/**
 * Behavioral discrimination controls for History's durable authority
 * (issue #55). Each control plants exactly one wrong behavior into History's
 * emitted build (never its TypeScript source), runs the unchanged durable
 * assembly suites, and records which named tests fail; the emitted file is
 * restored afterwards and the restored build must pass every test. A control
 * whose anchor does not match exactly once, or that no test rejects, fails the
 * run. Every Jest run is judged fail-closed by `control-outcome.mjs` (whose
 * false-success cases run in `npm test`): abnormal exits, missing reports,
 * runtime suite errors, foreign or missing suites or titles, and pending or
 * skipped results are never counted as a rejection or a clean restore. Each
 * run's temporary report directory is removed in `finally`. Every planted file
 * is restored after its control, on error, and on SIGINT/SIGTERM/SIGHUP, and
 * the final bytes are compared with the originals. A SIGKILL cannot be
 * intercepted; rebuilding History restores the emitted files in that case.
 *
 * It is an on-demand evidence command, not part of `npm test`: run
 * `npm run build` and `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/durable-history/controls/history-mutation-controls.mjs`.
 * Controls must run serially.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { judgeRun } from './control-outcome.mjs';

const root = new URL('../../../../../', import.meta.url).pathname;
const dist = join(root, 'packages/history/dist/src/durable');
const core = join(root, 'packages/core');

const controls = [
  { name: 'publication ignores the fence', file: 'index.js', anchor: 'if (writer.holder !== lease.holder || writer.lastFence !== lease.fence) {', replacement: 'if (writer.holder !== lease.holder && false) {' },
  { name: 'fence equality alone is not checked', file: 'index.js', anchor: 'if (writer.holder !== lease.holder || writer.lastFence !== lease.fence) {', replacement: 'if (writer.holder !== lease.holder) {' },
  { name: 'index metadata is not validated against node kind', file: 'selected-index.js', anchor: 'if (!shapeValid || (address.length === 0) !== (metadata.valueFingerprint === null)) {', replacement: 'if (false) {' },
  { name: 'completed outcomes are never resolved (all acknowledgment paths)', file: 'index.js', anchor: 'resolveResult(attempt.result, attempt);', replacement: 'void 0;' },
  { name: 'lease expiry is not checked', file: 'index.js', anchor: 'else if (writer.expiresAt <= now) {', replacement: 'else if (false) {' },
  { name: 'clock high-water is ignored', file: 'index.js', anchor: 'const now = Math.max(reading, writer.timeHighWater);', replacement: 'const now = reading;' },
  { name: 'publication leaves the current pointer', file: 'index.js', anchor: 'statements.setCurrent.run(attempt.analysis, attempt.environment, attempt.subject, attemptId);', replacement: 'void 0;' },
  { name: 'attempt counter is not persisted (identities reissued)', file: 'index.js', anchor: 'statements.setAttemptSequence.run(attemptId);', replacement: 'void 0;' },
  { name: 'exact reads ignore stored scope', file: 'index.js', anchor: 'if (row.analysis !== parts.analysis || row.environment !== parts.environment) {', replacement: 'if (false) {' },
  { name: 'stable key ignores intent on allocation', file: 'index.js', anchor: `                    const attempt = attemptOf(existing);
                    assertSameExecution(attempt, request);`, replacement: `                    const attempt = attemptOf(existing);` },
  { name: 'recovery ignores intent', file: 'index.js', anchor: `            assertSameExecution(attempt, request);
            return recoveryOf(verifiedAttempt(attempt));`, replacement: `            return recoveryOf(verifiedAttempt(attempt));` },
  { name: 'completed re-allocation skips result verification', file: 'index.js', anchor: 'return verifiedAttempt(attempt);', replacement: 'return attempt;' },
  { name: 'completed re-publication skips result verification', file: 'index.js', anchor: 'const completed = verifiedAttempt(attempt).result;', replacement: 'const completed = attempt.result;' },
  { name: 'recovery skips outcome verification', file: 'index.js', anchor: 'return recoveryOf(verifiedAttempt(attempt));', replacement: 'return recoveryOf(attempt);' },
  { name: 'attempt/result contradiction is not detected', file: 'index.js', anchor: 'else if (statements.reference.get(attempt.attemptId) !== undefined) {', replacement: 'else if (false) {' },
  { name: 'envelopes and candidates skip exact resolution', file: 'index.js', anchor: 'resolveResult(referenceOf(resultId, scope), scope);', replacement: 'void 0;' },
  { name: 'current pointer skips exact resolution', file: 'index.js', anchor: 'resolveResult(reference, subject);', replacement: 'void 0;' },
  { name: 'returned dependencies skip exact resolution', file: 'index.js', anchor: '            resolveResult(reference, scope);\n            return reference;', replacement: '            return reference;' },
  { name: 'absent members need no indexed proof of absence', file: 'selected-index.js', anchor: 'assertIndexedAbsence(resultId, best.metadata, remainder[0]);', replacement: 'void 0;' },
  { name: 'scalar leaves are not verified', file: 'selected-index.js', anchor: 'if (metadata.valueFingerprint === null || actual !== metadata.valueFingerprint) {', replacement: 'if (false) {' },
  { name: 'stored dependencies are not validated (dangling or wrong scope accepted)', file: 'index.js', anchor: 'const dependencyId = integer(row, \'dependency_id\');', replacement: 'const dependencyId = integer(row, \'dependency_id\'); return referenceOf(dependencyId, scope);' },
  { name: 'leaf reads fall back to the root payload', file: 'selected-index.js', anchor: "const row = statements.scalarPayload.get(resultId, metadata.nodeId);", replacement: "statements.payload.get(resultId); const row = statements.scalarPayload.get(resultId, metadata.nodeId);" },
  { name: 'acceptance rewinds the current pointer', file: 'index.js', anchor: 'statements.setAcceptanceSequence.run(acceptanceId);', replacement: "statements.setAcceptanceSequence.run(acceptanceId); connection.prepare('UPDATE history_current SET result_id = ? WHERE result_id IN (SELECT result_id FROM history_results WHERE analysis = ? AND environment = ? AND subject = (SELECT subject FROM history_results WHERE result_id = ?))').run(resultId, scope.analysis, scope.environment, resultId);" },
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

// A signal mid-control must not leave a planted defect in the build. Suites
// run asynchronously so the event loop stays free to deliver the signal.
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

/**
 * Run both durable suites once in a fresh temporary directory, always removed,
 * and judge the run fail-closed. Returns the failing test titles.
 */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'history-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--json', `--outputFile=${out}`, '.test-build/test/durable-history'], { cwd: core, stdio: 'ignore' });
      running.on('error', reject);
      running.on('exit', (code) => {
        resolve(code);
      });
    });
    running = undefined;
    return judgeRun({ exitStatus, reportText: existsSync(out) ? readFileSync(out, 'utf8') : undefined, expectedTitles });
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
