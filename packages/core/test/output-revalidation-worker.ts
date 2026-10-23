/**
 * One fresh process resolves an explicit pass-through output over the supplied
 * current input. It reports body work separately from the immutable result,
 * so the restart test can distinguish a retained reference from a republish.
 */
import { encodeSnapshot } from '@microdelta/value';

import { authoring, openWorkspace } from '../src/index.js';

/** Only supported record output is in this bounded worker's scope. */
interface IConfig { readonly selected: { readonly score: number }; readonly unread: string }
/** The declaration binds one current record whose sibling is intentionally unread. */
interface IInputs { readonly config: IConfig }
/** No helper code influences this output. */
type IHelpers = Record<never, never>;

const [location, variant, requestKey] = process.argv.slice(2);
if (location === undefined || variant === undefined || requestKey === undefined) {
  throw new Error('Expected location, input variant and request key');
}
const score = variant === 'changed' ? 4 : 3;
const unread = variant === 'unread' ? 'changed sibling' : 'original sibling';
if (variant !== 'base' && variant !== 'unread' && variant !== 'changed') {
  throw new Error('Unknown input variant');
}
let bodyCalls = 0;
const builders = authoring<IInputs, IHelpers>();
const output = builders.memo({
  subject: 'output-revalidation',
  run: ({ inputs }) => {
    // eslint-disable-next-line microdelta/tracked-captures -- Test-only counter observes body execution and never influences its returned value.
    bodyCalls += 1;
    return { value: inputs.config.selected };
  },
});
const composition = builders.compose({
  scope: 'output-revalidation',
  inputs: [{ slot: 'config', value: { selected: { score }, unread } }],
  helpers: [],
  steps: [{ slot: 'output', declaration: output }],
});
const workspace = openWorkspace({ location, logicalStore: 'output-revalidation' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
    const outcome = await run.resolve({ scope: 'output-revalidation', role: 'step', slot: 'output' }, { requestKey });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') {
      throw new Error(`Unexpected ${outcome.kind}`);
    }
    return {
      kind: outcome.kind,
      reference: outcome.reference,
      output: encodeSnapshot(run.read<unknown>(outcome.reference)),
      bodyCalls,
    };
  });
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
} finally {
  workspace.close();
}
