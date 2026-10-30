/** Ordinary harness refusal and diagnostic controls start no owner run, store or transport. */
import { expect, test } from '@jest/globals';

import { beforeRunTerminates, createFailureLatch, finalizeCase, formatFailureDiagnostic, requireResourceBounds } from './guard.js';
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
