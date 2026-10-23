import { performance } from 'node:perf_hooks';
import { statSync } from 'node:fs';
import { authoring, openWorkspace } from 'microdelta';

/** Stable logical keys prevent traversal order from impersonating identity. */
interface IMember { readonly key: string; readonly score: number }
interface IListing { readonly members: readonly IMember[]; readonly status: 'complete' }
interface IInputs { readonly size: number }
const size = Number(process.argv[2]);
if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Expected positive integer collection size');
const api = authoring<IInputs, Record<string, never>>();
const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, finality: () => true, run: ({ inputs, outcome }) => outcome.fresh<IListing>({ members: Array.from({ length: inputs.size }, (_, index) => ({ key: `member:${index}`, score: index })), status: 'complete' }) });
const template = api.template({ slot: 'member', collection: listing, steps: member => ({ score: member.memo({ subject: member.subject('score'), run: ({ member: input }) => ({ score: input.score }) }) }) });
const composition = api.compose({ scope: 'collections', inputs: [{ slot: 'size', value: size }], steps: [{ slot: 'listing', declaration: listing }], templates: [template] });
const path = `scratch/gap-hunt/scale/collection-${size}-${process.pid}.sqlite`;
const workspace = openWorkspace({ location: path, logicalStore: 'collection', leaseMilliseconds: 3600000 });
console.log(JSON.stringify({ phase: 'start', size, path, heap: process.memoryUsage().heapUsed }));
const start = performance.now();
try {
  const result = await workspace.run({ authoring: api, composition, environment: 'synthetic' }, run => run.resolveMembers({ template: 'member', step: 'score' }, { requestKey: `request:${process.pid}` }));
  const counts: Record<string, number> = {};
  for (const member of result.value.members) counts[member.status] = (counts[member.status] ?? 0) + 1;
  console.log(JSON.stringify({ phase: 'settled', size, counts, milliseconds: performance.now() - start, heap: process.memoryUsage().heapUsed }));
} finally { workspace.close(); }
console.log(JSON.stringify({ phase: 'closed', size, fileBytes: statSync(path).size }));
