/** Finite DOM-3 diagnostic: published roster versus work queued before admission. */
import { createHook } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { authoring, createStopController, openWorkspace } from 'microdelta';
interface IMember { readonly key: string; readonly score: number }
interface IListing { readonly members: readonly IMember[]; readonly status: 'complete' }
const size = Number(process.argv[2]);
const window = Number(process.argv[3]);
const phase = process.argv[4] ?? 'admission';
const location = process.argv[5];
if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(window) || window <= 0 || location === undefined) throw new Error('Expected size/window/store');
let release: () => void = () => { throw new Error('Missing hold gate'); };
const hold = new Promise<void>(resolve => { release = resolve; });
let ready: () => void = () => { throw new Error('Missing ready gate'); };
const reached = new Promise<void>(resolve => { ready = resolve; });
let sourceBodies = 0;
let admissionCalls = 0;
let bodies = 0;
let queuedPromises = 0;
let permitPromiseInits = 0;
const queuePromiseSites = new Set<string>();
const pendingQueue = new Set<number>();
// Only the generated wait-constructor line counts: Promise.resolve acquisitions
// share the same source file but do not retain a queued member continuation.
// This diagnostic is source-specific and must fail closed if that site moves.
const permitLines = readFileSync('packages/supervision/dist/src/permits.js', 'utf8').split('\n');
const queueLine = permitLines.findIndex(line => line.includes('return new Promise(')) + 1;
if (queueLine === 0) throw new Error('The lane-wait allocation site changed; update this diagnostic');
const queueSite = `/supervision/dist/src/permits.js:${String(queueLine)}:`;
const hook = createHook({ init(id, type) {
  if (type !== 'PROMISE') return;
  const stack = new Error('allocation site').stack ?? '';
  if (stack.includes('/supervision/dist/src/permits.js')) permitPromiseInits += 1;
  if (stack.includes('at new Promise') && stack.includes(queueSite)) {
    queuedPromises += 1;
    pendingQueue.add(id);
    queuePromiseSites.add(stack.split('\n').filter(line => line.includes('permits.js')).join('\n'));
  }
}, promiseResolve(id) { pendingQueue.delete(id); } });
const api = authoring<Record<string, never>, Record<string, never>>();
const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, finality: () => true, run: ({ outcome }) => {
  sourceBodies += 1;
  return outcome.fresh<IListing>({ members: Array.from({ length: size }, (_, score) => ({ key: `member:${String(score)}`, score })), status: 'complete' });
} });
const template = api.template({ slot: 'member', collection: listing, steps: member => ({ score: member.memo({ subject: member.subject('score'), run: async ({ member: input }) => {
  bodies += 1;
  if (phase === 'body' && bodies === Math.min(size, window)) ready();
  await hold;
  return { score: input.score };
} }) }) });
const composition = api.compose({ scope: 'fanout', steps: [{ slot: 'listing', declaration: listing }], templates: [template] });
const originalTopology = JSON.stringify(composition.topology);
const workspace = openWorkspace({ location, logicalStore: 'fanout-admission', leaseMilliseconds: 3600000 });
const stop = createStopController();
try {
  // Roster publication completes before scheduler instrumentation; it is not member work.
  await workspace.run({ authoring: api, composition, environment: 'synthetic' }, run => run.resolve({ scope: 'fanout', role: 'step', slot: 'listing' }, { requestKey: 'publish-roster' }));
  const result = await workspace.run({ authoring: api, composition, environment: 'synthetic', window, stop, admission: { async admit(request) {
    if (request.step.memberKey !== undefined) {
      admissionCalls += 1;
      if (phase === 'admission') {
        if (admissionCalls === Math.min(size, window)) ready();
        await hold;
      }
    }
    return { kind: 'admitted' };
  } } }, async run => {
    hook.enable();
    const resolving = run.resolveMembers({ template: 'member', step: 'score' }, { requestKey: 'held-members' });
    await reached;
    await setImmediate();
    global.gc?.();
    await setImmediate();
    const held = { topologyUnchanged: JSON.stringify(composition.topology) === originalTopology, admissionCalls, bodies, queuedPromises, permitPromiseInits, pendingLaneWaits: pendingQueue.size };
    stop.request({ level: 'hard' });
    release();
    const report = await resolving;
    hook.disable();
    const canonicalKeys = Array.from({ length: size }, (_, index) => `member:${String(index)}`).sort();
    return { ...held, pendingLaneWaitsAfterStop: pendingQueue.size, reportMembers: report.members.length, reportOrdered: report.members.every((member, index) => member.key === canonicalKeys[index]), publishedMembers: report.members.filter(member => member.status === 'succeeded').length, bodiesAfterStop: bodies };
  });
  console.log(JSON.stringify({ size, window, phase, sourceBodies, ...result.value, queuePromiseSites: [...queuePromiseSites] }));
} finally { hook.disable(); release(); workspace.close(); }
