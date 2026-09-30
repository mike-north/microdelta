/**
 * EXP-8's supervision candidate: one pass of a short run over declared members
 * with a bounded active window, request permits, operator stop intent,
 * durable quota deferral, retry policy, intent-before-call accounting and
 * privacy-restricted events. It is a fake of Run Supervision coordinating a
 * provider adapter, Resource Accounting and History's publication authority
 * for mechanism evidence only; it is not a package runtime.
 *
 * Decisions this candidate encodes (see `decision.md`):
 * - Soft stop drains admitted **step attempts**; it refuses new admissions and
 *   every retry. A hard stop, or an operator deadline reached during a soft
 *   stop, aborts in-flight requests and forbids publication.
 * - The publication commit is the linearization point: a hard stop effective
 *   before it wins (no publication); one after it cannot undo it.
 * - A rate limit with a retry time becomes a durable deferral; the deferred
 *   step attempt ends, holding no permit, and the lease is released whenever
 *   only deferred work remains.
 * - An intent is durable before each request; usage is acknowledged by
 *   (operation ID, report ID); an ambiguous outcome is never replayed unless
 *   the operation is declared safe to repeat (or the provider deduplicates
 *   operation identifiers) and an author retry policy allows another attempt.
 */
import { Permits } from './control.js';
import type { IAbortSignal, IClock, IStopLevel, IStopRequest, StopController } from './control.js';
import { canonical, isData } from './data.js';
import type { IData } from './data.js';
import { EventLog } from './events.js';
import type { IDiagnostic, IEvent, IObserver, IReasonCode } from './events.js';
import type { IProvider, IProviderResponse, IUsageReport } from './provider.js';
import { CommitUnknownError } from './store.js';
import type { IAcknowledgment, Store } from './store.js';
import type { IOperationRecord, IRetryPolicy } from './state.js';

/**
 * A paid call as the author declares it. `name` plus the canonical `binding`
 * address the logical operation within the member (a changed binding is a
 * distinct operation). `safeToRepeat` is the author's declaration that an
 * ambiguous outcome may be retried; `retry` governs failures other than a rate
 * limit with a known retry time.
 * @internal
 */
export interface IOperationDeclaration {
  readonly name: string;
  readonly binding: IData;
  readonly safeToRepeat?: boolean;
  readonly retry?: IRetryPolicy;
}

/** What a step body sees: paid operations and cooperative stop intent. @internal */
export interface IStepContext {
  operation(declaration: IOperationDeclaration): Promise<IData>;
  readonly signal: IAbortSignal;
}

/** A member's single step body. Its returned data is the candidate result. @internal */
export type IStepBody = (context: IStepContext) => Promise<IData>;

/** A declared member: its key (an identifier, also used in events) and body. @internal */
export interface IMemberDeclaration {
  readonly key: string;
  readonly body: IStepBody;
}

/**
 * The soft-stop drain unit under evaluation. `step`: admitted step attempts
 * run to completion (no new admissions, no retries). `request`: only in-flight
 * requests finish; a further request in an admitted body is refused.
 * @internal
 */
export type IDrainUnit = 'step' | 'request';

/** What the run does when only deferred work remains: sleep and resume, or exit reporting the wait. @internal */
export type IWaitMode = 'sleep' | 'exit';

/** Everything one pass needs; all host effects are injected. @internal */
export interface IRunOptions {
  readonly store: Store;
  readonly clock: IClock;
  readonly provider: IProvider;
  readonly members: readonly IMemberDeclaration[];
  readonly stop: StopController;
  readonly observers?: readonly IObserver[];
  readonly permits?: Permits;
  readonly maxActive?: number;
  readonly waitMode?: IWaitMode;
  readonly drainUnit?: IDrainUnit;
}

/** A member's outcome in this pass. `reused` means a prior committed result and no body. @internal */
export type IMemberOutcome =
  | { readonly status: 'published'; readonly reference: string }
  | { readonly status: 'reused'; readonly reference: string }
  | { readonly status: 'waiting'; readonly notBefore: number }
  | { readonly status: 'interrupted' }
  | { readonly status: 'failed' }
  | { readonly status: 'unknown-outcome'; readonly operationId: string }
  | { readonly status: 'not-admitted' };

/**
 * The pass result. `waiting` reports the earliest "not before" time when only
 * deferred work remains (exit mode); `stopped` means stop intent ended the pass
 * (it still reports any deferred work's time).
 * @internal
 */
export interface IRunReport {
  readonly runId: string;
  readonly status: 'settled' | 'waiting' | 'stopped' | 'writer-busy';
  readonly waitingUntil: number | null;
  readonly members: Readonly<Record<string, IMemberOutcome>>;
  readonly events: readonly IEvent[];
  readonly diagnostics: readonly IDiagnostic[];
}

/** A step context was used after its step settled (A-18): late work is refused, never attributed. @internal */
export class ContextClosedError extends Error {
  constructor() {
    super('EXP-8 step context is closed; late work is not admitted');
    this.name = 'ContextClosedError';
  }
}

/** A provider failure surfaced to the body as a closed reason code (never the provider's text). @internal */
export class OperationFailedError extends Error {
  constructor(readonly reason: IReasonCode) {
    super(`EXP-8 operation failed: ${reason}`);
    this.name = 'OperationFailedError';
  }
}

/** Thrown into a body when stop intent refuses or aborts its operation. */
class StopSignal extends Error {
  constructor(readonly level: IStopLevel) {
    super(`EXP-8 stop: ${level}`);
    this.name = 'StopSignal';
  }
}

/** Thrown into a body when its operation is durably deferred. */
class DeferralSignal extends Error {
  constructor(readonly notBefore: number) {
    super('EXP-8 operation deferred');
    this.name = 'DeferralSignal';
  }
}

/** Thrown into a body when its operation's outcome is unknown and may not be replayed. */
class UnknownOutcomeSignal extends Error {
  constructor(readonly operationId: string) {
    super('EXP-8 operation outcome unknown');
    this.name = 'UnknownOutcomeSignal';
  }
}

/** Default cap on rate-limit deferrals of one operation when the author declares no policy. @internal */
export const defaultRateLimitAttempts = 5;

/** Default bound on concurrently admitted step attempts (RUN-002). */
const defaultMaxActive = 8;

/**
 * Why a step attempt cannot publish, whatever its body returns. Recorded the
 * first time the runtime refuses, aborts, defers or loses an operation; a body
 * that swallows the signal still cannot turn partial work into success.
 */
type ITaint =
  | { readonly kind: 'interrupted'; readonly reason: IReasonCode }
  | { readonly kind: 'deferred'; readonly notBefore: number }
  | { readonly kind: 'unknown-outcome'; readonly operationId: string; readonly reason: IReasonCode };

/** How one send attempt ended from the runtime's point of view. */
type ISendOutcome =
  | { readonly kind: 'response'; readonly value: IProviderResponse }
  | { readonly kind: 'lost' }
  | { readonly kind: 'aborted' };

/** A member's admission decision at a point in time. */
type IClassification =
  | { readonly kind: 'reused'; readonly reference: string }
  | { readonly kind: 'blocked'; readonly operationId: string }
  | { readonly kind: 'waiting'; readonly notBefore: number }
  | { readonly kind: 'stopped'; readonly level: IStopLevel }
  | { readonly kind: 'admissible' };

/**
 * Race a send against the member's abort signal. A local abort wins even if
 * the provider never settles; a rejection that is not an abort is a lost
 * response (the request may have taken effect).
 */
function raceAbort(send: () => Promise<IProviderResponse>, signal: IAbortSignal): Promise<ISendOutcome> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (outcome: ISendOutcome): void => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };
    signal.onAbort(() => {
      finish({ kind: 'aborted' });
    });
    Promise.resolve().then(send).then(
      value => {
        finish({ kind: 'response', value });
      },
      () => {
        finish(signal.aborted ? { kind: 'aborted' } : { kind: 'lost' });
      },
    );
  });
}

/** The context handed to one step attempt's body. */
class StepContext implements IStepContext {
  taint: ITaint | null = null;
  closed = false;
  readonly signal: IAbortSignal;

  constructor(
    private readonly run: Run,
    readonly member: string,
    readonly stepAttemptId: string,
  ) {
    this.signal = run.stop.signalFor(member);
  }

  operation(declaration: IOperationDeclaration): Promise<IData> {
    if (this.closed) {
      return Promise.reject(new ContextClosedError());
    }
    return this.run.operate(this, declaration);
  }

  /** Record the first reason this attempt cannot publish. */
  mark(taint: ITaint): void {
    this.taint ??= taint;
  }
}

/** Reason code for a stop level. */
function stopReason(level: IStopLevel): IReasonCode {
  return level === 'hard' ? 'stop-hard' : 'stop-soft';
}

/** One pass: owns the event log, member outcomes and the lease for its duration. */
class Run {
  readonly log: EventLog;
  readonly stop: StopController;
  private readonly store: Store;
  private readonly clock: IClock;
  private readonly provider: IProvider;
  private readonly members: readonly IMemberDeclaration[];
  private readonly permits: Permits;
  private readonly maxActive: number;
  private readonly waitMode: IWaitMode;
  private readonly drainUnit: IDrainUnit;
  private readonly outcomes = new Map<string, IMemberOutcome>();
  private readonly announcedWaits = new Set<string>();
  private runId = '';
  private holding = false;
  private finished = false;

  constructor(options: IRunOptions) {
    this.store = options.store;
    this.clock = options.clock;
    this.provider = options.provider;
    this.members = options.members;
    this.stop = options.stop;
    this.permits = options.permits ?? new Permits(2);
    this.maxActive = options.maxActive ?? defaultMaxActive;
    this.waitMode = options.waitMode ?? 'sleep';
    this.drainUnit = options.drainUnit ?? 'step';
    this.log = new EventLog(() => this.clock.now(), options.observers ?? []);
    this.stop.subscribe(stop => {
      this.onStop(stop);
    });
  }

  /** Record stop intent as an event and arm any operator deadline. */
  private onStop(stop: IStopRequest): void {
    if (this.finished) {
      return;
    }
    const scope = stop.member === undefined ? {} : { member: stop.member };
    if (stop.cause === 'deadline') {
      this.log.emit({ kind: 'stop-escalated', level: stop.level, reason: 'deadline', ...scope });
    } else {
      this.log.emit({ kind: 'stop-requested', level: stop.level, ...scope });
    }
    const deadline = stop.deadline;
    if (stop.level === 'soft' && deadline !== undefined) {
      this.clock.at(deadline, () => {
        const level = stop.member === undefined ? this.stop.runLevel() : this.stop.levelFor(stop.member);
        if (!this.finished && level !== 'hard') {
          this.stop.request({ level: 'hard', cause: 'deadline', ...scope });
        }
      });
    }
  }

  /** Whether an ambiguous operation may be retried automatically (owner decision: never, unless declared safe). */
  private repeatAllowed(operationId: string, operation: IOperationRecord): boolean {
    const repeatSafe = operation.safeToRepeat || this.provider.idempotencyKeys;
    return repeatSafe && operation.retry !== null && this.store.requestCount(operationId) < operation.retry.maxAttempts;
  }

  /** Decide a member's admission from durable facts and current stop intent. */
  private classify(member: string): IClassification {
    const state = this.store.state;
    const result = state.results[member];
    if (result !== undefined) {
      return { kind: 'reused', reference: result.reference };
    }
    const operations = Object.entries(state.operations).filter(([, operation]) => operation.member === member);
    const ambiguous = operations.find(([id, operation]) => (operation.state === 'unknown' || operation.state === 'running')
      && !this.repeatAllowed(id, operation));
    if (ambiguous !== undefined) {
      return { kind: 'blocked', operationId: ambiguous[0] };
    }
    const now = this.clock.now();
    const waits = operations.flatMap(([, operation]) => operation.state === 'deferred' && operation.notBefore !== null
      && operation.notBefore > now ? [operation.notBefore] : []);
    if (waits.length > 0) {
      return { kind: 'waiting', notBefore: Math.max(...waits) };
    }
    const level = this.stop.levelFor(member);
    return level === 'none' ? { kind: 'admissible' } : { kind: 'stopped', level };
  }

  /** Durably acknowledge a usage report; a lost acknowledgment is resolved by reloading and re-acknowledging once. */
  private acknowledge(operationId: string, requestAttemptId: string, report: IUsageReport): void {
    const member = this.store.state.requests[requestAttemptId]?.member;
    if (member === undefined) {
      // A report for a request this store never recorded cannot be attributed; it stays with the provider.
      return;
    }
    const ids = { member, operationId, requestAttemptId };
    const attempt = (): IAcknowledgment => this.store.acknowledgeUsage(operationId, requestAttemptId, report, this.clock.now());
    let result: IAcknowledgment;
    try {
      result = attempt();
    } catch (error) {
      if (!(error instanceof CommitUnknownError)) {
        this.log.diagnose({ code: 'usage-not-durable', ...ids });
        return;
      }
      this.log.diagnose({ code: 'acknowledgment-lost', ...ids });
      try {
        result = attempt();
      } catch {
        this.log.diagnose({ code: 'usage-not-durable', ...ids });
        return;
      }
    }
    if (result === 'conflict') {
      this.log.diagnose({ code: 'usage-conflict', ...ids });
    }
    this.log.emit({ kind: 'usage-acknowledged', status: result, ...ids, ...(result === 'acknowledged' ? { quantities: report.quantities } : {}) });
  }

  /** Acknowledge out-of-band reports the provider can deliver now. */
  private drainLateReports(): void {
    for (const late of this.provider.lateReports(this.clock.now())) {
      this.acknowledge(late.operationId, late.requestAttemptId, late.report);
    }
  }

  /** Record a local abort and whatever the provider says about the remote work. */
  private async recordAbort(context: StepContext, operationId: string, requestAttemptId: string): Promise<void> {
    const ids = { member: context.member, stepAttemptId: context.stepAttemptId, operationId, requestAttemptId };
    this.log.emit({ kind: 'local-abort', status: 'interrupted', reason: 'stop-hard', ...ids });
    let remote: 'cancelled' | 'running' | 'unknown' = 'unknown';
    if (this.provider.remoteCancellation) {
      this.log.emit({ kind: 'remote-cancel-requested', ...ids });
      try {
        remote = await this.provider.cancel(operationId);
      } catch {
        remote = 'unknown';
      }
    }
    this.store.settleRequest(requestAttemptId, remote, remote, null, this.clock.now());
    this.log.emit({ kind: 'remote-state', status: remote, ...ids });
    context.mark({ kind: 'interrupted', reason: 'stop-hard' });
  }

  /** Refuse an operation because of stop intent. */
  private refuse(context: StepContext, level: IStopLevel): never {
    context.mark({ kind: 'interrupted', reason: stopReason(level) });
    throw new StopSignal(level);
  }

  /** Whether stop intent forbids sending a request now (first attempt versus retry). */
  private stopForbids(member: string, retry: boolean): IStopLevel | null {
    const level = this.stop.levelFor(member);
    if (level === 'hard' || (level === 'soft' && (retry || this.drainUnit === 'request'))) {
      return level;
    }
    return null;
  }

  /** One logical operation for a body: intent, permit, send, account, settle, retry or defer. */
  async operate(context: StepContext, declaration: IOperationDeclaration): Promise<IData> {
    const { member, stepAttemptId } = context;
    const bindingDigest = canonical(declaration.binding);
    const policy = declaration.retry ?? null;
    let operationId = this.store.openOperation(member, declaration.name, bindingDigest);
    let retry = operationId !== undefined;
    const initial = this.stopForbids(member, retry);
    if (initial !== null) {
      this.refuse(context, initial);
    }
    if (operationId !== undefined) {
      this.log.emit({ kind: 'retry-started', member, stepAttemptId, operationId });
    }
    for (;;) {
      const release = await this.permits.acquire();
      const forbidden = this.stopForbids(member, retry);
      if (forbidden !== null || context.closed) {
        release();
        if (forbidden === null) {
          throw new ContextClosedError();
        }
        this.refuse(context, forbidden);
      }
      const ids = this.store.intent({
        member,
        stepAttemptId,
        runId: this.runId,
        name: declaration.name,
        bindingDigest,
        safeToRepeat: declaration.safeToRepeat === true,
        retry: policy,
      }, operationId, this.clock.now());
      operationId = ids.operationId;
      const { requestAttemptId } = ids;
      const event = { member, stepAttemptId, operationId, requestAttemptId };
      this.log.emit({ kind: 'request-started', ...event });
      const outcome = await raceAbort(() => this.provider.send({ operationId: ids.operationId, requestAttemptId, name: declaration.name, binding: declaration.binding }, context.signal), context.signal);
      release();
      if (outcome.kind === 'aborted') {
        await this.recordAbort(context, operationId, requestAttemptId);
        throw new StopSignal('hard');
      }
      if (outcome.kind === 'lost') {
        this.store.settleRequest(requestAttemptId, 'unknown', 'unknown', null, this.clock.now());
        this.log.emit({ kind: 'request-settled', status: 'unknown', reason: 'lost-response', ...event });
        const operation = this.store.state.operations[operationId];
        if (operation === undefined || !this.repeatAllowed(operationId, operation)) {
          const repeatSafe = operation !== undefined && (operation.safeToRepeat || this.provider.idempotencyKeys) && operation.retry !== null;
          context.mark({ kind: 'unknown-outcome', operationId, reason: repeatSafe ? 'policy-exhausted' : 'not-repeat-safe' });
          throw new UnknownOutcomeSignal(operationId);
        }
        // The persisted policy decided eligibility, so it also sets the backoff.
        await this.backoff(context, operation.retry?.backoffMs ?? 0, operationId, 'lost-response');
        retry = true;
        continue;
      }
      const response = outcome.value;
      if (response.usage !== null) {
        this.acknowledge(operationId, requestAttemptId, response.usage);
      }
      const now = this.clock.now();
      if (response.kind === 'succeeded') {
        this.store.settleRequest(requestAttemptId, 'succeeded', 'succeeded', null, now);
        this.log.emit({ kind: 'request-settled', status: 'succeeded', ...event });
        return response.body;
      }
      const reason: IReasonCode = response.kind === 'rate-limited' ? 'rate-limited' : response.kind;
      if (response.kind === 'rate-limited' && response.retryAt !== null) {
        if (this.store.requestCount(operationId) >= (policy?.maxAttempts ?? defaultRateLimitAttempts)) {
          this.exhaust(requestAttemptId, event, reason);
        }
        this.store.settleRequest(requestAttemptId, 'not-applied', 'deferred', response.retryAt, now);
        this.log.emit({ kind: 'request-settled', status: 'not-applied', reason, ...event });
        this.log.emit({ kind: 'retry-scheduled', status: 'deferred', reason, notBefore: response.retryAt, member, stepAttemptId, operationId });
        context.mark({ kind: 'deferred', notBefore: response.retryAt });
        throw new DeferralSignal(response.retryAt);
      }
      if (response.kind === 'rejected' || policy === null) {
        this.store.settleRequest(requestAttemptId, 'not-applied', 'failed', null, now);
        this.log.emit({ kind: 'request-settled', status: 'not-applied', reason, ...event });
        throw new OperationFailedError(response.kind === 'rejected' ? 'rejected' : 'no-policy');
      }
      if (this.store.requestCount(operationId) >= policy.maxAttempts) {
        this.exhaust(requestAttemptId, event, reason);
      }
      this.store.settleRequest(requestAttemptId, 'not-applied', 'pending', null, now);
      this.log.emit({ kind: 'request-settled', status: 'not-applied', reason, ...event });
      await this.backoff(context, policy.backoffMs, operationId, reason);
      retry = true;
    }
  }

  /** Settle an operation whose retry policy is exhausted and fail the body's call. */
  private exhaust(
    requestAttemptId: string,
    event: { readonly member: string; readonly stepAttemptId: string; readonly operationId: string; readonly requestAttemptId: string },
    reason: IReasonCode,
  ): never {
    this.store.settleRequest(requestAttemptId, 'not-applied', 'failed', null, this.clock.now());
    this.log.emit({ kind: 'request-settled', status: 'not-applied', reason, ...event });
    this.log.emit({ kind: 'retry-exhausted', status: 'failed', reason: 'policy-exhausted', ...event });
    throw new OperationFailedError('policy-exhausted');
  }

  /** Wait out an in-body backoff holding no permit, unless stop intent forbids the retry. */
  private async backoff(context: StepContext, backoffMs: number, operationId: string, reason: IReasonCode): Promise<void> {
    const { member, stepAttemptId } = context;
    const before = this.stopForbids(member, true);
    if (before !== null) {
      this.refuse(context, before);
    }
    const notBefore = this.clock.now() + backoffMs;
    this.log.emit({ kind: 'retry-scheduled', status: 'waiting', reason, notBefore, member, stepAttemptId, operationId });
    await this.clock.sleepUntil(notBefore);
    const after = this.stopForbids(member, true);
    if (after !== null) {
      this.refuse(context, after);
    }
    this.log.emit({ kind: 'retry-started', member, stepAttemptId, operationId });
  }

  /** Run one admitted step attempt to publication or to an explicit non-success state. */
  private async runStep(member: IMemberDeclaration): Promise<void> {
    const key = member.key;
    const stepAttemptId = this.store.beginAttempt(key, this.runId, this.clock.now());
    this.log.emit({ kind: 'step-admitted', member: key, stepAttemptId });
    const context = new StepContext(this, key, stepAttemptId);
    let output: unknown;
    let thrown: unknown;
    let returned = false;
    try {
      output = await member.body(context);
      returned = true;
    } catch (error) {
      thrown = error;
    }
    context.closed = true;
    const taint = context.taint;
    const hard = this.stop.levelFor(key) === 'hard';
    const now = this.clock.now();
    if (returned && taint === null && !hard && isData(output)) {
      // Publication is the linearization point: nothing after this commit can turn it into a failure.
      const reference = this.store.publish(key, stepAttemptId, output, now);
      this.outcomes.set(key, { status: 'published', reference });
      this.log.emit({ kind: 'published', status: 'completed', member: key, stepAttemptId, reference });
      return;
    }
    let settled: { readonly state: 'interrupted' | 'deferred' | 'unknown-outcome' | 'failed'; readonly reason: IReasonCode; readonly outcome: IMemberOutcome };
    if (taint?.kind === 'interrupted') {
      settled = { state: 'interrupted', reason: taint.reason, outcome: { status: 'interrupted' } };
    } else if (taint?.kind === 'deferred') {
      settled = { state: 'deferred', reason: 'rate-limited', outcome: { status: 'waiting', notBefore: taint.notBefore } };
    } else if (taint?.kind === 'unknown-outcome') {
      settled = { state: 'unknown-outcome', reason: taint.reason, outcome: { status: 'unknown-outcome', operationId: taint.operationId } };
    } else if (hard) {
      settled = { state: 'interrupted', reason: 'stop-hard', outcome: { status: 'interrupted' } };
    } else {
      const reason = thrown instanceof OperationFailedError ? thrown.reason : 'body-failed';
      if (reason === 'body-failed') {
        this.log.diagnose({ code: 'body-failed', member: key });
      }
      settled = { state: 'failed', reason, outcome: { status: 'failed' } };
    }
    this.store.settleAttempt(stepAttemptId, settled.state, now);
    this.outcomes.set(key, settled.outcome);
    const reason = returned && taint !== null ? 'partial-output-discarded' : settled.reason;
    this.log.emit({ kind: 'step-settled', status: settled.state, reason, member: key, stepAttemptId });
  }

  /** Apply one admission decision; returns a step promise when the member is admitted. */
  private admit(member: IMemberDeclaration, classification: IClassification, active: number): Promise<void> | undefined {
    const key = member.key;
    switch (classification.kind) {
      case 'reused':
        this.outcomes.set(key, { status: 'reused', reference: classification.reference });
        this.log.emit({ kind: 'member-reused', member: key, reference: classification.reference });
        return undefined;
      case 'blocked':
        this.outcomes.set(key, { status: 'unknown-outcome', operationId: classification.operationId });
        this.log.emit({ kind: 'member-blocked', status: 'unknown-outcome', reason: 'not-repeat-safe', member: key, operationId: classification.operationId });
        return undefined;
      case 'waiting': {
        this.outcomes.set(key, { status: 'waiting', notBefore: classification.notBefore });
        const announcement = `${key}@${String(classification.notBefore)}`;
        if (!this.announcedWaits.has(announcement)) {
          this.announcedWaits.add(announcement);
          this.log.emit({ kind: 'member-waiting', status: 'waiting', member: key, notBefore: classification.notBefore });
        }
        return undefined;
      }
      case 'stopped':
        this.outcomes.set(key, { status: 'not-admitted' });
        this.log.emit({ kind: 'member-not-admitted', status: 'stopped', reason: stopReason(classification.level), member: key });
        return undefined;
      case 'admissible':
        if (active >= this.maxActive) {
          return undefined;
        }
        this.outcomes.delete(key);
        return this.runStep(member);
    }
  }

  /** Release the lease (after delivering any due late reports) if this pass holds it. */
  private releaseLease(): void {
    if (!this.holding) {
      return;
    }
    this.drainLateReports();
    this.store.release(this.clock.now());
    this.holding = false;
    this.log.emit({ kind: 'lease-released' });
  }

  /** Acquire (or re-acquire) the lease and report recovered intents. */
  private acquire(): boolean {
    const acquired = this.store.acquire(this.runId === '' ? null : this.runId, this.clock.now());
    if (acquired.status === 'busy') {
      return false;
    }
    this.runId = acquired.runId;
    this.log.runId = acquired.runId;
    this.holding = true;
    this.log.emit({ kind: 'lease-acquired', fence: acquired.fence });
    for (const recovered of acquired.recovered) {
      this.log.emit({
        kind: 'recovered',
        status: 'unknown',
        reason: 'recovered-after-crash',
        member: recovered.member,
        operationId: recovered.operationId,
        requestAttemptId: recovered.requestAttemptId,
      });
    }
    this.drainLateReports();
    return true;
  }

  /** End the pass: release the lease, emit the final status and freeze the report. */
  private finish(status: IRunReport['status'], waitingUntil: number | null): IRunReport {
    this.releaseLease();
    if (status !== 'writer-busy' || this.runId !== '') {
      this.log.emit({ kind: 'run-settled', status });
    }
    this.finished = true;
    const members: Record<string, IMemberOutcome> = {};
    for (const member of this.members) {
      const outcome = this.outcomes.get(member.key);
      if (outcome !== undefined) {
        members[member.key] = outcome;
      }
    }
    return {
      runId: this.runId,
      status,
      waitingUntil,
      members,
      events: [...this.log.events],
      diagnostics: [...this.log.diagnostics],
    };
  }

  /** The pass: admit, drain, wait or exit, until nothing admissible remains. */
  async execute(): Promise<IRunReport> {
    if (!this.acquire()) {
      return this.finish('writer-busy', null);
    }
    const active = new Map<string, Promise<void>>();
    for (;;) {
      let earliest: number | null = null;
      for (const member of this.members) {
        const prior = this.outcomes.get(member.key);
        if (active.has(member.key) || (prior !== undefined && prior.status !== 'waiting')) {
          continue;
        }
        const classification = this.classify(member.key);
        if (classification.kind === 'waiting') {
          earliest = Math.min(earliest ?? classification.notBefore, classification.notBefore);
        }
        const step = this.admit(member, classification, active.size);
        if (step !== undefined) {
          active.set(member.key, step.finally(() => {
            active.delete(member.key);
          }));
        }
      }
      if (active.size > 0) {
        await Promise.race(active.values());
        continue;
      }
      const stopped = this.stop.runLevel() !== 'none';
      if (earliest === null || stopped) {
        return this.finish(stopped ? 'stopped' : 'settled', earliest);
      }
      this.log.emit({ kind: 'run-waiting', status: 'waiting', notBefore: earliest });
      this.releaseLease();
      if (this.waitMode === 'exit') {
        return this.finish('waiting', earliest);
      }
      await this.clock.sleepUntil(earliest);
      if (this.stop.runLevel() !== 'none') {
        return this.finish('stopped', earliest);
      }
      if (!this.acquire()) {
        return this.finish('writer-busy', earliest);
      }
    }
  }
}

/** Run one pass of the candidate over injected store, clock, provider and stop intent. @internal */
export function runPass(options: IRunOptions): Promise<IRunReport> {
  return new Run(options).execute();
}
