/**
 * The engine of one run's external operations (RUN-011, RUN-012, RUN-013,
 * RUN-014, ACC-003, ACC-005, ACC-007; EXP-8 mechanisms 3 to 7, supervisor
 * resolutions 1 to 8 and ruling R).
 *
 * It owns the meaning of Supervision's operation records and applies, in this
 * order for every request attempt:
 *
 * 1. **Address.** An operation is addressed by its step attempt's subject, its
 *    name and its binding. The subject's block index names the operations at
 *    its addresses that are still unsettled; a call at such an address reuses
 *    that operation's identity, otherwise it mints a new one.
 * 2. **Taint guard.** An attempt that met a deferral or an unknown outcome
 *    rethrows that signal without sending; a deferral is never sent before
 *    its time, and an unknown outcome is never replayed without a safety basis
 *    and an author policy.
 * 3. **Intent before send.** Once the permit is held and stop intent
 *    rechecked, one journal commit records the operation as `pending` with
 *    the new request attempt, then Accounting records the usage intent, and
 *    only then is the request sent. If either fails, nothing is sent.
 * 4. **Usage before outcome.** A usage report is acknowledged through
 *    Accounting before the outcome is committed.
 * 5. **Outcome and policy.** Success settles the operation. A permanent
 *    failure, or an exhausted policy, settles it failed. A transient failure
 *    under an author policy waits out its backoff as a short durable deferral,
 *    holding no permit and no lane, then retries. A rate or quota response
 *    with a retry time defers the operation durably until then and ends the
 *    attempt pending, retried by default up to a cap of 5. An unknown outcome
 *    is retried at once only with a safety basis and a policy allowing
 *    another attempt; otherwise the attempt ends pending.
 * 6. **Hard stop.** An aborted request's remote state is committed to the
 *    journal by operation and request attempt; a provider-confirmed
 *    cancellation settles the operation, otherwise it is unknown.
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
import type { IRunTimer } from './control.js';
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
  IOperationResponse,
  IOperationSettlement,
  IOperationStatus,
  IOperationSubject,
  IOperationUsage,
  IOperationView,
  IRequestAttemptStatus,
  IRunOperationPorts,
} from './operations.js';
import {
  decodeBlocks,
  decodeOperation,
  encodeBlocks,
  encodeOperation,
  isUnsettled,
  rateLimited,
  spentAttempts,
  subjectKey,
  unknownRetry,
  viewOf,
} from './records.js';
import type { IAttemptRecord, IBlockEntry, IOperationRecord, ISafetyBasis } from './records.js';

/**
 * The identifier rule of operation names, operator identities and the usage
 * units events may carry: lower-case, starting with a letter, at most 64
 * characters. An identifier names a kind of thing; it never carries a value.
 */
const identifierRule = /^[a-z][a-z0-9_.:-]{0,63}$/u;

/** The default cap on deferred retries of rate or quota responses (EXP-8 resolution 6). */
const defaultRateLimitRetries = 5;

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
  readonly backoff: number;
  readonly rateLimitRetries: number;
  readonly providerIdempotency: boolean;
  readonly perform: IOperationRequest<T>['perform'];
  readonly cancel: (() => Promise<'cancelled' | 'running'>) | undefined;
}

/** Read and validate an operation request. */
function validated<T>(request: IOperationRequest<T>): IValidatedRequest<T> {
  const read = (field: string): unknown => typeof request === 'object' && request !== null ? Reflect.get(request, field) : undefined;
  const name = read('name');
  const binding = read('binding');
  const perform = read('perform');
  const cancel = read('cancel');
  const safeToRepeat = read('safeToRepeat');
  const providerIdempotency = read('providerIdempotency');
  const retry = read('retry');
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
  const policy = (field: string): unknown => typeof retry === 'object' && retry !== null ? Reflect.get(retry, field) : undefined;
  return {
    name,
    binding,
    safety: providerIdempotency === true ? 'provider-idempotency' : safeToRepeat === true ? 'safe-to-repeat' : 'none',
    maxAttempts: count(policy('maxAttempts'), 1, 'maxAttempts', 1),
    backoff: count(policy('backoffMilliseconds'), 0, 'backoffMilliseconds', 0),
    rateLimitRetries: count(policy('rateLimitRetries'), defaultRateLimitRetries, 'rateLimitRetries', 0),
    providerIdempotency: providerIdempotency === true,
    // Validated just above; the request's own declared types describe these members.
    perform: request.perform.bind(request),
    cancel: request.cancel?.bind(request),
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
  | { readonly kind: 'failed'; readonly transient: boolean; readonly error: unknown; readonly usage: IOperationUsage | undefined }
  | { readonly kind: 'rate-limited'; readonly retryAt: number | undefined; readonly usage: IOperationUsage | undefined }
  | { readonly kind: 'unknown'; readonly usage: IOperationUsage | undefined };

/**
 * Classify a transmission's settled response. A rejected `perform`, and a
 * response that is not one of the declared kinds, are unknown outcomes: an
 * uncertain response is never evidence that nothing happened (RUN-012).
 */
function classify<T>(sent: Extract<ITransmitted<IOperationResponse<T>>, { readonly kind: 'returned' | 'threw' }>): IClassified<T> {
  if (sent.kind === 'threw') {
    return { kind: 'unknown', usage: undefined };
  }
  const response: unknown = sent.value;
  if (typeof response !== 'object' || response === null) {
    return { kind: 'unknown', usage: undefined };
  }
  const usage = usageOf(Reflect.get(response, 'usage'));
  const answer = sent.value;
  switch (answer.kind) {
    case 'succeeded':
      return { kind: 'succeeded', value: answer.value, usage };
    case 'failed':
      return { kind: 'failed', transient: answer.transient === true, error: answer.error, usage };
    case 'rate-limited':
      return { kind: 'rate-limited', retryAt: typeof answer.retryAt === 'number' && Number.isSafeInteger(answer.retryAt) ? answer.retryAt : undefined, usage };
    default:
      // An `unknown` answer, or a kind no adapter may answer.
      return { kind: 'unknown', usage };
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
  /** Offer an event to observers; a failure becomes a diagnostic. */
  report(event: IRunEvent, position: string): void;
  /** Record a run diagnostic; it names codes and identifiers only. */
  diagnose(message: string): void;
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
  const { context, ports, timer } = engine;
  const namespace = { analysis: context.analysis, environment: context.environment };
  const now = (): number => timer.currentEpochMilliseconds();

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
    const entries = isUnsettled(next.status) ? [...others, { operation: next.operation, name: next.name, binding: next.binding }] : others;
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

  /** The block an unsettled record imposes now, or undefined when it may be resumed. */
  function blockOf(record: IOperationRecord): IOperationBlock | undefined {
    if (record.status === 'deferred' && record.notBefore !== undefined && now() < record.notBefore) {
      return { kind: 'deferred', operation: record.operation, notBefore: record.notBefore };
    }
    if (record.status === 'unknown') {
      const decision = unknownRetry(record, spentAttempts(record));
      return decision === 'retry' ? undefined : { kind: 'unknown-outcome', operation: record.operation, reason: decision };
    }
    return undefined;
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

  /** Locate the unsettled operation at an address, if any. */
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
    if (attempt.pending !== undefined) {
      throw pendingError(attempt.pending);
    }
    if (attempt.taint !== undefined) {
      throw new SupervisionError('stopped', `Operation ${request.name} was refused: ${attempt.taint}`);
    }
    const { lease } = scope;
    const subject = attempt.subject;
    const stepAttempt = String(attempt.attemptId);
    let stored = locate(subject, request.name, request.binding);
    if (stored !== undefined && stored.record.status === 'pending') {
      if (!leftByEarlierWriter(stored, lease)) {
        throw new SupervisionError('invalid-request', `Operation ${stored.record.operation} is already in flight in this run`);
      }
      stored = recover(stored, lease);
    }
    let retry = false;
    if (stored !== undefined) {
      // The current declaration governs a call's own retry decision.
      const current: IOperationRecord = { ...stored.record, safety: request.safety, maxAttempts: request.maxAttempts, rateLimitRetries: request.rateLimitRetries };
      const block = blockOf(current);
      if (block !== undefined) {
        emit('blocked', current, { stepAttempt, status: current.status, reason: block.kind === 'deferred' ? 'not-before' : block.reason, notBefore: block.kind === 'deferred' ? block.notBefore : undefined });
        return pend(attempt, scope, block);
      }
      stored = { ...stored, record: current };
      retry = true;
    }
    let current: IStored;
    if (stored !== undefined) {
      current = stored;
    } else {
      attempt.minted += 1;
      const record: IOperationRecord = {
        operation: `op-${stepAttempt}-${String(attempt.minted)}`,
        subject: subject.subject,
        version: subject.version,
        member: attempt.member,
        name: request.name,
        binding: request.binding,
        safety: request.safety,
        maxAttempts: request.maxAttempts,
        rateLimitRetries: request.rateLimitRetries,
        status: 'pending',
        notBefore: undefined,
        attempts: [],
        settlement: undefined,
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
    const requestAttempt = `${operation}/${String(before.record.attempts.length + 1)}`;
    let current = before;
    const sent = await transport.transmit<IOperationResponse<T>>({
      label: request.name,
      retry,
      perform: (signal) => request.perform({ signal, operation, requestAttempt, idempotencyKey: request.providerIdempotency ? operation : undefined }),
      cancel: request.cancel,
    }, () => {
      // Intent before send: the operation record, then Accounting's usage intent.
      const intent: IOperationRecord = {
        ...before.record,
        status: 'pending',
        notBefore: undefined,
        attempts: [...before.record.attempts, { requestAttempt, run: context.runId, stepAttempt, status: 'pending', remote: undefined, usage: undefined }],
      };
      current = write(lease, intent, before.revision);
      try {
        ports.accounting.recordUsageIntent({
          environment: context.environment,
          operation,
          requestAttempt,
          attribution: { run: context.runId, member: attempt.member ?? null, stepAttempt },
        });
      } catch (error: unknown) {
        // Nothing will be sent: record the attempt not sent and restore the operation's earlier standing.
        const restored: IOperationRecord = before.revision === 0
          ? { ...withLast(intent, { status: 'not-sent' }), status: 'failed' }
          : { ...withLast(intent, { status: 'not-sent' }), status: before.record.status, notBefore: before.record.notBefore };
        try {
          current = write(lease, restored, current.revision);
        } catch {
          engine.diagnose(`lease-lost: operation ${operation} request attempt ${requestAttempt} stays pending though it was never sent`);
        }
        throw error;
      }
      emit('request-started', intent, { stepAttempt, requestAttempt, status: 'pending' });
    });
    if (sent.kind === 'unrecorded') {
      return { stored: current, outcome: { kind: 'error', error: new SupervisionError('operation-unrecorded', `Operation ${operation}'s intent could not be made durable, so nothing was sent`, sent.error) } };
    }
    if (sent.kind === 'refused') {
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
    return settleResponse(current, response, usage, { stepAttempt, requestAttempt, request, transport, lease });
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
    where: { readonly stepAttempt: string; readonly requestAttempt: string; readonly request: IValidatedRequest<T>; readonly transport: IOperationTransport; readonly lease: IRunLease },
  ): Promise<{ readonly stored: IStored; readonly outcome: IAttemptOutcome<T> }> {
    const { stepAttempt, requestAttempt, request, transport, lease } = where;
    const operation = current.record.operation;
    const settledAs = (attemptStatus: IRequestAttemptStatus, status: IOperationStatus, notBefore?: number): IOperationRecord => ({
      ...withLast(current.record, { status: attemptStatus, usage }),
      status,
      notBefore,
    });
    /** Commit and report; a lost lease makes the outcome unknown (ruling R). */
    const commit = (next: IOperationRecord, reason: IOperationReason | undefined): IStored | undefined => {
      const written = settle(current, next, lease);
      if (written.record.status === 'pending') {
        emit('request-settled', next, { stepAttempt, requestAttempt, status: 'unknown', reason: 'lease-lost' });
        return undefined;
      }
      emit('request-settled', next, { stepAttempt, requestAttempt, status: next.attempts.at(-1)?.status, reason });
      return written;
    };
    /** The outcome could not be recorded under the pass's lease: it is unknown, and the attempt ends pending. */
    const leaseLost = (): { readonly stored: IStored; readonly outcome: IAttemptOutcome<T> } => ({
      stored: current,
      outcome: { kind: 'pending', block: { kind: 'unknown-outcome', operation, reason: 'unrecorded' } },
    });
    switch (response.kind) {
      case 'succeeded': {
        const written = commit(settledAs('succeeded', 'succeeded'), undefined);
        return written === undefined ? leaseLost() : { stored: written, outcome: { kind: 'value', value: response.value } };
      }
      case 'rate-limited':
      case 'failed': {
        const rateLimitedWithTime = response.kind === 'rate-limited' && response.retryAt !== undefined;
        if (rateLimitedWithTime) {
          const next = settledAs('rate-limited', 'deferred', response.retryAt);
          if (rateLimited(next) > request.rateLimitRetries) {
            const exhausted: IOperationRecord = { ...next, status: 'failed', notBefore: undefined };
            const written = commit(exhausted, 'rate-limited');
            if (written === undefined) {
              return leaseLost();
            }
            emit('retry-exhausted', exhausted, { stepAttempt, status: 'failed', reason: 'policy-exhausted' });
            return { stored: written, outcome: { kind: 'error', error: new SupervisionError('operation-failed', `Operation ${operation} is still rate limited after ${String(request.rateLimitRetries)} deferred retries`) } };
          }
          const written = commit(next, 'rate-limited');
          if (written === undefined) {
            return leaseLost();
          }
          const notBefore = next.notBefore ?? now();
          emit('retry-scheduled', next, { stepAttempt, status: 'deferred', reason: 'rate-limited', notBefore });
          return { stored: written, outcome: { kind: 'pending', block: { kind: 'deferred', operation, notBefore } } };
        }
        // A permanent failure, or a transient one (including a rate limit without a retry time).
        const transient = response.kind === 'rate-limited' || response.transient;
        const failed = settledAs('failed', 'failed');
        const retryable = transient && spentAttempts(failed) < request.maxAttempts;
        if (!retryable) {
          const written = commit(failed, transient ? (response.kind === 'rate-limited' ? 'rate-limited' : 'transient') : 'permanent');
          if (written === undefined) {
            return leaseLost();
          }
          if (transient) {
            emit('retry-exhausted', failed, { stepAttempt, status: 'failed', reason: 'policy-exhausted' });
          }
          const cause = response.kind === 'failed' ? response.error : undefined;
          return { stored: written, outcome: { kind: 'error', error: new SupervisionError('operation-failed', `Operation ${operation} failed${transient ? ' after its retry policy was exhausted' : ''}`, cause) } };
        }
        // A short durable deferral covers the backoff, so a crash during it leaves a time a later run honors.
        const notBefore = now() + request.backoff;
        const waiting = settledAs('failed', 'deferred', notBefore);
        const written = commit(waiting, response.kind === 'rate-limited' ? 'rate-limited' : 'transient');
        if (written === undefined) {
          return leaseLost();
        }
        emit('retry-scheduled', waiting, { stepAttempt, status: 'deferred', reason: 'transient', notBefore });
        if (request.backoff > 0) {
          // Holds no permit and lends the member's lane; any stop ends it (and taints the attempt).
          await transport.sleepUntil(notBefore);
        }
        return { stored: written, outcome: { kind: 'retry' } };
      }
      case 'unknown': {
        const unknown = settledAs('unknown', 'unknown');
        const written = commit(unknown, 'lost-response');
        if (written === undefined) {
          return leaseLost();
        }
        const decision = unknownRetry({ safety: request.safety, maxAttempts: request.maxAttempts }, spentAttempts(unknown));
        if (decision === 'retry') {
          return { stored: written, outcome: { kind: 'retry' } };
        }
        return { stored: written, outcome: { kind: 'pending', block: { kind: 'unknown-outcome', operation, reason: decision } } };
      }
      default: {
        const exhaustive: never = response;
        return exhaustive;
      }
    }
  }

  return Object.freeze({
    call,

    admit(request: IAdmissionRequest, scope: IRequestScope | undefined, stopped: boolean): IAdmissionDecision | undefined {
      const blocks = readBlocks(request.subject);
      let resumable = false;
      for (const entry of blocks.entries) {
        let stored = readOperation(entry.operation);
        if (stored === undefined) {
          throw new SupervisionError('integrity', `The block index of ${request.subject.subject} names a missing operation`);
        }
        if (stored.record.status === 'pending') {
          if (!leftByEarlierWriter(stored, scope?.lease)) {
            return Object.freeze({ kind: 'denied', reason: `operation ${stored.record.operation} is in flight in this run` });
          }
          stored = recover(stored, scope?.lease);
        }
        const block = blockOf(stored.record);
        if (block === undefined) {
          resumable = true;
          continue;
        }
        emit('blocked', stored.record, { status: stored.record.status, reason: block.kind === 'deferred' ? 'not-before' : block.reason, notBefore: block.kind === 'deferred' ? block.notBefore : undefined });
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
      if (stored.record.status !== 'unknown') {
        throw new SupervisionError('invalid-request', `Operation ${operation} is ${stored.record.status}; only an unknown operation can be settled`);
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
      };
      write(lease, settled, stored.revision);
      emit(action === 'resolve' ? 'resolved' : 'abandoned', settled, { requestAttempt: last?.requestAttempt, status: settled.status, reason: 'operator' });
      return viewOf(settled, namespace);
    },
  });
}
