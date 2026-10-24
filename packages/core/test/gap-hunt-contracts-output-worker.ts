/** Fresh processes distinguish output transport shape from ordinary selected-leaf equality. */
import { encodeSnapshot } from '@microdelta/value';
import { authoring, openWorkspace } from '../src/index.js';
interface IConfig { readonly selected: object; readonly unread: string }
interface IInputs { readonly config: IConfig }
type IHelpers = Record<never, never>;
/** Keep supported custom prototypes explicit and free from accessors. */
function inherited(value: string): object {
  const prototype: Record<string, string> = { role: value };
  Object.setPrototypeOf(prototype, null);
  const result: Record<string, string> = { name: 'Ada' };
  Object.setPrototypeOf(result, prototype);
  return result;
}
function configOf(variant: string): IConfig {
  switch (variant) {
    case 'base': return { selected: { a: 1, b: 2 }, unread: 'before' };
    case 'unread': return { selected: { a: 1, b: 2 }, unread: 'changed' };
    case 'order': return { selected: { b: 2, a: 1 }, unread: 'before' };
    case 'value': return { selected: { a: 3, b: 2 }, unread: 'before' };
    case 'missing': return { selected: {}, unread: 'before' };
    case 'undefined': return { selected: { a: undefined }, unread: 'before' };
    case 'hole': return { selected: new Array<undefined>(1), unread: 'before' };
    case 'slot': return { selected: [undefined], unread: 'before' };
    case 'inherited': return { selected: inherited('author'), unread: 'before' };
    case 'inherited-change': return { selected: inherited('reviewer'), unread: 'before' };
    case 'own': return { selected: { name: 'Ada', role: 'author' }, unread: 'before' };
    default: throw new Error('Unknown output fixture');
  }
}
const [location, variant, requestKey, selectedSlot] = process.argv.slice(2);
if (location === undefined || variant === undefined || requestKey === undefined) { throw new Error('Expected location, variant and request'); }
const builders = authoring<IInputs, IHelpers>();
const step = builders.memo({ subject: 'output', run: ({ inputs }) => ({ value: inputs.config.selected }) });
const scalar = builders.memo({ subject: 'scalar', run: ({ inputs }) => ({ value: inputs.config.unread }) });
const composition = builders.compose({ scope: 'output-analysis', inputs: [{ slot: 'config', value: configOf(variant) }], helpers: [], steps: [{ slot: 'output', declaration: step }, { slot: 'scalar', declaration: scalar }] });
const workspace = openWorkspace({ location, logicalStore: 'output-store' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
    const outcome = await run.resolve({ scope: 'output-analysis', role: 'step', slot: selectedSlot ?? 'output' }, { requestKey });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
    return { kind: outcome.kind, misses: outcome.misses, reference: outcome.reference, wire: encodeSnapshot(run.read<unknown>(outcome.reference)) };
  });
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
} finally { workspace.close(); }
