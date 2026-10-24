import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = new URL('./', import.meta.url);
const output = process.env.MICRODELTA_PROBE_OUTPUT ?? '.test-build/fresh-docs-cursor/run';
mkdirSync(output, { recursive: true });
const mutations = [
  ['dropped-page', 'adapter.js', 'if (page.next === null)', 'if (true)'],
  ['unconditional-source-refresh', 'source-pagination.js', "inputs.revision === 'fixture-v1'", "inputs.revision === 'force-refresh'"],
  ['wrong-summary', 'pipeline.js', 'total += record.score;', 'total += record.score + 1;'],
];
for (const [name, file, before, after] of mutations) {
  const path = new URL(`dist/${file}`, root);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(before)) { throw new Error(`missing mutation anchor: ${name}`); }
  try {
    writeFileSync(path, original.replace(before, after));
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'scratch/fresh-docs-cursor/jest.config.mjs', '--runInBand'], { encoding: 'utf8' });
    writeFileSync(`${output}/${name}-control.log`, result.stdout + result.stderr);
    if (result.status === 0 || result.status === null) { throw new Error(`control escaped: ${name}`); }
    console.log(`${name}: rejected (exit ${result.status})`);
  } finally { writeFileSync(path, original); }
}
