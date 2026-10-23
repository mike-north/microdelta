/** Independent-process guard probe: every invocation reconstructs its composition from JSON. */
import { authoring, openWorkspace } from '../src/index.js';

/** A checked synthetic JSON input; parsing never supplies a function or hidden configuration. */
interface IConfig { readonly detail?: { readonly name: string } | null; readonly enabled: boolean }
interface IInputs { readonly config: IConfig }
type IHelpers = Record<never, never>;

/** Parse exactly the fixture variants, keeping invalid CLI shapes outside the runtime under test. */
function configOf(value: string): IConfig {
  if (value === 'object') { return { enabled: true, detail: { name: 'Ada' } }; }
  if (value === 'null') { return { enabled: true, detail: null }; }
  if (value === 'missing') { return { enabled: true }; }
  throw new Error('Expected object, null or missing');
}

/** One normal resolution in a fresh host process over the named shared store. */
async function main(): Promise<void> {
  const location = process.argv[2];
  const variant = process.argv[3];
  const requestKey = process.argv[4];
  if (location === undefined || variant === undefined || requestKey === undefined) { throw new Error('Expected location, variant and request key'); }
  const builders = authoring<IInputs, IHelpers>();
  const declaration = builders.memo({
    subject: 'container-guard',
    run: ({ inputs }) => ({ state: inputs.config.detail ? 'present' : 'absent' }),
  });
  const composition = builders.compose({
    scope: 'guard-process-analysis', inputs: [{ slot: 'config', value: configOf(variant) }], helpers: [],
    steps: [{ slot: 'container', declaration }],
  });
  const workspace = openWorkspace({ location, logicalStore: 'guard-process-store' });
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async (run) => {
      const outcome = await run.resolve({ scope: 'guard-process-analysis', role: 'step', slot: 'container' }, { requestKey });
      if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
      return { kind: outcome.kind, value: run.read<unknown>(outcome.reference) };
    });
    process.stdout.write(`${JSON.stringify(result.value)}\n`);
  } finally {
    workspace.close();
  }
}

await main();
