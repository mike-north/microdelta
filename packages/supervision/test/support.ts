/**
 * Test support for Run Supervision's stop, permit and wait suites: Node's real
 * asynchronous scope supplied structurally, a controlled fake timer, promise
 * gates, and a Resolution port double that only captures the ports
 * Supervision hands it, so a test drives admission, supervised execution and
 * the publication check exactly as Resolution would, one call at a time.
 *
 * @see ../../../docs/spec/operations.md (RUN-001, RUN-002, RUN-014, RUN-015)
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { IBindingDescriptor } from '@microdelta/definition';
import type { IAdmissionRequest, IResolution, IResolutionOutcome } from '@microdelta/resolution';

import { SupervisionError, createSupervision } from '../src/index.js';
import type { IResolutionPorts, IRunEvent, IRunLease, IRunOptions, IRunScope, IRunScopeCapability, IRunTimer, ISupervision } from '../src/index.js';

/** Node's real asynchronous context, supplied structurally as a host would. */
export const nodeScopes: IRunScopeCapability = {
  createAsyncContext<T>(): IRunScope<T> {
    return new AsyncLocalStorage<T>();
  },
};

/** A fixed wall-clock origin: 2026-01-01T00:00:00Z. */
export const T0 = Date.UTC(2026, 0, 1);

/** One hour in milliseconds. */
export const hour = 60 * 60 * 1_000;

/** One pending callback of the fake timer. */
export interface IScheduled {
  readonly at: number;
  readonly keepAlive: boolean;
  cancelled: boolean;
  fired: boolean;
}

/** A controlled timer: time moves only when advanced, and due callbacks run in time order. */
export interface IFakeTimer extends IRunTimer {
  /** Every callback ever scheduled, in scheduling order. */
  readonly scheduled: readonly IScheduled[];
  /** Move the clock forward by `milliseconds`, running every callback that falls due. */
  advance(milliseconds: number): void;
}

/** Create a fake timer starting at `start`. */
export function fakeTimer(start: number = T0): IFakeTimer {
  let now = start;
  const entries: (IScheduled & { readonly callback: () => void })[] = [];
  return {
    scheduled: entries,
    currentEpochMilliseconds: () => now,
    schedule(epochMilliseconds, callback, options = {}): () => void {
      const entry = { at: epochMilliseconds, keepAlive: options.keepAlive !== false, cancelled: false, fired: false, callback };
      entries.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    advance(milliseconds: number): void {
      const until = now + milliseconds;
      for (;;) {
        const due = entries.filter((entry) => !entry.cancelled && !entry.fired && entry.at <= until).sort((left, right) => left.at - right.at)[0];
        if (due === undefined) {
          break;
        }
        now = Math.max(now, due.at);
        due.fired = true;
        due.callback();
      }
      now = until;
    },
  };
}

/** A promise with its resolution exposed, for coordinating concurrent work without timers. */
export interface IDeferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** Create a deferred promise. */
export function deferred<T = void>(): IDeferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Let every queued promise continuation and immediate run. */
export function settle(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** A step descriptor, as Resolution would present one. */
export function stepOf(slot: string, memberKey?: string): IBindingDescriptor {
  return Object.freeze({ scope: 'analysis:test', role: 'step', slot, ...(memberKey === undefined ? {} : { memberKey }) });
}

/** One admission request for a step, as Resolution presents it. */
export function admissionFor(step: IBindingDescriptor): IAdmissionRequest {
  return Object.freeze({ step, kind: 'memo', subject: { analysis: 'analysis:test', environment: 'env:test', subject: step.slot, version: 1 }, reason: 'cold' });
}

/** A Resolution that only captures the ports; requests are never made through it here. */
export interface IPortDouble {
  /** The ports Supervision supplied when the run started. */
  ports(): IResolutionPorts;
  readonly factory: IRunOptions['resolution'];
}

/** Create a port-capturing Resolution double. */
export function portDouble(): IPortDouble {
  let captured: IResolutionPorts | undefined;
  const unused = (): Promise<never> => Promise.reject(new Error('the port double makes no requests'));
  return {
    ports(): IResolutionPorts {
      if (captured === undefined) {
        throw new Error('the run has not started');
      }
      return captured;
    },
    factory: (ports: IResolutionPorts): IResolution => {
      captured = ports;
      return {
        resolve: (): Promise<IResolutionOutcome> => unused(),
        resolveMembers: unused,
        resolveFold: unused,
        check: unused,
        recover: (): never => {
          throw new Error('the port double makes no requests');
        },
      };
    },
  };
}

/** A writer port that always grants a lease. */
export const grantingWriter: IRunOptions['writer'] = Object.freeze({
  lease: (): IRunLease => Object.freeze({ holder: 'run:test', fence: 1, expiresAt: Number.MAX_SAFE_INTEGER }),
  release: (): void => undefined,
});

/** The Supervision error code of a rejected promise or throwing call, or a description of anything else. */
export async function codeOf(action: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof action === 'function' ? action() : action);
  } catch (error: unknown) {
    return error instanceof SupervisionError ? error.code : `not a SupervisionError: ${String(error)}`;
  }
  return undefined;
}

/**
 * A scripted provider standing in for a paid service. Each request waits on
 * a gate the test opens, or aborts with the signal it received. It counts
 * requests in flight and records every request, completion and abort.
 */
export interface IStubProvider {
  /** Requests currently in flight. */
  readonly inFlight: number;
  /** The most requests ever in flight at once. */
  readonly peak: number;
  /** Labels of requests the provider received, in order. */
  readonly received: string[];
  /** Labels of requests that completed. */
  readonly completed: string[];
  /** Labels of requests whose signal aborted while in flight. */
  readonly aborted: string[];
  /** A perform function for one labelled request, answering `value` once its gate opens. */
  request<T>(label: string, value: T): (signal: { readonly aborted: boolean; onAbort(listener: () => void): () => void }) => Promise<T>;
  /** Open the gate of a received request. */
  release(label: string): void;
}

/** Create a stub provider. `settleOnAbort` makes a request reject when its signal aborts, as a cooperative adapter does. */
export function stubProvider(options: { readonly settleOnAbort?: boolean } = {}): IStubProvider {
  const gates = new Map<string, IDeferred<void>>();
  const state = { inFlight: 0, peak: 0 };
  const received: string[] = [];
  const completed: string[] = [];
  const aborted: string[] = [];
  const gateOf = (label: string): IDeferred<void> => {
    let gate = gates.get(label);
    if (gate === undefined) {
      gate = deferred();
      gates.set(label, gate);
    }
    return gate;
  };
  return {
    get inFlight(): number {
      return state.inFlight;
    },
    get peak(): number {
      return state.peak;
    },
    received,
    completed,
    aborted,
    request<T>(label: string, value: T) {
      return async (signal: { readonly aborted: boolean; onAbort(listener: () => void): () => void }): Promise<T> => {
        received.push(label);
        state.inFlight += 1;
        state.peak = Math.max(state.peak, state.inFlight);
        try {
          await new Promise<void>((resolve, reject) => {
            // A well-behaved adapter stops listening once its request settles.
            const stopListening = signal.onAbort(() => {
              aborted.push(label);
              if (options.settleOnAbort === true) {
                reject(new Error(`request ${label} abandoned`));
              }
            });
            void gateOf(label).promise.then(() => {
              stopListening();
              resolve();
            });
          });
          completed.push(label);
          return value;
        } finally {
          state.inFlight -= 1;
        }
      };
    },
    release(label: string): void {
      gateOf(label).resolve();
    },
  };
}

/** A Supervision over Node's real scope and the given fake timer. */
export function supervisionWith(timer: IFakeTimer): ISupervision {
  return createSupervision({ context: nodeScopes, timer });
}

/** Run options over a port double. */
export function optionsFor(double: IPortDouble, overrides: Partial<IRunOptions> = {}): IRunOptions {
  return { analysis: 'analysis:test', environment: 'env:test', resolution: double.factory, writer: grantingWriter, ...overrides };
}

/** The stop and send events a run offered, as compact strings. */
export function controlEvents(events: readonly IRunEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.kind === 'stop') {
      return [`stop:${event.level}:${String(event.cause)}`];
    }
    if (event.kind === 'send') {
      return [`send:${event.label}:${event.phase}${event.phase === 'remote-state' ? `:${event.remote}` : ''}`];
    }
    return [];
  });
}
