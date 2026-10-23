/** Expected-red merged-main replay; original fixture bytes and expectations are never rewritten. */
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = 'scratch/gap-hunt/current-contracts/';
const checks = [];
function run(id, command, args, expected = 0) {
  const child = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (child.error) throw child.error;
  if (child.signal) throw new Error(`${id}: ${child.signal}`);
  checks.push({ id, exitCode: child.status });
  return writeFile(root + base + `local-${id}.log`, child.stdout + child.stderr).then(() => assert.equal(child.status, expected, id));
}
for (const fixture of JSON.parse(await readFile(root + base + 'fixture-hashes.json', 'utf8'))) {
  assert.equal(createHash('sha256').update(await readFile(root + fixture.file)).digest('hex'), fixture.sha256, `Fixture drift ${fixture.file}`);
}
if (!process.argv.includes('--reuse-build')) {
  await run('install', 'npm', ['ci', '--no-audit', '--no-fund']);
  await run('build', 'npm', ['run', 'build']);
}
await run('extension-types', process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'scratch/gap-hunt/consumer-dx/tsconfig.current-output.json']);
const cases = [
  { id: '162', workspace: '@microdelta/tracking', file: 'gap-hunt-contracts-intrinsic-presence', failed: 9, passed: 2, pending: 0 },
  { id: '164-input', workspace: 'microdelta', file: 'gap-hunt-contracts-output', pattern: 'scalar-only output|base → base', failed: 1, passed: 1, pending: 7 },
  { id: '164-bindings', workspace: 'microdelta', file: 'gap-hunt-dx-output-bindings', failed: 2, passed: 2, pending: 0 },
];
for (const item of cases) {
  const resultFile = root + base + `local-${item.id}-results.json`;
  await run(item.id, 'npm', ['run', 'test:unit', '-w', item.workspace, '--', '--runTestsByPath', `.test-build/test/${item.file}.test.js`, ...('pattern' in item ? ['--testNamePattern', item.pattern] : []), '--json', '--outputFile', resultFile], 1);
  const result = JSON.parse(await readFile(resultFile, 'utf8'));
  assert.equal(result.numRuntimeErrorTestSuites, 0);
  assert.deepEqual([result.numFailedTests, result.numPassedTests, result.numPendingTests], [item.failed, item.passed, item.pending], item.id);
}
await run('tracking-check', 'npm', ['run', 'check', '-w', '@microdelta/tracking']);
await run('core-check', 'npm', ['run', 'check', '-w', 'microdelta']);
await run('consumer-lint', process.execPath, ['node_modules/eslint/bin/eslint.js', '--no-ignore', '--config', 'scratch/gap-hunt/consumer-dx/eslint.current-output.config.mjs', 'scratch/gap-hunt/consumer-dx/output-bindings.ts']);
await writeFile(root + base + 'local-replay-summary.json', JSON.stringify({ runtime: process.version, productionBaseline: 'f43c5872987573d9b98a19f41c324b4d9336894c', checks, expectedRedCounts: cases.map(({ id, failed, passed, pending }) => ({ id, failed, passed, pending })) }, null, 2) + '\n');
console.log('Original #162/#164 expectations remain red with all five positive controls passing.');
