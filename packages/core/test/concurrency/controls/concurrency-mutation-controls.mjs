/**
 * Behavioral discrimination controls for the M5 concurrency suites. Each
 * control in `controls.mjs` plants exactly one weakened writer guard into
 * History's emitted build, reruns the unchanged interleaving and contention
 * suites, and records which named tests fail; the emitted file is restored
 * afterwards and the restored build must pass every test. A control whose
 * anchor does not match exactly once, or that no test rejects, fails the run.
 * Every Jest run is judged fail-closed by `control-outcome.mjs` against
 * exactly the two concurrency suites. The planted file is restored after each
 * control, on error and on SIGINT/SIGTERM/SIGHUP, and its final bytes are
 * compared with the original; rebuilding History restores it after a SIGKILL.
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
import { controls, repositoryRoot, suites, target } from './controls.mjs';

const file = join(repositoryRoot, target);
const core = join(repositoryRoot, 'packages/core');
const original = readFileSync(file, 'utf8');

/** Restore the planted file. */
function restore() {
  writeFileSync(file, original);
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
    console.log(`INTERRUPTED by ${signal}; emitted file restored`);
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
    const count = original.split(control.anchor).length - 1;
    if (count !== 1) {
      console.log(`ANCHOR ${String(count)}x: ${control.name}`);
      failures += 1;
      continue;
    }
    writeFileSync(file, original.replace(control.anchor, control.replacement));
    try {
      const { failed } = await runSuites(baseline.titles);
      console.log(`\n## ${control.name} (model fault ${control.fault}): ${String(failed.length)} failing`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0) failures += 1;
    } finally {
      restore();
    }
    if (readFileSync(file, 'utf8') !== original) {
      throw new Error(`${target} was not restored after ${control.name}`);
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
if (readFileSync(file, 'utf8') !== original) {
  console.log(`NOT RESTORED: ${target}`);
  failures += 1;
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${String(controls.length)} controls`);
process.exit(failures > 0 ? 1 : 0);
