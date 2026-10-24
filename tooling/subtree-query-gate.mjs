/**
 * Execute the candidate History subtree query through the actual facade and
 * Node SQLite adapter, then count VM work over the captured SQL, schema and
 * listing rows. Each invocation creates a fresh store and capture so stale
 * proof cannot qualify a changed implementation.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** One fresh evidence directory shared by real Node execution and SQL work counting. */
const workDir = mkdtempSync(join(tmpdir(), 'microdelta-subtree-query-'));

/** Run a gate phase with inherited diagnostics and fail on its exact status. */
function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: environment });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('node', ['node_modules/typescript/bin/tsc', '-p', 'tooling/subtree-query/tsconfig.json']);
run('node', ['node_modules/eslint/bin/eslint.js', '--config', 'tooling/subtree-query/eslint.config.mjs', 'tooling/subtree-query/probe.test.ts']);
run('node', ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'tooling/subtree-query/jest.config.mjs', '--runInBand'], { ...process.env, SUBTREE_WORK_DIR: workDir });
run('python3', ['tooling/subtree-query/sql-work.py', join(workDir, 'production-captures.json')]);
// Rebind a copy of the same listing to another result ID so controls cannot rely on fixture identity 1.
run('python3', ['tooling/subtree-query/test_remapped_result.py', join(workDir, 'production-captures.json')]);
console.log(`Selected-subtree evidence: ${workDir}`);
