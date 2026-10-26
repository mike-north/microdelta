/**
 * Exact-execution observation contracts and the finite reader. Supervision owns
 * the meaning of an observed run; Machine supplies storage and time mechanics.
 * The reader has no producer, callback, repair, or execution authority.
 * @packageDocumentation
 */
import { SqliteBusyError, SqliteReadError } from '@microdelta/machine';
import type { IClockCapability, IElapsedClockCapability, IRandomIdentifierCapability, ISqliteCapability, ISqliteConnection, ISqliteReadCapability, ITimerCapability } from '@microdelta/machine';

import type { IRunContext, IRunEvent, IRunResult, ISendInterruption } from './contracts.js';
import type { IStopState } from './control.js';
import { SupervisionError } from './errors.js';
import type { ISupervisionErrorCode } from './errors.js';

/** The host ports an observed run needs, supplied by assembly. @alpha */
export interface IExecutionObservationHost {
  readonly sqlite: ISqliteCapability;
  readonly reader: ISqliteReadCapability;
  readonly random: IRandomIdentifierCapability;
  readonly clock: IClockCapability;
  readonly elapsedClock: IElapsedClockCapability;
  readonly timer: ITimerCapability;
}

/**
 * The exact address of one owner-managed artifact. `location` is a nonempty
 * bounded path (at most 4096 UTF-16 code units); `executionId` is a freshly
 * minted 32-character lowercase hex identity. Reusing a public runId never
 * grants ownership of this locator or another execution's file. @alpha
 */
export interface IExecutionObservationLocator {
  readonly location: string;
  readonly executionId: string;
}

/**
 * The application's bounded final assertion about its deliverable. A generic
 * body return, lifecycle event or terminal execution status cannot establish
 * confirmation; the application must submit its own strict evidence. @alpha
 */
export type IApplicationStatement =
  | { readonly kind: 'not-classified' }
  | { readonly kind: 'incomplete'; readonly reasons: readonly ('required-work' | 'coverage' | 'publication' | 'other')[] }
  | { readonly kind: 'confirmed'; readonly deliverable: string };

/** Submit exactly one bounded final application assertion while the run is open. @alpha */
export interface IApplicationStatementSubmission {
  /** Duplicate identical assertions are idempotent; conflicts and post-close submissions reject. */
  submit(statement: IApplicationStatement): void;
}

/** Fixed event observations, never unique work counts or a progress denominator. @alpha */
export interface IExecutionObservationEventCounts {
  readonly step: number;
  readonly ordinary: number;
  readonly operation: number;
  readonly send: number;
  readonly wait: number;
  readonly promotion: number;
  readonly stop: number;
  readonly lowerBound: boolean;
}

/**
 * Observation-only failures seen by one producer. The count is exact through
 * the safe-integer maximum; `lowerBound` marks any further faults that could
 * not be counted precisely. It never changes execution or application status.
 * @alpha
 */
export interface IExecutionObservationFaultCount {
  /** Exact number of observed faults until saturation, then the safe maximum. */
  readonly count: number;
  /** True once one or more faults exceeded the exactly countable maximum. */
  readonly lowerBound: boolean;
}

/** The bounded latest facts about one exact execution. @alpha */
export interface IExecutionObservation {
  readonly executionId: string;
  /** Advances only with committed rows for this exact execution, never with pending samples. */
  readonly revision: number;
  /** Wall-clock date of these sampled facts; neither a heartbeat nor proof the process is still alive. */
  readonly sampledAt: number;
  /** Bounded public correlation names, independent of the exact execution identity. */
  readonly context: IRunContext;
  readonly phase: 'prepared' | 'running' | 'draining' | 'closed';
  readonly eventCounts: IExecutionObservationEventCounts;
  /** Observation-only storage/timer/clock faults retained even if terminal publication later succeeds. */
  readonly observationFaults?: IExecutionObservationFaultCount;
  /** Closing stop state, frozen at the actual run latch. */
  readonly stop?: IStopState;
  /** Earliest deferral left waiting when the run closed. */
  readonly waitingUntil?: number;
  /** Bounded diagnostic count, not messages. */
  readonly diagnostics?: { readonly present: boolean; readonly count: number; readonly lowerBound: boolean };
  /** Bounded counts of known and unknown remote work after local interruption. */
  readonly interruptions?: { readonly cancelled: number; readonly running: number; readonly unknown: number; readonly lowerBound: boolean };
  /** Typed failure category, never the arbitrary error value or message. */
  readonly executionFailure?: { readonly kind: 'supervision'; readonly code: ISupervisionErrorCode } | { readonly kind: 'other' };
  readonly body?: 'not-entered' | 'returned' | 'threw';
  readonly application?: IApplicationStatement;
}

/** One explicit finite read state. @alpha */
export type IExecutionObservationReadState =
  | { readonly kind: 'observed'; readonly observation: IExecutionObservation }
  | { readonly kind: 'absent' | 'identity-mismatch' | 'unsupported' | 'corrupt' | 'busy' | 'unavailable' | 'recovery-required' };

/** A single closed versioned JSON document for one exact locator. @alpha */
export interface IExecutionObservationReadResult {
  readonly version: 1;
  readonly result: IExecutionObservationReadState;
}

/**
 * Terminal durability knowledge, independent of the body's result. `uncertain`
 * requires exact-locator readback before claiming a terminal record; it never
 * authorizes rerunning analysis. `unprepared` means no analysis began. @alpha
 */
export type IObservationAcknowledgment =
  | { readonly kind: 'acknowledged'; readonly revision: number; readonly observationFaults?: IExecutionObservationFaultCount }
  | { readonly kind: 'uncertain'; readonly observationFaults?: IExecutionObservationFaultCount }
  | { readonly kind: 'unprepared' };

/** A started execution and its independent observation receipt; either promise may settle first. @alpha */
export interface IObservedRun<T> {
  readonly locator: IExecutionObservationLocator;
  readonly result: Promise<IRunResult<T>>;
  readonly acknowledgment: Promise<IObservationAcknowledgment>;
}

/** Only finite read and local handle release belong to an observer. @alpha */
export interface IExecutionObservationReader {
  /** Return one coherent versioned document or a finite refusal, without waiting or changing the artifact. */
  read(): IExecutionObservationReadResult;
  /** Idempotently release the local reader; later reads reject and execution continues independently. */
  close(): void;
}

/** The schema belongs to Supervision; the host owns only SQL mechanics. */
const observationTable = 'microdelta_execution_observation';
/** One bounded SQLite row means there is no event ledger or cross-execution catalog. */
const createTable = `CREATE TABLE IF NOT EXISTS ${observationTable} (slot INTEGER PRIMARY KEY CHECK (slot = 1), execution_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL)`;
/** A fixed query cannot execute application-provided SQL. */
const readRow = `SELECT execution_id, revision, document FROM ${observationTable} WHERE slot = 1`;

/** The private producer's contract to the run lifetime guard. */
export interface IExecutionObservationProducer {
  readonly locator: IExecutionObservationLocator;
  readonly acknowledgment: Promise<IObservationAcknowledgment>;
  settleIfNeeded(): void;
  prepare(context: IRunContext): void;
  phase(phase: 'running' | 'draining'): void;
  observe(event: IRunEvent): void;
  submit(statement: IApplicationStatement): void;
  seal(): void;
  close(body: 'not-entered' | 'returned' | 'threw', facts?: IExecutionObservationTerminalFacts): void;
}

/** Actual run facts supplied only by the owning lifetime guard. */
export interface IExecutionObservationTerminalFacts {
  readonly stop: IStopState;
  readonly waitingUntil?: number;
  readonly diagnostics: number;
  readonly interruptions: readonly ISendInterruption[];
  readonly failure?: unknown;
}

/** Saturate a count instead of allowing an unsafe integer to claim precision. */
function countBounded(value: number): { readonly count: number; readonly lowerBound: boolean } {
  return { count: Math.min(Number.MAX_SAFE_INTEGER, value), lowerBound: value >= Number.MAX_SAFE_INTEGER };
}

/**
 * Advance one fixed event route without claiming unsafe precision. The exact
 * maximum remains a count; an attempted step beyond it makes every later
 * snapshot a lower bound, even when another route is still exactly countable.
 * @internal
 */
export function _incrementObservationEventCounts(current: IExecutionObservationEventCounts, kind: IRunEvent['kind']): IExecutionObservationEventCounts {
  const previous = current[kind];
  const saturated = previous >= Number.MAX_SAFE_INTEGER;
  return Object.freeze({ ...current, [kind]: saturated ? previous : previous + 1, lowerBound: current.lowerBound || saturated });
}

/** Keep observation fault arithmetic truthful at the chosen counter boundary. @internal */
export function _incrementObservationFaults(current: IExecutionObservationFaultCount): IExecutionObservationFaultCount {
  const saturated = current.count >= Number.MAX_SAFE_INTEGER;
  return Object.freeze({ count: saturated ? current.count : current.count + 1, lowerBound: current.lowerBound || saturated });
}

/** Copy only closed remote-state categories, never interruption labels. */
function remoteCounts(interruptions: readonly ISendInterruption[]): { readonly cancelled: number; readonly running: number; readonly unknown: number; readonly lowerBound: boolean } {
  const current = { cancelled: 0, running: 0, unknown: 0, lowerBound: false };
  for (const item of interruptions) {
    if (item.remote === 'cancelled' || item.remote === 'running' || item.remote === 'unknown') {
      if (current[item.remote] === Number.MAX_SAFE_INTEGER) { current.lowerBound = true; }
      else { current[item.remote] += 1; }
    }
  }
  return current;
}

/**
 * Own one bounded latest artifact for a single execution. Its identity is
 * freshly minted before preparation; the locator is usable as an exact query
 * target, but only a committed prepared row is evidence that work began.
 * @internal
 */
export function _createExecutionObservationProducer(host: IExecutionObservationHost, location: string): IExecutionObservationProducer {
  const executionId = host.random.randomIdentifier();
  if (!/^[0-9a-f]{32}$/u.test(executionId)) {
    throw new TypeError('Observation identity source returned an invalid identifier');
  }
  const locator = Object.freeze({ location, executionId });
  let connection: ISqliteConnection | undefined;
  let snapshot: IExecutionObservation | undefined;
  let resolveAcknowledgment: (ack: IObservationAcknowledgment) => void = () => undefined;
  const acknowledgment = new Promise<IObservationAcknowledgment>((resolve) => { resolveAcknowledgment = resolve; });
  let settled = false;
  let sealed = false;
  let application: IApplicationStatement | undefined;
  let phase: IExecutionObservation['phase'] = 'prepared';
  let eventCounts: IExecutionObservationEventCounts = Object.freeze({ step: 0, ordinary: 0, operation: 0, send: 0, wait: 0, promotion: 0, stop: 0, lowerBound: false });
  let pending = false;
  let nextOrdinaryElapsed = 0;
  let cancelTimer: (() => void) | undefined;
  let observationFaults: IExecutionObservationFaultCount = Object.freeze({ count: 0, lowerBound: false });
  /** Settle durability once, so a later error cannot revise the receipt. */
  const settle = (ack: IObservationAcknowledgment): void => {
    if (!settled) {
      settled = true;
      resolveAcknowledgment(Object.freeze(ack));
    }
  };
  /** Observation-only faults never propagate to execution, even from a host callback. */
  const fault = (): void => { observationFaults = _incrementObservationFaults(observationFaults); };
  /** Cancel the one pending ordinary sample; terminal publication supersedes it. */
  const cancelPending = (): void => {
    const cancel = cancelTimer;
    cancelTimer = undefined;
    try { cancel?.(); } catch { fault(); }
  };
  /** The latest bounded facts; a completed commit alone advances the revision. */
  const makeSnapshot = (nextPhase: IExecutionObservation['phase'], revision: number, sampledAt: number): IExecutionObservation => {
    if (snapshot === undefined) { throw new Error('Observation has no prepared sample'); }
    return Object.freeze({ ...snapshot, phase: nextPhase, revision, sampledAt, eventCounts });
  };
  /** Schedule one ordinary sample from monotonic elapsed time, tolerating wall-clock correction. */
  const schedule = (): void => {
    if (!pending || sealed || cancelTimer !== undefined) { return; }
    try {
      const remaining = Math.max(0, nextOrdinaryElapsed - host.elapsedClock.currentElapsedMilliseconds());
      const due = host.clock.currentEpochMilliseconds() + remaining;
      cancelTimer = host.timer.schedule(due, () => {
        cancelTimer = undefined;
        if (sealed || !pending || snapshot === undefined || connection === undefined) { return; }
        try {
          const elapsed = host.elapsedClock.currentElapsedMilliseconds();
          if (elapsed < nextOrdinaryElapsed) { schedule(); return; }
          const ordinary = makeSnapshot(phase, snapshot.revision + 1, host.clock.currentEpochMilliseconds());
          const document = JSON.stringify({ version: 1, result: { kind: 'observed', observation: ordinary } });
          const written = connection.prepare(`UPDATE ${observationTable} SET revision = ?, document = ? WHERE slot = 1 AND execution_id = ? AND revision = ?`).run(ordinary.revision, document, executionId, snapshot.revision);
          if (written.changes !== 1) { fault(); return; }
          snapshot = ordinary;
          pending = false;
          nextOrdinaryElapsed = elapsed + 1000;
        } catch { fault(); }
      });
    } catch { fault(); }
  };
  /** Any event or live phase update replaces the single newest pending ordinary sample. */
  const changed = (): void => { pending = true; schedule(); };
  return Object.freeze({
    locator,
    acknowledgment,
    settleIfNeeded(): void {
      if (!settled) { settle(snapshot === undefined ? { kind: 'unprepared' } : { kind: 'uncertain', ...(observationFaults.count === 0 ? {} : { observationFaults }) }); }
    },
    prepare(context: IRunContext): void {
      try {
        if (!boundedText(location, 4096) || !boundedText(context.runId, 256)
          || !boundedText(context.analysis, 256) || !boundedText(context.environment, 256)) {
          throw new TypeError('Execution observation needs bounded locator and context identifiers');
        }
        connection = host.sqlite.openSqlite(location, { journalMode: 'delete', creation: 'exclusive' });
        connection.exec(createTable);
        const prepared: IExecutionObservation = Object.freeze({
          executionId,
          revision: 1,
          sampledAt: host.clock.currentEpochMilliseconds(),
          context,
          phase: 'prepared',
          eventCounts: { step: 0, ordinary: 0, operation: 0, send: 0, wait: 0, promotion: 0, stop: 0, lowerBound: false },
        });
        const document = JSON.stringify({ version: 1, result: { kind: 'observed', observation: prepared } });
        connection.prepare(`INSERT INTO ${observationTable} (slot, execution_id, revision, document) VALUES (1, ?, ?, ?)`).run(executionId, 1, document);
        snapshot = prepared;
        nextOrdinaryElapsed = host.elapsedClock.currentElapsedMilliseconds() + 1000;
      } catch (error: unknown) {
        try { connection?.close(); } catch { /* The original preparation failure remains authoritative. */ }
        connection = undefined;
        settle({ kind: 'unprepared' });
        throw error;
      }
    },
    phase(next: 'running' | 'draining'): void {
      if (sealed || snapshot === undefined) { return; }
      phase = next;
      changed();
    },
    observe(event: IRunEvent): void {
      if (sealed || snapshot === undefined) { return; }
      try {
        eventCounts = _incrementObservationEventCounts(eventCounts, event.kind);
        changed();
      } catch { fault(); }
    },
    submit(statement: IApplicationStatement): void {
      if (sealed) { throw new Error('Execution observation statement is sealed'); }
      const canonical = canonicalStatement(statement);
      if (application !== undefined && JSON.stringify(application) !== JSON.stringify(canonical)) {
        throw new Error('Execution observation statement conflicts with the submitted statement');
      }
      application = canonical;
    },
    seal(): void { sealed = true; },
    close(body: 'not-entered' | 'returned' | 'threw', facts?: IExecutionObservationTerminalFacts): void {
      sealed = true;
      cancelPending();
      if (snapshot === undefined || connection === undefined) {
        settle({ kind: 'unprepared' });
        return;
      }
      try {
        const executionFailure: IExecutionObservation['executionFailure'] | undefined = body === 'returned' || facts?.failure === undefined
          ? undefined
          : closedExecutionFailure(facts.failure);
        const terminal: IExecutionObservation = Object.freeze({
          ...snapshot,
          revision: snapshot.revision + 1,
          sampledAt: host.clock.currentEpochMilliseconds(),
          phase: 'closed',
          eventCounts,
          body,
          application: application ?? Object.freeze({ kind: 'not-classified' }),
          ...(observationFaults.count === 0 ? {} : { observationFaults }),
          ...(facts === undefined ? {} : {
            stop: Object.freeze({ level: facts.stop.level, cause: facts.stop.cause, deadline: facts.stop.deadline }),
            ...(facts.waitingUntil === undefined ? {} : { waitingUntil: facts.waitingUntil }),
            diagnostics: Object.freeze({ present: facts.diagnostics > 0, ...countBounded(facts.diagnostics) }),
            interruptions: Object.freeze(remoteCounts(facts.interruptions)),
            ...(executionFailure === undefined ? {} : { executionFailure }),
          }),
        });
        const document = JSON.stringify({ version: 1, result: { kind: 'observed', observation: terminal } });
        const written = connection.prepare(`UPDATE ${observationTable} SET revision = ?, document = ? WHERE slot = 1 AND execution_id = ? AND revision = ?`).run(terminal.revision, document, executionId, snapshot.revision);
        settle(written.changes === 1 ? { kind: 'acknowledged', revision: terminal.revision, ...(observationFaults.count === 0 ? {} : { observationFaults }) } : { kind: 'uncertain', ...(observationFaults.count === 0 ? {} : { observationFaults }) });
      } catch {
        settle({ kind: 'uncertain', ...(observationFaults.count === 0 ? {} : { observationFaults }) });
      } finally {
        try { connection.close(); } catch { /* Observation health stays separate from execution outcome. */ }
      }
    },
  });
}

/**
 * Copy an application assertion into Supervision-owned finite primitives. The
 * caller's arrays and objects can mutate after submission; their later state
 * has no authority over the sealed terminal record.
 */
function canonicalStatement(statement: IApplicationStatement): IApplicationStatement {
  if (typeof statement !== 'object' || statement === null || !('kind' in statement)) {
    throw new TypeError('Application statement must be a bounded final assertion');
  }
  if (statement.kind === 'not-classified') { return Object.freeze({ kind: 'not-classified' }); }
  if (statement.kind === 'confirmed') {
    if (typeof statement.deliverable !== 'string' || statement.deliverable.length < 1 || statement.deliverable.length > 256) {
      throw new TypeError('Confirmed deliverable locator must be a bounded nonempty string');
    }
    return Object.freeze({ kind: 'confirmed', deliverable: statement.deliverable });
  }
  if (statement.kind === 'incomplete') {
    if (!Array.isArray(statement.reasons) || statement.reasons.length > 4 || statement.reasons.length === 0) {
      throw new TypeError('Incomplete reasons must be a finite nonempty set');
    }
    const candidates: readonly unknown[] = statement.reasons;
    const reasons: ('required-work' | 'coverage' | 'publication' | 'other')[] = [];
    for (const reason of candidates) {
      if (!isIncompleteReason(reason)) { throw new TypeError('Incomplete reason is unsupported'); }
      if (!reasons.includes(reason)) { reasons.push(reason); }
    }
    return Object.freeze({ kind: 'incomplete', reasons: Object.freeze(reasons.sort()) });
  }
  throw new TypeError('Application statement kind is unsupported');
}

/** An object with only data fields, used before reconstructing a trusted protocol result. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reject foreign fields so a corrupt file cannot smuggle arbitrary author data into JSON output. */
function exactFields(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/** Bounded identifier/string rule shared by stored context and locator validation. */
function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

/** The application may report only these finite unmet-obligation categories. */
function isIncompleteReason(value: unknown): value is 'required-work' | 'coverage' | 'publication' | 'other' {
  return value === 'required-work' || value === 'coverage' || value === 'publication' || value === 'other';
}

/** Parse one application assertion from fixed finite data, never a user serializer. */
function readApplication(value: unknown): IApplicationStatement | undefined {
  if (!record(value) || !('kind' in value)) { return undefined; }
  if (value.kind === 'not-classified' && exactFields(value, ['kind'])) { return { kind: 'not-classified' }; }
  if (value.kind === 'confirmed' && exactFields(value, ['kind', 'deliverable']) && boundedText(value.deliverable, 256)) {
    return { kind: 'confirmed', deliverable: value.deliverable };
  }
  if (value.kind === 'incomplete' && exactFields(value, ['kind', 'reasons']) && Array.isArray(value.reasons) && value.reasons.length > 0 && value.reasons.length <= 4) {
    const candidates: readonly unknown[] = value.reasons;
    const reasons: ('required-work' | 'coverage' | 'publication' | 'other')[] = [];
    for (const candidate of candidates) {
      if (!isIncompleteReason(candidate)) { return undefined; }
      if (reasons.includes(candidate)) { return undefined; }
      reasons.push(candidate);
    }
    return { kind: 'incomplete', reasons };
  }
  return undefined;
}

/** The three remote-state counts and saturation flag are a fixed finite summary. */
function remoteFieldsValid(value: Record<string, unknown>): boolean {
  return ['cancelled', 'running', 'unknown'].every((key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)
    && typeof value.lowerBound === 'boolean';
}

/** The reader accepts only Supervision's public closed failure vocabulary. */
const supervisionFailureCodes: Readonly<Record<ISupervisionErrorCode, true>> = Object.freeze({
  'outside-run': true,
  'run-closed': true,
  'composition-phase': true,
  'observer-failure': true,
  'writer-busy': true,
  'invalid-request': true,
  'invalid-response': true,
  'rate-timing-failed': true,
  stopped: true,
  'operation-failed': true,
  'operation-classification-failed': true,
  'operation-classification-incomplete': true,
  'operation-deferred': true,
  'operation-unknown': true,
  'operation-exhausted': true,
  'operation-unrecorded': true,
  'operation-resolved': true,
  integrity: true,
  'undeclared-call': true,
});

/** Do not let a file turn arbitrary bounded text into a typed failure code. */
function knownSupervisionFailureCode(value: unknown): value is ISupervisionErrorCode {
  return typeof value === 'string' && Object.hasOwn(supervisionFailureCodes, value);
}

/** Class identity alone cannot make a caller-created error code part of the closed observation vocabulary. */
function closedExecutionFailure(failure: unknown): NonNullable<IExecutionObservation['executionFailure']> {
  try {
    if (failure instanceof SupervisionError) {
      const code: unknown = failure.code;
      if (knownSupervisionFailureCode(code)) { return { kind: 'supervision', code }; }
    }
  } catch { /* An untrusted error accessor cannot enlarge the stored failure vocabulary. */ }
  return { kind: 'other' };
}

/** Parse only the finite schema the producer owns; foreign content is corrupt. */
function parseDocument(value: unknown, locator: IExecutionObservationLocator, revision: number): IExecutionObservationReadResult {
  if (typeof value !== 'string') { return { version: 1, result: { kind: 'corrupt' } }; }
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return { version: 1, result: { kind: 'corrupt' } }; }
  if (!record(parsed) || parsed.version !== 1) {
    return { version: 1, result: { kind: record(parsed) && 'version' in parsed ? 'unsupported' : 'corrupt' } };
  }
  if (!exactFields(parsed, ['version', 'result']) || !record(parsed.result) || parsed.result.kind !== 'observed' || !exactFields(parsed.result, ['kind', 'observation']) || !record(parsed.result.observation)) {
    return { version: 1, result: { kind: 'corrupt' } };
  }
  const raw = parsed.result.observation;
  if (!exactFields(raw, ['executionId', 'revision', 'sampledAt', 'context', 'phase', 'eventCounts', 'observationFaults', 'stop', 'waitingUntil', 'diagnostics', 'interruptions', 'executionFailure', 'body', 'application'])
    || raw.executionId !== locator.executionId || raw.revision !== revision
    || typeof raw.sampledAt !== 'number' || !Number.isSafeInteger(raw.sampledAt)
    || !record(raw.context) || !exactFields(raw.context, ['runId', 'analysis', 'environment'])
    || !boundedText(raw.context.runId, 256) || !boundedText(raw.context.analysis, 256) || !boundedText(raw.context.environment, 256)
    || (raw.phase !== 'prepared' && raw.phase !== 'running' && raw.phase !== 'draining' && raw.phase !== 'closed')) {
    return { version: 1, result: { kind: 'corrupt' } };
  }
  const context: IRunContext = { runId: raw.context.runId, analysis: raw.context.analysis, environment: raw.context.environment };
  if ('observationFaults' in raw && (!record(raw.observationFaults) || !exactFields(raw.observationFaults, ['count', 'lowerBound'])
    || typeof raw.observationFaults.count !== 'number' || !Number.isSafeInteger(raw.observationFaults.count) || raw.observationFaults.count < 1
    || typeof raw.observationFaults.lowerBound !== 'boolean')) { return { version: 1, result: { kind: 'corrupt' } }; }
  const health = record(raw.observationFaults)
    ? { observationFaults: { count: Number(raw.observationFaults.count), lowerBound: raw.observationFaults.lowerBound === true } }
    : {};
  let terminalFacts: Pick<IExecutionObservation, 'stop' | 'waitingUntil' | 'diagnostics' | 'interruptions' | 'executionFailure'> = {};
  if (raw.phase === 'closed') {
    if (!record(raw.stop) || !exactFields(raw.stop, ['level', 'cause', 'deadline']) || (raw.stop.level !== 'none' && raw.stop.level !== 'soft' && raw.stop.level !== 'hard')
      || ('cause' in raw.stop && raw.stop.cause !== 'operator' && raw.stop.cause !== 'deadline')
      || ('deadline' in raw.stop && (typeof raw.stop.deadline !== 'number' || !Number.isSafeInteger(raw.stop.deadline)))
      || !record(raw.diagnostics) || !exactFields(raw.diagnostics, ['present', 'count', 'lowerBound'])
      || typeof raw.diagnostics.present !== 'boolean' || typeof raw.diagnostics.count !== 'number' || !Number.isSafeInteger(raw.diagnostics.count) || raw.diagnostics.count < 0 || typeof raw.diagnostics.lowerBound !== 'boolean'
      || !record(raw.interruptions) || !exactFields(raw.interruptions, ['cancelled', 'running', 'unknown', 'lowerBound'])
      || !remoteFieldsValid(raw.interruptions)
      || ('waitingUntil' in raw && (typeof raw.waitingUntil !== 'number' || !Number.isSafeInteger(raw.waitingUntil)))) {
      return { version: 1, result: { kind: 'corrupt' } };
    }
    const stop: IStopState = { level: raw.stop.level, cause: raw.stop.cause === 'operator' || raw.stop.cause === 'deadline' ? raw.stop.cause : undefined, deadline: typeof raw.stop.deadline === 'number' ? raw.stop.deadline : undefined };
    const diagnostics = { present: raw.diagnostics.present, count: raw.diagnostics.count, lowerBound: raw.diagnostics.lowerBound };
    const interruptions = { cancelled: Number(raw.interruptions.cancelled), running: Number(raw.interruptions.running), unknown: Number(raw.interruptions.unknown), lowerBound: raw.interruptions.lowerBound === true };
    let executionFailure: IExecutionObservation['executionFailure'];
    if ('executionFailure' in raw) {
      const failure = raw.executionFailure;
      if (!record(failure) || !exactFields(failure, ['kind', 'code'])) {
        return { version: 1, result: { kind: 'corrupt' } };
      }
      if (failure.kind === 'other' && !('code' in failure)) { executionFailure = { kind: 'other' }; }
      else if (failure.kind === 'supervision' && knownSupervisionFailureCode(failure.code)) {
        executionFailure = { kind: 'supervision', code: failure.code };
      } else { return { version: 1, result: { kind: 'corrupt' } }; }
    }
    terminalFacts = { stop, diagnostics, interruptions, ...(typeof raw.waitingUntil === 'number' ? { waitingUntil: raw.waitingUntil } : {}), ...(executionFailure === undefined ? {} : { executionFailure }) };
  } else if ('stop' in raw || 'waitingUntil' in raw || 'diagnostics' in raw || 'interruptions' in raw || 'executionFailure' in raw) {
    return { version: 1, result: { kind: 'corrupt' } };
  }
  if (!record(raw.eventCounts)) { return { version: 1, result: { kind: 'corrupt' } }; }
  const rawCounts = raw.eventCounts;
  if (!exactFields(rawCounts, ['step', 'ordinary', 'operation', 'send', 'wait', 'promotion', 'stop', 'lowerBound'])
    || !['step', 'ordinary', 'operation', 'send', 'wait', 'promotion', 'stop'].every((key) => typeof rawCounts[key] === 'number' && Number.isSafeInteger(rawCounts[key]) && Number(rawCounts[key]) >= 0)
    || typeof rawCounts.lowerBound !== 'boolean') {
    return { version: 1, result: { kind: 'corrupt' } };
  }
  const counts: IExecutionObservationEventCounts = {
    step: Number(rawCounts.step), ordinary: Number(rawCounts.ordinary), operation: Number(rawCounts.operation),
    send: Number(rawCounts.send), wait: Number(rawCounts.wait), promotion: Number(rawCounts.promotion),
    stop: Number(rawCounts.stop), lowerBound: rawCounts.lowerBound,
  };
  if (raw.phase === 'closed') {
    const application = readApplication(raw.application);
    if ((raw.body !== 'not-entered' && raw.body !== 'returned' && raw.body !== 'threw') || application === undefined) {
      return { version: 1, result: { kind: 'corrupt' } };
    }
    return { version: 1, result: { kind: 'observed', observation: { executionId: locator.executionId, revision, sampledAt: raw.sampledAt, context, phase: 'closed', eventCounts: counts, ...health, ...terminalFacts, body: raw.body, application } } };
  }
  if ('body' in raw || 'application' in raw) { return { version: 1, result: { kind: 'corrupt' } }; }
  return { version: 1, result: { kind: 'observed', observation: { executionId: locator.executionId, revision, sampledAt: raw.sampledAt, context, phase: raw.phase, eventCounts: counts, ...health } } };
}

/** Open one exact artifact without invoking author code or execution controls. @alpha */
export function openExecutionObservationReader(host: ISqliteReadCapability, locator: IExecutionObservationLocator): IExecutionObservationReader {
  const exact = Object.freeze({ location: locator.location, executionId: locator.executionId });
  if (!boundedText(exact.location, 4096) || !/^[0-9a-f]{32}$/u.test(exact.executionId)) {
    throw new TypeError('Execution observation reader needs a bounded exact locator');
  }
  let closed = false;
  return Object.freeze({
    read(): IExecutionObservationReadResult {
      if (closed) { throw new Error('Execution observation reader is closed'); }
      let reader;
      try {
        reader = host.openSqliteReader(exact.location);
        const table = reader.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(observationTable);
        if (table === undefined) { return { version: 1, result: { kind: 'unsupported' } }; }
        const row = reader.prepare(readRow).get();
        if (row === undefined) { return { version: 1, result: { kind: 'absent' } }; }
        if (row.execution_id !== exact.executionId) { return { version: 1, result: { kind: 'identity-mismatch' } }; }
        if (typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1) { return { version: 1, result: { kind: 'corrupt' } }; }
        return parseDocument(row.document, exact, row.revision);
      } catch (error: unknown) {
        return { version: 1, result: { kind: error instanceof SqliteBusyError ? 'busy' : error instanceof SqliteReadError ? error.code : 'unavailable' } };
      } finally {
        try { reader?.close(); } catch { /* A finite read result remains finite if release fails. */ }
      }
    },
    close(): void { closed = true; },
  });
}
