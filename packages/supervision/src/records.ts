/**
 * Supervision's durable operation records and their codec (RUN-011/012/014).
 * History stores these as opaque versioned journal records; their meaning is
 * Supervision's alone, and this module is the only place that encodes or
 * decodes them.
 *
 * Two collections hold them, both in the run's environment namespace:
 *
 * - **operations** (`microdelta.supervision.operations`), keyed by operation
 *   identity: one record per external operation with its address, safety
 *   basis, policy, status, "not before" time, every request attempt and any
 *   operator settlement;
 * - **blocks** (`microdelta.supervision.blocks`), keyed by subject: the
 *   operations holding that subject's addresses: those still unsettled
 *   (`pending`, `deferred`, `unknown` or invocation-scoped `retry-exhausted`), and those an operator resolved as
 *   succeeded, whose address stays consumed. Admission reads it to honor a
 *   deferral, an exhausted invocation or an unknown outcome whose current run allowance is spent
 *   before any claim; a call reads it to reuse an unsettled operation's
 *   identity or to refuse a resolved address.
 *   An operation leaves it, in the same commit, exactly when it settles any
 *   other way.
 *
 * A stored record that does not decode is integrity damage, reported as a
 * typed error rather than guessed at.
 */
import { SupervisionError } from './errors.js';
import { blocksFormat, operationFormat } from './operations.js';
import type {
  IAttemptUsage,
  IJournalRecordValue,
  IOperationRemoteState,
  IOperationSettlementRecord,
  IOperationStatus,
  IOperationSubject,
  IOperationView,
  IRetryDecision,
  IRetryFacts,
  IRetryOutcome,
  IRetrySourceScope,
  IRequestAttemptStatus,
  IRequestAttemptView,
} from './operations.js';

/** Historical author/deduplication hint retained in journal records; acquisition retry no longer requires it. */
export type ISafetyBasis = 'none' | 'safe-to-repeat' | 'provider-idempotency';

/** One request attempt as stored, with immutable public attribution and private allowance membership. */
export interface IAttemptRecord {
  readonly requestAttempt: string;
  readonly run: string;
  /** Private invocation identity used only for this run's finite allowance; absent on historical v1 attempts. */
  readonly runInstance?: string | undefined;
  readonly stepAttempt: string;
  readonly status: IRequestAttemptStatus;
  readonly remote: IOperationRemoteState | undefined;
  readonly usage: IAttemptUsage | undefined;
  /**
   * For an attempt never sent, `unconfirmed` when its usage intent may have
   * landed (Accounting could not confirm the commit), so a retry restates it
   * under this attempt's identity and attribution; otherwise undefined.
   */
  readonly intent: 'unconfirmed' | undefined;
  /** Accepted source decision for this response, if classification was committed. */
  readonly decision?: IRetryDecision | undefined;
  /** The exact source selected when this response was observed; historical attempts remain unchanged across runs. */
  readonly source?: IRetrySourceScope | undefined;
  /** The normalized response category, including transient meaning independent of provider facts. */
  readonly outcome?: IRetryOutcome | undefined;
  /** Detached bounded response observations retained even if a later run replaces current classification state. */
  readonly facts?: IRetryFacts | undefined;
}

/** One external operation as stored; all historical attempts remain after a run's allowance resets. */
export interface IOperationRecord {
  readonly operation: string;
  /** The subject and compatibility group that own the operation; analysis and environment are the namespace's. */
  readonly subject: string;
  readonly version: number;
  readonly member: string | undefined;
  readonly name: string;
  /** The author's opaque request binding: part of the address, never reported. */
  readonly binding: string;
  readonly safety: ISafetyBasis;
  readonly maxAttempts: number;
  /** Legacy rate-only retry subcap, never a separate pool above maxAttempts. */
  readonly rateLimitRetries: number;
  readonly status: IOperationStatus;
  /** Consecutive intents of this operation that could not be made durable; it sets the intent retry backoff. */
  readonly unrecorded: number;
  readonly notBefore: number | undefined;
  /** Persisted source-classification state, separate from provider status and outward member outcome. */
  readonly classification?: IClassificationRecord | undefined;
  /** The selected tuple, including absence, bound to one private run for every later pass of that run. */
  readonly sourceSelection?: { readonly runInstance: string; readonly scope: IRetrySourceScope | undefined } | undefined;
  /** Last accepted retry duration in this run, independent of its absolute provider floor. */
  readonly previousDelayMilliseconds?: number | undefined;
  /** The private invocation whose known refusal exhausted allowance; v3 and v4 retain this authority. */
  readonly retryExhaustedRunInstance?: string | undefined;
  readonly attempts: readonly IAttemptRecord[];
  readonly settlement: IOperationSettlementRecord | undefined;
  /**
   * The resolution as succeeded that an abandonment superseded, kept so the
   * record still shows that an operator asserted the effect happened (and its
   * usage report) before authorizing a possible second effect.
   */
  readonly resolution: IOperationSettlementRecord | undefined;
}

/** Durable retry-policy lifecycle state; it carries no allowance or dispatch authority. */
export type IClassificationRecord =
  | { readonly kind: 'pending'; readonly runInstance: string; readonly requestAttempt: string; readonly source: IRetrySourceScope | undefined; readonly outcome: IRetryOutcome; readonly facts: IRetryFacts; readonly generation: string }
  | { readonly kind: 'accepted'; readonly runInstance: string; readonly decision: IRetryDecision; readonly delayMilliseconds: number; readonly notBefore: number }
  | { readonly kind: 'failed'; readonly runInstance: string; readonly code: 'policy-error' }
  | { readonly kind: 'cancelled'; readonly runInstance: string; readonly code: 'stopped' }
  | { readonly kind: 'no-retry'; readonly runInstance: string; readonly code: 'policy-exhausted' };

/** One unsettled operation at a subject's address, as the block index lists it. */
export interface IBlockEntry {
  readonly operation: string;
  readonly name: string;
  readonly binding: string;
}

/** The statuses that keep an operation in its subject's block index. */
const unsettled: ReadonlySet<IOperationStatus> = new Set<IOperationStatus>(['pending', 'deferred', 'unknown', 'retry-exhausted']);

/** Whether an operation status is unsettled, including known exhaustion awaiting a new run. */
export function isUnsettled(status: IOperationStatus): boolean {
  return unsettled.has(status);
}

/**
 * Whether an operation holds its address in the subject's block index: while
 * unsettled, and for good once an operator resolved it as succeeded, because
 * its effect happened and the same intended request must never be sent again
 * (RUN-012, A-12). Every other settlement frees the address.
 */
export function holdsAddress(record: Pick<IOperationRecord, 'status' | 'settlement'>): boolean {
  return isUnsettled(record.status) || (record.status === 'resolved' && record.settlement?.outcome === 'succeeded');
}

/** The journal key of a subject's block index entry: its subject and compatibility group, unambiguously. */
export function subjectKey(subject: Pick<IOperationSubject, 'subject' | 'version'>): string {
  return JSON.stringify([subject.subject, subject.version]);
}

/** Persisted sent-attempt evidence for one invocation; a live engine may know a pending intent never dispatched. */
export function spentAttempts(record: IOperationRecord, runInstance: string): number {
  return record.attempts.filter((attempt) => attempt.status !== 'not-sent' && attempt.runInstance === runInstance).length;
}

/** Rate refusals within one invocation: a restrictive legacy subcap, never additional allowance. */
export function rateLimited(record: IOperationRecord, runInstance: string): number {
  return record.attempts.filter((attempt) => attempt.status === 'rate-limited' && attempt.runInstance === runInstance).length;
}

/**
 * Whether another acquisition attempt is allowed after an unknown response.
 * Provider idempotency helps deduplication, but is not retry authority for
 * data acquisition; only the current invocation's finite tally governs.
 */
export function unknownRetry(record: Pick<IOperationRecord, 'maxAttempts'>, spent: number): 'retry' | 'policy-exhausted' {
  return spent < record.maxAttempts ? 'retry' : 'policy-exhausted';
}

/** Encode v4 operation records while carrying legacy attempts without inventing invocation identity. */
export function encodeOperation(record: IOperationRecord): IJournalRecordValue {
  return {
    format: operationFormat,
    formatVersion: 4,
    content: {
      operation: record.operation,
      subject: record.subject,
      version: record.version,
      member: record.member ?? null,
      name: record.name,
      binding: record.binding,
      safety: record.safety,
      maxAttempts: record.maxAttempts,
      rateLimitRetries: record.rateLimitRetries,
      status: record.status,
      unrecorded: record.unrecorded,
      notBefore: record.notBefore ?? null,
      previousDelayMilliseconds: record.previousDelayMilliseconds ?? null,
      classification: record.classification === undefined ? null : encodeClassification(record.classification),
      sourceSelection: record.sourceSelection === undefined ? null : {
        runInstance: record.sourceSelection.runInstance,
        scope: record.sourceSelection.scope === undefined ? null : encodeSource(record.sourceSelection.scope),
      },
      retryExhaustedRunInstance: record.status === 'retry-exhausted' ? record.retryExhaustedRunInstance ?? null : null,
      attempts: record.attempts.map((attempt) => ({
        requestAttempt: attempt.requestAttempt,
        run: attempt.run,
        runInstance: attempt.runInstance ?? null,
        stepAttempt: attempt.stepAttempt,
        status: attempt.status,
        remote: attempt.remote ?? null,
        usage: attempt.usage ?? null,
        intent: attempt.intent ?? null,
        decision: attempt.decision === undefined ? null : encodeDecision(attempt.decision),
        source: attempt.source === undefined ? null : encodeSource(attempt.source),
        outcome: attempt.outcome === undefined ? null : encodeOutcome(attempt.outcome),
        facts: attempt.facts === undefined ? null : encodeFacts(attempt.facts),
      })),
      settlement: record.settlement === undefined ? null : encodeSettlement(record.settlement),
      resolution: record.resolution === undefined ? null : encodeSettlement(record.resolution),
    },
  };
}

/** Encode only the exact, non-secret source identity; each occurrence is independent Value data. */
function encodeSource(scope: IRetrySourceScope): Record<string, unknown> {
  return { source: scope.source, service: scope.service, connection: scope.connection };
}

/** Encode the normalized provider category apart from its bounded source facts. */
function encodeOutcome(outcome: IRetryOutcome): Record<string, unknown> {
  return outcome.kind === 'failed' ? { kind: outcome.kind, transient: outcome.transient } : { kind: outcome.kind };
}

/** Encode a detached bounded fact set without retaining the adapter's array identity. */
function encodeFacts(facts: IRetryFacts): Record<string, unknown> {
  return {
    ...(facts.httpStatus === undefined ? {} : { httpStatus: facts.httpStatus }),
    ...(facts.providerCode === undefined ? {} : { providerCode: facts.providerCode }),
    ...(facts.conditions === undefined ? {} : { conditions: [...facts.conditions] }),
  };
}

/**
 * Give each durable decision occurrence its own closed data value. History's
 * snapshot format rejects shared object references, while the attempt and
 * accepted classification both retain the same semantic choice.
 */
function encodeDecision(decision: IRetryDecision): Record<string, unknown> {
  switch (decision.kind) {
    case 'retry-now':
    case 'stop':
      return { kind: decision.kind };
    case 'retry-after':
      return { kind: decision.kind, delayMilliseconds: decision.delayMilliseconds };
    default: {
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}

/** Encode only the bounded callback lifecycle; provider errors and raw metadata never persist here. */
function encodeClassification(classification: IClassificationRecord): Record<string, unknown> {
  switch (classification.kind) {
    case 'pending':
      return {
        kind: classification.kind,
        runInstance: classification.runInstance,
        requestAttempt: classification.requestAttempt,
        source: classification.source === undefined ? null : encodeSource(classification.source),
        outcome: encodeOutcome(classification.outcome),
        facts: encodeFacts(classification.facts),
        generation: classification.generation,
      };
    case 'accepted':
      return { kind: classification.kind, runInstance: classification.runInstance, decision: encodeDecision(classification.decision), delayMilliseconds: classification.delayMilliseconds, notBefore: classification.notBefore };
    case 'failed':
    case 'cancelled':
    case 'no-retry':
      return { kind: classification.kind, runInstance: classification.runInstance, code: classification.code };
    default: {
      const exhaustive: never = classification;
      return exhaustive;
    }
  }
}

/** Encode one operator settlement record. */
function encodeSettlement(settlement: IOperationSettlementRecord): Record<string, unknown> {
  return {
    action: settlement.action,
    outcome: settlement.outcome ?? null,
    operator: settlement.operator,
    at: settlement.at,
    report: settlement.report ?? null,
  };
}

/** Decode one stored operator settlement record. */
function decodeSettlement(settlement: unknown, what: string): IOperationSettlementRecord {
  if (typeof settlement !== 'object' || settlement === null || Array.isArray(settlement)) {
    return damaged(what);
  }
  return {
    action: oneOf(settlement, 'action', ['resolve', 'abandon'], what),
    outcome: optionalOneOf(settlement, 'outcome', ['succeeded', 'failed'], what),
    operator: text(settlement, 'operator', what),
    at: whole(settlement, 'at', what),
    report: optionalText(settlement, 'report', what),
  };
}

/** Encode a subject's block index. */
export function encodeBlocks(subject: Pick<IOperationSubject, 'subject' | 'version'>, entries: readonly IBlockEntry[]): IJournalRecordValue {
  return {
    format: blocksFormat,
    formatVersion: 1,
    content: {
      subject: subject.subject,
      version: subject.version,
      operations: entries.map((entry) => ({ operation: entry.operation, name: entry.name, binding: entry.binding })),
    },
  };
}

/** A decoding failure: stored data Supervision wrote cannot be read back. */
function damaged(what: string): never {
  throw new SupervisionError('integrity', `A stored ${what} is malformed`);
}

/** Read a field of a stored object. */
function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Reflect.get(value, name) : undefined;
}

/** A required nonempty string field. */
function text(value: unknown, name: string, what: string): string {
  const read = field(value, name);
  return typeof read === 'string' && read.length > 0 ? read : damaged(what);
}

/** A nullable string field. */
function optionalText(value: unknown, name: string, what: string): string | undefined {
  const read = field(value, name);
  if (read === null) {
    return undefined;
  }
  return typeof read === 'string' && read.length > 0 ? read : damaged(what);
}

/** A v2 private run identity is distinct from caller-supplied correlation labels. */
const runInstanceRule = /^run-instance-[0-9a-f]{32}$/u;

/** Decode a private identity, allowing explicit null for an upgraded v1 attempt. */
function decodedRunInstance(value: unknown, what: string): string | undefined {
  const read = optionalText(value, 'runInstance', what);
  return read === undefined || runInstanceRule.test(read) ? read : damaged(what);
}

/** A v4 classification always names the private run that owned its decision. */
function requiredRunInstance(value: unknown, what: string): string {
  const read = text(value, 'runInstance', what);
  return runInstanceRule.test(read) ? read : damaged(what);
}

/** A required safe-integer field. */
function whole(value: unknown, name: string, what: string): number {
  const read = field(value, name);
  return typeof read === 'number' && Number.isSafeInteger(read) ? read : damaged(what);
}

/** A required boolean stored field. */
function boolean(value: unknown, name: string, what: string): boolean {
  const read = field(value, name);
  return typeof read === 'boolean' ? read : damaged(what);
}

/** A field whose value is one of a closed set of strings. */
function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[], what: string): T {
  const read = field(value, name);
  const found = allowed.find((candidate) => candidate === read);
  return found ?? damaged(what);
}

/** A nullable field whose value is one of a closed set of strings. */
function optionalOneOf<T extends string>(value: unknown, name: string, allowed: readonly T[], what: string): T | undefined {
  return field(value, name) === null ? undefined : oneOf(value, name, allowed, what);
}

const statuses: readonly IOperationStatus[] = ['pending', 'succeeded', 'failed', 'deferred', 'unknown', 'cancelled', 'resolved', 'abandoned', 'retry-exhausted'];
const attemptStatuses: readonly IRequestAttemptStatus[] = ['pending', 'succeeded', 'failed', 'rate-limited', 'unknown', 'cancelled', 'not-sent'];
const remoteStates: readonly IOperationRemoteState[] = ['cancelled', 'running', 'unknown'];
const usages: readonly IAttemptUsage[] = ['acknowledged', 'unrecorded', 'none'];
const safeties: readonly ISafetyBasis[] = ['none', 'safe-to-repeat', 'provider-idempotency'];

/** Require the expected format and version of a stored record. */
function requireFormat(record: IJournalRecordValue, format: string, what: string): unknown {
  if (record.format !== format || record.formatVersion !== 1) {
    damaged(what);
  }
  return record.content;
}

/** Decode v1-v3 records compatibly and v4 classification without inferring authority from public run labels. */
export function decodeOperation(record: IJournalRecordValue): IOperationRecord {
  const what = 'operation record';
  if (record.format !== operationFormat || (record.formatVersion !== 1 && record.formatVersion !== 2 && record.formatVersion !== 3 && record.formatVersion !== 4)) {
    damaged(what);
  }
  const content = record.content;
  const attempts: unknown = field(content, 'attempts');
  const settlement: unknown = field(content, 'settlement');
  const resolution: unknown = field(content, 'resolution');
  if (!Array.isArray(attempts)) {
    return damaged(what);
  }
  const status = oneOf(content, 'status', statuses, what);
  const retryExhaustedRunInstance = record.formatVersion >= 3
    ? decodedRunInstance({ runInstance: field(content, 'retryExhaustedRunInstance') }, what)
    : undefined;
  const decodedAttempts = attempts.map((attempt: unknown): IAttemptRecord => ({
    requestAttempt: text(attempt, 'requestAttempt', what),
    run: text(attempt, 'run', what),
    runInstance: record.formatVersion === 1 ? undefined : decodedRunInstance(attempt, what),
    stepAttempt: text(attempt, 'stepAttempt', what),
    status: oneOf(attempt, 'status', attemptStatuses, what),
    remote: optionalOneOf(attempt, 'remote', remoteStates, what),
    usage: optionalOneOf(attempt, 'usage', usages, what),
    // Earlier records lack this field; a not-sent attempt remains conservatively unconfirmed.
    intent: field(attempt, 'intent') === undefined
      ? (field(attempt, 'status') === 'not-sent' ? 'unconfirmed' : undefined)
      : optionalOneOf(attempt, 'intent', ['unconfirmed'], what),
    decision: record.formatVersion < 4 || field(attempt, 'decision') === null || field(attempt, 'decision') === undefined
      ? undefined
      : decodeDecision(field(attempt, 'decision'), what),
    source: record.formatVersion < 4 || field(attempt, 'source') === null || field(attempt, 'source') === undefined
      ? undefined
      : decodeSource(field(attempt, 'source'), what),
    outcome: record.formatVersion < 4 || field(attempt, 'outcome') === null || field(attempt, 'outcome') === undefined
      ? undefined
      : decodeOutcome(field(attempt, 'outcome'), what),
    facts: record.formatVersion < 4 || field(attempt, 'facts') === null || field(attempt, 'facts') === undefined
      ? undefined
      : decodeFacts(field(attempt, 'facts'), what),
  }));
  if (record.formatVersion < 3 && status === 'retry-exhausted') {
    return damaged(what);
  }
  if (status === 'retry-exhausted') {
    const last = decodedAttempts.at(-1);
    const classifiedRefusal = last?.status === 'failed' || last?.status === 'rate-limited'
      || (record.formatVersion === 4 && last?.status === 'unknown');
    if (retryExhaustedRunInstance === undefined || last?.runInstance !== retryExhaustedRunInstance || !classifiedRefusal) {
      return damaged(what);
    }
  } else if (retryExhaustedRunInstance !== undefined) {
    return damaged(what);
  }
  const rawClassification: unknown = record.formatVersion === 4 ? field(content, 'classification') : undefined;
  const classification = rawClassification === undefined || rawClassification === null ? undefined : decodeClassification(rawClassification, what);
  const rawSelection: unknown = record.formatVersion === 4 ? field(content, 'sourceSelection') : undefined;
  const sourceSelection = rawSelection === undefined || rawSelection === null ? undefined : decodeSourceSelection(rawSelection, what);
  const rawPreviousDelay: unknown = record.formatVersion === 4 ? field(content, 'previousDelayMilliseconds') : undefined;
  const previousDelayMilliseconds = rawPreviousDelay === undefined || rawPreviousDelay === null
    ? undefined : whole(content, 'previousDelayMilliseconds', what);
  if (previousDelayMilliseconds !== undefined && previousDelayMilliseconds < 0) {
    return damaged(what);
  }
  return {
    operation: text(content, 'operation', what),
    subject: text(content, 'subject', what),
    version: whole(content, 'version', what),
    member: optionalText(content, 'member', what),
    name: text(content, 'name', what),
    binding: text(content, 'binding', what),
    safety: oneOf(content, 'safety', safeties, what),
    maxAttempts: whole(content, 'maxAttempts', what),
    rateLimitRetries: whole(content, 'rateLimitRetries', what),
    unrecorded: whole(content, 'unrecorded', what),
    status,
    notBefore: field(content, 'notBefore') === null ? undefined : whole(content, 'notBefore', what),
    classification,
    sourceSelection,
    previousDelayMilliseconds,
    retryExhaustedRunInstance,
    attempts: decodedAttempts,
    settlement: settlement === null ? undefined : decodeSettlement(settlement, what),
    // Absent in records written before the field existed: no abandonment could then supersede a resolution, so none is kept.
    resolution: resolution === undefined || resolution === null ? undefined : decodeSettlement(resolution, what),
  };
}

/** Restore a private-run source binding without promoting it into cross-run authority. */
function decodeSourceSelection(value: unknown, what: string): NonNullable<IOperationRecord['sourceSelection']> {
  exactKeys(value, ['runInstance', 'scope'], what);
  const runInstance = requiredRunInstance(value, what);
  const rawScope: unknown = field(value, 'scope');
  if (rawScope === undefined) {
    return damaged(what);
  }
  return { runInstance, scope: rawScope === null ? undefined : decodeSource(rawScope, what) };
}

/** Decode the v4 policy state, rejecting malformed shapes as journal integrity damage. */
function decodeClassification(value: unknown, what: string): IClassificationRecord {
  const kind = oneOf(value, 'kind', ['pending', 'accepted', 'failed', 'cancelled', 'no-retry'] as const, what);
  switch (kind) {
    case 'pending': {
      exactKeys(value, ['kind', 'runInstance', 'requestAttempt', 'source', 'outcome', 'facts', 'generation'], what);
      const rawSource: unknown = field(value, 'source');
      return {
        kind,
        runInstance: requiredRunInstance(value, what),
        requestAttempt: text(value, 'requestAttempt', what),
        source: rawSource === null ? undefined : decodeSource(rawSource, what),
        outcome: decodeOutcome(field(value, 'outcome'), what),
        facts: decodeFacts(field(value, 'facts'), what),
        generation: text(value, 'generation', what),
      };
    }
    case 'accepted': {
      exactKeys(value, ['kind', 'runInstance', 'decision', 'delayMilliseconds', 'notBefore'], what);
      const decision = decodeDecision(field(value, 'decision'), what);
      const delayMilliseconds = whole(value, 'delayMilliseconds', what);
      if ((decision.kind === 'retry-now' && delayMilliseconds !== 0) || (decision.kind === 'retry-after' && delayMilliseconds < 1) || (decision.kind === 'stop' && delayMilliseconds !== 0)) {
        return damaged(what);
      }
      const runInstance = requiredRunInstance(value, what);
      return { kind, runInstance, decision, delayMilliseconds, notBefore: whole(value, 'notBefore', what) };
    }
    case 'failed':
      exactKeys(value, ['kind', 'runInstance', 'code'], what);
      return { kind, runInstance: requiredRunInstance(value, what), code: oneOf(value, 'code', ['policy-error'] as const, what) };
    case 'cancelled':
      exactKeys(value, ['kind', 'runInstance', 'code'], what);
      return { kind, runInstance: requiredRunInstance(value, what), code: oneOf(value, 'code', ['stopped'] as const, what) };
    case 'no-retry':
      exactKeys(value, ['kind', 'runInstance', 'code'], what);
      return { kind, runInstance: requiredRunInstance(value, what), code: oneOf(value, 'code', ['policy-exhausted'] as const, what) };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Decode the exact non-secret identity that selects a source callback. */
function decodeSource(value: unknown, what: string): IRetrySourceScope {
  exactKeys(value, ['source', 'service', 'connection'], what);
  return {
    source: boundedIdentifier(field(value, 'source'), what),
    service: boundedIdentifier(field(value, 'service'), what),
    connection: boundedIdentifier(field(value, 'connection'), what),
  };
}

/** Decode the adapter-normalized response kind independently of its facts. */
function decodeOutcome(value: unknown, what: string): IRetryOutcome {
  const kind = oneOf(value, 'kind', ['failed', 'rate-limited', 'unknown'] as const, what);
  exactKeys(value, kind === 'failed' ? ['kind', 'transient'] : ['kind'], what);
  return kind === 'failed' ? { kind, transient: boolean(value, 'transient', what) } : { kind };
}

/** Decode bounded source observations; facts cannot become a generic metadata bag. */
function decodeFacts(value: unknown, what: string): IRetryFacts {
  exactKeys(value, ['httpStatus', 'providerCode', 'conditions'], what);
  const httpStatus = field(value, 'httpStatus');
  const providerCode = field(value, 'providerCode');
  const conditions = field(value, 'conditions');
  if (httpStatus !== undefined && (typeof httpStatus !== 'number' || !Number.isSafeInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) {
    return damaged(what);
  }
  const checkedCode = providerCode === undefined ? undefined : boundedIdentifier(providerCode, what);
  if (conditions !== undefined && (!Array.isArray(conditions) || conditions.length > 8)) {
    return damaged(what);
  }
  // Inspect each durable slot so an in-memory sparse array cannot bypass the
  // same identifier checks that reject JSON's dense null representation.
  let checkedConditions: string[] | undefined;
  if (conditions !== undefined) {
    checkedConditions = [];
    for (let index = 0; index < conditions.length; index += 1) {
      checkedConditions.push(boundedIdentifier(conditions[index], what));
    }
  }
  if (checkedConditions !== undefined && new Set(checkedConditions).size !== checkedConditions.length) {
    return damaged(what);
  }
  return {
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(checkedCode === undefined ? {} : { providerCode: checkedCode }),
    ...(checkedConditions === undefined ? {} : { conditions: checkedConditions }),
  };
}

/** Decode one closed decision, including the positive-delay invariant. */
function decodeDecision(value: unknown, what: string): IRetryDecision {
  const kind = oneOf(value, 'kind', ['retry-now', 'retry-after', 'stop'] as const, what);
  exactKeys(value, kind === 'retry-after' ? ['kind', 'delayMilliseconds'] : ['kind'], what);
  if (kind === 'retry-after') {
    const delayMilliseconds = whole(value, 'delayMilliseconds', what);
    if (delayMilliseconds <= 0) {
      return damaged(what);
    }
    return { kind, delayMilliseconds };
  }
  return { kind };
}

/** Reject unrecognized persisted fields so private response metadata cannot hide in v4 records. */
function exactKeys(value: unknown, allowed: readonly string[], what: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    damaged(what);
  }
}

/** Check source identifiers and provider facts stay within the documented bounds. */
function boundedIdentifier(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_.:-]+$/u.test(value)) {
    return damaged(what);
  }
  return value;
}

/** Decode a stored block index. */
export function decodeBlocks(record: IJournalRecordValue): readonly IBlockEntry[] {
  const what = 'operation block index';
  const content = requireFormat(record, blocksFormat, what);
  const entries: unknown = field(content, 'operations');
  if (!Array.isArray(entries)) {
    return damaged(what);
  }
  return entries.map((entry: unknown): IBlockEntry => ({
    operation: text(entry, 'operation', what),
    name: text(entry, 'name', what),
    binding: text(entry, 'binding', what),
  }));
}

/** The operator's view of a stored operation: identities, statuses and times, never its binding. */
export function viewOf(record: IOperationRecord, scope: { readonly analysis: string; readonly environment: string }): IOperationView {
  return Object.freeze({
    operation: record.operation,
    subject: Object.freeze({ analysis: scope.analysis, environment: scope.environment, subject: record.subject, version: record.version }),
    member: record.member,
    name: record.name,
    status: record.status,
    notBefore: record.notBefore,
    attempts: Object.freeze(record.attempts.map((attempt): IRequestAttemptView => Object.freeze({
      requestAttempt: attempt.requestAttempt,
      run: attempt.run,
      stepAttempt: attempt.stepAttempt,
      status: attempt.status,
      remote: attempt.remote,
      usage: attempt.usage,
    }))),
    settlement: record.settlement === undefined ? undefined : Object.freeze({ ...record.settlement }),
    resolution: record.resolution === undefined ? undefined : Object.freeze({ ...record.resolution }),
  });
}
