/**
 * Behavioral discrimination controls for Resource Accounting (issue #115).
 * Each control plants exactly one wrong behavior into Accounting's emitted
 * build (never its TypeScript source), runs the unchanged accounting assembly
 * suites over real Node SQLite, and records which named tests fail; the
 * emitted file is restored afterwards and the restored build must pass every
 * test. A control whose anchor does not match exactly once, or that no test
 * rejects, fails the run. Every Jest run is judged fail-closed by the facade's
 * shared `control-outcome.mjs` against exactly the accounting suites. Every
 * planted file is restored after its control, on error, and on
 * SIGINT/SIGTERM/SIGHUP, and the final bytes are compared with the originals.
 * A SIGKILL cannot be intercepted; rebuilding Accounting restores the files.
 *
 * It is an on-demand evidence command, not part of `npm test`: run
 * `npm run build` and `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/accounting/controls/accounting-mutation-controls.mjs`.
 * Controls must run serially.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';

const root = new URL('../../../../../', import.meta.url).pathname;
const dist = join(root, 'packages/accounting/dist/src');
const core = join(root, 'packages/core');

/** The accounting suite files every run must execute. */
const suites = Object.freeze(['node-conformance.test.js', 'crash-recovery.test.js', 'concurrent-read.test.js']);

const controls = [
  { name: "a sibling attempt's report covers another request attempt", file: 'sqlite/index.js', anchor: ' AND p.request_attempt = r.request_attempt', replacement: '' },
  { name: 'unreported request attempts are counted as reported (zero)', file: 'summary.js', anchor: '.filter((intent) => !intent.reported)', replacement: '.filter(() => false)' },
  { name: 'a redelivered report is recorded again', file: 'sqlite/index.js', anchor: 'const recorded = recordedReport(report.environment, report.operation, report.report);', replacement: "const recorded = undefined; statements.insertReport.run(report.environment, report.operation, report.report + '#redelivered', report.requestAttempt);" },
  { name: 'report identity is keyed globally rather than per operation', file: 'sqlite/index.js', anchor: 'const row = statements.report.get(environment, operation, report);', replacement: "const row = connection.prepare('SELECT request_attempt FROM accounting_reports WHERE environment = ? AND report = ?').get(environment, report);" },
  { name: "a report for another operation's request attempt is accepted", file: 'sqlite/index.js', anchor: "if (text(attempt, 'operation') !== report.operation) {", replacement: 'if (false) {' },
  { name: 'attribution ignores the environment', file: 'sqlite/index.js', anchor: 'SELECT 1 AS known FROM accounting_request_attempts WHERE environment = ? AND operation = ? LIMIT 1', replacement: 'SELECT 1 AS known FROM accounting_request_attempts WHERE (? IS NOT NULL) AND operation = ? LIMIT 1' },
  { name: 'estimates are summed into observed usage', file: 'sqlite/index.js', anchor: 'return summarize(factsFromRows(query.environment, rows, estimates));', replacement: 'const facts = factsFromRows(query.environment, rows, estimates); return summarize({ ...facts, reportedQuantities: [...facts.reportedQuantities, ...estimates.flatMap((estimate) => estimate.quantities)] });' },
  { name: 'an unconfirmed commit is reported as acknowledged', file: 'sqlite/index.js', anchor: 'throw new AccountingDurabilityUnknownError(', replacement: 'return outcome.value; throw new AccountingDurabilityUnknownError(' },
  { name: 'an unconfirmed commit is reported as certainly failed', file: 'sqlite/index.js', anchor: '            if (outcome === undefined) {\n                throw error;', replacement: '            if (true) {\n                throw error;' },
  { name: 'a summary takes the write lock', file: 'sqlite/index.js', anchor: 'const query = queryArgument(candidate);', replacement: 'const query = queryArgument(candidate); connection.transaction(() => undefined);' },
  { name: 'REPLACE over a recorded fact is allowed', file: 'sqlite/schema.js', anchor: 'WHEN EXISTS (SELECT 1 FROM ${table} WHERE', replacement: 'WHEN 0 AND EXISTS (SELECT 1 FROM ${table} WHERE' },
];

/** Emitted files a control may plant into, with their original bytes. */
const originals = new Map([...new Set(controls.map((control) => control.file))].map((file) => [file, readFileSync(join(dist, file), 'utf8')]));

/** Restore every emitted file a control may have planted into. */
function restoreAll() {
  for (const [file, content] of originals) {
    writeFileSync(join(dist, file), content);
  }
}

/** The Jest child currently running and its report directory, so a signal can stop and remove them. */
let running;
let reportDirectory;

// A signal mid-control must not leave a planted defect in the build.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    running?.kill('SIGKILL');
    restoreAll();
    if (reportDirectory !== undefined) {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
    console.log(`INTERRUPTED by ${signal}; emitted files restored`);
    process.exit(130);
  });
}

/** Run the accounting suites once in a fresh temporary directory and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'accounting-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--json', `--outputFile=${out}`, '.test-build/test/accounting'], { cwd: core, stdio: 'ignore' });
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
    const path = join(dist, control.file);
    const original = originals.get(control.file);
    const count = original.split(control.anchor).length - 1;
    if (count !== 1) {
      console.log(`ANCHOR ${String(count)}x: ${control.name}`);
      failures += 1;
      continue;
    }
    writeFileSync(path, original.replace(control.anchor, control.replacement));
    try {
      const { failed } = await runSuites(baseline.titles);
      console.log(`\n## ${control.name}: ${String(failed.length)} failing`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0) failures += 1;
    } finally {
      writeFileSync(path, original);
    }
    if (readFileSync(path, 'utf8') !== original) {
      throw new Error(`${control.file} was not restored after ${control.name}`);
    }
  }
  const restored = await runSuites(baseline.titles);
  console.log(`\nrestored: ${String(restored.titles.size)} tests, ${String(restored.failed.length)} failing`);
  if (restored.failed.length > 0) failures += 1;
} catch (error) {
  console.log(`CONTROL RUN INVALID: ${error instanceof Error ? error.message : String(error)}`);
  failures += 1;
} finally {
  restoreAll();
}
for (const [file, content] of originals) {
  if (readFileSync(join(dist, file), 'utf8') !== content) {
    console.log(`NOT RESTORED: ${file}`);
    failures += 1;
  }
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${String(controls.length)} controls`);
process.exit(failures > 0 ? 1 : 0);
