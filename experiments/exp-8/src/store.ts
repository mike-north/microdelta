/**
 * EXP-8's store candidate: History's single fenced writer lease plus the
 * operation journal and keyed usage acknowledgments, over an injected durable
 * port. Every mutation is one whole-snapshot commit at a named boundary, so a
 * harness can kill the process immediately before or after any boundary.
 * Only the lease holder writes. Renewal happens only when real work commits;
 * there is no timer-driven renewal (RUN-015).
 */
import { canonical } from './data.js';
import type { IData } from './data.js';
import type { IUsageReport } from './provider.js';
import { usageKey } from './state.js';
import type {
  IDurableState,
  IOperationRecord,
  IOperationState,
  IRequestRecord,
  IRequestState,
  IRetryPolicy,
  IStepAttemptRecord,
  IStepAttemptState,
} from './state.js';

/**
 * Named commit boundaries. The harness targets process kills at these points:
 * `operation-intent` is the durable "operation started" record made before a
 * paid call; `usage-acknowledged` is the durable usage acknowledgment;
 * `publication` atomically records a result and completes its attempt.
 * @internal
 */
export type ICommitBoundary =
  | 'lease-acquired'
  | 'lease-released'
  | 'step-admitted'
  | 'operation-intent'
  | 'usage-acknowledged'
  | 'request-settled'
  | 'publication'
  | 'step-settled';

/**
 * The durable port. `commit` makes the whole snapshot durable or throws; if it
 * throws `CommitUnknownError`, the write may have happened (a lost
 * acknowledgment) and the store must reload before deciding anything.
 * `subject` is the member the commit concerns, for fault targeting only.
 * @internal
 */
export interface IDurablePort {
  load(): IDurableState;
  commit(boundary: ICommitBoundary, state: IDurableState, subject: string | null): void;
}

/** The port could not tell whether a commit became durable. @internal */
export class CommitUnknownError extends Error {
  constructor(readonly boundary: ICommitBoundary) {
    super(`Commit outcome unknown at ${boundary}`);
    this.name = 'CommitUnknownError';
  }
}

/**
 * This writer no longer holds an unexpired, current lease (it expired, or
 * another writer took it over). PUB-004: every holder mutation requires that
 * authority, so nothing is written; there is no timer-driven renewal (RUN-015).
 * @internal
 */
export class LeaseLostError extends Error {
  constructor() {
    super('EXP-8 store: this writer no longer holds an unexpired, current lease');
    this.name = 'LeaseLostError';
  }
}

/** A usage report that cannot be attributed to a known request of its operation. @internal */
export class UnattributableReportError extends Error {
  constructor() {
    super('EXP-8 store: the usage report does not name a known request of its operation');
    this.name = 'UnattributableReportError';
  }
}

/** A request attempt settled while its intent was still pending in a dead process. @internal */
export interface IRecoveredRequest {
  readonly requestAttemptId: string;
  readonly operationId: string;
  readonly member: string;
}

/** Lease acquisition: the holder's run and fence plus anything recovered, or a live foreign holder. @internal */
export type IAcquireResult =
  | { readonly status: 'acquired'; readonly runId: string; readonly fence: number; readonly recovered: readonly IRecoveredRequest[] }
  | { readonly status: 'busy'; readonly holder: string; readonly expiresAt: number };

/** The author-visible addressing and replay facts recorded with an intent. @internal */
export interface IIntentInput {
  readonly member: string;
  readonly stepAttemptId: string;
  readonly runId: string;
  readonly name: string;
  readonly bindingDigest: string;
  readonly safeToRepeat: boolean;
  readonly retry: IRetryPolicy | null;
}

/** Result of an idempotent usage acknowledgment keyed by (operation ID, report ID). @internal */
export type IAcknowledgment = 'acknowledged' | 'duplicate' | 'conflict';

/**
 * Operation states whose identifier a later call with the same address reuses:
 * the logical operation has not reached a settled outcome. Succeeded, failed and
 * remotely cancelled operations are settled; a new call is a new operation.
 */
const reusableStates: ReadonlySet<IOperationState> = new Set<IOperationState>(['pending', 'deferred', 'unknown', 'running']);

/** Look up a record that must exist; a missing one is a protocol defect, never repaired. */
function existing<T>(records: Readonly<Record<string, T>>, id: string, what: string): T {
  const found = records[id];
  if (found === undefined) {
    throw new TypeError(`EXP-8 store: unknown ${what} ${id}`);
  }
  return found;
}

/** Allocate the next store-wide identifier with a readable prefix. */
function allocate(state: IDurableState, prefix: string): readonly [string, IDurableState] {
  return [`${prefix}-${String(state.next)}`, { ...state, next: state.next + 1 }];
}

/**
 * The store candidate. It holds the last snapshot known to be durable and the
 * lease identity it acquired; every write checks that identity (fencing).
 * @internal
 */
export class Store {
  private current: IDurableState;
  private holder: { readonly runId: string; readonly fence: number } | null = null;

  constructor(
    private readonly port: IDurablePort,
    private readonly leaseTtlMs: number,
  ) {
    this.current = port.load();
  }

  /** The last snapshot known to be durable. */
  get state(): IDurableState {
    return this.current;
  }

  /** Reload from the port, discarding the in-memory snapshot. */
  reload(): void {
    this.current = this.port.load();
  }

  /** Commit a whole snapshot; after an ambiguous commit, reload so the truth decides. */
  private write(boundary: ICommitBoundary, next: IDurableState, subject: string | null): void {
    try {
      this.port.commit(boundary, next, subject);
    } catch (error) {
      if (error instanceof CommitUnknownError) {
        this.reload();
      }
      throw error;
    }
    this.current = next;
  }

  /**
   * Fencing: only the identity that acquired the lease may write, and only
   * while the *durable* lease is still its own and unexpired. The in-memory
   * snapshot is never trusted for this: another process may have taken over.
   */
  private assertHolder(now: number): void {
    const lease = this.port.load().lease;
    if (this.holder === null || lease.holder !== this.holder.runId || lease.fence !== this.holder.fence || lease.expiresAt <= now) {
      throw new LeaseLostError();
    }
  }

  /** A holder mutation: fence check, change, progress-driven lease renewal, commit. */
  private transact(boundary: ICommitBoundary, subject: string | null, now: number, change: (state: IDurableState) => IDurableState): void {
    this.assertHolder(now);
    const changed = change(this.current);
    this.write(boundary, { ...changed, lease: { ...changed.lease, expiresAt: now + this.leaseTtlMs } }, subject);
  }

  /**
   * Acquire the writer lease. A free or expired lease is taken with the next
   * fence; recovery then marks the dead holder's running attempts interrupted
   * and its pending requests `unknown`. `runId` continues an existing run.
   */
  acquire(runId: string | null, now: number): IAcquireResult {
    this.reload();
    const lease = this.current.lease;
    if (lease.holder !== null && lease.expiresAt > now) {
      return { status: 'busy', holder: lease.holder, expiresAt: lease.expiresAt };
    }
    const [id, allocated] = runId === null ? allocate(this.current, 'run') : [runId, this.current] as const;
    const fence = lease.fence + 1;
    const recovered: IRecoveredRequest[] = [];
    const requests: Record<string, IRequestRecord> = {};
    for (const [requestId, request] of Object.entries(allocated.requests)) {
      if (request.state === 'pending') {
        recovered.push({ requestAttemptId: requestId, operationId: request.operationId, member: request.member });
      }
      requests[requestId] = request.state === 'pending' ? { ...request, state: 'unknown' } : request;
    }
    const unresolved = new Set(recovered.map(request => request.operationId));
    const operations: Record<string, IOperationRecord> = {};
    for (const [operationId, operation] of Object.entries(allocated.operations)) {
      operations[operationId] = unresolved.has(operationId) ? { ...operation, state: 'unknown' } : operation;
    }
    const attempts: Record<string, IStepAttemptRecord> = {};
    for (const [attemptId, attempt] of Object.entries(allocated.attempts)) {
      attempts[attemptId] = attempt.state === 'running' ? { ...attempt, state: 'interrupted' } : attempt;
    }
    this.write('lease-acquired', {
      ...allocated,
      lease: { holder: id, fence, expiresAt: now + this.leaseTtlMs },
      requests,
      operations,
      attempts,
    }, null);
    this.holder = { runId: id, fence };
    return { status: 'acquired', runId: id, fence, recovered };
  }

  /** Release the lease so another process may write; this store must re-acquire before writing again. */
  release(now: number): void {
    this.assertHolder(now);
    this.write('lease-released', { ...this.current, lease: { ...this.current.lease, holder: null, expiresAt: now } }, null);
    this.holder = null;
  }

  /** Durably admit a step attempt for a member. */
  beginAttempt(member: string, runId: string, now: number): string {
    const fence = this.holder?.fence ?? 0;
    let id = '';
    this.transact('step-admitted', member, now, state => {
      const [attemptId, next] = allocate(state, 'step');
      id = attemptId;
      return { ...next, attempts: { ...next.attempts, [attemptId]: { member, runId, fence, state: 'running' } } };
    });
    return id;
  }

  /** The unsettled operation with this address, if any, whose identifier a retry must reuse. */
  openOperation(member: string, name: string, bindingDigest: string): string | undefined {
    const matches = Object.entries(this.current.operations).filter(([, operation]) => operation.member === member
      && operation.name === name && operation.bindingDigest === bindingDigest && reusableStates.has(operation.state));
    return matches[matches.length - 1]?.[0];
  }

  /** How many request attempts an operation has had, across every process. */
  requestCount(operationId: string): number {
    return Object.values(this.current.requests).filter(request => request.operationId === operationId).length;
  }

  /**
   * Durable "operation started" intent before a paid call; creates the
   * operation if new. A deferred operation cannot be restarted before its
   * "not before" time: the deferral is never cleared early.
   */
  intent(input: IIntentInput, operationId: string | undefined, now: number): { readonly operationId: string; readonly requestAttemptId: string } {
    const prior = operationId === undefined ? undefined : this.current.operations[operationId];
    if (prior?.state === 'deferred' && prior.notBefore !== null && prior.notBefore > now) {
      throw new Error(`EXP-8 store: operation ${operationId ?? ''} is deferred until ${String(prior.notBefore)}`);
    }
    let ids = { operationId: '', requestAttemptId: '' };
    this.transact('operation-intent', input.member, now, state => {
      const [opId, withOperation] = operationId === undefined ? allocate(state, 'op') : [operationId, state] as const;
      const [requestId, next] = allocate(withOperation, 'req');
      const operation: IOperationRecord = operationId === undefined
        ? {
            member: input.member,
            name: input.name,
            bindingDigest: input.bindingDigest,
            safeToRepeat: input.safeToRepeat,
            retry: input.retry,
            state: 'pending',
            notBefore: null,
          }
        : { ...existing(state.operations, opId, 'operation'), state: 'pending', notBefore: null };
      ids = { operationId: opId, requestAttemptId: requestId };
      return {
        ...next,
        operations: { ...next.operations, [opId]: operation },
        requests: {
          ...next.requests,
          [requestId]: { operationId: opId, stepAttemptId: input.stepAttemptId, member: input.member, runId: input.runId, startedAt: now, state: 'pending' },
        },
      };
    });
    return ids;
  }

  /**
   * Idempotently acknowledge a usage report under its (operation ID, report ID)
   * key. A redelivery with equal quantities is a duplicate; with different
   * quantities it is a conflict and the first acknowledgment stands. Only
   * `acknowledged` performs a commit. Report IDs are unique **per operation**
   * (not globally), which is why the operation is part of the key. A report
   * must name a known request attempt of that same operation.
   */
  acknowledgeUsage(operationId: string, requestAttemptId: string, report: IUsageReport, now: number): IAcknowledgment {
    const request = this.current.requests[requestAttemptId];
    if (this.current.operations[operationId] === undefined || request?.operationId !== operationId) {
      throw new UnattributableReportError();
    }
    const key = usageKey(operationId, report.reportId);
    const prior = this.current.usage[key];
    if (prior !== undefined) {
      return canonical(prior.quantities) === canonical(report.quantities) ? 'duplicate' : 'conflict';
    }
    this.transact('usage-acknowledged', request.member, now, state => ({
      ...state,
      usage: { ...state.usage, [key]: { operationId, requestAttemptId, reportId: report.reportId, quantities: { ...report.quantities } } },
    }));
    return 'acknowledged';
  }

  /** Whether this exact acknowledgment (same key, request attempt and quantities) is in the last known durable snapshot. */
  holdsUsage(operationId: string, requestAttemptId: string, report: IUsageReport): boolean {
    const stored = this.current.usage[usageKey(operationId, report.reportId)];
    return stored !== undefined && stored.requestAttemptId === requestAttemptId && canonical(stored.quantities) === canonical(report.quantities);
  }

  /** Record a request outcome and the operation state it implies, with any "not before" time. */
  settleRequest(requestAttemptId: string, state: IRequestState, operation: IOperationState, notBefore: number | null, now: number): void {
    const request = existing(this.current.requests, requestAttemptId, 'request attempt');
    this.transact('request-settled', request.member, now, current => ({
      ...current,
      requests: { ...current.requests, [requestAttemptId]: { ...request, state } },
      operations: {
        ...current.operations,
        [request.operationId]: { ...existing(current.operations, request.operationId, 'operation'), state: operation, notBefore },
      },
    }));
  }

  /** Record a terminal non-publication attempt state. */
  settleAttempt(stepAttemptId: string, state: Exclude<IStepAttemptState, 'running' | 'completed'>, now: number): void {
    const attempt = existing(this.current.attempts, stepAttemptId, 'step attempt');
    this.transact('step-settled', attempt.member, now, current => ({
      ...current,
      attempts: { ...current.attempts, [stepAttemptId]: { ...attempt, state } },
    }));
  }

  /** One commit retaining the payload, moving the member's pointer and completing the attempt. */
  publish(member: string, stepAttemptId: string, output: IData, now: number): string {
    const attempt = existing(this.current.attempts, stepAttemptId, 'step attempt');
    let reference = '';
    this.transact('publication', member, now, state => {
      const [id, next] = allocate(state, 'result');
      reference = id;
      return {
        ...next,
        results: { ...next.results, [member]: { reference: id, stepAttemptId, output } },
        attempts: { ...next.attempts, [stepAttemptId]: { ...attempt, state: 'completed' } },
      };
    });
    return reference;
  }
}
