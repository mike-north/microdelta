/**
 * Independent current-runtime controls for the authoring experiment. Raw scalar
 * publication and tracked subtree output are measured separately from the
 * candidate syntax so their owning limitations cannot be credited to its adapter.
 */
import { authoring, openWorkspace, ResolutionError } from 'microdelta';

/** Resolve a baseline mode and emit raw lifecycle evidence for the calling test process. */
async function main() {
  const [location, mode, requestKey] = process.argv.slice(2);
  if (location === undefined || requestKey === undefined || (mode !== 'scalar' && mode !== 'subtree')) {
    throw new Error('Expected database, scalar/subtree mode and request key');
  }
  const builders = authoring();
  // JavaScript deliberately bypasses the typed result-root boundary so this
  // historical negative control continues to exercise runtime rejection.
  const scalar = builders.memo({ subject: 'baseline:scalar', run: ({ inputs }) => inputs.pr.title.length });
  const child = builders.memo({ subject: 'baseline:child', run: ({ inputs }) => ({ value: inputs.pr }) });
  const parent = builders.memo({ subject: 'baseline:parent', children: { child },
    run: async ({ calls }) => ({ value: (await calls.child()).data.value.title.length }) });
  const composition = builders.compose({ scope: 'authoring:baseline', inputs: [{ slot: 'pr', value: { title: 'ready', labels: ['unread'] } }], helpers: [],
    steps: [{ slot: 'scalar', declaration: scalar }, { slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }] });
  const events = [];
  const workspace = openWorkspace({ location, logicalStore: 'authoring-baseline' });
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test', observers: [{ observe(event) { events.push(event); } }] }, async (run) => {
      try {
        const outcome = await run.resolve({ scope: 'authoring:baseline', role: 'step', slot: mode === 'scalar' ? 'scalar' : 'parent' }, { requestKey });
        if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
        return { kind: outcome.kind, reference: outcome.reference, data: run.read(outcome.reference) };
      } catch (error) {
        if (!(error instanceof ResolutionError)) { throw error; }
        return { kind: 'rejected', code: error.code };
      }
    });
    process.stdout.write(`${JSON.stringify({ outcome: result.value, events })}\n`);
  } finally { workspace.close(); }
}

await main();
