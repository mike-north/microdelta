/**
 * The engine of one run's external operations (RUN-011, RUN-012, RUN-013,
 * RUN-014, ACC-003, ACC-005, ACC-007; EXP-8 mechanisms 3 to 7, supervisor
 * resolutions 1 to 8 and ruling R).
 *
 * It composes pure retry-policy interpretation while retaining journal,
 * callback-lifecycle, fencing, allowance and send authority. It applies, in this
 * order for every request attempt:
 *
 * 1. **Address.** An operation is addressed by its step attempt's subject, its
 *    name and its binding. The subject's block index names the operations at
 *    its addresses that are still unsettled; a call at such an address reuses
 *    that operation's identity, otherwise it mints a new one.
 * 2. **Taint guard.** An attempt that met a deferral or exhausted unknown or
 *    known retry allowance rethrows that signal without sending. The known
 *    provider floor still gates a later invocation, while exhaustion in the
 *    current invocation is final and must not make that run wait pointlessly.
 *    A distinct admitted attempt may retry under this run's finite allowance
 *    without an effect-safety declaration.
 * 3. **Intent before send.** Once the permit is held and stop intent
 *    rechecked, one journal commit records the operation as `pending` with
 *    the new request attempt, then Accounting records the usage intent, and
 *    only then is the request sent. If either fails, nothing is sent.
 * 4. **Usage before outcome.** A usage report is acknowledged through
 *    Accounting before the outcome is committed.
 * 5. **Outcome and policy.** Success settles the operation. Current known-
 *    failure settlement remains distinct from unknown exhaustion, which
 *    stays pending. Every actual send, including a rate refusal, consumes
 *    one of this invocation's finite total attempts. Classified retries
 *    defer durably for built-in increasing or explicit timing, with provider
 *    not-before as a floor; waits hold no network permit. The legacy rate
 *    cap can only restrict this total. A lost response is retryable under
 *    that allowance and remains unknown evidence even after later success.
 * 6. **Hard stop.** An aborted request's remote state is committed to the
 *    journal by operation and request attempt; a provider-confirmed
 *    cancellation settles the operation, otherwise it is unknown.
 * 7. **Legacy operator settlement.** Resolving an unknown operation as succeeded
 *    asserts its effect happened, so its address stays consumed: a later call
 *    there mints and sends nothing and fails with `operation-resolved`, which
 *    carries no value. Resolving as failed (no effect) or abandoning frees the
 *    address; abandoning is the operator's explicit authorization of a
 *    possible second effect, and an operation resolved as succeeded may
 *    still be abandoned later to free its address. This surface supplies no
 *    data value; result-bearing manual recovery remains deferred.
 *
 * Every commit uses the lease of the normal request pass the attempt belongs
 * to, so a pass that lost its lease commits nothing (ruling R): its operation
 * stays `pending` and any later run records it unknown. Events carry
 * identifiers, closed codes, times and usage figures with identifier units
 * only; the binding, values, provider bodies and error messages never leave
 * the author's body (RUN-013).
 */
import type { IAdmissionDecision, IAdmissionRequest } from '@microdelta/resolution';

import type { IRunContext, IRunEvent, IRunLease } from './contracts.js';
import { createAbortSource } from './control.js';
import type { IRunTimer, IStopController } from './control.js';
import type { IRunRandom } from './operations.js';
import { SupervisionError } from './errors.js';
import { descriptorKey, pendingError } from './execution.js';
import type { IAttemptFrame, IOperationTransport, IRequestScope, IRunFrame, IRunOperations, ITransmitted } from './execution.js';
import { blocksCollection, operationsCollection } from './operations.js';
import type {
  IAttemptUsage,
  IOperationBlock,
  IOperationEvent,
  IOperationPhase,
  IOperationQuantity,
  IOperationReason,
  IOperationRemoteState,
  IOperationRequest,
  IOperationRetryPolicy,
  IOperationResponse,
  IOperationSettlement,
  IOperationStatus,
  IOperationSubject,
  IOperationUsage,
  IOperationView,
  IRetryDecision,
  IRetryDecisionInput,
  IRetryFacts,
  IRetrySourceScope,
  ISourceRetryPolicy,
  IRequestAttemptStatus,
  IRunOperationPorts,
} from './operations.js';
import {
  builtInRetryDecision,
  defaultRetryDelay,
  retryFacts,
  retryFloor,
  retryHistory,
  retryOutcome,
  sameRetrySource,
  selectRetryPolicy,
  validatedRetryDecision,
  validatedRetryPolicies,
  validatedRetrySource,
} from './retry-classification.js';
import {
  decodeBlocks,
  decodeOperation,
  encodeBlocks,
  encodeOperation,
  holdsAddress,
  rateLimited,
  spentAttempts,
  subjectKey,
  unknownRetry,
  viewOf,
} from './records.js';
import type { IAttemptRecord, IBlockEntry, IClassificationRecord, IOperationRecord, ISafetyBasis } from './records.js';

/**
 * The identifier rule of operation names, operator identities and the usage
 * units events may carry: lower-case, starting with a letter, at most 64
 * characters. An identifier names a kind of thing; it never carries a value.
 */
const identifierRule = /^[a-z][a-z0-9_.:-]{0,63}$/u;

/** A compatibility-only rate-refusal subcap, unable to raise the total request allowance. */
const defaultRateLimitRetries = 5;

/** The ordinary acquisition allowance counts all actual sends, including rate refusals. */
const defaultMaxAttempts = 3;

/**
 * The backoff after an intent that could not be made durable (Accounting
 * busy, or a commit it could not confirm). Nothing was sent, so the step
 * stays pending on a deferral rather than failing: a sleeping run retries
 * after it, and a later run admits it again. The first retry waits
 * `initialMilliseconds`; each further consecutive failure of the same
 * operation doubles the wait, up to `capMilliseconds`, so persistent
 * contention is not hammered while a brief one clears quickly. A durable
 * intent resets the count.
 */
const intentRetryBackoff = Object.freeze({ initialMilliseconds: 1_000, capMilliseconds: 60_000 });

/** The wait before retrying after the `failures`-th consecutive non-durable intent of an operation (1-based). */
function intentRetryDelay(failures: number): number {
  const doublings = Math.max(0, failures - 1);
  // 2^6 already exceeds the cap, so larger exponents never need computing.
  return doublings >= 6 ? intentRetryBackoff.capMilliseconds : Math.min(intentRetryBackoff.capMilliseconds, intentRetryBackoff.initialMilliseconds * 2 ** doublings);
}

/** The shape of an operation identity's random part: exactly what the random identifier capability supplies. */
const randomRule = /^[0-9a-f]{32}$/u;

/**
 * Whether a usage-intent write that threw may nevertheless have landed. The
 * accounting port marks exactly that case with `durability: 'unknown'` (the
 * write ran but its commit was not confirmed); every other failure, such as a
 * busy store, recorded nothing (ACC-007).
 */
function intentMayHaveLanded(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'durability') === 'unknown';
}

/** Thrown from the intent hook when the step attempt ended before the send: nothing is recorded or sent. */
class EndedAttemptError extends Error {}

/** Whether a value is an identifier under {@link identifierRule}. */
function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierRule.test(value);
}

/** Whether a value is a nonempty string. */
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** A positive safe integer option, or the fallback when absent. */
function count(value: unknown, fallback: number, name: string, minimum: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new SupervisionError('invalid-request', `An operation's ${name} must be a safe integer of at least ${String(minimum)}`);
  }
  return value;
}

/** An operation request's fields, read and validated once before anything is recorded. */
interface IValidatedRequest<T> {
  readonly name: string;
  readonly binding: string;
  readonly safety: ISafetyBasis;
  readonly maxAttempts: number;
  /** An author-specified fixed delay; absent uses the bounded increasing default. */
  readonly backoff: number | undefined;
  readonly rateLimitRetries: number;
  /** Detached exact source tuple; absent means built-in classification. */
  readonly retrySource: IRetrySourceScope | undefined;
  readonly providerIdempotency: boolean;
  readonly perform: IOperationRequest<T>['perform'];
  readonly cancel: (() => Promise<'cancelled' | 'running'>) | undefined;
}

/** Read and validate an operation request. */
function validated<T>(request: IOperationRequest<T>): IValidatedRequest<T> {
  const read = <K extends keyof IOperationRequest<T>>(field: K): IOperationRequest<T>[K] => {
    try {
      return request[field];
    } catch {
      // A request accessor is untrusted author input; neither its exception
      // nor a partial declaration can become a provider send or diagnostic.
      throw new SupervisionError('invalid-request', 'An operation request has a malformed field');
    }
  };
  const name = read('name');
  const binding = read('binding');
  const perform = read('perform');
  const cancel = read('cancel');
  const safeToRepeat = read('safeToRepeat');
  const providerIdempotency = read('providerIdempotency');
  const retry = read('retry');
  const rawRetrySource = read('retrySource');
  if (!isIdentifier(name)) {
    throw new SupervisionError('invalid-request', 'An operation needs an identifier name');
  }
  if (!nonempty(binding) || typeof perform !== 'function' || (cancel !== undefined && typeof cancel !== 'function')) {
    throw new SupervisionError('invalid-request', `Operation ${name} needs a nonempty binding, a perform function and an optional cancel function`);
  }
  if ((safeToRepeat !== undefined && typeof safeToRepeat !== 'boolean') || (providerIdempotency !== undefined && typeof providerIdempotency !== 'boolean')
    || (retry !== undefined && (typeof retry !== 'object' || retry === null))) {
    throw new SupervisionError('invalid-request', `Operation ${name} has a malformed safety declaration or retry policy`);
  }
  const policy = (field: keyof IOperationRetryPolicy): unknown => {
    if (retry === undefined) {
      return undefined;
    }
    try {
      return retry[field];
    } catch {
      throw new SupervisionError('invalid-request', 'An operation retry policy has a malformed field');
    }
  };
  const declaredBackoff = policy('backoffMilliseconds');
  const retrySource = rawRetrySource === undefined ? undefined : validatedRetrySource(rawRetrySource, 'retrySource');
  return {
    name,
    binding,
    safety: providerIdempotency === true ? 'provider-idempotency' : safeToRepeat === true ? 'safe-to-repeat' : 'none',
    maxAttempts: count(policy('maxAttempts'), defaultMaxAttempts, 'maxAttempts', 1),
    backoff: declaredBackoff === undefined ? undefined : count(declaredBackoff, 0, 'backoffMilliseconds', 0),
    rateLimitRetries: count(policy('rateLimitRetries'), defaultRateLimitRetries, 'rateLimitRetries', 0),
    retrySource,
    providerIdempotency: providerIdempotency === true,
    // Validated just above; the request's own declared types describe these members.
    perform: perform.bind(request),
    cancel: cancel?.bind(request),
  };
}

/** Validate a usage report an adapter or operator supplied: its identity and quantities, never their meaning. */
function usageOf(value: unknown): IOperationUsage | undefined {
  if (value === undefined) {
    return undefined;
  }
  const report: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'report') : undefined;
  const quantities: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'quantities') : undefined;
  if (!nonempty(report) || !Array.isArray(quantities)) {
    return undefined;
  }
  const parsed = quantities.map((quantity: unknown): IOperationQuantity | undefined => {
    const unit: unknown = typeof quantity === 'object' && quantity !== null ? Reflect.get(quantity, 'unit') : undefined;
    const amount: unknown = typeof quantity === 'object' && quantity !== null ? Reflect.get(quantity, 'amount') : undefined;
    return typeof unit === 'string' && typeof amount === 'number' ? { unit, amount } : undefined;
  });
  const valid = parsed.filter((quantity): quantity is IOperationQuantity => quantity !== undefined);
  return valid.length === parsed.length ? { report, quantities: valid } : undefined;
}

/** An adapter's classification of one response, read defensively: anything unrecognized is an unknown outcome. */
type IClassified<T> =
  | { readonly kind: 'succeeded'; readonly value: T; readonly usage: IOperationUsage | undefined }
  | { readonly kind: 'failed'; readonly transient: boolean; readonly error: unknown; readonly usage: IOperationUsage | undefined; readonly facts: IRetryFacts; readonly notBefore: number | undefined }
  | { readonly kind: 'rate-limited'; readonly retryAt: number | undefined; readonly usage: IOperationUsage | undefined; readonly facts: IRetryFacts; readonly notBefore: number | undefined }
  | { readonly kind: 'unknown'; readonly usage: IOperationUsage | undefined; readonly facts: IRetryFacts; readonly notBefore: number | undefined };

/**
 * Classify a transmission's settled response. A rejected `perform`, and a
 * response that is not one of the declared kinds, are unknown outcomes: an
 * uncertain response is never evidence that nothing happened (RUN-012).
 */
function classify<T>(sent: Extract<ITransmitted<IOperationResponse<T>>, { readonly kind: 'returned' | 'threw' }>): IClassified<T> {
  if (sent.kind === 'threw') {
    return { kind: 'unknown', usage: undefined, facts: Object.freeze({}), notBefore: undefined };
  }
  const response: unknown = sent.value;
  if (typeof response !== 'object' || response === null) {
    return { kind: 'unknown', usage: undefined, facts: Object.freeze({}), notBefore: undefined };
  }
  try {
    const usage = usageOf(Reflect.get(response, 'usage'));
    const answer = sent.value;
    // A successful response is never a retry refusal: its unrelated retry
    // fields are neither read nor validated by this classification seam.
    if (answer.kind === 'succeeded') {
      return { kind: 'succeeded', value: answer.value, usage };
    }
    const facts = retryFacts(Reflect.get(response, 'retryFacts'));
    const notBefore = retryFloor(Reflect.get(response, 'notBefore'));
    switch (answer.kind) {
      case 'failed':
        return { kind: 'failed', transient: answer.transient === true, error: answer.error, usage, facts, notBefore };
      case 'rate-limited':
        return { kind: 'rate-limited', retryAt: typeof answer.retryAt === 'number' && Number.isSafeInteger(answer.retryAt) ? answer.retryAt : undefined, usage, facts, notBefore };
      default:
        // An `unknown` answer, or a kind no adapter may answer.
        return { kind: 'unknown', usage, facts, notBefore };
    }
  } catch {
    // Adapter-owned accessors and reflection traps can throw private text.
    // The attempt was sent, but malformed evidence grants no classification.
    throw new SupervisionError('invalid-response', 'A source returned malformed response evidence');
  }
}

/**
 * One operation record with the journal revision it was read or written at,
 * and the writer fence that committed that revision (undefined for a record
 * not yet committed).
 */
interface IStored {
  readonly record: IOperationRecord;
  readonly revision: number;
  readonly fence: number | undefined;
}

/** What the engine needs of its run. */
export interface IOperationEngineContext {
  readonly context: IRunContext;
  readonly ports: IRunOperationPorts;
  readonly timer: IRunTimer;
  /** Source registrations are captured once for this invocation. */
  readonly retryPolicies?: readonly ISourceRetryPolicy[];
  /** Stop intent bounds classifier waits as well as sends and backoff. */
  readonly stop: IStopController;
  /** The host's random identifier source, which makes operation identities and idempotency keys globally unique. */
  readonly random: IRunRandom;
  /** Offer an event to observers; a failure becomes a diagnostic. */
  report(event: IRunEvent, position: string): void;
  /** Record a run diagnostic; it names codes and identifiers only. */
  diagnose(message: string): void;
  /** Invoke a source callback in a run scope with no live author attempt or request authority. */
  runPolicy<T>(work: () => T): T;
}

/** A run's external operations: the call path, admission's check, inspection and operator settlement. */
export interface IOperationEngine extends IRunOperations {
  /**
   * Admission's check of one step's unsettled operations, before the policy
   * decides: a denial while a deferral's time has not come or an unknown
   * outcome may not be retried, a cancellation of a resumable deferral or
   * retry under stop intent, or undefined when the step may proceed.
   */
  admit(request: IAdmissionRequest, scope: IRequestScope | undefined, stopped: boolean): IAdmissionDecision | undefined;
  /** Read a same-private-run terminal classifier before executing the claimed step body. */
  terminalClassificationError(subject: IOperationSubject): SupervisionError | undefined;
  /** The environment's operations, optionally of one status. */
  inspect(status: IOperationStatus | undefined): readonly IOperationView[];
  /** Record an operator's settlement of one unknown operation under `lease`. */
  settle(settlement: IOperationSettlement, lease: IRunLease): IOperationView;
}

/**
 * Create the engine of one run's external operations.
 * @param engine - The run's context, ports, timer, observer position and diagnostics.
 * @returns The engine.
 */
export function createOperationEngine(engine: IOperationEngineContext): IOperationEngine {
  const { context, ports, timer, random } = engine;
  const retryPolicies = validatedRetryPolicies(engine.retryPolicies);
  /**
   * Lazy so a new operation keeps the first random operation identity stable
   * for existing deterministic callers. Once minted it belongs to this run
   * invocation, so a repeated public label cannot merge retry allowances.
   * Callers still owe unique public labels for attribution and usage.
   */
  let runInstance: string | undefined;
  /**
   * Request intents that this live invocation knows never reached `perform`.
   * If the not-sent restoration cannot be committed, the durable pending row
   * remains conservatively recoverable as unknown by another invocation;
   * only this invocation may exclude its own stronger no-dispatch evidence
   * from the sent-attempt allowance after reacquiring the writer.
   */
  const neverDispatched = new Set<string>();
  function currentRunInstance(): string {
    if (runInstance === undefined) {
      const minted: unknown = random.randomIdentifier();
      if (typeof minted !== 'string' || !randomRule.test(minted)) {
        throw new SupervisionError('invalid-request', 'The random identifier source returned a malformed run instance');
      }
      runInstance = `run-instance-${minted}`;
    }
    return runInstance;
  }
  /** Durable evidence counts conservatively; local no-dispatch evidence narrows only this invocation's tally. */
  function spentInRun(record: IOperationRecord): number {
    const instance = currentRunInstance();
    const durable = spentAttempts(record, instance);
    const knownUnsent = record.attempts.filter((attempt) => attempt.runInstance === instance && attempt.status !== 'not-sent' && neverDispatched.has(attempt.requestAttempt)).length;
    return durable - knownUnsent;
  }

  /**
   * Addresses with a call in progress in this run. A second call at an
   * address while one is in progress, even one started in the same turn, is
   * refused: two concurrent calls of the same intended request would mint two
   * operations and send it twice.
   */
  const inProgress = new Set<string>();
  const namespace = { analysis: context.analysis, environment: context.environment };
  const now = (): number => timer.currentEpochMilliseconds();
  /**
   * One live policy wait per operation in this invocation. Durable pending
   * records outlive this map; the map only distinguishes a callback still
   * authorized to answer from an orphaned decision after failure or takeover.
   */
  const activeClassifications = new Map<string, {
    readonly generation: string;
    readonly requestAttempt: string;
    readonly runInstance: string;
    readonly source: IRetrySourceScope;
    readonly revision: number;
    readonly fence: number | undefined;
    readonly lease: IRunLease;
    readonly attempt: IAttemptFrame;
  }>();

  /** Observe a known response without mistaking it for an unknown send. */
  function classificationBlock(stored: IStored): IOperationBlock {
    const pending = stored.record.classification;
    const active = activeClassifications.get(stored.record.operation);
    const waiting = pending?.kind === 'pending' && active !== undefined
      && pending.runInstance === currentRunInstance()
      && active.runInstance === pending.runInstance
      && active.generation === pending.generation
      && active.requestAttempt === pending.requestAttempt
      && sameRetrySource(active.source, pending.source)
      && stored.record.attempts.at(-1)?.requestAttempt === pending.requestAttempt
      && stored.revision === active.revision && stored.fence === active.fence
      && active.lease.fence === stored.fence && now() < active.lease.expiresAt
      && !active.attempt.ended && active.attempt.pending === undefined
      && engine.stop.state.level === 'none';
    return { kind: 'classification', operation: stored.record.operation, reason: waiting ? 'waiting' : 'interrupted' };
  }

  /** The stored operation of one identity, if any. */
  function readOperation(operation: string): IStored | undefined {
    const entry = ports.journal.read({ ...namespace, collection: operationsCollection, key: operation });
    return entry === undefined ? undefined : { record: decodeOperation(entry.record), revision: entry.revision, fence: entry.fence };
  }

  /** A subject's block index: the unsettled operations at its addresses, with its revision. */
  function readBlocks(subject: Pick<IOperationSubject, 'subject' | 'version'>): { readonly entries: readonly IBlockEntry[]; readonly revision: number } {
    const entry = ports.journal.read({ ...namespace, collection: blocksCollection, key: subjectKey(subject) });
    return entry === undefined ? { entries: [], revision: 0 } : { entries: decodeBlocks(entry.record), revision: entry.revision };
  }

  /**
   * Commit one operation record at its expected revision together with its
   * subject's block index, in one journal commit: the operation is listed
   * there exactly while it is unsettled. Throws when the commit is refused
   * (a stale lease, a conflicting revision); nothing is then written.
   */
  function write(lease: IRunLease, next: IOperationRecord, expected: number): IStored {
    const subject = { subject: next.subject, version: next.version };
    const blocks = readBlocks(subject);
    const others = blocks.entries.filter((entry) => entry.operation !== next.operation);
    const entries = holdsAddress(next) ? [...others, { operation: next.operation, name: next.name, binding: next.binding }] : others;
    const writes = [{ collection: operationsCollection, key: next.operation, expectedRevision: expected, record: encodeOperation(next) }];
    const changed = entries.length !== blocks.entries.length || entries.some((entry, index) => entry.operation !== blocks.entries[index]?.operation);
    const committed = ports.journal.commit(lease, {
      ...namespace,
      writes: changed ? [...writes, { collection: blocksCollection, key: subjectKey(subject), expectedRevision: blocks.revision, record: encodeBlocks(subject, entries) }] : writes,
    });
    const own = committed.find((entry) => entry.key === next.operation);
    return { record: next, revision: own?.revision ?? expected + 1, fence: own?.fence ?? lease.fence };
  }

  /** Offer one operation event, dropping usage units that are not identifiers (and diagnosing the drop by code). */
  function emit(phase: IOperationPhase, record: IOperationRecord, details: {
    readonly stepAttempt?: string | undefined;
    readonly requestAttempt?: string | undefined;
    readonly status?: IOperationEvent['status'];
    readonly reason?: IOperationReason | undefined;
    readonly notBefore?: number | undefined;
    readonly usage?: readonly IOperationQuantity[] | undefined;
    readonly remote?: IOperationRemoteState | undefined;
  } = {}): void {
    const usage = details.usage?.filter((quantity) => isIdentifier(quantity.unit));
    if (usage !== undefined && details.usage !== undefined && usage.length !== details.usage.length) {
      engine.diagnose(`usage-unit-dropped: operation ${record.operation} reported a usage unit that is not an identifier; the event omits it`);
    }
    const event: IOperationEvent = Object.freeze({
      kind: 'operation',
      runId: context.runId,
      phase,
      at: now(),
      operation: record.operation,
      name: record.name,
      member: record.member,
      stepAttempt: details.stepAttempt,
      requestAttempt: details.requestAttempt,
      status: details.status,
      reason: details.reason,
      notBefore: details.notBefore,
      usage: usage === undefined ? undefined : Object.freeze(usage.map((quantity) => Object.freeze({ unit: quantity.unit, amount: quantity.amount }))),
      remote: details.remote,
    });
    engine.report(event, `operation ${record.operation} ${phase}`);
  }

  /** Replace the last request attempt of a record. */
  function withLast(record: IOperationRecord, change: Partial<IAttemptRecord>): IOperationRecord {
    const last = record.attempts.at(-1);
    if (last === undefined) {
      return record;
    }
    return { ...record, attempts: [...record.attempts.slice(0, -1), { ...last, ...change }] };
  }

  /**
   * Record an operation a dead run, or a run that lost its lease, left
   * `pending` as `unknown`: its in-flight attempt may or may not have reached
   * the provider (CX-4). Returns the record as it now stands; a failed commit
   * leaves it pending durably, which every reader treats the same way.
   */
  function recover(stored: IStored, lease: IRunLease | undefined): IStored {
    const recovered: IOperationRecord = { ...withLast(stored.record, { status: 'unknown' }), status: 'unknown' };
    if (lease === undefined) {
      return { ...stored, record: recovered };
    }
    try {
      const written = write(lease, recovered, stored.revision);
      emit('recovered', recovered, { requestAttempt: recovered.attempts.at(-1)?.requestAttempt, status: 'unknown', reason: 'recovered-after-crash' });
      return written;
    } catch {
      engine.diagnose(`lease-lost: operation ${stored.record.operation} could not be recorded unknown`);
      return { ...stored, record: recovered };
    }
  }

  /**
   * Whether a pending record was left in flight by an earlier writer: a run
   * that died, or that lost its lease, committed it under another fence. A
   * pending record committed under the current lease's fence is genuinely in
   * flight in this run. Fences, unlike run identifiers, never repeat across
   * processes. Without a lease nothing can be decided, so it reads in flight.
   */
  function leftByEarlierWriter(stored: IStored, lease: IRunLease | undefined): boolean {
    return stored.record.status === 'pending' && lease !== undefined && stored.fence !== lease.fence;
  }

  /** Whether an unsettled record's provider floor still forbids a send. */
  function isBeforeProviderFloor(record: IOperationRecord): record is IOperationRecord & { readonly notBefore: number } {
    return record.notBefore !== undefined && now() < record.notBefore;
  }

  /**
   * A retained source decision that ended this private run's attempt. It is
   * terminal for the author's whole step, even if a later pass changes the
   * operation address or tries to return a value without revisiting it.
   */
  function retainedClassificationError(record: IOperationRecord): SupervisionError | undefined {
    const classification = record.classification;
    if (classification?.runInstance !== currentRunInstance()) {
      return undefined;
    }
    if (classification.kind === 'failed') {
      return new SupervisionError('operation-classification-failed', `Operation ${record.operation} source policy failed`);
    }
    if (classification.kind === 'accepted' && classification.decision.kind === 'stop') {
      return new SupervisionError('operation-failed', `Operation ${record.operation} source policy stopped retrying`);
    }
    return undefined;
  }

  /** The block an unsettled record imposes now, or undefined when it may be resumed. */
  function blockOf(record: IOperationRecord): IOperationBlock | undefined {
    if (record.status === 'retry-exhausted') {
      if (record.retryExhaustedRunInstance === currentRunInstance()) {
        return record.attempts.at(-1)?.status === 'unknown'
          ? { kind: 'unknown-outcome', operation: record.operation, reason: 'policy-exhausted' }
          : { kind: 'policy-exhausted', operation: record.operation };
      }
    }
    if ((record.status === 'retry-exhausted' || record.status === 'deferred' || record.status === 'unknown'
      || (record.status === 'pending' && record.classification?.kind === 'pending')) && isBeforeProviderFloor(record)) {
      return { kind: 'deferred', operation: record.operation, notBefore: record.notBefore };
    }
    if (record.status === 'unknown') {
      const decision = unknownRetry(record, spentInRun(record));
      return decision === 'retry' ? undefined : { kind: 'unknown-outcome', operation: record.operation, reason: decision };
    }
    return undefined;
  }

  /** Translate a closed incomplete-input state to its event reason without exposing policy content. */
  function blockReason(block: IOperationBlock): IOperationReason {
    switch (block.kind) {
      case 'deferred': return 'not-before';
      case 'policy-exhausted': return 'policy-exhausted';
      case 'classification': return block.reason === 'waiting' ? 'classification-waiting' : 'classification-interrupted';
      case 'unknown-outcome': return block.reason;
      default: {
        const exhaustive: never = block;
        return exhaustive;
      }
    }
  }

  /** Note that a step stays pending because of `block`, for its pass's report and the run's wait. */
  function noteBlock(scope: IRequestScope | undefined, step: IAttemptFrame['step'], block: IOperationBlock): void {
    if (scope === undefined) {
      return;
    }
    scope.blocks.set(descriptorKey(step), block);
    if (block.kind === 'deferred') {
      scope.deferrals.push(block.notBefore);
    }
  }

  /** Make an attempt pending on `block` and fail its call without sending. */
  function pend(attempt: IAttemptFrame, scope: IRequestScope, block: IOperationBlock): never {
    attempt.pending = block;
    noteBlock(scope, attempt.step, block);
    throw pendingError(block);
  }

  /** Acknowledge a usage report under the provider namespace; returns how the attempt's usage stands. */
  function acknowledge(record: IOperationRecord, requestAttempt: string, stepAttempt: string, usage: IOperationUsage | undefined): IAttemptUsage {
    if (usage === undefined) {
      return 'none';
    }
    try {
      const outcome = ports.accounting.acknowledgeUsage({
        environment: context.environment,
        operation: record.operation,
        requestAttempt,
        report: `provider:${usage.report}`,
        quantities: usage.quantities,
      });
      if (outcome.kind === 'conflict') {
        engine.diagnose(`usage-conflict: operation ${record.operation} received a report that disagrees with the recorded one; the first is kept`);
        emit('usage-unrecorded', record, { stepAttempt, requestAttempt, reason: 'conflict' });
        return 'acknowledged';
      }
      emit('usage-acknowledged', record, { stepAttempt, requestAttempt, usage: usage.quantities });
      return 'acknowledged';
    } catch {
      engine.diagnose(`usage-unrecorded: operation ${record.operation} request attempt ${requestAttempt} has no durable usage acknowledgment; its usage stays unknown`);
      emit('usage-unrecorded', record, { stepAttempt, requestAttempt, reason: 'unrecorded' });
      return 'unrecorded';
    }
  }

  /**
   * A new operation identity: `op-` and an identifier from the host's random
   * source, so it never repeats across stores, processes or hosts sharing a
   * provider account. It is also the provider idempotency key, persisted with
   * the operation and kept by every retry.
   */
  function mintOperation(): string {
    const minted: unknown = random.randomIdentifier();
    if (typeof minted !== 'string' || !randomRule.test(minted)) {
      throw new SupervisionError('invalid-request', 'The random identifier source returned a malformed identifier');
    }
    return `op-${minted}`;
  }

  /** Locate the operation holding an address (unsettled, or resolved as succeeded), if any. */
  function locate(subject: IOperationSubject, name: string, binding: string): IStored | undefined {
    const entry = readBlocks(subject).entries.find((candidate) => candidate.name === name && candidate.binding === binding);
    return entry === undefined ? undefined : readOperation(entry.operation);
  }

  async function call<T>(frame: IRunFrame, transport: IOperationTransport, presented: IOperationRequest<T>): Promise<T> {
    const request = validated(presented);
    const { attempt, request: scope } = frame;
    if (attempt === undefined || attempt.subject === undefined || attempt.attemptId === undefined || scope === undefined) {
      throw new SupervisionError('invalid-request', `Operation ${request.name} must be called from the body of an admitted step attempt in a normal request`);
    }
    if (attempt.ended) {
      throw new SupervisionError('invalid-request', `Operation ${request.name} was called after its step attempt ended; nothing was sent`);
    }
    const address = JSON.stringify([subjectKey(attempt.subject), request.name, request.binding]);
    if (inProgress.has(address)) {
      const existing = locate(attempt.subject, request.name, request.binding);
      if (existing?.record.classification?.kind === 'pending'
        && existing.record.classification.runInstance === currentRunInstance()) {
        const block = classificationBlock(existing);
        emit('blocked', existing.record, { stepAttempt: String(attempt.attemptId), status: 'pending', reason: blockReason(block) });
        return pend(attempt, scope, block);
      }
      throw new SupervisionError('invalid-request', `Operation ${request.name} is already being called at this address in this run`);
    }
    inProgress.add(address);
    try {
      return await callAt(attempt, scope, transport, request);
    } finally {
      inProgress.delete(address);
    }
  }

  /** One call of a validated request by an admitted, live step attempt. */
  async function callAt<T>(attempt: IAttemptFrame, scope: IRequestScope, transport: IOperationTransport, request: IValidatedRequest<T>): Promise<T> {
    const subject = attempt.subject;
    if (subject === undefined) {
      throw new SupervisionError('invalid-request', `Operation ${request.name} needs an admitted step attempt`);
    }
    if (attempt.pending !== undefined) {
      throw pendingError(attempt.pending);
    }
    if (attempt.taint !== undefined) {
      throw new SupervisionError('stopped', `Operation ${request.name} was refused: ${attempt.taint}`);
    }
    const { lease } = scope;
    const stepAttempt = String(attempt.attemptId);
    let stored = locate(subject, request.name, request.binding);
    if (stored?.record.status === 'resolved') {
      // The operator asserted this request's effect happened: nothing is minted or sent again.
      emit('blocked', stored.record, { stepAttempt, status: 'resolved', reason: 'operator' });
      throw new SupervisionError('operation-resolved', `Operation ${stored.record.operation} was resolved as succeeded by an operator; it is not sent again`);
    }
    if (stored !== undefined && stored.record.status === 'pending') {
      if (stored.record.classification?.kind === 'pending') {
        if (stored.record.classification.runInstance === currentRunInstance()) {
          const block = classificationBlock(stored);
          emit('blocked', stored.record, { stepAttempt, status: 'pending', reason: blockReason(block) });
          return pend(attempt, scope, block);
        }
        // A fresh ordinary run may retry the known refusal without changing
        // its response or reclassifying a decision that never committed.
      } else {
        if (!leftByEarlierWriter(stored, lease)) {
          throw new SupervisionError('invalid-request', `Operation ${stored.record.operation} is already in flight in this run`);
        }
        stored = recover(stored, lease);
      }
    }
    let retry = false;
    if (stored !== undefined) {
      const selection = stored.record.sourceSelection;
      if (selection?.runInstance === currentRunInstance() && !sameRetrySource(selection.scope, request.retrySource)) {
        // One run cannot switch the selected adapter/access tuple at an
        // existing operation address to escape its current retry decision.
        throw new SupervisionError('invalid-request', `Operation ${stored.record.operation} changed its retry source within this run`);
      }
      // A local policy failure and a source-selected stop are retained
      // decisions about this exact address. Repeating an author call in the
      // same run reports that decision, rather than relabeling it as finite
      // allowance exhaustion or minting another operation.
      const terminal = retainedClassificationError(stored.record);
      if (terminal !== undefined) {
        throw terminal;
      }
      // The current declaration governs a call's own retry decision.
      const current: IOperationRecord = {
        ...stored.record, safety: request.safety, maxAttempts: request.maxAttempts, rateLimitRetries: request.rateLimitRetries,
        sourceSelection: { runInstance: currentRunInstance(), scope: request.retrySource },
      };
      const block = blockOf(current);
      if (block !== undefined) {
        emit('blocked', current, { stepAttempt, status: current.status, reason: blockReason(block), notBefore: block.kind === 'deferred' ? block.notBefore : undefined });
        return pend(attempt, scope, block);
      }
      stored = { ...stored, record: current };
      retry = true;
    }
    let current: IStored;
    if (stored !== undefined) {
      current = stored;
    } else {
      const record: IOperationRecord = {
        operation: mintOperation(),
        subject: subject.subject,
        version: subject.version,
        member: attempt.member,
        name: request.name,
        binding: request.binding,
        safety: request.safety,
        maxAttempts: request.maxAttempts,
        rateLimitRetries: request.rateLimitRetries,
        status: 'pending',
        sourceSelection: { runInstance: currentRunInstance(), scope: request.retrySource },
        notBefore: undefined,
        attempts: [],
        settlement: undefined,
        resolution: undefined,
        unrecorded: 0,
      };
      current = { record, revision: 0, fence: undefined };
    }
    for (;;) {
      if (retry) {
        emit('retry-started', current.record, { stepAttempt });
      }
      const sent = await sendOnce(current, attempt, transport, request, retry, lease);
      current = sent.stored;
      const outcome = sent.outcome;
      if (outcome.kind === 'value') {
        return outcome.value;
      }
      if (outcome.kind === 'retry') {
        retry = true;
        continue;
      }
      if (outcome.kind === 'pending') {
        return pend(attempt, scope, outcome.block);
      }
      throw outcome.error;
    }
  }

  /** How one request attempt left the operation. */
  type IAttemptOutcome<T> =
    | { readonly kind: 'value'; readonly value: T }
    | { readonly kind: 'retry' }
    | { readonly kind: 'pending'; readonly block: IOperationBlock }
    | { readonly kind: 'error'; readonly error: SupervisionError };

  /** Send one request attempt of an operation: intent, send, usage, outcome. */
  async function sendOnce<T>(
    stored: IStored,
    attempt: IAttemptFrame,
    transport: IOperationTransport,
    request: IValidatedRequest<T>,
    retry: boolean,
    lease: IRunLease,
  ): Promise<{ readonly stored: IStored; readonly outcome: IAttemptOutcome<T> }> {
    const stepAttempt = String(attempt.attemptId);
    const before = stored;
    const operation = before.record.operation;
    // An attempt never sent whose intent may have landed (Accounting could not confirm its commit) is reused with the
    // attribution it was first recorded with, so restating the intent is an idempotent duplicate rather than a conflict,
    // and a landed intent gets this send's usage instead of reading unknown forever (ACC-005, ACC-007). An attempt whose
    // intent certainly recorded nothing (Accounting busy, or any other refusal) stays in the record as not sent, and the
    // send is a fresh request attempt credited to the run and step attempt that make it.
    const last = before.record.attempts.at(-1);
    const unsent = last?.status === 'not-sent' && last.intent === 'unconfirmed' ? last : undefined;
    const earlier = unsent !== undefined ? before.record.attempts.slice(0, -1) : before.record.attempts;
    const requestAttempt = unsent?.requestAttempt ?? `${operation}/${String(earlier.length + 1)}`;
    const attribution = { run: unsent?.run ?? context.runId, stepAttempt: unsent?.stepAttempt ?? stepAttempt };
    let current = before;
    const sent = await transport.transmit<IOperationResponse<T>>({
      label: request.name,
      retry,
      perform: (signal) => {
        // If a formerly unconfirmed intent is eventually sent under the same
        // request ID, local no-dispatch evidence no longer excludes it.
        neverDispatched.delete(requestAttempt);
        try {
          return request.perform({ signal, operation, requestAttempt, idempotencyKey: request.providerIdempotency ? operation : undefined });
        } finally {
          // This phase means the provider callback was invoked, not merely
          // that its durable intents were recorded before a stop.
          emit('request-started', current.record, { stepAttempt, requestAttempt, status: 'pending' });
        }
      },
      cancel: request.cancel,
    }, () => {
      if (attempt.ended) {
        throw new EndedAttemptError('the step attempt ended before the send');
      }
      // Intent before send: the operation record, then Accounting's usage intent.
      const intent: IOperationRecord = {
        ...before.record,
        status: 'pending',
        notBefore: undefined,
        // A duration describes accepted retry history in one private run.
        // Historical attempts retain their own decisions, but a new run's
        // first send must not inherit its predecessor's backoff seed.
        previousDelayMilliseconds: last?.runInstance === currentRunInstance() ? before.record.previousDelayMilliseconds : undefined,
        // A new send supersedes an undecided old response; accepted and
        // failed decisions remain durable evidence of their earlier attempt.
        classification: before.record.classification?.kind === 'pending' ? undefined : before.record.classification,
        unrecorded: before.record.unrecorded,
        attempts: [...earlier, { requestAttempt, run: attribution.run, runInstance: currentRunInstance(), stepAttempt: attribution.stepAttempt, status: 'pending', remote: undefined, usage: undefined, intent: undefined }],
      };
      current = write(lease, intent, before.revision);
      try {
        ports.accounting.recordUsageIntent({
          environment: context.environment,
          operation,
          requestAttempt,
          attribution: { run: attribution.run, member: before.record.member ?? null, stepAttempt: attribution.stepAttempt },
        });
        // The intent is durable: the consecutive non-durable count resets.
        if (intent.unrecorded !== 0) {
          current = write(lease, { ...intent, unrecorded: 0 }, current.revision);
        }
      } catch (error: unknown) {
        // Nothing will be sent: record the attempt not sent and the operation as a short deferral, so the step stays pending
        // and the work is retried (a sleeping run after the delay, a later run when admitted) under the same identities.
        const failures = before.record.unrecorded + 1;
        // The mark is sticky: a reused attempt whose intent may have landed in an earlier run stays unconfirmed whatever
        // this retry's failure is, because a later failure (a busy store) cannot undo an intent that already landed.
        const unconfirmed = intentMayHaveLanded(error) ? 'unconfirmed' : unsent?.intent;
        const restored: IOperationRecord = { ...withLast(intent, { status: 'not-sent', intent: unconfirmed }), status: 'deferred', notBefore: now() + intentRetryDelay(failures), unrecorded: failures };
        try {
          current = write(lease, restored, current.revision);
        } catch {
          neverDispatched.add(requestAttempt);
          // Deliberately conservative: if recording the restoration fails too, the operation stays `pending` durably, and the
          // next writer records it unknown. A later invocation cannot infer no-send from that row; only this live invocation
          // knows its pre-send callback failed before `perform` and may exclude the phantom from its allowance.
          engine.diagnose(`lease-lost: operation ${operation} request attempt ${requestAttempt} stays pending though it was never sent`);
        }
        throw error;
      }
    });
    if (sent.kind === 'unrecorded') {
      if (sent.error instanceof EndedAttemptError) {
        return { stored: current, outcome: { kind: 'error', error: new SupervisionError('invalid-request', `Operation ${operation} was called after its step attempt ended; nothing was sent`) } };
      }
      // Nothing was sent. The step stays pending, retried after the backoff; it never fails for a busy or unconfirmed write.
      // The durable restoration, when it was recorded, already carries the time.
      const restored = current.revision !== before.revision && current.record.status === 'deferred' ? current.record.notBefore : undefined;
      const notBefore = restored ?? now() + intentRetryDelay(before.record.unrecorded + 1);
      engine.diagnose(`operation-unrecorded: operation ${operation} request attempt ${requestAttempt} has no durable intent; nothing was sent`);
      emit('retry-scheduled', current.record, { stepAttempt, requestAttempt, status: 'deferred', reason: 'unrecorded', notBefore });
      return { stored: current, outcome: { kind: 'pending', block: { kind: 'deferred', operation, notBefore } } };
    }
    if (sent.kind === 'refused') {
      // A stop after durable intent but before provider invocation is not a
      // remotely aborted request. Preserve its Accounting intent as an
      // unknown usage gap, but record the journal attempt as definitely
      // unsent so a later run may try this address without inventing an
      // effect or spending a sent-attempt allowance.
      const last = current.record.attempts.at(-1);
      if (current.revision !== before.revision && last?.requestAttempt === requestAttempt && last.status === 'pending') {
        const unsentRecord: IOperationRecord = { ...withLast(current.record, { status: 'not-sent' }), status: 'deferred', notBefore: now() };
        try {
          current = write(lease, unsentRecord, current.revision);
          emit('request-settled', unsentRecord, { stepAttempt, requestAttempt, status: 'not-sent', reason: 'stopped' });
        } catch {
          // A failed fenced restoration cannot turn an unconfirmed pending
          // row into durable no-dispatch evidence for another invocation.
          engine.diagnose(`lease-lost: operation ${operation} request attempt ${requestAttempt} stays pending after pre-dispatch stop`);
        }
      }
      return { stored: current, outcome: { kind: 'error', error: new SupervisionError('stopped', `Operation ${operation} was refused: ${sent.reason}`) } };
    }
    if (sent.kind === 'aborted') {
      const settledRemotely = sent.remote === 'cancelled';
      const next: IOperationRecord = { ...withLast(current.record, { status: settledRemotely ? 'cancelled' : 'unknown', remote: sent.remote }), status: settledRemotely ? 'cancelled' : 'unknown' };
      current = settle(current, next, lease);
      emit('request-settled', next, { stepAttempt, requestAttempt, status: settledRemotely ? 'cancelled' : 'unknown', reason: 'stopped', remote: sent.remote });
      return { stored: current, outcome: { kind: 'error', error: new SupervisionError('stopped', `Operation ${operation} was aborted: ${sent.reason}`) } };
    }
    const response = classify(sent);
    const usage = acknowledge(current.record, requestAttempt, stepAttempt, response.usage);
    return settleResponse(current, response, usage, { stepAttempt, requestAttempt, request, lease, attempt });
  }

  /**
   * Commit a settlement; if the lease no longer authorizes it, the operation
   * stays `pending` durably (any later run records it unknown) and the
   * returned record says so.
   */
  function settle(current: IStored, next: IOperationRecord, lease: IRunLease): IStored {
    try {
      return write(lease, next, current.revision);
    } catch {
      engine.diagnose(`lease-lost: operation ${next.operation} settlement could not be recorded; it stays pending and reads unknown`);
      return { record: { ...current.record, status: 'pending' }, revision: current.revision, fence: current.fence };
    }
  }

  /** Apply the policy to one classified response. */
  async function settleResponse<T>(
    current: IStored,
    response: IClassified<T>,
    usage: IAttemptUsage,
    where: { readonly stepAttempt: string; readonly requestAttempt: string; readonly request: IValidatedRequest<T>; readonly lease: IRunLease; readonly attempt: IAttemptFrame },
  ): Promise<{ readonly stored: IStored; readonly outcome: IAttemptOutcome<T> }> {
    const { stepAttempt, requestAttempt, request, lease, attempt } = where;
    const operation = current.record.operation;
    const settledAs = (attemptStatus: IRequestAttemptStatus, status: IOperationStatus, notBefore?: number): IOperationRecord => ({
      ...withLast(current.record, { status: attemptStatus, usage }),
      status,
      notBefore,
    });
    /** The configured fixed wait or increasing default after sent attempts of this invocation. */
    const retryDelay = (record: IOperationRecord): number => request.backoff ?? defaultRetryDelay(spentInRun(record));
    /** Commit and report; a lost lease makes the outcome unknown (ruling R). */
    const commit = (next: IOperationRecord, reason: IOperationReason | undefined): IStored | undefined => {
      const written = settle(current, next, lease);
      if (written.record.status === 'pending') {
        // The provider's known nonsuccess was already published with its
        // response commit. A refused later decision cannot revise that fact
        // or publish a second, fabricated unknown provider settlement.
        if (response.kind === 'succeeded') {
          emit('request-settled', next, { stepAttempt, requestAttempt, status: 'unknown', reason: 'lease-lost' });
        }
        return undefined;
      }
      // Non-success responses were already reported after their durable
      // response write, before classification. Its later decision is not a
      // second provider settlement.
      if (response.kind === 'succeeded') {
        emit('request-settled', next, { stepAttempt, requestAttempt, status: next.attempts.at(-1)?.status, reason });
      }
      return written;
    };
    /** The outcome could not be recorded under the pass's lease: it is unknown, and the attempt ends pending. */
    const leaseLost = (): { readonly stored: IStored; readonly outcome: IAttemptOutcome<T> } => ({
      stored: current,
      outcome: { kind: 'pending', block: current.record.classification?.kind === 'pending'
        ? { kind: 'classification', operation, reason: 'interrupted' }
        : { kind: 'unknown-outcome', operation, reason: 'unrecorded' } },
    });
    if (response.kind === 'succeeded') {
      const written = commit(settledAs('succeeded', 'succeeded'), undefined);
      return written === undefined ? leaseLost() : { stored: written, outcome: { kind: 'value', value: response.value } };
    }

    const runInstance = currentRunInstance();
    const attemptStatus: IRequestAttemptStatus = response.kind === 'rate-limited'
      ? 'rate-limited'
      : response.kind === 'failed' ? 'failed' : 'unknown';
    const outcome = retryOutcome(response);
    const rateRefusalCount = response.kind === 'rate-limited' ? rateLimited(withLast(current.record, { status: attemptStatus, usage }), runInstance) : 0;
    const knownFloors = [current.record.notBefore, response.notBefore, response.kind === 'rate-limited' ? response.retryAt : undefined]
      .filter((floor): floor is number => floor !== undefined);
    const knownNotBefore = knownFloors.length === 0 ? undefined : Math.max(...knownFloors);
    const selectedPolicy = selectRetryPolicy(retryPolicies, request.retrySource);
    const generation = random.randomIdentifier();
    if (!randomRule.test(generation)) {
      throw new SupervisionError('invalid-request', 'The random identifier source returned a malformed classification generation');
    }
    const responseRecord: IOperationRecord = {
      ...withLast(current.record, { status: attemptStatus, usage, source: request.retrySource, outcome, facts: response.facts }),
      status: 'pending',
      notBefore: knownNotBefore,
      // Every known refusal has a durable decision boundary, including the
      // built-in policy. A failed decision commit must not make its already
      // recorded provider response look like an in-flight unknown send.
      classification: {
        kind: 'pending', runInstance, requestAttempt, source: selectedPolicy?.scope,
        outcome, facts: response.facts, generation: `decision-${generation}`,
      },
    };
    try {
      current = write(lease, responseRecord, current.revision);
    } catch {
      engine.diagnose(`lease-lost: operation ${operation} response could not be recorded before classification`);
      return leaseLost();
    }
    emit('request-settled', responseRecord, { stepAttempt, requestAttempt, status: attemptStatus,
      reason: response.kind === 'unknown' ? 'lost-response' : response.kind === 'rate-limited' ? 'rate-limited' : response.transient ? 'transient' : 'permanent' });

    const eligible = spentInRun(responseRecord) < request.maxAttempts
      && (response.kind !== 'rate-limited' || rateRefusalCount <= request.rateLimitRetries)
      && engine.stop.state.level === 'none';
    const keepNoRetry = (classification: IClassificationRecord): IOperationRecord => ({
      ...responseRecord,
      // Unknown effects retain the longstanding operator-resolution path.
      // The classification still records why this invocation cannot send.
      status: response.kind === 'unknown' ? 'unknown' : 'retry-exhausted',
      retryExhaustedRunInstance: response.kind === 'unknown' ? undefined : runInstance,
      classification,
    });
    // A known permanent refusal has a terminal built-in decision even when
    // no retry remains. The allowance limits another send, not recognition
    // of the provider's final failure. Matched policies remain gated because
    // invoking one after exhaustion would grant new decision authority.
    const defaultPermanentStop = selectedPolicy === undefined && response.kind === 'failed'
      && !response.transient && engine.stop.state.level === 'none';
    if (!eligible && !defaultPermanentStop) {
      const whyStopped = engine.stop.state.level !== 'none';
      const stopped: IOperationRecord = keepNoRetry(whyStopped
        ? { kind: 'cancelled', runInstance, code: 'stopped' }
        : { kind: 'no-retry', runInstance, code: 'policy-exhausted' });
      const written = commit(stopped, whyStopped ? 'stopped' : 'policy-exhausted');
      if (written !== undefined && !whyStopped && response.kind !== 'unknown') {
        emit('retry-exhausted', stopped, { stepAttempt, requestAttempt, status: 'retry-exhausted', reason: 'policy-exhausted' });
      }
      return written === undefined ? leaseLost() : {
        stored: written,
        outcome: whyStopped
          ? { kind: 'error', error: new SupervisionError('stopped', `Operation ${operation} cannot retry after stop intent`) }
          : { kind: 'pending', block: response.kind === 'unknown'
            ? { kind: 'unknown-outcome', operation, reason: 'policy-exhausted' }
            : { kind: 'policy-exhausted', operation } },
      };
    }

    let decision: IRetryDecision;
    if (selectedPolicy === undefined) {
      decision = builtInRetryDecision(outcome, retryDelay(responseRecord));
    } else {
      const localAbort = createAbortSource(() => engine.diagnose(`retry-policy-listener-failure: operation ${operation}`));
      let unsubscribe = (): void => undefined;
      let stopResolve: (() => void) | undefined;
      const stopped = new Promise<'stopped'>((resolve) => {
        stopResolve = () => resolve('stopped');
      });
      unsubscribe = engine.stop.subscribe((state) => {
        if (state.level !== 'none') {
          localAbort.abort();
          stopResolve?.();
        }
      });
      const input: IRetryDecisionInput = Object.freeze({
        context,
        source: selectedPolicy.scope,
        operation,
        requestAttempt,
        outcome,
        facts: response.facts,
        ...(knownNotBefore === undefined ? {} : { knownNotBefore }),
        history: retryHistory(responseRecord, requestAttempt, runInstance, spentInRun(responseRecord)),
        signal: localAbort.signal,
      });
      const active = { generation: `decision-${generation}`, requestAttempt, runInstance, source: selectedPolicy.scope,
        revision: current.revision, fence: current.fence, lease, attempt };
      activeClassifications.set(operation, active);
      const callback = Promise.resolve().then(() => engine.runPolicy(() => selectedPolicy.decide(input))).then(
        (answer: unknown) => ({ kind: 'answer' as const, answer }),
        () => ({ kind: 'error' as const }),
      );
      const selected = await Promise.race([callback, stopped.then(() => ({ kind: 'stopped' as const }))]).finally(() => {
        unsubscribe();
        if (activeClassifications.get(operation) === active) {
          activeClassifications.delete(operation);
        }
      });
      // Only the exact response generation this callback saw may accept its
      // answer. A newer writer or attempt can preserve or supersede the row;
      // its revision/fence must not inherit this callback's authority.
      const latest = readOperation(operation);
      const pending = latest?.record.classification;
      if (latest?.revision !== current.revision || latest.fence !== lease.fence
        || pending?.kind !== 'pending' || pending.generation !== active.generation
        || pending.runInstance !== runInstance || pending.requestAttempt !== requestAttempt
        || !sameRetrySource(pending.source, selectedPolicy.scope)
        || latest.record.attempts.at(-1)?.requestAttempt !== requestAttempt) {
        return leaseLost();
      }
      // A stop that races a completed promise still wins before accepting a
      // retry decision; the callback has no independent send authority.
      if (engine.stop.state.level !== 'none' && selected.kind !== 'stopped') {
        localAbort.abort();
        const cancelled: IOperationRecord = keepNoRetry({ kind: 'cancelled', runInstance, code: 'stopped' });
        const written = commit(cancelled, 'stopped');
        return written === undefined ? leaseLost() : { stored: written, outcome: { kind: 'error', error: new SupervisionError('stopped', `Operation ${operation} classification was cancelled`) } };
      }
      if (selected.kind === 'stopped') {
        const cancelled: IOperationRecord = keepNoRetry({ kind: 'cancelled', runInstance, code: 'stopped' });
        const written = commit(cancelled, 'stopped');
        return written === undefined ? leaseLost() : { stored: written, outcome: { kind: 'error', error: new SupervisionError('stopped', `Operation ${operation} classification was cancelled`) } };
      }
      if (attempt.ended || attempt.pending !== undefined) {
        return leaseLost();
      }
      if (selected.kind === 'error') {
        const failed: IOperationRecord = keepNoRetry({ kind: 'failed', runInstance, code: 'policy-error' });
        const written = commit(failed, undefined);
        return written === undefined ? leaseLost() : { stored: written, outcome: { kind: 'error', error: new SupervisionError('operation-classification-failed', `Operation ${operation} source policy failed`) } };
      }
      try {
        decision = validatedRetryDecision(selected.answer);
      } catch {
        const failed: IOperationRecord = keepNoRetry({ kind: 'failed', runInstance, code: 'policy-error' });
        const written = commit(failed, undefined);
        return written === undefined ? leaseLost() : { stored: written, outcome: { kind: 'error', error: new SupervisionError('operation-classification-failed', `Operation ${operation} source policy returned an invalid decision`) } };
      }
    }

    const delay = decision.kind === 'retry-after' ? decision.delayMilliseconds : 0;
    const acceptedAt = now();
    const timed = acceptedAt + delay;
    if (!Number.isSafeInteger(timed)) {
      const failed: IOperationRecord = keepNoRetry({ kind: 'failed', runInstance, code: 'policy-error' });
      const written = commit(failed, undefined);
      return written === undefined ? leaseLost() : { stored: written, outcome: { kind: 'error', error: new SupervisionError('operation-classification-failed', `Operation ${operation} source policy returned invalid timing`) } };
    }
    const notBefore = Math.max(timed, knownNotBefore ?? timed);
    const acceptedClassification: IClassificationRecord = { kind: 'accepted', runInstance, decision, delayMilliseconds: delay, notBefore };
    // An accepted delay does not erase uncertainty about an effect. Keep an
    // unknown operation visible for operator settlement while its accepted
    // decision and floor still govern whether a later send may occur.
    const acceptedStatus: IOperationStatus = decision.kind === 'stop' ? 'retry-exhausted'
      : response.kind === 'unknown' ? 'unknown' : 'deferred';
    const accepted: IOperationRecord = {
      ...withLast(responseRecord, { decision }),
      status: acceptedStatus,
      notBefore,
      classification: acceptedClassification,
      ...(decision.kind === 'stop' ? { retryExhaustedRunInstance: runInstance } : { previousDelayMilliseconds: delay }),
    };
    const written = commit(accepted, response.kind === 'unknown' ? 'lost-response' : response.kind === 'rate-limited' ? 'rate-limited' : response.transient ? 'transient' : 'permanent');
    if (written === undefined) {
      return leaseLost();
    }
    if (decision.kind === 'stop') {
      emit('retry-exhausted', accepted, { stepAttempt, requestAttempt, status: 'retry-exhausted', reason: 'policy-exhausted' });
      return { stored: written, outcome: { kind: 'error', error: new SupervisionError('operation-failed', `Operation ${operation} source policy stopped retrying`, defaultPermanentStop && response.kind === 'failed' ? response.error : undefined) } };
    }
    if (notBefore > now()) {
      emit('retry-scheduled', accepted, { stepAttempt, status: acceptedStatus, reason: response.kind === 'unknown' ? 'lost-response' : response.kind === 'rate-limited' ? 'rate-limited' : 'transient', notBefore });
      return { stored: written, outcome: { kind: 'pending', block: { kind: 'deferred', operation, notBefore } } };
    }
    emit('retry-scheduled', accepted, { stepAttempt, status: response.kind === 'unknown' ? 'unknown' : response.kind === 'rate-limited' ? 'rate-limited' : 'failed', reason: response.kind === 'unknown' ? 'lost-response' : response.kind === 'rate-limited' ? 'rate-limited' : 'transient', notBefore });
    return { stored: written, outcome: { kind: 'retry' } };
  }

  return Object.freeze({
    call,

    terminalClassificationError(subject: IOperationSubject): SupervisionError | undefined {
      for (const entry of readBlocks(subject).entries) {
        const stored = readOperation(entry.operation);
        if (stored === undefined) {
          throw new SupervisionError('integrity', `The block index of ${subject.subject} names a missing operation`);
        }
        const terminal = retainedClassificationError(stored.record);
        if (terminal !== undefined) {
          return terminal;
        }
      }
      return undefined;
    },

    admit(request: IAdmissionRequest, scope: IRequestScope | undefined, stopped: boolean): IAdmissionDecision | undefined {
      const blocks = readBlocks(request.subject);
      let resumable = false;
      for (const entry of blocks.entries) {
        let stored = readOperation(entry.operation);
        if (stored === undefined) {
          throw new SupervisionError('integrity', `The block index of ${request.subject.subject} names a missing operation`);
        }
        if (stored.record.status === 'resolved') {
          // A consumed address neither blocks nor resumes: the body runs, and a call there fails with `operation-resolved`.
          continue;
        }
        if (stored.record.status === 'pending') {
          if (stored.record.classification?.kind === 'pending') {
            if (stored.record.classification.runInstance === currentRunInstance()) {
              const block = classificationBlock(stored);
              noteBlock(scope, request.step, block);
              return Object.freeze({ kind: 'denied', reason: pendingError(block).message });
            }
            // A new invocation can continue after the known response without
            // recasting its committed provider evidence as an unknown send.
            // A future provider restriction still gates this ordinary new
            // run even though the old policy answer never committed.
          } else {
            if (!leftByEarlierWriter(stored, scope?.lease)) {
              return Object.freeze({ kind: 'denied', reason: `operation ${stored.record.operation} is in flight in this run` });
            }
            stored = recover(stored, scope?.lease);
          }
        }
        // Admission still runs normal stop and caller policy checks. A
        // terminal classifier is replayed before the author body, where it
        // can fail with its exact type without letting changed code send.
        if (retainedClassificationError(stored.record) !== undefined) {
          resumable = true;
          continue;
        }
        const block = blockOf(stored.record);
        if (block === undefined) {
          resumable = true;
          continue;
        }
        emit('blocked', stored.record, { status: stored.record.status, reason: blockReason(block), notBefore: block.kind === 'deferred' ? block.notBefore : undefined });
        noteBlock(scope, request.step, block);
        return Object.freeze({ kind: 'denied', reason: pendingError(block).message });
      }
      if (resumable && stopped) {
        return Object.freeze({ kind: 'cancelled', reason: `run ${context.runId} is stopped: a stop refuses resumed deferrals and retries` });
      }
      return undefined;
    },

    inspect(status: IOperationStatus | undefined): readonly IOperationView[] {
      const records = ports.journal.list({ ...namespace, collection: operationsCollection }).map((entry) => decodeOperation(entry.record));
      return Object.freeze(records.filter((record) => status === undefined || record.status === status).map((record) => viewOf(record, namespace)));
    },

    settle(settlement: IOperationSettlement, lease: IRunLease): IOperationView {
      const read = (field: string): unknown => typeof settlement === 'object' && settlement !== null ? Reflect.get(settlement, field) : undefined;
      const action = read('action');
      const operation = read('operation');
      const operator = read('operator');
      const outcome = read('outcome');
      const usage = usageOf(read('usage'));
      if ((action !== 'resolve' && action !== 'abandon') || !nonempty(operation) || !isIdentifier(operator)) {
        throw new SupervisionError('invalid-request', 'A settlement needs action "resolve" or "abandon", an operation and an identifier operator');
      }
      if (action === 'resolve' && ((outcome !== 'succeeded' && outcome !== 'failed') || (read('usage') !== undefined && usage === undefined))) {
        throw new SupervisionError('invalid-request', `Resolving operation ${operation} needs an outcome "succeeded" or "failed" and an optional well-formed usage report`);
      }
      let stored = readOperation(operation);
      if (stored === undefined) {
        throw new SupervisionError('invalid-request', `There is no operation ${operation} in environment ${context.environment}`);
      }
      if (leftByEarlierWriter(stored, lease)) {
        stored = recover(stored, lease);
      }
      // An unknown operation can be resolved or abandoned. An address resolved as succeeded stays consumed until the
      // operator abandons it, the explicit authorization of a possible second effect (supervisor ruling on #121).
      const consumed = holdsAddress(stored.record) && stored.record.status === 'resolved';
      if (stored.record.status !== 'unknown' && !(action === 'abandon' && consumed)) {
        throw new SupervisionError('invalid-request', `Operation ${operation} is ${stored.record.status}; only an unknown operation can be settled, or abandoned once resolved as succeeded`);
      }
      const last = stored.record.attempts.at(-1);
      let report: string | undefined;
      if (action === 'resolve' && usage !== undefined) {
        if (last === undefined) {
          throw new SupervisionError('invalid-request', `Operation ${operation} has no request attempt to attribute usage to`);
        }
        report = `operator:${usage.report}`;
        let acknowledged: { readonly kind: 'acknowledged' | 'duplicate' | 'conflict' };
        try {
          // Usage before outcome: the operator's report is durable before the settlement.
          acknowledged = ports.accounting.acknowledgeUsage({ environment: context.environment, operation, requestAttempt: last.requestAttempt, report, quantities: usage.quantities });
        } catch (error: unknown) {
          throw new SupervisionError('operation-unrecorded', `The operator's usage for operation ${operation} could not be made durable, so nothing was settled`, error);
        }
        if (acknowledged.kind === 'conflict') {
          throw new SupervisionError('invalid-request', `Operation ${operation} already has a different operator report ${report}`);
        }
      }
      const settled: IOperationRecord = {
        ...stored.record,
        status: action === 'resolve' ? 'resolved' : 'abandoned',
        settlement: { action, outcome: action === 'resolve' && (outcome === 'succeeded' || outcome === 'failed') ? outcome : undefined, operator, at: now(), report },
        // Abandoning a resolved operation keeps the resolution it supersedes: the audit trail of the asserted effect.
        resolution: consumed ? stored.record.settlement : stored.record.resolution,
      };
      write(lease, settled, stored.revision);
      emit(action === 'resolve' ? 'resolved' : 'abandoned', settled, { requestAttempt: last?.requestAttempt, status: settled.status, reason: 'operator' });
      return viewOf(settled, namespace);
    },
  });
}
