/** Resource and acknowledgment safeguards belong to the ordinary test harness, never domain policy. */
import { stderr } from 'node:process';
import { Writable } from 'node:stream';

import type { ITraceEvent } from './trace.js';

/** Exact process and fixture-store byte observations for one ordinary case. @internal */
export interface IResourceSample { readonly rssBytes: number; readonly storeBytes: number; }
/** First refusal identity survives cleanup and secondary stop consequences. @internal */
export interface IFailureLatch { readonly promise: Promise<never>; fail(cause: unknown): void; check(): void; }
/** Finite failure evidence describes actual starts and observations, without inventing continuous peaks. @internal */
export interface IFailureDiagnostic {
  readonly mode: 'cold' | 'soft' | 'hard'; readonly failure: unknown; readonly initial: IResourceSample | null; readonly peak: IResourceSample;
  readonly runs: number; readonly traversals: number; readonly sends: number; readonly inFlight: number; readonly peakSends: number;
  readonly stop: unknown; readonly unresolved: boolean; readonly elapsedMilliseconds: number; readonly samples: number; readonly finalization?: ICaseFinalization; readonly trace: readonly ITraceEvent[];
}
/** An observed ceiling is an admission boundary for the fixture, not a policy for the whole repository. @internal */
export function requireResourceBounds(sample: IResourceSample): void {
  if (sample.rssBytes > 512 * 1024 * 1024) { throw new Error(`Ordinary regression resource refusal: rssBytes=${sample.rssBytes} exceeds 536870912; storeBytes=${sample.storeBytes}`); }
  if (sample.storeBytes > 64 * 1024 * 1024) { throw new Error(`Ordinary regression resource refusal: storeBytes=${sample.storeBytes} exceeds 67108864; rssBytes=${sample.rssBytes}`); }
}

/** A failed latch retains even an undefined rejection value. @internal */
export function createFailureLatch(): IFailureLatch {
  let failed = false;
  let first: unknown;
  let rejectFailure: ((cause: unknown) => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  // A refusal can precede the first awaited acknowledgment without becoming an unhandled rejection.
  void promise.catch(() => undefined);
  return {
    promise,
    fail(cause): void {
      if (failed) { return; }
      failed = true; first = cause; rejectFailure?.(cause);
    },
    check(): void { if (failed) { throw first; } },
  };
}

/** Waiting for a fixture acknowledgment cannot hide an owner's earlier terminal result. @internal */
export function beforeRunTerminates<T>(acknowledgment: Promise<T>, terminal: Promise<unknown>, label: string): Promise<T> {
  return Promise.race([acknowledgment, terminal.then(value => {
    throw new Error(`Owned run terminated before ${label} acknowledgment`, { cause: value });
  })]);
}

/** Diagnostic conversion cannot replace an original failure with a serialization error. */
function boundedValue(value: unknown, limit: number): string {
  try { return (JSON.stringify(value) ?? String(value)).slice(0, limit); }
  catch { return '<unserializable>'; }
}

/** Durable test output has a fixed envelope even when the retained trace is large. @internal */
export function formatFailureDiagnostic(diagnostic: IFailureDiagnostic): string {
  const failure = diagnostic.failure instanceof Error
    ? { name: diagnostic.failure.name.slice(0, 128), message: diagnostic.failure.message.slice(0, 2048), cause: boundedValue(diagnostic.failure.cause, 2048) }
    : { thrownType: typeof diagnostic.failure, value: boundedValue(diagnostic.failure, 2048) };
  const selected = diagnostic.trace.length <= 32 ? diagnostic.trace : [...diagnostic.trace.slice(0, 16), ...diagnostic.trace.slice(-16)];
  const trace = selected.map(event => ({ sequence: event.sequence, kind: event.kind.slice(0, 128),
    runId: event.runId?.slice(0, 256) ?? null, runInstance: event.runInstance?.slice(0, 256) ?? null,
    facts: boundedValue(event.facts, 1536) }));
  const finalization = diagnostic.finalization === undefined ? undefined : {
    ownersClosed: diagnostic.finalization.ownersClosed, storeRemoved: diagnostic.finalization.storeRemoved,
    mayStartNext: diagnostic.finalization.mayStartNext, metricsAttempted: diagnostic.finalization.metricsAttempted,
    diagnosticAttempted: diagnostic.finalization.diagnosticAttempted, boundaryFailures: diagnostic.finalization.boundaryFailures.length,
    failures: diagnostic.finalization.boundaryFailures.slice(0, 8).map(item => ({ boundary: item.boundary.slice(0, 128),
      cause: boundedValue(item.cause instanceof Error ? { name: item.cause.name, message: item.cause.message } : item.cause, 512) })),
  };
  const envelope = { kind: 'ordinary-regression-failure', mode: diagnostic.mode, failure, initial: diagnostic.initial, peak: diagnostic.peak,
    runs: diagnostic.runs, traversals: diagnostic.traversals, sends: diagnostic.sends, inFlight: diagnostic.inFlight, peakSends: diagnostic.peakSends,
    finalization, samples: diagnostic.samples, elapsedMilliseconds: diagnostic.elapsedMilliseconds, stop: boundedValue(diagnostic.stop, 2048), unresolved: diagnostic.unresolved,
    traceEvents: diagnostic.trace.length, omittedTraceEvents: diagnostic.trace.length - trace.length, trace };
  let text = JSON.stringify(envelope);
  // Preserve the first and last observations when unusually large escaped facts consume the envelope.
  while (Buffer.byteLength(text) > 64 * 1024 && trace.length > 2) {
    trace.splice(Math.floor(trace.length / 2), 1);
    envelope.omittedTraceEvents = diagnostic.trace.length - trace.length;
    text = JSON.stringify(envelope);
  }
  return text;
}


/** A present failure can carry undefined; optional cause values do not establish absence. @internal */
export interface ICaseFailure { readonly cause: unknown; }
/** Finalization observations never infer owner closure from elapsed time or output delivery. @internal */
export interface ICaseFinalization {
  readonly failure: ICaseFailure | undefined; readonly boundaryFailures: readonly { readonly boundary: string; readonly cause: unknown }[];
  readonly ownersClosed: boolean; readonly storeRemoved: boolean; readonly mayStartNext: boolean;
  readonly metricsAttempted: boolean; readonly diagnosticAttempted: boolean;
}
/** Independent closes and output attempts belong to one drained ordinary case. @internal */
export interface ICaseFinalizationRequest {
  readonly primary: ICaseFailure | undefined; readonly drained: boolean;
  readonly owners: readonly { readonly name: string; close(): void }[];
  removeStore(): void; record(state: ICaseFinalization): void;
  metrics(state: ICaseFinalization): Promise<void>; diagnostic(state: ICaseFinalization): Promise<void>;
}
/** Case finalization preserves the first failure while gathering independent cleanup and output observations. @internal */
export async function finalizeCase(request: ICaseFinalizationRequest): Promise<ICaseFinalization> {
  let failure = request.primary;
  const boundaryFailures: { readonly boundary: string; readonly cause: unknown }[] = [];
  let ownersClosed = request.drained;
  let storeRemoved = false;
  let metricsAttempted = false;
  let diagnosticAttempted = false;
  let outputFailed = false;
  /** A secondary cleanup/output fault is evidence, never authority to replace the primary refusal. */
  const retain = (boundary: string, cause: unknown): void => {
    boundaryFailures.push({ boundary, cause }); failure ??= { cause };
  };
  /** Each callback receives only observations already made, including attempted rather than guaranteed output. */
  const snapshot = (): ICaseFinalization => ({ failure, boundaryFailures: [...boundaryFailures], ownersClosed, storeRemoved,
    mayStartNext: ownersClosed && storeRemoved && !outputFailed, metricsAttempted, diagnosticAttempted });
  if (!request.drained) { retain('owned-run-drain', new Error('Ordinary case owner drain is unresolved')); }
  else {
    for (const owner of request.owners) {
      try { owner.close(); }
      catch (cause: unknown) { ownersClosed = false; retain(`close:${owner.name}`, cause); }
    }
    // Removing files beneath a handle whose close failed would manufacture a closed fixture.
    if (ownersClosed) {
      try { request.removeStore(); storeRemoved = true; }
      catch (cause: unknown) { retain('remove-store', cause); }
    }
  }
  try { request.record(snapshot()); }
  catch (cause: unknown) { retain('case-boundaries', cause); }
  metricsAttempted = true;
  try { await request.metrics(snapshot()); }
  catch (cause: unknown) { outputFailed = true; retain('metrics-output', cause); }
  if (failure !== undefined) {
    diagnosticAttempted = true;
    try { await request.diagnostic(snapshot()); }
    catch (cause: unknown) { outputFailed = true; retain('diagnostic-output', cause); }
  }
  return snapshot();
}


/** Output completion remains mandatory within the case deadline; a sink return value is not acknowledgment. @internal */
export async function writeCaseOutput(text: string, deadline: number, stream: Writable = stderr): Promise<void> {
  const writing = new Promise<void>((resolve, reject) => {
    let failure: { readonly cause: unknown } | undefined;
    let finishing = false;
    /** Observe callback and stream errors through the same event turn before releasing the temporary listener. */
    const finish = (cause?: Error | null): void => {
      if (cause !== undefined && cause !== null) { failure ??= { cause }; }
      if (finishing) { return; }
      finishing = true;
      setImmediate(() => {
        stream.off('error', onError);
        if (failure === undefined) { resolve(); } else { reject(failure.cause); }
      });
    };
    const onError = (cause: Error): void => { finish(cause); };
    stream.once('error', onError);
    // Jest reporters can replace the stream's own write method and discard its
    // completion callback. The genuine Writable entry preserves physical TTY/
    // pipe completion and errors instead of accepting the reporter's Boolean.
    try { Writable.prototype.write.call(stream, text, 'utf8', finish); }
    catch (cause: unknown) {
      stream.off('error', onError); reject(cause);
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const remaining = Math.max(0, deadline - Date.now());
    await Promise.race([writing, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Missing bounded case output acknowledgment')), remaining); })]);
  } finally { if (timer !== undefined) { clearTimeout(timer); } }
}
