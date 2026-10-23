/** Linux-portable, clean-checkout reproducer: install, build declarations, compile and run one focused suite. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const suites = {
  '155': { workspace: 'microdelta', test: 'gap-hunt-contracts-container-guard', types: false },
  '156': { workspace: 'microdelta', test: 'gap-hunt-contracts-scalar-roots', types: true },
  'operations': { workspace: 'microdelta', test: 'gap-hunt-contracts-operation-matrix', types: false },
  'edge': { workspace: 'microdelta', test: 'gap-hunt-contracts-edge-oracle', types: false },
  'durable-output-minimal': { workspace: 'microdelta', test: 'gap-hunt-contracts-output', types: false, pattern: 'scalar-only output|base → base' },
  'durable-output': { workspace: 'microdelta', test: 'gap-hunt-contracts-output', types: false },
  'output': { workspace: '@microdelta/tracking', test: 'gap-hunt-contracts-output', types: false },
  'intrinsic': { workspace: '@microdelta/tracking', test: 'gap-hunt-contracts-intrinsic-presence', types: false },
  'async': { workspace: '@microdelta/tracking', test: 'gap-hunt-contracts-async', types: false },
  'nested': { workspace: 'microdelta', test: 'gap-hunt-contracts-nested-current', types: false },
  'capture-lint': { probe: 'transitive-capture-lint-probe.mjs' },
};
const selected = suites[process.argv[2]];
if (selected === undefined) { throw new Error(`Choose ${Object.keys(suites).join(', ')}`); }
function run(command, args) {
  const child = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.signal) throw new Error(`${command} ended with ${child.signal}`);
  return child.status ?? 1;
}
const version = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
process.stderr.write(`Reproduction checkout: ${version.stdout.trim()}\n`);
for (const args of [['ci', '--no-audit', '--no-fund'], ['run', 'build']]) {
  const status = run('npm', args);
  if (status !== 0) process.exit(status);
}
if ('probe' in selected) process.exit(run(process.execPath, [`scratch/gap-hunt/contracts/${selected.probe}`]));
if (selected.types) {
  const status = run('npm', ['run', 'test:types', '--workspace', selected.workspace]);
  if (status !== 0) process.exit(status);
}
process.exit(run('npm', ['run', 'test:unit', '--workspace', selected.workspace, '--', '--runTestsByPath', `.test-build/test/${selected.test}.test.js`, ...('pattern' in selected ? ['--testNamePattern', selected.pattern] : [])]));
