/**
 * F-09/F-10 isolate a memo's own callback implementation from compatibility
 * version. Callback A and B emit equal complete data; output equality cannot
 * excuse a changed implementation, and rollback may reuse an older candidate.
 */
import { join } from 'node:path';

import { authoring, openWorkspace } from '../src/index.js';

const directory = process.argv[2];
const implementation = process.argv[3];
const versionText = process.argv[4];
if (directory === undefined || (implementation !== 'A' && implementation !== 'B') || (versionText !== '1' && versionText !== '2')) {
  throw new Error('expected synthetic directory, implementation A/B and version 1/2');
}
/** Both concrete callback bodies return the same complete author record. */
interface IResult { readonly value: string; readonly complete: true }
interface IHelpers { readonly record: () => void }
/** Only the tracked helper capability records execution; it is not an author input. */
interface IBodyContext { readonly helpers: IHelpers }
let bodyCalls = 0;
const record = (): void => { bodyCalls += 1; };
/** A's explicit construction is intentionally a different callback body from B. */
function runA({ helpers }: IBodyContext): IResult { helpers.record(); return { value: 'same', complete: true }; }
/** B preserves output while changing the callback's own implementation evidence. */
function runB({ helpers }: IBodyContext): IResult { helpers.record(); const value = 'same'; return { complete: true, value }; }
const builders = authoring<object, IHelpers>();
const step = implementation === 'A'
  ? builders.memo({ subject: 'artifact-consumer', version: Number(versionText), run: runA })
  : builders.memo({ subject: 'artifact-consumer', version: Number(versionText), run: runB });
const composition = builders.compose({ scope: 'reuse-artifact', inputs: [], helpers: [{ slot: 'record', helper: record }], steps: [{ slot: 'consumer', declaration: step }] });
const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'reuse-artifact' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'same' }, async (run) => {
    const outcome = await run.resolve({ scope: 'reuse-artifact', role: 'step', slot: 'consumer' }, { requestKey: `${implementation}:${versionText}` });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`unexpected ${outcome.kind}`); }
    return { kind: outcome.kind, reference: outcome.reference.locator, value: run.read<IResult>(outcome.reference) };
  });
  console.log(JSON.stringify({ ...result.value, bodyCalls }));
} finally { workspace.close(); }
