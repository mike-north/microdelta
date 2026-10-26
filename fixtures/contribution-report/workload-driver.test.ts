/** The actual qualification parent must preserve phase evidence when its own worker receipt protocol fails. */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'workload-driver-protocol-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

/** Copy the actual parent unchanged; only its independent child is substituted with a no-workload protocol response. */
function invokeDriver(stdout: string, exitStatus = 0): { readonly child: ReturnType<typeof spawnSync>; readonly failure: unknown } {
  const fixtureDirectory = join(directory, 'fixtures/contribution-report');
  const emittedDirectory = join(fixtureDirectory, '.test-build/fixtures/contribution-report');
  mkdirSync(emittedDirectory, { recursive: true });
  const driver = join(fixtureDirectory, 'workload-driver.mjs');
  copyFileSync(fileURLToPath(new URL('../../../workload-driver.mjs', import.meta.url)), driver);
  // Imported real helpers resolve their own public packages in the original worktree;
  // the fake worker cannot invoke a provider, open a store or perform report work.
  for (const name of ['workload-harness', 'workload-budget', 'workload-failure']) {
    symlinkSync(fileURLToPath(new URL(`./${name}.js`, import.meta.url)), join(emittedDirectory, `${name}.js`));
  }
  writeFileSync(join(emittedDirectory, 'workload-worker.js'), `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write('controlled child diagnostic'); process.exitCode = ${String(exitStatus)};\n`);
  const child = spawnSync(process.execPath, [driver, '--smoke'], { cwd: directory, encoding: 'utf8', env: { ...process.env, TMPDIR: directory }, timeout: 5_000, maxBuffer: 64 * 1_024 });
  const phaseDirectory = readdirSync(directory).find(name => name.startsWith('issue260-controlled-workload-'));
  const path = phaseDirectory === undefined ? '' : join(directory, phaseDirectory, 'cold-failure.json');
  const failure: unknown = path !== '' && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  return { child, failure };
}

describe('actual parent receipt protocol', () => {
  test.each([
    ['malformed', 'not-json\n'], ['empty', ''], ['null', 'null\n'], ['wrong shape', '{}\n'],
  ])('exit-zero %s output persists a bounded failed-phase artifact with actual process facts', (_name, stdout) => {
    const { child, failure } = invokeDriver(stdout);
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(failure).not.toBeNull();
    expect(failure).toMatchObject({ phase: 'cold', status: 'process-failed', exitStatus: 0, workerReceipt: null });
    if (typeof failure !== 'object' || failure === null) { throw new Error('missing phase failure evidence'); }
    expect(Reflect.get(failure, 'elapsedMilliseconds')).toBeGreaterThan(0);
    expect(Reflect.get(failure, 'processError')).toMatch(/^worker receipt protocol:/u);
    expect(String(Reflect.get(failure, 'processError')).length).toBeLessThanOrEqual(512);
    expect(JSON.stringify(failure).length).toBeLessThan(9_000);
    expect(String(child.stderr).length).toBeLessThan(4_000);
  });

  test('a nonzero child still persists the same artifact without fabricating unavailable child measurements', () => {
    const { child, failure } = invokeDriver('', 1);
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(1);
    expect(failure).toMatchObject({ phase: 'cold', status: 'process-failed', exitStatus: 1, processError: null, workerReceipt: null, stderrTail: 'controlled child diagnostic' });
  });
});
