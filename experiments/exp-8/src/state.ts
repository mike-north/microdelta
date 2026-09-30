/**
 * EXP-8's durable fixture state: the facts a later process must be able to
 * recover about one store. It holds the single writer lease and fence, step
 * attempts, logical external operations and their request attempts, keyed
 * usage acknowledgments and current result pointers. It is one immutable
 * snapshot committed whole through a port so that a real process boundary
 * (and a real process kill) separates writer from reader. It is **not** a
 * selected History or Accounting schema: record layout, indexing and
 * transactions belong to later package work under PUB-004 and ACC-007.
 */
import { isData } from './data.js';
import type { IData } from './data.js';

/**
 * One request attempt (a single network try) as far as this store knows.
 * `pending` means the intent is durable and no outcome has been recorded; a
 * recovering writer turns a dead process's `pending` into `unknown`, never into
 * success or failure. `not-applied` is a provider statement that the request
 * had no effect (rate limit, unavailability, rejection). `cancelled` is a
 * provider-confirmed remote cancellation; `running` is a provider report that
 * the remote work continues after a local abort; `unknown` means no remote
 * information (lost response, local abort without provider support, crash).
 * @internal
 */
export type IRequestState = 'pending' | 'succeeded' | 'not-applied' | 'unknown' | 'cancelled' | 'running';

/**
 * A logical external operation's state, owned across request attempts and
 * processes (RUN-012). `deferred` carries a durable "not before" time. The
 * ambiguous states `unknown` and `running` block automatic replay unless the
 * author declared the operation safe to repeat.
 * @internal
 */
export type IOperationState = 'pending' | 'succeeded' | 'deferred' | 'failed' | 'unknown' | 'running' | 'cancelled';

/**
 * A durable step attempt's lifecycle. Only `completed` corresponds to a
 * publication; every other terminal state retains evidence without a result
 * (RUN-015). `unknown-outcome` means an operation's effect is unresolved and no
 * automatic replay is permitted.
 * @internal
 */
export type IStepAttemptState = 'running' | 'completed' | 'deferred' | 'failed' | 'interrupted' | 'unknown-outcome';

/**
 * An author-declared retry policy for failures other than a rate limit with a
 * known retry time. `maxAttempts` bounds the total request attempts of one
 * logical operation across all processes; `backoffMs` is the fixed fake-clock
 * delay before an in-body retry. Without a policy such failures never retry.
 * @internal
 */
export interface IRetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
}

/** The store's single writer lease. `holder` is a run identifier; `fence` increases on every acquisition. @internal */
export interface ILeaseRecord {
  readonly holder: string | null;
  readonly fence: number;
  readonly expiresAt: number;
}

/** A durable step attempt for one member, tagged with the run and fence that admitted it. @internal */
export interface IStepAttemptRecord {
  readonly member: string;
  readonly runId: string;
  readonly fence: number;
  readonly state: IStepAttemptState;
}

/**
 * A logical external operation, addressed by (member, author operation name,
 * canonical request binding). Its identifier is persisted before any request
 * is sent, so a retry in any later process reuses it. The author's repeat
 * declaration and retry policy are persisted with it so that a later process
 * can decide replay safety before running any body.
 * @internal
 */
export interface IOperationRecord {
  readonly member: string;
  readonly name: string;
  readonly bindingDigest: string;
  readonly safeToRepeat: boolean;
  readonly retry: IRetryPolicy | null;
  readonly state: IOperationState;
  readonly notBefore: number | null;
}

/** A request attempt: the "operation started" intent plus its recorded outcome. @internal */
export interface IRequestRecord {
  readonly operationId: string;
  readonly stepAttemptId: string;
  readonly member: string;
  readonly runId: string;
  readonly startedAt: number;
  readonly state: IRequestState;
}

/**
 * One durably acknowledged usage report, keyed by (operation ID, report ID).
 * Quantities are observed deltas by unit; no unit is converted or priced.
 * @internal
 */
export interface IUsageRecord {
  readonly operationId: string;
  readonly requestAttemptId: string;
  readonly reportId: string;
  readonly quantities: Readonly<Record<string, number>>;
}

/** A member's current published result: exact reference, producing attempt and retained payload. @internal */
export interface IResultRecord {
  readonly reference: string;
  readonly stepAttemptId: string;
  readonly output: IData;
}

/**
 * The whole durable snapshot. `next` allocates every identifier (run, step
 * attempt, operation, request attempt, result), so identifiers never repeat
 * across processes.
 * @internal
 */
export interface IDurableState {
  readonly version: 1;
  readonly next: number;
  readonly lease: ILeaseRecord;
  readonly results: Readonly<Record<string, IResultRecord>>;
  readonly attempts: Readonly<Record<string, IStepAttemptRecord>>;
  readonly operations: Readonly<Record<string, IOperationRecord>>;
  readonly requests: Readonly<Record<string, IRequestRecord>>;
  readonly usage: Readonly<Record<string, IUsageRecord>>;
}

/** A store with no history and a free lease. @internal */
export function emptyState(): IDurableState {
  return {
    version: 1,
    next: 1,
    lease: { holder: null, fence: 0, expiresAt: 0 },
    results: {},
    attempts: {},
    operations: {},
    requests: {},
    usage: {},
  };
}

/** The deduplication key of a usage acknowledgment. @internal */
export function usageKey(operationId: string, reportId: string): string {
  return `${operationId}#${reportId}`;
}

/**
 * Resource Accounting's read-side view over the durable facts. `known` sums
 * each acknowledged report once, by unit. `unknownRequests` lists request
 * attempts with no acknowledged report whose outcome is settled, or whose
 * intent is dead: their usage is unknown, never zero (ACC-005).
 * `pendingRequests` are live intents only.
 * @internal
 */
export interface IUsageSummary {
  readonly known: Readonly<Record<string, number>>;
  readonly unknownRequests: readonly string[];
  readonly pendingRequests: readonly string[];
}

/**
 * Derive the usage view from durable facts only; nothing in memory
 * contributes. A `pending` intent is live only while its own run holds an
 * unexpired lease at `now`; otherwise its process is gone and the view reports
 * it as unknown. This view needs no writer: making that recovery durable is the
 * next writer's job (`Store.acquire`).
 * @internal
 */
export function summarizeUsage(state: IDurableState, now: number): IUsageSummary {
  const known: Record<string, number> = {};
  const reported = new Set<string>();
  for (const usage of Object.values(state.usage)) {
    reported.add(usage.requestAttemptId);
    for (const [unit, amount] of Object.entries(usage.quantities)) {
      known[unit] = (known[unit] ?? 0) + amount;
    }
  }
  const lease = state.lease;
  const live = (runId: string): boolean => lease.holder === runId && lease.expiresAt > now;
  const requests = Object.entries(state.requests);
  return {
    known,
    unknownRequests: requests
      .filter(([id, request]) => !reported.has(id) && (request.state !== 'pending' || !live(request.runId)))
      .map(([id]) => id),
    pendingRequests: requests.filter(([, request]) => request.state === 'pending' && live(request.runId)).map(([id]) => id),
  };
}

/** Structural check failure while reading a fixture file. */
function invalid(what: string): never {
  throw new TypeError(`Invalid EXP-8 fixture state: ${what}`);
}

/** Narrow an untrusted value to a plain string-keyed record. */
function record(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(what);
  }
  const fields: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    fields[key] = field;
  }
  return fields;
}

function text(value: unknown, what: string): string {
  return typeof value === 'string' ? value : invalid(what);
}

function count(value: unknown, what: string): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : invalid(what);
}

function nullable<T>(value: unknown, parse: (inner: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const found = allowed.find(candidate => candidate === value);
  return found ?? invalid(what);
}

function each<T>(value: unknown, what: string, parse: (entry: Readonly<Record<string, unknown>>) => T): Record<string, T> {
  const parsed: Record<string, T> = {};
  for (const [key, entry] of Object.entries(record(value, what))) {
    parsed[key] = parse(record(entry, `${what}.${key}`));
  }
  return parsed;
}

const requestStates: readonly IRequestState[] = ['pending', 'succeeded', 'not-applied', 'unknown', 'cancelled', 'running'];
const operationStates: readonly IOperationState[] = ['pending', 'succeeded', 'deferred', 'failed', 'unknown', 'running', 'cancelled'];
const attemptStates: readonly IStepAttemptState[] = ['running', 'completed', 'deferred', 'failed', 'interrupted', 'unknown-outcome'];

function quantities(value: unknown): Record<string, number> {
  const parsed: Record<string, number> = {};
  for (const [unit, amount] of Object.entries(record(value, 'quantities'))) {
    parsed[unit] = count(amount, 'quantity');
  }
  return parsed;
}

/**
 * Rebuild a snapshot from untrusted JSON. Unknown versions and malformed
 * records reject rather than being repaired or migrated by guessing.
 * @internal
 */
export function parseState(value: unknown): IDurableState {
  const root = record(value, 'root');
  if (root.version !== 1) {
    return invalid('version');
  }
  const lease = record(root.lease, 'lease');
  return {
    version: 1,
    next: count(root.next, 'next'),
    lease: {
      holder: nullable(lease.holder, inner => text(inner, 'lease.holder')),
      fence: count(lease.fence, 'lease.fence'),
      expiresAt: count(lease.expiresAt, 'lease.expiresAt'),
    },
    results: each(root.results, 'results', entry => {
      const output: unknown = entry.output;
      return {
        reference: text(entry.reference, 'reference'),
        stepAttemptId: text(entry.stepAttemptId, 'stepAttemptId'),
        output: isData(output) ? output : invalid('output'),
      };
    }),
    attempts: each(root.attempts, 'attempts', entry => ({
      member: text(entry.member, 'member'),
      runId: text(entry.runId, 'runId'),
      fence: count(entry.fence, 'fence'),
      state: oneOf(entry.state, attemptStates, 'attempt state'),
    })),
    operations: each(root.operations, 'operations', entry => ({
      member: text(entry.member, 'member'),
      name: text(entry.name, 'name'),
      bindingDigest: text(entry.bindingDigest, 'bindingDigest'),
      safeToRepeat: entry.safeToRepeat === true,
      retry: nullable(entry.retry, inner => {
        const policy = record(inner, 'retry');
        return { maxAttempts: count(policy.maxAttempts, 'maxAttempts'), backoffMs: count(policy.backoffMs, 'backoffMs') };
      }),
      state: oneOf(entry.state, operationStates, 'operation state'),
      notBefore: nullable(entry.notBefore, inner => count(inner, 'notBefore')),
    })),
    requests: each(root.requests, 'requests', entry => ({
      operationId: text(entry.operationId, 'operationId'),
      stepAttemptId: text(entry.stepAttemptId, 'stepAttemptId'),
      member: text(entry.member, 'member'),
      runId: text(entry.runId, 'runId'),
      startedAt: count(entry.startedAt, 'startedAt'),
      state: oneOf(entry.state, requestStates, 'request state'),
    })),
    usage: each(root.usage, 'usage', entry => ({
      operationId: text(entry.operationId, 'operationId'),
      requestAttemptId: text(entry.requestAttemptId, 'requestAttemptId'),
      reportId: text(entry.reportId, 'reportId'),
      quantities: quantities(entry.quantities),
    })),
  };
}
