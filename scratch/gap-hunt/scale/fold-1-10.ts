import { performance } from 'node:perf_hooks';
import { authoring, openWorkspace } from 'microdelta';
interface IMember { readonly key: string; readonly score: number }
interface IListing { readonly members: readonly IMember[]; readonly status: 'complete' }
const api = authoring<Record<string, never>, Record<string, never>>();
const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, run: ({ outcome }) => outcome.fresh<IListing>({ members: Array.from({ length: 1 }, (_, score) => ({ key: 'member:' + score, score })), status: 'complete' }) });
const template = api.template({ slot: 'member', collection: listing, steps: member => {
const s0 = member.memo({ subject: member.subject('node0'), run: ({ member: item }) => ({ depth: item.score }) });
const s1 = member.memo({ subject: member.subject('node1'), children: { s0 }, run: async ({ calls }) => ({ depth: (await calls.s0()).data.depth + 1 }) });
const s2 = member.memo({ subject: member.subject('node2'), children: { s1 }, run: async ({ calls }) => ({ depth: (await calls.s1()).data.depth + 1 }) });
const s3 = member.memo({ subject: member.subject('node3'), children: { s2 }, run: async ({ calls }) => ({ depth: (await calls.s2()).data.depth + 1 }) });
const s4 = member.memo({ subject: member.subject('node4'), children: { s3 }, run: async ({ calls }) => ({ depth: (await calls.s3()).data.depth + 1 }) });
const s5 = member.memo({ subject: member.subject('node5'), children: { s4 }, run: async ({ calls }) => ({ depth: (await calls.s4()).data.depth + 1 }) });
const s6 = member.memo({ subject: member.subject('node6'), children: { s5 }, run: async ({ calls }) => ({ depth: (await calls.s5()).data.depth + 1 }) });
const s7 = member.memo({ subject: member.subject('node7'), children: { s6 }, run: async ({ calls }) => ({ depth: (await calls.s6()).data.depth + 1 }) });
const s8 = member.memo({ subject: member.subject('node8'), children: { s7 }, run: async ({ calls }) => ({ depth: (await calls.s7()).data.depth + 1 }) });
const s9 = member.memo({ subject: member.subject('node9'), children: { s8 }, run: async ({ calls }) => ({ depth: (await calls.s8()).data.depth + 1 }) });
const s10 = member.memo({ subject: member.subject('node10'), children: { s9 }, run: async ({ calls }) => ({ depth: (await calls.s9()).data.depth + 1 }) });
return { s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10 };
} });
const fold = api.fold({ subject: 'fold', over: { template, step: 's10' }, run: ({ members }) => {
let total = 0;
for (const entry of members) if (entry.status === 'succeeded') total += entry.data.depth;
return { total };
} });
const composition = api.compose({ scope: 'fold', steps: [{ slot: 'listing', declaration: listing }, { slot: 'fold', declaration: fold }], templates: [template] });
const workspace = openWorkspace({ location: 'scratch/gap-hunt/scale/fold-1-10-' + process.pid + '.sqlite', logicalStore: 'fold', leaseMilliseconds: 600000 });
const start = performance.now();
try {
const result = await workspace.run({ authoring: api, composition, environment: 'synthetic' }, async run => { const report = await run.resolveFold({ scope: 'fold', role: 'step', slot: 'fold' }, { requestKey: 'request:' + process.pid }); const total = report.outcome.status === 'succeeded' ? run.read<{ readonly total: number }>(report.outcome.outcome.reference).total : undefined; return { report, total }; });
if (result.value.total !== 1 * (1 - 1) / 2 + 1 * 10) throw new Error('Fold total did not match independent expected value');
console.log(JSON.stringify({ width: 1, depth: 10, milliseconds: performance.now() - start, outcome: result.value.report.outcome.status, total: result.value.total, heap: process.memoryUsage().heapUsed }));
} finally { workspace.close(); }
