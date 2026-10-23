/** COL-1: numeric-only member records should be keyable by an explicit author strategy. */
import { authoring, openWorkspace } from 'microdelta';
interface IMember { readonly id: number; readonly score: number }
interface IOptionalMember extends IMember { readonly key?: string }
interface IListing { readonly status: 'complete'; readonly members: readonly IMember[] }
interface IOptionalListing { readonly status: 'complete'; readonly members: readonly IOptionalMember[] }
const mode = process.argv[2];
const api = authoring<Record<string, never>, Record<string, never>>();
try {
  if (mode === 'optional') {
    // Diagnostic workaround: a phantom optional string field permits a collection marker.
    const source = api.source<IOptionalListing>({ subject: 'listing', collection: { identity: 'key' }, run: ({ outcome }) => outcome.fresh<IOptionalListing>({ status: 'complete', members: [{ id: 7, score: 3 }] }) });
    const template = api.template({ slot: 'member', collection: source, key: member => `id:${member.id}`, steps: member => ({ score: member.memo({ subject: member.subject('score'), run: ({ member: bound }) => ({ score: bound.score }) }) }) });
    const composition = api.compose({ scope: 'custom-key', steps: [{ slot: 'listing', declaration: source }], templates: [template] });
    const location = process.argv[3];
    if (location === undefined) { throw new Error('Expected store'); }
    const workspace = openWorkspace({ location, logicalStore: 'custom-key' });
    try {
      const result = await workspace.run({ authoring: api, composition, environment: 'fixture' }, run => run.resolveMembers({ template: 'member', step: 'score' }, { requestKey: 'optional' }));
      console.log(JSON.stringify({ kind: 'accepted', report: result.value }));
    } finally { workspace.close(); }
  } else {
    const source = api.source<IListing>({ subject: 'listing', run: ({ outcome }) => outcome.fresh<IListing>({ status: 'complete', members: [{ id: 7, score: 3 }] }) });
    const steps = (member: import('microdelta').IMemberBuilder<Record<string, never>, Record<string, never>, IMember>) => ({ score: member.memo({ subject: member.subject('score'), run: ({ member: bound }) => ({ score: bound.score }) }) });
    if (mode === 'custom') {
      api.template({ slot: 'member', collection: source, key: member => `id:${member.id}`, steps });
    } else {
      api.template({ slot: 'member', collection: source, steps });
    }
  }
  if (mode !== 'optional') { console.log(JSON.stringify({ kind: 'accepted' })); }
} catch (error: unknown) {
  console.log(JSON.stringify(error instanceof Error ? { kind: 'rejected', name: error.name, message: error.message } : { kind: 'rejected' }));
}
