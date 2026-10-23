/** Independent member/argument output transport across complete process restarts. */
import { authoring, openWorkspace } from 'microdelta';
const [location, requestKey, mode] = process.argv.slice(2);
if (location === undefined || requestKey === undefined || mode === undefined) {
    throw new Error('Expected store request mode');
}
const api = authoring();
const slot = api.stepSlot({ slot: 'describe' });
const described = api.suppliedStep({ label: 'describe', run: ({ args }) => ({ value: args[0] }) });
const listing = api.source({ subject: 'listing', collection: { identity: 'key' }, finality: () => true,
    run: ({ outcome }) => outcome.fresh({ status: 'complete', members: [{ key: 'ada', selected: { score: 3 } }] }),
});
const template = api.template({ slot: 'person', collection: listing, steps: member => ({
        subtree: member.memo({ subject: member.subject('subtree'), run: ({ member: bound }) => ({ value: bound.selected }) }),
        scalar: member.memo({ subject: member.subject('scalar'), run: ({ member: bound }) => ({ value: bound.selected.score }) }),
        argument: member.memo({ subject: member.subject('argument'), children: { describe: slot }, run: async ({ calls }) => ({ value: (await calls.describe(api.forward.member(['selected']))).data.value }) }),
    }) });
const composition = api.compose({ scope: 'output-bindings', steps: [{ slot: 'listing', declaration: listing }], templates: [template], supplied: [api.supply({ slot, declaration: described, subject: () => 'description' })] });
const workspace = openWorkspace({ location, logicalStore: 'output-bindings' });
try {
    const result = await workspace.run({ authoring: api, composition, environment: 'fixture' }, async (run) => {
        const outcome = await run.resolve({ scope: 'output-bindings', role: 'step', slot: mode, template: 'person', collection: 'listing', memberKey: 'ada' }, { requestKey });
        if (outcome.kind !== 'published' && outcome.kind !== 'reused') {
            throw new Error(`Unexpected ${outcome.kind}`);
        }
        return { kind: outcome.kind, reference: outcome.reference, misses: outcome.misses, value: run.read(outcome.reference) };
    });
    console.log(JSON.stringify(result.value));
}
finally {
    workspace.close();
}
