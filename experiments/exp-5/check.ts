/** Reports the bounded native CML/API correspondence from freshly built artifacts. */
import { resolve } from 'node:path';

import { compareCorrespondence } from './conformance.js';
import { loadApiSnapshot, loadCmlSnapshot, loadManifest } from './model-bridge.js';

/** The checker reports unsupported coverage even when represented facts match. */
async function main(): Promise<void> {
  const experiment = resolve(import.meta.dirname, '..');
  const manifest = await loadManifest(resolve(experiment, 'mapping.json'));
  const cml = await loadCmlSnapshot(resolve(experiment, 'build/cml-facts.json'));
  const api = loadApiSnapshot(manifest.artifacts);
  const result = compareCorrespondence(cml, api, manifest.mapping);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.diagnostics.length > 0) {
    process.exitCode = 1;
  }
}

await main();
