/** One process lifetime proves a durable helper dependency through supported alpha facade declarations. */
import { authoring, openWorkspace } from 'microdelta';
import { dependency, intermediary } from './gap-hunt-contracts-artifact-intermediary.js';

interface IHelpers {
  readonly dependency: (value: number) => number;
  readonly intermediary: (leaf: (value: number) => number, value: number) => number;
  readonly trace: () => void;
}
type IInputs = Record<never, never>;

const [location, requestKey] = process.argv.slice(2);
if (location === undefined || requestKey === undefined) { throw new Error('Expected location and request key'); }
const builders = authoring<IInputs, IHelpers>();
const analysis = builders.memo({ subject: 'analysis', run: ({ helpers }) => {
  helpers.trace();
  return { score: helpers.intermediary(helpers.dependency, 3) };
} });
/** A test-only side effect counts executions; its implementation is identical in every process. */
function trace(): void { process.stderr.write('BODY:analysis\n'); }
const composition = builders.compose({ scope: 'durable-artifacts', steps: [{ slot: 'analysis', declaration: analysis }], helpers: [
  { slot: 'dependency', helper: dependency },
  { slot: 'intermediary', helper: intermediary },
  { slot: 'trace', helper: trace },
] });
const workspace = openWorkspace({ location, logicalStore: 'durable-artifacts-store' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
    const outcome = await run.resolve({ scope: 'durable-artifacts', role: 'step', slot: 'analysis' }, { requestKey });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
    return { kind: outcome.kind, reference: outcome.reference.locator, data: run.read<{ readonly score: number }>(outcome.reference) };
  });
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
} finally { workspace.close(); }
