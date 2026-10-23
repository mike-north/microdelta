/** Independent-process guard probe: every invocation reconstructs its composition from JSON. */
import { authoring, openWorkspace } from '../src/index.js';

/** A checked synthetic JSON input; parsing never supplies a function or hidden configuration. */
interface IConfig { readonly detail?: undefined | { readonly name?: string; readonly unread?: string } | null; readonly enabled: boolean; readonly list?: readonly { readonly name: string }[] | null }
interface IInputs { readonly config: IConfig }
type IHelpers = Record<never, never>;

/** Parse exactly the fixture variants, keeping invalid CLI shapes outside the runtime under test. */
function configOf(value: string): IConfig {
  if (value === 'array') { return { enabled: true, list: [{ name: 'Ada' }] }; }
  if (value === 'array-edited') { return { enabled: true, list: [{ name: 'Ada' }, { name: 'unread' }] }; }
  if (value === 'array-changed') { return { enabled: true, list: [{ name: 'Grace' }] }; }
  if (value === 'array-null') { return { enabled: true, list: null }; }
  if (value === 'object') { return { enabled: true, detail: { name: 'Ada' } }; }
  if (value === 'edited') { return { enabled: true, detail: { name: 'Ada', unread: 'changed' } }; }
  if (value === 'changed') { return { enabled: true, detail: { name: 'Grace' } }; }
  if (value === 'empty') { return { enabled: true, detail: {} }; }
  if (value === 'undefined') { return { enabled: true, detail: undefined }; }
  if (value === 'false') { return { enabled: false }; }
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
  const slot = process.argv[5] ?? 'container';
  const declaration = builders.memo({
    subject: 'container-guard',
    run: ({ inputs }) => ({ state: inputs.config.detail ? 'present' : 'absent' }),
  });
  const explicit = builders.memo({ subject: 'explicit-null', run: ({ inputs }) => ({ state: inputs.config.detail !== null }) });
  const type = builders.memo({ subject: 'type', run: ({ inputs }) => ({ state: typeof inputs.config.detail }) });
  const nullish = builders.memo({ subject: 'nullish', run: ({ inputs }) => ({ state: (inputs.config.detail ?? { name: 'fallback' }).name }) });
  const nested = builders.memo({ subject: 'nested', run: ({ inputs }) => ({ state: inputs.config.detail?.name ?? 'absent' }) });
  const branch = builders.memo({ subject: 'branch', run: ({ inputs }) => ({ state: inputs.config.detail ? (inputs.config.detail.name ?? 'present') : 'absent' }) });
  const scalar = builders.memo({ subject: 'scalar', run: ({ inputs }) => ({ state: inputs.config.enabled ? 'present' : 'absent' }) });
  const producer = builders.memo({ subject: 'producer', run: ({ inputs }) => ({ detail: inputs.config.detail }) });
  const child = builders.memo({ subject: 'child-guard', children: { producer }, run: async ({ calls }) => {
    const { data } = await calls.producer();
    return { state: data.detail ? (data.detail.name ?? 'present') : 'absent' };
  } });
  const childLeaf = builders.memo({ subject: 'child-leaf', children: { producer }, run: async ({ calls }) => ({ state: (await calls.producer()).data.detail?.name ?? 'absent' }) });
  const array = builders.memo({ subject: 'array-guard', run: ({ inputs }) => ({ state: inputs.config.list ? 'present' : 'absent' }) });
  const arrayLeaf = builders.memo({ subject: 'array-leaf', run: ({ inputs }) => ({ state: inputs.config.list?.[0]?.name ?? 'absent' }) });
  const composition = builders.compose({
    scope: 'guard-process-analysis', inputs: [{ slot: 'config', value: configOf(variant) }], helpers: [],
    steps: [{ slot: 'producer', declaration: producer }, { slot: 'container', declaration }, { slot: 'explicit', declaration: explicit }, { slot: 'type', declaration: type }, { slot: 'nullish', declaration: nullish }, { slot: 'nested', declaration: nested }, { slot: 'branch', declaration: branch }, { slot: 'scalar', declaration: scalar }, { slot: 'child', declaration: child }, { slot: 'childLeaf', declaration: childLeaf }, { slot: 'array', declaration: array }, { slot: 'arrayLeaf', declaration: arrayLeaf }],
  });
  const workspace = openWorkspace({ location, logicalStore: 'guard-process-store' });
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async (run) => {
      const outcome = await run.resolve({ scope: 'guard-process-analysis', role: 'step', slot }, { requestKey });
      if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
      return { kind: outcome.kind, value: run.read<unknown>(outcome.reference) };
    });
    process.stdout.write(`${JSON.stringify(result.value)}\n`);
  } finally {
    workspace.close();
  }
}

await main();
