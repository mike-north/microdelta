/** Linux-portable, clean-checkout reproducer: install, build declarations, compile and run one focused suite. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const suites = {
  'imported-closure': { workspace: '@microdelta/tracking', test: 'gap-hunt-contracts-imported-closure', types: false },
  'fold-observer': { workspace: 'microdelta', test: 'gap-hunt-contracts-fold-observer', types: false },
  'resolution-144': { workspace: 'microdelta', test: 'gap-hunt-contracts-resolution-144', types: false, controls: true },
  '155': { workspace: 'microdelta', test: 'gap-hunt-contracts-container-guard', types: false },
  '156': { workspace: 'microdelta', test: 'gap-hunt-contracts-scalar-roots', types: true },
  'falsey-guard': { workspace: 'microdelta', test: 'gap-hunt-contracts-operation-matrix', types: false, pattern: 'falsey guard values' },
  'dedup-expiry': { workspace: 'microdelta', test: 'gap-hunt-contracts-dedup-expiry', types: false },
  'cost': { workspace: 'microdelta', test: 'gap-hunt-contracts-cost', types: true },
  'early-stop': { workspace: 'microdelta', test: 'gap-hunt-contracts-operation-matrix', types: false, pattern: 'COL-4 early termination' },
  'precedence': { workspace: 'microdelta', test: 'gap-hunt-contracts-precedence', types: false },
  'operations': { workspace: 'microdelta', test: 'gap-hunt-contracts-operation-matrix', types: false },
  'edge': { workspace: 'microdelta', test: 'gap-hunt-contracts-edge-oracle', types: false },
  'durable-output-minimal': { workspace: 'microdelta', test: 'gap-hunt-contracts-output', types: false, pattern: 'scalar-only output|base → base' },
  'durable-output': { workspace: 'microdelta', test: 'gap-hunt-contracts-output', types: false },
  'output': { workspace: '@microdelta/tracking', test: 'gap-hunt-contracts-output', types: false },
  'intrinsic': { workspace: '@microdelta/tracking', test: 'gap-hunt-contracts-intrinsic-presence', types: false },
  'async': { workspace: '@microdelta/tracking', test: 'gap-hunt-contracts-async', types: false },
  'multihop': { workspace: 'microdelta', test: 'gap-hunt-contracts-multihop', types: false },
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
if ('controls' in selected) {
  const status = run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/core/tsconfig.test.json']);
  if (status !== 0) process.exit(status);
  process.exit(run(process.execPath, ['scratch/gap-hunt/contracts/resolution-gap-controls.mjs', '--focused']));
}
if (selected.types) {
  const status = run('npm', ['run', 'test:types', '--workspace', selected.workspace]);
  if (status !== 0) process.exit(status);
}
process.exit(run('npm', ['run', 'test:unit', '--workspace', selected.workspace, '--', '--runTestsByPath', `.test-build/test/${selected.test}.test.js`, ...('pattern' in selected ? ['--testNamePattern', selected.pattern] : [])]));
