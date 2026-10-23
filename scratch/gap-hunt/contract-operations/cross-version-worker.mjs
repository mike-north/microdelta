/** Recreate author declarations in each process; no old function/tag survives. */
import { pathToFileURL } from 'node:url';
const [root, location, requestKey] = process.argv.slice(2);
if (!root || !location || !requestKey) throw new Error('root, shared store and request key required');
const { authoring, openWorkspace } = await import(pathToFileURL(`${root}/packages/core/dist/src/index.js`).href);
let calls = 0;
const builders = authoring();
const value = builders.memo({ subject: 'identity:node-cross-version', run: () => {
  calls += 1;
  return { title: 'retained', list: [1, 2, 3], nested: { empty: null, enabled: true, text: 'Unicode: café 🚀' } };
} });
const composition = builders.compose({ scope: 'node-cross-version', inputs: [], helpers: [], steps: [{ slot: 'value', declaration: value }] });
const workspace = openWorkspace({ location, logicalStore: 'node-cross-version' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'fixture' }, async (run) => {
    const outcome = await run.resolve({ scope: 'node-cross-version', role: 'step', slot: 'value' }, { requestKey });
    const payload = outcome.kind === 'published' || outcome.kind === 'reused' ? run.read(outcome.reference) : undefined;
    return { kind: outcome.kind, reference: outcome.reference, payload };
  });
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, calls, ...result.value }));
} finally { workspace.close(); }
