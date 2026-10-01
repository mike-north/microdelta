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
 *   (`pending`, `deferred` or `unknown`), and those an operator resolved as
 *   succeeded, whose address stays consumed. Admission reads it to honor a
 *   deferral or an unknown outcome before any claim, and a call reads it to
 *   reuse an unsettled operation's identity or to refuse a resolved address.
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

/** The basis on which an unknown outcome may be retried: none, the author's declaration, or provider idempotency keys. */
export type ISafetyBasis = 'none' | 'safe-to-repeat' | 'provider-idempotency';

/** One request attempt as stored. */
export interface IAttemptRecord {
  readonly requestAttempt: string;
  readonly run: string;
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

/** One external operation as stored. */
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
  readonly rateLimitRetries: number;
  readonly status: IOperationStatus;
  /** Consecutive intents of this operation that could not be made durable; it sets the intent retry backoff. */
  readonly unrecorded: number;
  readonly notBefore: number | undefined;
  readonly attempts: readonly IAttemptRecord[];
  readonly settlement: IOperationSettlementRecord | undefined;
}

/** One unsettled operation at a subject's address, as the block index lists it. */
export interface IBlockEntry {
  readonly operation: string;
  readonly name: string;
  readonly binding: string;
}

/** The statuses that keep an operation in its subject's block index. */
const unsettled: ReadonlySet<IOperationStatus> = new Set<IOperationStatus>(['pending', 'deferred', 'unknown']);

/** Whether an operation status is unsettled: pending, deferred or unknown. */
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

/** Request attempts that count against the author's transient and unknown-outcome policy. */
export function spentAttempts(record: IOperationRecord): number {
  return record.attempts.filter((attempt) => attempt.status !== 'not-sent' && attempt.status !== 'rate-limited').length;
}

/** Request attempts a rate or quota limit refused. */
export function rateLimited(record: IOperationRecord): number {
  return record.attempts.filter((attempt) => attempt.status === 'rate-limited').length;
}

/**
 * Whether an unknown outcome may be retried: it needs a safety basis (the
 * author's safe-to-repeat declaration, or provider idempotency keys) and a
 * policy allowing another attempt (EXP-8 resolution 4). Otherwise it waits
 * for an operator.
 */
export function unknownRetry(record: Pick<IOperationRecord, 'safety' | 'maxAttempts'>, spent: number): 'retry' | 'not-repeat-safe' | 'policy-exhausted' {
  if (record.safety === 'none') {
    return 'not-repeat-safe';
  }
  return spent < record.maxAttempts ? 'retry' : 'policy-exhausted';
}

/** Encode an operation record as Value data. */
export function encodeOperation(record: IOperationRecord): IJournalRecordValue {
  return {
    format: operationFormat,
    formatVersion: 1,
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
      attempts: record.attempts.map((attempt) => ({
        requestAttempt: attempt.requestAttempt,
        run: attempt.run,
        stepAttempt: attempt.stepAttempt,
        status: attempt.status,
        remote: attempt.remote ?? null,
        usage: attempt.usage ?? null,
        intent: attempt.intent ?? null,
      })),
      settlement: record.settlement === undefined ? null : {
        action: record.settlement.action,
        outcome: record.settlement.outcome ?? null,
        operator: record.settlement.operator,
        at: record.settlement.at,
        report: record.settlement.report ?? null,
      },
    },
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

const statuses: readonly IOperationStatus[] = ['pending', 'succeeded', 'failed', 'deferred', 'unknown', 'cancelled', 'resolved', 'abandoned'];
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

/** Decode a stored operation record. */
export function decodeOperation(record: IJournalRecordValue): IOperationRecord {
  const what = 'operation record';
  const content = requireFormat(record, operationFormat, what);
  const attempts: unknown = field(content, 'attempts');
  const settlement: unknown = field(content, 'settlement');
  if (!Array.isArray(attempts)) {
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
    status: oneOf(content, 'status', statuses, what),
    notBefore: field(content, 'notBefore') === null ? undefined : whole(content, 'notBefore', what),
    attempts: attempts.map((attempt: unknown): IAttemptRecord => ({
      requestAttempt: text(attempt, 'requestAttempt', what),
      run: text(attempt, 'run', what),
      stepAttempt: text(attempt, 'stepAttempt', what),
      status: oneOf(attempt, 'status', attemptStatuses, what),
      remote: optionalOneOf(attempt, 'remote', remoteStates, what),
      usage: optionalOneOf(attempt, 'usage', usages, what),
      // Absent in records written before the field existed: a not-sent attempt is conservatively read as unconfirmed,
      // as those records were written, so a retry restates its intent and accounting stays complete.
      intent: field(attempt, 'intent') === undefined
        ? (field(attempt, 'status') === 'not-sent' ? 'unconfirmed' : undefined)
        : optionalOneOf(attempt, 'intent', ['unconfirmed'], what),
    })),
    settlement: settlement === null ? undefined : {
      action: oneOf(settlement, 'action', ['resolve', 'abandon'], what),
      outcome: optionalOneOf(settlement, 'outcome', ['succeeded', 'failed'], what),
      operator: text(settlement, 'operator', what),
      at: whole(settlement, 'at', what),
      report: optionalText(settlement, 'report', what),
    },
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
  });
}
