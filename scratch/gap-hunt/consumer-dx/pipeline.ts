import { authoring, openWorkspace } from 'microdelta';

/** Synthetic GitHub search member identity survives page rearrangement. */
interface IPullRequest { readonly key: string; readonly title: string }
interface IListing { readonly members: readonly IPullRequest[]; readonly status: 'complete' | 'open'; readonly observation: string }
interface IInputs { readonly observation: string; readonly limit: number }
const api = authoring<IInputs, Record<string, never>>();
// A fresh observation differs from a process restart with the same observation.
const listing = api.source<IListing>({
  subject: 'github:search', collection: { identity: 'key' },
  finality: ({ previous, inputs }) => previous.data.observation === inputs.observation,
  run: ({ outcome, inputs }) => {
    const members: IPullRequest[] = [];
    // Provider cap forces range bisection; traversal pages have no durable identity.
    const ranges: (readonly [number, number])[] = [[1, inputs.limit]];
    while (ranges.length > 0) {
      const range = ranges.pop();
      if (range === undefined) break;
      const [start, end] = range;
      if (end - start + 1 > 2) {
        const middle = Math.floor((start + end) / 2);
        ranges.push([middle + 1, end], [start, middle]);
      } else {
        for (let id = start; id <= end; id += 1) members.push({ key: `pr:${id}`, title: `PR ${id}` });
      }
    }
    return outcome.fresh<IListing>({ members, status: inputs.limit < 4 ? 'open' : 'complete', observation: inputs.observation });
  },
});
const template = api.template({ slot: 'pull-request', collection: listing, steps: (member) => ({
  assessment: member.memo({ subject: member.subject('assessment'), run: ({ member: pr }) => {
    // The first attempted consumer naturally serializes the tracked member.
    return { serialized: JSON.stringify({ key: pr.key, title: pr.title }) };
  } }),
}) });
const composition = api.compose({ scope: 'github-report', inputs: [{ slot: 'observation', value: process.env['DX_OBSERVATION'] ?? 'cutoff:1' }, { slot: 'limit', value: Number(process.env['DX_LIMIT'] ?? '4') }], steps: [{ slot: 'discovery', declaration: listing }], templates: [template] });
const workspace = openWorkspace({ location: process.env['DX_STORE'] ?? './scratch/gap-hunt/consumer-dx/explicit-store.sqlite', logicalStore: 'dx' });
try {
  console.log(JSON.stringify(await workspace.run({ authoring: api, composition, environment: 'synthetic' }, (run) => run.resolveMembers({ template: 'pull-request', step: 'assessment' }, { requestKey: `request:${process.pid}` })), null, 2));
} finally { workspace.close(); }
