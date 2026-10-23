/** Fresh-process emitted-module probes of production Tracking, not the EXP-1 fixture. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve('packages/tracking/dist/src/index.js');
const dir = await mkdtemp(join(tmpdir(), 'microdelta-import-probe-'));
const dependency = 'export function dependency(value) { return value * 2; }';
const variants = [
  { name: 'unchanged fresh modules', code: dependency, version: '1.0.0', expected: 'equal', value: 6 },
  { name: 'transitive tracked imported body changes', code: dependency.replace('* 2', '* 3'), version: '1.0.0', expected: 'changed', value: 9 },
  { name: 'dependency version metadata alone', code: dependency, version: '2.0.0', expected: 'equal', value: 6 },
  { name: 'emitted function rename', code: dependency.replace('function dependency', 'function renamed') + '\nexport { renamed as dependency };', version: '1.0.0', expected: 'changed', value: 6 },
  { name: 'emitted formatting', code: dependency.replace('return value * 2;', 'return  value  *  2;'), version: '1.0.0', expected: 'changed', value: 6 },
  { name: 'emitted comment', code: dependency.replace('return', '/* emitted comment */ return'), version: '1.0.0', expected: 'changed', value: 6 },
];
const worker = `
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createTrackingObserver } from ${JSON.stringify(pathToFileURL(root).href)};
import { dependency } from './dependency.mjs';
const observer = createTrackingObserver({ createAsyncContext() { return new AsyncLocalStorage(); }, sha256(input) { return createHash('sha256').update(input).digest('hex'); } });
const trackedDependency = observer.tracked(dependency, { path: ['dependency'] });
// The intermediary lives in its own imported module and calls the imported tracked leaf.
const { intermediary } = await import('./intermediary.mjs');
const rawOuter = intermediary(trackedDependency);
const outer = observer.tracked(rawOuter, { path: ['outer'] });
const capture = observer.capture(() => outer(3));
if (process.argv[2] === 'record') {
 await writeFile(new URL('./capture.json', import.meta.url), JSON.stringify(capture));
 console.log(JSON.stringify({ value: capture.value, paths: capture.observations.map(o => o.binding.path) }));
} else {
 const prior = JSON.parse(await readFile(new URL('./capture.json', import.meta.url), 'utf8'));
 const compared = observer.compareCurrent(prior, { resolve(binding, request) {
  if (request.kind !== 'implementation') return { kind: 'unavailable' };
  const fact = binding.path[0] === 'outer' ? rawOuter : dependency;
  return { kind: 'available', fact };
 } });
 console.log(JSON.stringify({ kind: compared.kind, value: capture.value }));
}
`;
try {
  await writeFile(join(dir, 'worker.mjs'), worker);
  await writeFile(join(dir, 'intermediary.mjs'), 'export function intermediary(leaf) { return function outer(value) { return leaf(value); }; }');
  await writeFile(join(dir, 'dependency.mjs'), dependency);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0', type: 'module' }));
  const run = (mode) => JSON.parse(execFileSync(process.execPath, [join(dir, 'worker.mjs'), mode], { encoding: 'utf8' }));
  const first = run('record');
  assert.deepEqual(first.paths, [['outer'], ['dependency']]);
  for (const variant of variants) {
    await writeFile(join(dir, 'dependency.mjs'), variant.code);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ version: variant.version, type: 'module' }));
    const actual = run('compare');
    assert.equal(actual.kind, variant.expected, variant.name);
    assert.equal(actual.value, variant.value, variant.name);
    console.log(JSON.stringify({ name: variant.name, ...actual, expected: variant.expected, status: 'pass' }));
  }
} finally { await rm(dir, { recursive: true, force: true }); }
