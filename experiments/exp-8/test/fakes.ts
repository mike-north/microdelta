/**
 * EXP-8 deterministic fakes shared by the in-process suite and the separate
 * process driver: a fake clock, a scripted fake paid provider whose ledger can
 * be persisted across processes, an in-memory durable port with fault
 * injection, and the bounded run's members. Distinctive planted values flow
 * through bindings, provider bodies, outputs and error text so the privacy
 * test can prove none of them reaches an event or diagnostic.
 */
import { CommitUnknownError, emptyState, parseState } from '../src/protocol.js';
import type {
  IAbortSignal,
  IClock,
  ICommitBoundary,
  IData,
  IDurablePort,
  IDurableState,
  ILateReport,
  IMemberDeclaration,
  IOperationDeclaration,
  IProvider,
  IProviderRequest,
  IProviderResponse,
  IRemoteCancel,
  IRetryPolicy,
  IStepContext,
} from '../src/protocol.js';

/** Fake-clock origin: 2026-01-01T00:00:00Z. */
export const T0 = Date.UTC(2026, 0, 1);
/** One fake hour in milliseconds. */
export const HOUR = 3_600_000;
/** The long quota wait's provider retry time: three hours after T0. */
export const quotaAt = T0 + 3 * HOUR;
/** Lease time-to-live; a restarted process after a kill starts well beyond it. */
export const leaseTtlMs = 5 * 60_000;

/** Distinctive planted values; none may appear in any event or diagnostic. */
export const secrets = {
  input: 'planted-input-9f41c2',
  provider: 'planted-provider-5be07d',
  output: 'planted-output-c83a19',
  error: 'planted-error-e11d7a',
} as const;

/** Every planted value, for scanning. */
export const plantedValues: readonly string[] = Object.values(secrets);

/** A clock that moves only when told to; `sleepUntil` is instant but recorded. */
export class FakeClock implements IClock {
  readonly sleeps: number[] = [];
  onSleep: ((until: number) => void) | undefined;
  private current: number;
  private readonly timers: { readonly time: number; readonly callback: () => void }[] = [];

  constructor(start: number) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  /** Move time forward (never back) and fire due timers in time order. */
  advance(to: number): void {
    this.current = Math.max(this.current, to);
    for (;;) {
      this.timers.sort((left, right) => left.time - right.time);
      const due = this.timers[0];
      if (due === undefined || due.time > this.current) {
        return;
      }
      this.timers.shift();
      due.callback();
    }
  }

  sleepUntil(time: number): Promise<void> {
    this.sleeps.push(time);
    this.onSleep?.(time);
    this.advance(time);
    return Promise.resolve();
  }

  at(time: number, callback: () => void): void {
    this.timers.push({ time, callback });
  }
}

/** One scripted provider behavior for the n-th request of an operation name. */
export type IScriptStep =
  | { readonly kind: 'ok'; readonly usage?: Readonly<Record<string, number>> | null; readonly late?: 'duplicate' | 'conflict'; readonly lateAt?: number }
  | { readonly kind: 'rate-limited'; readonly retryAt: number | null }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'lost' }
  | { readonly kind: 'hang' };

/** Scripts by operation name; the last step repeats once a script is exhausted. */
export type IScript = Readonly<Record<string, readonly IScriptStep[]>>;

/** A request the provider received, with its fake-clock time (binding kept provider-side only). */
export interface IReceived {
  readonly operationId: string;
  readonly requestAttemptId: string;
  readonly name: string;
  readonly at: number;
  readonly binding: IData;
}

/** An effect the provider actually performed (and would bill). */
export interface IApplied {
  readonly operationId: string;
  readonly requestAttemptId: string;
  readonly name: string;
}

/** A late usage delivery, deliverable from `deliverAt`. */
export interface IQueuedReport extends ILateReport {
  readonly deliverAt: number;
}

/** The provider's own durable ledger; the process driver persists it between processes. */
export interface ILedger {
  calls: Record<string, number>;
  received: IReceived[];
  applied: IApplied[];
  cancels: string[];
  late: IQueuedReport[];
}

/** A fresh, empty provider ledger. */
export function emptyLedger(): ILedger {
  return { calls: {}, received: [], applied: [], cancels: [], late: [] };
}

/** Provider construction options. */
export interface IFakeProviderOptions {
  readonly clock: FakeClock;
  readonly idempotencyKeys?: boolean;
  readonly cancelAnswer?: IRemoteCancel | 'unsupported' | 'no-answer';
  readonly ledger?: ILedger;
  readonly latencyMs?: number;
  /** Called after the ledger changes, before any response is returned. */
  readonly onChange?: (ledger: ILedger) => void;
  /** Called on receipt; operator actions scripted by a test run here. */
  readonly onReceive?: (request: IProviderRequest, index: number) => void;
  /** Called after an effect is applied and persisted, before the response (process kill point). */
  readonly onApplied?: (request: IProviderRequest, index: number) => void;
}

/** The provider marks its own abort rejections so tests can tell them apart. */
export class ProviderAbort extends Error {
  constructor() {
    super('aborted by caller');
    this.name = 'ProviderAbort';
  }
}

/** A scripted fake paid provider. Responses carry planted body text; usage has stable report IDs. */
export class FakeProvider implements IProvider {
  readonly ledger: ILedger;
  readonly idempotencyKeys: boolean;
  readonly remoteCancellation: boolean;
  private readonly hanging = new Map<string, () => void>();
  private readonly waiters = new Map<string, (() => void)[]>();

  constructor(
    private readonly script: IScript,
    private readonly options: IFakeProviderOptions,
  ) {
    this.ledger = options.ledger ?? emptyLedger();
    this.idempotencyKeys = options.idempotencyKeys ?? false;
    const answer = options.cancelAnswer ?? 'cancelled';
    this.remoteCancellation = answer !== 'unsupported';
  }

  /** Resolves once a request with this name has been received. */
  received(name: string): Promise<void> {
    if ((this.ledger.calls[name] ?? 0) > 0) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.waiters.set(name, [...(this.waiters.get(name) ?? []), resolve]);
    });
  }

  /** Complete a hanging request successfully. */
  release(name: string): void {
    const complete = this.hanging.get(name);
    this.hanging.delete(name);
    complete?.();
  }

  private changed(): void {
    this.options.onChange?.(this.ledger);
  }

  private stepFor(name: string, index: number): IScriptStep {
    const steps = this.script[name] ?? [];
    return steps[index] ?? steps[steps.length - 1] ?? { kind: 'ok' };
  }

  private reportId(name: string, index: number): string {
    return `usage-${name}-${String(index)}`;
  }

  private apply(request: IProviderRequest, index: number): void {
    this.ledger.applied.push({ operationId: request.operationId, requestAttemptId: request.requestAttemptId, name: request.name });
    this.changed();
    this.options.onApplied?.(request, index);
  }

  private body(name: string): IData {
    return { text: `${secrets.provider}:${name}` };
  }

  private success(request: IProviderRequest, index: number, step: Extract<IScriptStep, { kind: 'ok' }>): IProviderResponse {
    const usage = step.usage === null ? null : { reportId: this.reportId(request.name, index), quantities: step.usage ?? { tokens: 100 } };
    if (usage !== null && step.late !== undefined) {
      const quantities = step.late === 'duplicate' ? usage.quantities : { tokens: 999 };
      this.ledger.late.push({
        operationId: request.operationId,
        requestAttemptId: request.requestAttemptId,
        report: { reportId: usage.reportId, quantities },
        deliverAt: step.lateAt ?? this.options.clock.now(),
      });
      this.changed();
    }
    return { kind: 'succeeded', body: this.body(request.name), usage };
  }

  send(request: IProviderRequest, signal: IAbortSignal): Promise<IProviderResponse> {
    const index = this.ledger.calls[request.name] ?? 0;
    this.ledger.calls[request.name] = index + 1;
    this.ledger.received.push({ ...request, at: this.options.clock.now() });
    this.changed();
    for (const wake of this.waiters.get(request.name) ?? []) {
      wake();
    }
    this.waiters.delete(request.name);
    this.options.onReceive?.(request, index);
    this.options.clock.advance(this.options.clock.now() + (this.options.latencyMs ?? 1000));
    const step = this.stepFor(request.name, index);
    const failureUsage = { reportId: this.reportId(request.name, index), quantities: { requests: 1 } };
    if (this.idempotencyKeys && step.kind !== 'hang' && this.ledger.applied.some(entry => entry.operationId === request.operationId)) {
      // Deduplicated by operation identity: no second effect, no charge.
      return Promise.resolve({ kind: 'succeeded', body: this.body(request.name), usage: { reportId: this.reportId(request.name, index), quantities: { tokens: 0 } } });
    }
    switch (step.kind) {
      case 'ok':
        this.apply(request, index);
        return Promise.resolve(this.success(request, index, step));
      case 'rate-limited':
        return Promise.resolve({ kind: 'rate-limited', retryAt: step.retryAt, body: this.body(request.name), usage: failureUsage });
      case 'unavailable':
      case 'rejected':
        return Promise.resolve({ kind: step.kind, body: this.body(request.name), usage: failureUsage });
      case 'lost':
        this.apply(request, index);
        return Promise.reject(new Error(`connection reset after ${secrets.provider}`));
      case 'hang':
        return new Promise((resolve, reject) => {
          signal.onAbort(() => {
            reject(new ProviderAbort());
          });
          this.hanging.set(request.name, () => {
            this.apply(request, index);
            resolve(this.success(request, index, { kind: 'ok' }));
          });
        });
    }
  }

  cancel(operationId: string): Promise<IRemoteCancel> {
    this.ledger.cancels.push(operationId);
    this.changed();
    const answer = this.options.cancelAnswer ?? 'cancelled';
    if (answer === 'cancelled' || answer === 'running') {
      return Promise.resolve(answer);
    }
    return Promise.reject(new Error(`cancel endpoint said ${secrets.provider}`));
  }

  lateReports(now: number): readonly ILateReport[] {
    const due = this.ledger.late.filter(entry => entry.deliverAt <= now);
    if (due.length === 0) {
      return [];
    }
    this.ledger.late = this.ledger.late.filter(entry => entry.deliverAt > now);
    this.changed();
    return due.map(({ operationId, requestAttemptId, report }) => ({ operationId, requestAttemptId, report }));
  }
}

/** A port fault: fail before writing, or write and then lose the acknowledgment. */
export interface IPortFault {
  readonly boundary: ICommitBoundary;
  readonly subject?: string;
  readonly mode: 'fail-before' | 'ack-lost';
}

/** An in-memory durable port that serializes every commit, so state crosses a JSON boundary. */
export class MemoryPort implements IDurablePort {
  text = JSON.stringify(emptyState());
  readonly commits: { readonly boundary: ICommitBoundary; readonly subject: string | null }[] = [];
  readonly faults: IPortFault[] = [];

  load(): IDurableState {
    const parsed: unknown = JSON.parse(this.text);
    return parseState(parsed);
  }

  commit(boundary: ICommitBoundary, state: IDurableState, subject: string | null): void {
    const index = this.faults.findIndex(fault => fault.boundary === boundary && (fault.subject === undefined || fault.subject === subject));
    const fault = index < 0 ? undefined : this.faults.splice(index, 1)[0];
    if (fault?.mode === 'fail-before') {
      throw new Error('disk full');
    }
    this.text = JSON.stringify(state);
    this.commits.push({ boundary, subject });
    if (fault?.mode === 'ack-lost') {
      throw new CommitUnknownError(boundary);
    }
  }
}

/** Extract a provider body's text for the author's output (the body is data, not evidence). */
function textOf(value: IData): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'text' in value) {
    const text: IData | undefined = value.text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

/** Author-side declaration overrides for a member's operations. */
export interface IDeclarationOverrides {
  readonly safeToRepeat?: boolean;
  readonly retry?: IRetryPolicy;
  readonly binding?: IData;
}

/** Build a declaration from overrides without writing `undefined` into optional fields. */
function declare(name: string, binding: IData, overrides: IDeclarationOverrides): IOperationDeclaration {
  return {
    name,
    binding: overrides.binding ?? binding,
    ...(overrides.safeToRepeat === undefined ? {} : { safeToRepeat: overrides.safeToRepeat }),
    ...(overrides.retry === undefined ? {} : { retry: overrides.retry }),
  };
}

/** Bodies that ran to completion, by member key (a body may finish even when stop forbids its publication). */
export const finishedBodies: string[] = [];

/** The member that succeeds: one paid `summarize` call. */
export function okMember(overrides: IDeclarationOverrides = {}, key = 'm-ok'): IMemberDeclaration {
  return {
    key,
    body: async (context: IStepContext) => {
      const response = await context.operation(declare('summarize', { prompt: secrets.input }, overrides));
      finishedBodies.push(key);
      return { summary: `${secrets.output}|${textOf(response)}` };
    },
  };
}

/** The member whose single `assess` call meets a long quota wait. */
export function quotaMember(overrides: IDeclarationOverrides = {}): IMemberDeclaration {
  return {
    key: 'm-quota',
    body: async (context: IStepContext) => {
      const response = await context.operation(declare('assess', { pr: secrets.input }, overrides));
      finishedBodies.push('m-quota');
      return { assessment: `${secrets.output}|${textOf(response)}` };
    },
  };
}

/** The member cancelled mid-flight: three requests, the second of which is in flight when stopped. */
export function cancelMember(): IMemberDeclaration {
  return {
    key: 'm-cancel',
    body: async (context: IStepContext) => {
      const fetched = await context.operation({ name: 'fetch', binding: { repo: secrets.input } });
      const generated = await context.operation({ name: 'generate', binding: { draft: textOf(fetched) } });
      const polished = await context.operation({ name: 'polish', binding: { draft: textOf(generated) } });
      finishedBodies.push('m-cancel');
      return { report: `${secrets.output}|${textOf(polished)}` };
    },
  };
}

/** The bounded run's provider script: success, a long quota wait, and an in-flight second request. */
export function baseScript(): IScript {
  return {
    summarize: [{ kind: 'ok' }],
    assess: [{ kind: 'rate-limited', retryAt: quotaAt }, { kind: 'ok' }],
    fetch: [{ kind: 'ok' }],
    generate: [{ kind: 'hang' }, { kind: 'ok' }],
    polish: [{ kind: 'ok' }],
  };
}
