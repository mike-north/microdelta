/** Issue156 boundary: an awaited scalar root remains unsupported; wrapping is accepted. */
import { authoring, openWorkspace } from 'microdelta';
const mode = process.argv[2];
const location = process.argv[3];
const api = authoring();
let calls = 0;
const declaration = api.source({ subject: 'async-source', run: async ({ outcome, previous }) => {
  calls += 1;
  await Promise.resolve();
  if (mode === 'throw') throw new Error('check failed after await');
  if (mode === 'retain' && previous !== undefined) return outcome.retain(previous);
  return outcome.fresh(mode === 'scalar' ? 1 : { value: 1 });
} });
const composition = api.compose({ scope: 'async-source', steps: [{ slot: 'value', declaration }] });
const workspace = openWorkspace({ location, logicalStore: 'async-source' });
try {
  const result = await workspace.run({ authoring: api, composition, environment: 'fixture' }, run => run.resolve({ scope: 'async-source', role: 'step', slot: 'value' }, { requestKey: `run:${process.pid}` }));
  console.log(JSON.stringify({ kind: 'returned', calls, result: result.value }));
} catch (error) {
  console.log(JSON.stringify({ kind: 'threw', message: error instanceof Error ? error.message : 'unknown', calls }));
} finally { workspace.close(); }
