/** One fresh-process TRK-7 control; designated input identity is author data, not an output identity policy. */
import { authoring, openWorkspace } from 'microdelta';
/** The author designates id as this record's logical identity; content is deliberately unread by the memo. */
interface IEntity { readonly id: string; readonly content: string }
interface IInputs { readonly first: IEntity; readonly second: IEntity }
interface IHelpers { readonly trace: () => void }
/** Count the actual body, without introducing an invalidating influence. */
function trace(): void { process.stderr.write('BODY:combined\n'); }
/** Each stage changes only the intended input fact while keeping the other consumed identity stable. */
function inputsFor(variant: string): IInputs {
  const base: IInputs = { first: { id: 'first:a', content: 'first content' }, second: { id: 'second:a', content: 'second content' } };
  switch (variant) {
    case 'base': return base;
    case 'unread': return { first: { ...base.first, content: 'changed first content' }, second: { ...base.second, content: 'changed second content' } };
    case 'first': return { first: { id: 'first:b', content: 'changed first content' }, second: { ...base.second, content: 'changed second content' } };
    case 'second': return { first: { id: 'first:b', content: 'changed first content' }, second: { id: 'second:b', content: 'changed second content' } };
    default: throw new Error(`Unknown variant ${variant}`);
  }
}
const [location, variant, requestKey] = process.argv.slice(2);
if (location === undefined || variant === undefined || requestKey === undefined) { throw new Error('Expected store, variant and request key'); }
const builders = authoring<IInputs, IHelpers>();
const combined = builders.memo({
  // This complete subject stays fixed across both consumed identity changes.
  subject: 'combined:fixed-subject',
  run: ({ inputs, helpers }) => {
    helpers.trace();
    return { key: 'output:fixed', first: inputs.first.id, second: inputs.second.id };
  },
});
const inputs = inputsFor(variant);
const composition = builders.compose({ scope: 'identity-combination', inputs: [{ slot: 'first', value: inputs.first }, { slot: 'second', value: inputs.second }], helpers: [{ slot: 'trace', helper: trace }], steps: [{ slot: 'combined', declaration: combined }] });
const workspace = openWorkspace({ location, logicalStore: 'identity-combination-store' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
    const outcome = await run.resolve({ scope: 'identity-combination', role: 'step', slot: 'combined' }, { requestKey });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected outcome ${outcome.kind}`); }
    return { kind: outcome.kind, reference: outcome.reference.locator, data: run.read<unknown>(outcome.reference) };
  });
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
} finally { workspace.close(); }
