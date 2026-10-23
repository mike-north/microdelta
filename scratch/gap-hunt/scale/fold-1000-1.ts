import { performance } from 'node:perf_hooks';
import { authoring, openWorkspace } from 'microdelta';
interface IMember { readonly key: string; readonly score: number }
interface IListing { readonly members: readonly IMember[]; readonly status: 'complete' }
const api = authoring<Record<string, never>, Record<string, never>>();
const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, run: ({ outcome }) => outcome.fresh<IListing>({ members: Array.from({ length: 1000 }, (_, score) => ({ key: 'member:' + score, score })), status: 'complete' }) });
const template = api.template({ slot: 'member', collection: listing, steps: member => {
const s0 = member.memo({ subject: member.subject('node0'), run: ({ member: item }) => ({ depth: item.score }) });
const s1 = member.memo({ subject: member.subject('node1'), children: { s0 }, run: async ({ calls }) => ({ depth: (await calls.s0()).data.depth + 1 }) });
return { s0, s1 };
} });
const fold = api.fold({ subject: 'fold', over: { template, step: 's1' }, run: ({ members }) => {
let total = 0;
for (const entry of members) if (entry.status === 'succeeded') total += entry.data.depth;
return { total };
} });
const composition = api.compose({ scope: 'fold', steps: [{ slot: 'listing', declaration: listing }, { slot: 'fold', declaration: fold }], templates: [template] });
const workspace = openWorkspace({ location: 'scratch/gap-hunt/scale/fold-1000-1-' + process.pid + '.sqlite', logicalStore: 'fold', leaseMilliseconds: 600000 });
const start = performance.now();
try {
const result = await workspace.run({ authoring: api, composition, environment: 'synthetic' }, async run => { const report = await run.resolveFold({ scope: 'fold', role: 'step', slot: 'fold' }, { requestKey: 'request:' + process.pid }); const total = report.outcome.status === 'succeeded' ? run.read<{ readonly total: number }>(report.outcome.outcome.reference).total : undefined; return { report, total }; });
if (result.value.total !== 1000 * (1000 - 1) / 2 + 1000 * 1) throw new Error('Fold total did not match independent expected value');
console.log(JSON.stringify({ width: 1000, depth: 1, milliseconds: performance.now() - start, outcome: result.value.report.outcome.status, total: result.value.total, heap: process.memoryUsage().heapUsed }));
} finally { workspace.close(); }
