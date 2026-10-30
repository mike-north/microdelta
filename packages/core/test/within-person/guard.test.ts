/** Ordinary harness refusal and diagnostic controls start no owner run, store or transport. */
import { stderr } from 'node:process';
import { Writable } from 'node:stream';

import { expect, jest, test } from '@jest/globals';

import { beforeRunTerminates, createFailureLatch, finalizeCase, formatFailureDiagnostic, requireResourceBounds, writeCaseOutput } from './guard.js';
import type { ITraceEvent } from './trace.js';

test('exact ordinary resource ceilings are admitted, while an excess names measured and allowed bytes', () => {
  expect(() => requireResourceBounds({ rssBytes: 512 * 1024 * 1024, storeBytes: 64 * 1024 * 1024 })).not.toThrow();
  expect(() => requireResourceBounds({ rssBytes: 512 * 1024 * 1024 + 1, storeBytes: 17 })).toThrow('rssBytes=536870913 exceeds 536870912');
  expect(() => requireResourceBounds({ rssBytes: 23, storeBytes: 64 * 1024 * 1024 + 1 })).toThrow('storeBytes=67108865 exceeds 67108864');
});

test('the first resource or host refusal is retained by identity across later samples', async () => {
  const failure = createFailureLatch();
  const original = new Error('actual resource refusal');
  expect(() => failure.check()).not.toThrow();
  failure.fail(original); failure.fail(new Error('later stop consequence'));
  expect(() => failure.check()).toThrow(original);
  await expect(failure.promise).rejects.toBe(original);
});

test('undefined remains an actual first failure rather than the absence of one', async () => {
  const failure = createFailureLatch();
  failure.fail(undefined); failure.fail(new Error('later'));
  const observed: unknown[] = [];
  try { failure.check(); } catch (error: unknown) { observed.push(error); }
  expect(observed).toHaveLength(1); expect(observed[0]).toBeUndefined();
  await expect(failure.promise).rejects.toBeUndefined();
});

test('an acknowledgment can precede a still-running owner', async () => {
  await expect(beforeRunTerminates(Promise.resolve('held'), new Promise<never>(() => undefined), 'page hold')).resolves.toBe('held');
});

test('an actual run rejection wins over a missing acknowledgment with its exact original value', async () => {
  const original = new Error('actual owner rejection');
  const terminal = Promise.reject(original);
  void terminal.catch(() => undefined);
  const observed: unknown[] = [];
  void beforeRunTerminates(new Promise<never>(() => undefined), terminal, 'page hold').catch((error: unknown) => observed.push(error));
  for (let turn = 0; turn < 5; turn += 1) { await Promise.resolve(); }
  expect(observed).toHaveLength(1); expect(observed[0]).toBe(original);
});

test('a resolved early terminal report is retained as the missing acknowledgment cause', async () => {
  const report = { report: { kind: 'stopped' } };
  const observed: unknown[] = [];
  void beforeRunTerminates(new Promise<never>(() => undefined), Promise.resolve(report), 'page hold').catch((error: unknown) => observed.push(error));
  for (let turn = 0; turn < 5; turn += 1) { await Promise.resolve(); }
  expect(observed).toHaveLength(1);
  const error = observed[0];
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) { throw new Error('Missing early terminal diagnostic'); }
  expect(error.cause).toBe(report);
  expect(error.message).toBe('Owned run terminated before page hold acknowledgment');
});

test('failure diagnostics preserve exact counters and resource observations within a finite trace envelope', () => {
  const trace: ITraceEvent[] = Array.from({ length: 80 }, (_value, sequence) => ({ sequence, kind: 'send', facts: { detail: 'x'.repeat(4096) }, runId: 'ordinary:cold', runInstance: 'instance' }));
  const text = formatFailureDiagnostic({ mode: 'cold', failure: new Error('resource refusal'), samples: 1, elapsedMilliseconds: 3, initial: { rssBytes: 600_000_000, storeBytes: 123 }, peak: { rssBytes: 600_000_001, storeBytes: 456 }, runs: 0, traversals: 0, sends: 0, inFlight: 0, peakSends: 0, stop: { level: 'hard' }, unresolved: false, trace });
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(64 * 1024);
  expect(text).toContain('600000000'); expect(text).toContain('600000001');
  expect(text).toContain('"runs":0'); expect(text).toContain('"traversals":0');
  expect(text).toContain('"traceEvents":80'); expect(text).toContain('"omittedTraceEvents":48');
  expect(text).toContain('"sequence":0'); expect(text).toContain('"sequence":79');
});


test('a close failure preserves the primary identity, closes independent owners, retains the store and still reports', async () => {
  const primary = new Error('first owner rejection');
  const closeFailure = new Error('accounting close failed');
  const calls: string[] = [];
  const state = await finalizeCase({ primary: { cause: primary }, drained: true,
    owners: [{ name: 'accounting', close: () => { calls.push('accounting'); throw closeFailure; } }, { name: 'history', close: () => { calls.push('history'); } }],
    removeStore: () => { calls.push('remove'); }, record: () => { calls.push('record'); },
    metrics: async () => { calls.push('metrics'); }, diagnostic: async () => { calls.push('diagnostic'); } });
  expect(state.failure?.cause).toBe(primary);
  expect(state.boundaryFailures.map(item => item.cause)).toEqual([closeFailure]);
  expect(calls).toEqual(['accounting', 'history', 'record', 'metrics', 'diagnostic']);
  expect(state.ownersClosed).toBe(false); expect(state.storeRemoved).toBe(false); expect(state.mayStartNext).toBe(false);
});

test('undefined is preserved as a primary refusal through native close failure', async () => {
  const state = await finalizeCase({ primary: { cause: undefined }, drained: true,
    owners: [{ name: 'history', close: () => { throw new Error('later close failure'); } }], removeStore: () => undefined,
    record: () => undefined, metrics: async () => undefined, diagnostic: async () => undefined });
  expect(state.failure).toBeDefined(); expect(state.failure?.cause).toBeUndefined();
  expect(state.mayStartNext).toBe(false);
});

test('a store removal error is retained after both owners close without claiming store removal', async () => {
  const original = new Error('remove failed');
  const calls: string[] = [];
  const state = await finalizeCase({ primary: undefined, drained: true,
    owners: [{ name: 'accounting', close: () => { calls.push('accounting'); } }, { name: 'history', close: () => { calls.push('history'); } }],
    removeStore: () => { calls.push('remove'); throw original; }, record: () => { calls.push('record'); },
    metrics: async () => { calls.push('metrics'); }, diagnostic: async () => { calls.push('diagnostic'); } });
  expect(state.failure?.cause).toBe(original);
  expect(calls).toEqual(['accounting', 'history', 'remove', 'record', 'metrics', 'diagnostic']);
  expect(state.ownersClosed).toBe(true); expect(state.storeRemoved).toBe(false); expect(state.mayStartNext).toBe(false);
});

test('failed metrics output cannot suppress a diagnostic attempt or replace the primary error', async () => {
  const primary = new Error('primary'); const metricsFailure = new Error('metrics output'); const diagnosticFailure = new Error('diagnostic output');
  const calls: string[] = [];
  const state = await finalizeCase({ primary: { cause: primary }, drained: true, owners: [], removeStore: () => undefined,
    record: () => { calls.push('record'); }, metrics: async () => { calls.push('metrics'); throw metricsFailure; },
    diagnostic: async () => { calls.push('diagnostic'); throw diagnosticFailure; } });
  expect(state.failure?.cause).toBe(primary);
  expect(state.boundaryFailures.map(item => item.cause)).toEqual([metricsFailure, diagnosticFailure]);
  expect(calls).toEqual(['record', 'metrics', 'diagnostic']);
  expect(state.metricsAttempted).toBe(true); expect(state.diagnosticAttempted).toBe(true); expect(state.mayStartNext).toBe(false);
});

test('an output failure becomes the first failure when owner closure was otherwise healthy', async () => {
  const original = new Error('metrics output'); const calls: string[] = [];
  const state = await finalizeCase({ primary: undefined, drained: true, owners: [], removeStore: () => undefined,
    record: () => undefined, metrics: async () => { throw original; }, diagnostic: async () => { calls.push('diagnostic'); } });
  expect(state.failure?.cause).toBe(original); expect(calls).toEqual(['diagnostic']); expect(state.mayStartNext).toBe(false);
});

test('unknown run closure never closes its live owners or removes their stores but still reports', async () => {
  const calls: string[] = [];
  const state = await finalizeCase({ primary: { cause: new Error('drain unresolved') }, drained: false,
    owners: [{ name: 'history', close: () => { calls.push('history'); } }], removeStore: () => { calls.push('remove'); },
    record: () => { calls.push('record'); }, metrics: async () => { calls.push('metrics'); }, diagnostic: async () => { calls.push('diagnostic'); } });
  expect(calls).toEqual(['record', 'metrics', 'diagnostic']);
  expect(state.ownersClosed).toBe(false); expect(state.storeRemoved).toBe(false); expect(state.mayStartNext).toBe(false);
});

test('successful independent closure and metrics permit the next case without an invented diagnostic failure', async () => {
  const calls: string[] = [];
  const state = await finalizeCase({ primary: undefined, drained: true, owners: [{ name: 'history', close: () => { calls.push('history'); } }],
    removeStore: () => { calls.push('remove'); }, record: () => { calls.push('record'); },
    metrics: async () => { calls.push('metrics'); }, diagnostic: async () => { calls.push('diagnostic'); } });
  expect(state.failure).toBeUndefined(); expect(state.boundaryFailures).toHaveLength(0);
  expect(state.ownersClosed).toBe(true); expect(state.storeRemoved).toBe(true); expect(state.mayStartNext).toBe(true);
  expect(calls).toEqual(['history', 'remove', 'record', 'metrics']);
});


test('a formatter failure is a missing diagnostic outcome and cannot replace the primary cause', async () => {
  const primary = new Error('original'); const formatFailure = new Error('message getter failed');
  Object.defineProperty(primary, 'message', { get: () => { throw formatFailure; } });
  const state = await finalizeCase({ primary: { cause: primary }, drained: true, owners: [], removeStore: () => undefined,
    record: () => undefined, metrics: async () => undefined, diagnostic: async () => {
      formatFailureDiagnostic({ mode: 'cold', failure: primary, initial: null, peak: { rssBytes: 0, storeBytes: 0 }, samples: 0,
        elapsedMilliseconds: 0, runs: 0, traversals: 0, sends: 0, inFlight: 0, peakSends: 0, stop: {}, unresolved: false, trace: [] });
    } });
  expect(state.failure?.cause).toBe(primary);
  expect(state.boundaryFailures.map(item => item.cause)).toEqual([formatFailure]);
  expect(state.diagnosticAttempted).toBe(true); expect(state.mayStartNext).toBe(false);
});

test('a recorded boundary violation still attempts both bounded output paths', async () => {
  const original = new Error('case deadline exceeded'); const calls: string[] = [];
  const state = await finalizeCase({ primary: undefined, drained: true, owners: [], removeStore: () => undefined,
    record: () => { calls.push('record'); throw original; }, metrics: async () => { calls.push('metrics'); }, diagnostic: async () => { calls.push('diagnostic'); } });
  expect(state.failure?.cause).toBe(original); expect(calls).toEqual(['record', 'metrics', 'diagnostic']);
});


/** A genuine Writable exposes physical completion while a reporter may replace only its public write entry. */
interface IOutputSink {
  readonly stream: Writable;
  readonly chunks: readonly string[];
  acknowledge(cause?: Error | null): void;
}
/** The sink records bytes at _write, never treating write's Boolean return as acknowledgment. */
function outputSink(intercept: boolean): IOutputSink {
  const chunks: string[] = [];
  let complete: ((cause?: Error | null) => void) | undefined;
  const stream = new Writable({ write(chunk: unknown, _encoding: BufferEncoding, callback: (cause?: Error | null) => void): void {
    if (!Buffer.isBuffer(chunk)) { throw new Error('The physical output sink expects encoded bytes'); }
    chunks.push(chunk.toString('utf8')); complete = callback;
  } });
  if (intercept) {
    // Jest's installed reporters forward only chunk, discard every callback overload and return true.
    const nativeWrite = stream.write.bind(stream);
    Object.defineProperty(stream, 'write', { value: (chunk: unknown): boolean => nativeWrite(chunk) });
  }
  return { stream, chunks, acknowledge(cause): void {
    if (complete === undefined) { throw new Error('No physical write is pending'); }
    const acknowledgment = complete; complete = undefined; acknowledgment(cause);
  } };
}
/** Native nextTick/stream errors and the harness's deferred listener release cross an actual event turn. */
async function outputTurn(): Promise<void> {
  await new Promise<void>(resolve => { setImmediate(resolve); });
  await new Promise<void>(resolve => { setImmediate(resolve); });
}

test('output acknowledgment survives a reporter callback-dropping write override and still waits for physical completion', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  const sink = outputSink(true); const outcomes: string[] = [];
  const writing = writeCaseOutput('actual metrics\n', Date.now() + 16_000, sink.stream)
    .then(() => { outcomes.push('acknowledged'); }, () => { outcomes.push('failed'); });
  try {
    await outputTurn();
    expect(sink.chunks).toEqual(['actual metrics\n']); expect(outcomes).toEqual([]);
    sink.acknowledge(); await outputTurn();
    expect(outcomes).toEqual(['acknowledged']);
    expect(sink.stream.listenerCount('error')).toBe(0);
  } finally {
    jest.advanceTimersByTime(16_000); await writing; sink.stream.destroy(); jest.useRealTimers();
  }
});

test('a genuine output callback error preserves its identity and observes the subsequent stream error turn', async () => {
  const sink = outputSink(true); const original = new Error('physical write failed');
  const writing = writeCaseOutput('metrics', Date.now() + 16_000, sink.stream);
  const rejection = expect(writing).rejects.toBe(original);
  sink.acknowledge(original); await rejection;
  expect(sink.stream.listenerCount('error')).toBe(0);
  sink.stream.destroy();
});

test('a stream error without callback success is a failed output acknowledgment', async () => {
  const sink = outputSink(false); const original = new Error('stream failed');
  const writing = writeCaseOutput('metrics', Date.now() + 16_000, sink.stream);
  const rejection = expect(writing).rejects.toBe(original);
  sink.stream.emit('error', original); await rejection;
  sink.acknowledge(); await outputTurn();
  expect(sink.stream.listenerCount('error')).toBe(0); sink.stream.destroy();
});

test('a synchronous physical output throw retains its identity and releases the temporary listener', async () => {
  const original = new Error('physical writer threw');
  const stream = new Writable({ write(): never { throw original; } });
  await expect(writeCaseOutput('metrics', Date.now() + 16_000, stream)).rejects.toBe(original);
  expect(stream.listenerCount('error')).toBe(0); stream.destroy();
});

test('missing physical output acknowledgment retains the unchanged deadline and prevents the next ordinary case', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  const sink = outputSink(true); const calls: string[] = []; const started = Date.now();
  const finalizing = finalizeCase({ primary: undefined, drained: true, owners: [], removeStore: () => undefined, record: () => undefined,
    metrics: () => writeCaseOutput('metrics', started + 16_000, sink.stream), diagnostic: async () => { calls.push('diagnostic'); } });
  try {
    await jest.advanceTimersByTimeAsync(15_999);
    expect(calls).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    const state = await finalizing;
    expect(state.failure?.cause).toEqual(new Error('Missing bounded case output acknowledgment'));
    expect(state.boundaryFailures.map(value => value.boundary)).toEqual(['metrics-output']);
    expect(state.mayStartNext).toBe(false); expect(state.diagnosticAttempted).toBe(true); expect(calls).toEqual(['diagnostic']);
  } finally {
    sink.acknowledge(); await outputTurn(); sink.stream.destroy(); jest.useRealTimers();
  }
});


test('actual stderr acknowledges ordinary output with its real TTY or pipe backing', async () => {
  await writeCaseOutput(`${JSON.stringify({ kind: 'ordinary-output-acknowledgment', tty: stderr.isTTY === true, backing: stderr.constructor.name })}\n`, Date.now() + 1_000);
});
