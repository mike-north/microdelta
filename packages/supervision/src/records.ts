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
  /** The private invocation whose known refusal exhausted allowance; only v3 can carry this authority. */
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

/** Encode v3 operation records while carrying legacy attempts without inventing invocation identity. */
export function encodeOperation(record: IOperationRecord): IJournalRecordValue {
  return {
    format: operationFormat,
    formatVersion: 3,
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
      })),
      settlement: record.settlement === undefined ? null : encodeSettlement(record.settlement),
      resolution: record.resolution === undefined ? null : encodeSettlement(record.resolution),
    },
  };
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

/** Decode a current private identity, allowing null only for an upgraded v1 attempt. */
function decodedRunInstance(value: unknown, what: string): string | undefined {
  const read = optionalText(value, 'runInstance', what);
  return read === undefined || runInstanceRule.test(read) ? read : damaged(what);
}

/** A required safe-integer field. */
function whole(value: unknown, name: string, what: string): number {
  const read = field(value, name);
  return typeof read === 'number' && Number.isSafeInteger(read) ? read : damaged(what);
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

/** Decode legacy records and v3 invocation-scoped exhaustion without inferring authority from public run labels. */
export function decodeOperation(record: IJournalRecordValue): IOperationRecord {
  const what = 'operation record';
  if (record.format !== operationFormat || (record.formatVersion !== 1 && record.formatVersion !== 2 && record.formatVersion !== 3)) {
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
  const retryExhaustedRunInstance = record.formatVersion === 3
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
  }));
  if (record.formatVersion < 3 && status === 'retry-exhausted') {
    return damaged(what);
  }
  if (status === 'retry-exhausted') {
    const last = decodedAttempts.at(-1);
    if (retryExhaustedRunInstance === undefined || last?.runInstance !== retryExhaustedRunInstance || (last.status !== 'failed' && last.status !== 'rate-limited')) {
      return damaged(what);
    }
  } else if (retryExhaustedRunInstance !== undefined) {
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
    retryExhaustedRunInstance,
    attempts: decodedAttempts,
    settlement: settlement === null ? undefined : decodeSettlement(settlement, what),
    // Absent in records written before the field existed: no abandonment could then supersede a resolution, so none is kept.
    resolution: resolution === undefined || resolution === null ? undefined : decodeSettlement(resolution, what),
  };
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
