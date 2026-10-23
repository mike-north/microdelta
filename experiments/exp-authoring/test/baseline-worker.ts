/**
 * Independent current-runtime controls for the authoring experiment. Raw scalar
 * publication and tracked subtree output are measured separately from the
 * candidate syntax so their owning limitations cannot be credited to its adapter.
 */
import { authoring, openWorkspace, ResolutionError } from 'microdelta';
import type { IRunEvent } from 'microdelta';

/** Supported baseline data: one consumed title and an unread sibling. */
interface IInputs { readonly pr: { readonly title: string; readonly labels: readonly string[] } }
/** Baseline authoring has no helper capabilities or hidden environment reads. */
type IHelpers = Record<never, never>;

/** Resolve a baseline mode and emit raw lifecycle evidence for the calling test process. */
async function main(): Promise<void> {
  const [location, mode, requestKey] = process.argv.slice(2);
  if (location === undefined || requestKey === undefined || (mode !== 'scalar' && mode !== 'subtree')) {
    throw new Error('Expected database, scalar/subtree mode and request key');
  }
  const builders = authoring<IInputs, IHelpers>();
  const scalar = builders.memo({ subject: 'baseline:scalar', run: ({ inputs }) => inputs.pr.title.length });
  const child = builders.memo({ subject: 'baseline:child', run: ({ inputs }) => ({ value: inputs.pr }) });
  const parent = builders.memo({ subject: 'baseline:parent', children: { child },
    run: async ({ calls }) => ({ value: (await calls.child()).data.value.title.length }) });
  const composition = builders.compose({ scope: 'authoring:baseline', inputs: [{ slot: 'pr', value: { title: 'ready', labels: ['unread'] } }], helpers: [],
    steps: [{ slot: 'scalar', declaration: scalar }, { slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }] });
  const events: IRunEvent[] = [];
  const workspace = openWorkspace({ location, logicalStore: 'authoring-baseline' });
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test', observers: [{ observe(event): void { events.push(event); } }] }, async (run) => {
      try {
        const outcome = await run.resolve({ scope: 'authoring:baseline', role: 'step', slot: mode === 'scalar' ? 'scalar' : 'parent' }, { requestKey });
        if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
        return { kind: outcome.kind, reference: outcome.reference, data: run.read<unknown>(outcome.reference) };
      } catch (error: unknown) {
        if (!(error instanceof ResolutionError)) { throw error; }
        return { kind: 'rejected', code: error.code };
      }
    });
    process.stdout.write(`${JSON.stringify({ outcome: result.value, events })}\n`);
  } finally { workspace.close(); }
}

await main();
