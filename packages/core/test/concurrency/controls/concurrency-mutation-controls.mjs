/**
 * Behavioral discrimination controls for the M5 concurrency suites. Each
 * control in `controls.mjs` plants exactly one weakened guard into its
 * target's emitted build (History's lease authority or Run Supervision's
 * writer wait), reruns the unchanged interleaving and contention suites, and
 * records which named tests fail; the emitted file is restored afterwards and
 * the restored build must pass every test. A control whose anchors do not
 * each match exactly once, or that no test rejects, fails the run. Every Jest
 * run is judged fail-closed by `control-outcome.mjs` against exactly the two
 * concurrency suites. Every target is restored after each control, on error
 * and on SIGINT/SIGTERM/SIGHUP, and its final bytes are compared with the
 * original; rebuilding the package restores it after a SIGKILL.
 *
 * On-demand evidence command, not part of `npm test`: run `npm run build` and
 * `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/concurrency/controls/concurrency-mutation-controls.mjs`.
 * Controls must run serially.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';
import { controls, plant, repositoryRoot, suites, targetOf, targets } from './controls.mjs';

const core = join(repositoryRoot, 'packages/core');
/** The original emitted bytes of every target, by repository-relative path. */
const originals = new Map(targets.map((path) => [path, readFileSync(join(repositoryRoot, path), 'utf8')]));

/** Restore every target to its original bytes. */
function restore() {
  for (const [path, text] of originals) {
    writeFileSync(join(repositoryRoot, path), text);
  }
}

/** The targets whose bytes differ from the original. */
function unrestored() {
  return [...originals].filter(([path, text]) => readFileSync(join(repositoryRoot, path), 'utf8') !== text).map(([path]) => path);
}

/** The Jest child currently running and its report directory, so a signal can stop and remove them. */
let running;
let reportDirectory;

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    running?.kill('SIGKILL');
    restore();
    if (reportDirectory !== undefined) {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
    console.log(`INTERRUPTED by ${signal}; emitted files restored`);
    process.exit(130);
  });
}

/** Run both concurrency suites once, judged fail-closed; returns the failing titles. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'concurrency-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const paths = suites.map((suite) => `.test-build/test/concurrency/${suite}`);
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(repositoryRoot, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--json', `--outputFile=${out}`, ...paths], { cwd: core, stdio: 'ignore' });
      running.on('error', reject);
      running.on('exit', (code) => {
        resolve(code);
      });
    });
    running = undefined;
    return judgeRun({ exitStatus, reportText: existsSync(out) ? readFileSync(out, 'utf8') : undefined, expectedTitles, suites });
  } finally {
    rmSync(directory, { recursive: true, force: true });
    reportDirectory = undefined;
  }
}

let failures = 0;
try {
  const baseline = await runSuites(undefined);
  console.log(`baseline: ${String(baseline.titles.size)} tests, ${String(baseline.failed.length)} failing`);
  if (baseline.failed.length > 0) {
    throw new Error('the unmodified build must pass every test before controls run');
  }
  for (const control of controls) {
    const path = targetOf(control);
    const original = originals.get(path);
    let planted;
    try {
      if (original === undefined) {
        throw new Error(`${control.name}: unknown target ${path}`);
      }
      planted = plant(original, control);
    } catch (error) {
      console.log(`ANCHOR: ${error instanceof Error ? error.message : String(error)}`);
      failures += 1;
      continue;
    }
    writeFileSync(join(repositoryRoot, path), planted);
    try {
      const { failed } = await runSuites(baseline.titles);
      const model = control.model === null ? 'no model counterpart' : `${control.model} fault ${control.fault}`;
      console.log(`\n## ${control.name} (${model}; ${path}): ${String(failed.length)} failing`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0) failures += 1;
    } finally {
      restore();
    }
    if (unrestored().length > 0) {
      throw new Error(`${unrestored().join(', ')} not restored after ${control.name}`);
    }
  }
  const restored = await runSuites(baseline.titles);
  console.log(`\nrestored: ${String(restored.titles.size)} tests, ${String(restored.failed.length)} failing`);
  if (restored.failed.length > 0) failures += 1;
} catch (error) {
  console.log(`CONTROL RUN INVALID: ${error instanceof Error ? error.message : String(error)}`);
  failures += 1;
} finally {
  restore();
}
for (const path of unrestored()) {
  console.log(`NOT RESTORED: ${path}`);
  failures += 1;
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${String(controls.length)} controls`);
process.exit(failures > 0 ? 1 : 0);
