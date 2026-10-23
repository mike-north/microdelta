/** Offline reproduction of the consumer's fresh per-execution authoring/context shape. */
import { AsyncLocalStorage, AsyncResource, createHook } from 'node:async_hooks';
import { setImmediate } from 'node:timers/promises';
import { queryObjects } from 'node:v8';
import { authoring, openWorkspace } from 'microdelta';
import { createNodeMachine } from '@microdelta/machine-node';
import { createTrackingObserver } from '@microdelta/tracking';
interface IValue { readonly value: number; readonly final: boolean }
const mode = process.argv[2] ?? 'tracking';
const isolated = process.argv.includes('--isolated');
const iterations = Number(process.env['CONTEXT_RUNS'] ?? '3000');
const batchSize = Number(process.env['CONTEXT_BATCH'] ?? '100');
const caller = new AsyncLocalStorage<string>();
let initialized = 0;
let destroyed = 0;
const hook = createHook({ init() { initialized += 1; }, destroy() { destroyed += 1; } });
if (process.argv.includes('--hooks')) hook.enable();
const machine = createNodeMachine();
const workspace = mode === 'fresh' || mode === 'reuse' ? openWorkspace({ location: process.env['CONTEXT_STORE'] ?? `scratch/gap-hunt/scale/context-consumer-${process.pid}.sqlite`, logicalStore: 'consumer-context', leaseMilliseconds: 3_600_000 }) : undefined;
let bodies = 0;
let observed = 0;
/** The consumer restores a fresh async resource before its caller awaits the returned promise. */
function boundary<T>(work: () => Promise<T>): Promise<T> {
  if (!isolated) return work();
  const resource = new AsyncResource('synthetic-consumer-step');
  return resource.runInAsyncScope(work).finally(() => resource.emitDestroy());
}
/** Experimental heap diagnostic is narrowed and never used as domain identity. */
function countALS(): number {
  const count = queryObjects(AsyncLocalStorage, { format: 'count' });
  if (typeof count !== 'number') throw new Error('Expected an ALS count');
  return count;
}
/** Every execution allocates a fresh observer and Resolution-like active context. */
async function execute(index: number): Promise<void> {
  if (process.argv.includes('--yield-first')) await Promise.resolve();
  if (caller.getStore() !== 'caller') throw new Error('Caller context lost before work');
  if (mode === 'tracking' || mode === 'component' || mode === 'als' || mode === 'unentered') {
    const active = mode === 'component' ? undefined : machine.createAsyncContext<number>();
    if (mode === 'als') {
      const capture = machine.createAsyncContext<number>();
      if (active === undefined) throw new Error('Missing raw active context');
      await active.run(index, () => capture.run(index, async () => {
        for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
        if (active.getStore() !== index || capture.getStore() !== index) throw new Error('Context changed after await');
      }));
    } else {
      const tracking = createTrackingObserver(machine);
      // Resolution also owns a fresh independent validation observer.
      const validation = createTrackingObserver(machine);
      if (mode === 'unentered') { void validation; return; }
      const input = tracking.tracked({ value: index }, { path: ['inputs'] });
      const work = async (): Promise<number> => {
        await Promise.resolve();
        if (active !== undefined && active.getStore() !== index) throw new Error('Active invocation lost');
        return input.value;
      };
      const captured = await (active === undefined ? tracking.captureAsync(work) : active.run(index, () => tracking.captureAsync(work)));
      if (captured.value !== index || captured.observations.length !== 1) throw new Error('Wrong capture');
      observed += captured.observations.length;
      void validation;
    }
  } else {
    if (workspace === undefined) throw new Error('Missing workspace');
    const api = authoring<{ readonly observation: string; readonly revision: string }, Record<string, never>>();
    const declaration = api.source<IValue>({
      subject: mode === 'reuse' ? 'constant' : `source:${String(index)}`,
      finality: ({ previous }) => previous.data.final,
      run: ({ inputs, outcome }) => { void inputs.revision; bodies += 1; return outcome.fresh<IValue>({ value: 1, final: true }); },
    });
    const composition = api.compose({ scope: 'facts', inputs: [{ slot: 'revision', value: 'v1' }, { slot: 'observation', value: 'same' }], steps: [{ slot: 'result', declaration }] });
    const result = await workspace.run({ authoring: api, composition, environment: 'facts' }, async run => {
      const outcome = await run.resolve({ scope: 'facts', role: 'step', slot: 'result' }, { requestKey: `request:${String(index)}` });
      if (outcome.kind !== 'published' && outcome.kind !== 'reused') throw new Error('Unexpected outcome');
      return run.read<{ readonly value: number }>(outcome.reference).value;
    });
    if (result.value !== 1) throw new Error('Wrong source value');
  }
  if (caller.getStore() !== 'caller') throw new Error('Caller context lost after work');
}
/** Semantic guards a lifecycle repair must preserve independently of heap diagnostics. */
async function semanticControls(): Promise<void> {
  const observer = createTrackingObserver(machine);
  const left = observer.tracked({ value: 11 }, { path: ['left'] });
  const right = observer.tracked({ value: 22 }, { path: ['right'] });
  const outer = await observer.captureAsync(async () => {
    await Promise.resolve();
    if (caller.getStore() !== 'caller') throw new Error('Caller lost across await');
    const inner = await observer.captureAsync(async () => { await Promise.resolve(); return right.value; });
    if (inner.value !== 22 || inner.observations.length !== 1) throw new Error('Nested capture changed');
    try { await observer.captureAsync(async () => { await Promise.resolve(); throw new Error('expected'); }); }
    catch (error: unknown) { if (!(error instanceof Error) || error.message !== 'expected') throw error; }
    if (caller.getStore() !== 'caller') throw new Error('Caller lost across error');
    return left.value;
  });
  if (outer.value !== 11 || outer.observations.length !== 1) throw new Error('Parent capture polluted');
  const results = await Promise.all([
    observer.captureAsync(async () => { await Promise.resolve(); return left.value; }),
    observer.captureAsync(async () => { await Promise.resolve(); return right.value; }),
  ]);
  if (results[0]?.value !== 11 || results[1]?.value !== 22 || results.some(result => result.observations.length !== 1)) throw new Error('Concurrent capture polluted');
  let release: () => void = () => { throw new Error('Missing gate'); };
  const gate = new Promise<void>(resolve => { release = resolve; });
  let late: Promise<boolean> = Promise.resolve(false);
  await observer.captureAsync(async () => {
    late = gate.then(() => { try { void left.value; return false; } catch (error: unknown) { return error instanceof Error && /closed/u.test(error.message); } });
    await Promise.resolve();
    return left.value;
  });
  release();
  if (!await late) throw new Error('Closed frame accepted detached read');
  if (caller.getStore() !== 'caller') throw new Error('Caller lost after controls');
}
try {
  await caller.run('caller', async () => {
    if (process.argv.includes('--semantics')) { await semanticControls(); console.log(JSON.stringify({ semantics: 'passed' })); return; }
    for (let start = 0; start < iterations; start += batchSize) {
      const beforeInit = initialized;
      const beforeDestroy = destroyed;
      const started = performance.now();
      for (let index = start; index < Math.min(start + batchSize, iterations); index += 1) await boundary(() => execute(index));
      const milliseconds = performance.now() - started;
      await setImmediate();
      global.gc?.();
      await setImmediate();
      const liveALS = countALS();
      let liveALSConfirm: number | undefined;
      if (process.env['CONTEXT_CONFIRM'] === '1') {
        await setImmediate(); global.gc?.(); await setImmediate();
        liveALSConfirm = countALS();
      }
      console.log(JSON.stringify({ node: process.version, mode, isolated, runs: Math.min(start + batchSize, iterations), milliseconds, bodies, observed, initialized: initialized - beforeInit, destroyed: destroyed - beforeDestroy, totalInitialized: initialized, totalDestroyed: destroyed, liveALS, liveALSConfirm, heap: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss }));
    }
  });
} finally { hook.disable(); workspace?.close(); }
