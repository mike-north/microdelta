/**
 * Behavioral discrimination controls for History's operation journal,
 * environment namespaces and recorded promotion. Each control plants one
 * weakened guarantee into History's emitted build (never its TypeScript
 * source), runs the unchanged journal suites (`packages/core/test/journal`),
 * and records which named tests fail; the emitted files are restored
 * afterwards and the restored build must pass every test. A control whose
 * anchor does not match exactly once, or that no test rejects, fails the run.
 * Every Jest run is judged fail-closed by `control-outcome.mjs` against
 * exactly the three journal suites. Planted files are restored after each
 * control, on error and on SIGINT/SIGTERM/SIGHUP, and their final bytes are
 * compared with the originals; rebuilding History restores them after a SIGKILL.
 *
 * It is an on-demand evidence command, not part of `npm test`: run
 * `npm run build` and `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/durable-history/controls/journal-mutation-controls.mjs`.
 * Controls must run serially.
 *
 * `--check-anchors` verifies that every anchor matches exactly once in the
 * current builds and exits without running any suite; `npm test` runs it for
 * every runner (anchor-check.test.mjs) so drift fails early.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { anchorCheckRequested, reportAnchorCheck } from './anchor-check.mjs';
import { judgeRun } from './control-outcome.mjs';

const root = new URL('../../../../../', import.meta.url).pathname;
const dist = join(root, 'packages/history/dist/src/durable');
const core = join(root, 'packages/core');

/** The journal suite files every control run must execute, and no others. */
const suites = Object.freeze(['journal.test.js', 'environments.test.js', 'processes.test.js']);

/**
 * One planted defect per control, possibly spanning several emitted files.
 * Every plant's anchor must occur exactly once in its file.
 */
const controls = [
  {
    name: 'journal commit skips the writer fence and lease check',
    plants: [{ file: 'journal.js', anchor: 'return asHolder(lease, () => {', replacement: 'return connection.transaction(() => {' }],
  },
  {
    name: 'journal commit ignores compare-and-set expectations',
    plants: [{ file: 'journal.js', anchor: 'if (current !== expectedRevision) {', replacement: 'if (false) {' }],
  },
  {
    name: 'a write under another format mints a parallel record in the same collection',
    plants: [
      {
        file: 'journal.js',
        anchor: `const revisions = writes.map(({ address, expectedRevision }) => {
                            const row = currentRow(address);`,
        replacement: `const revisions = writes.map(({ address, expectedRevision, record }) => {
                            const found = currentRow(address);
                            const row = found !== undefined && text(found, 'format') !== record.format ? undefined : found;`,
      },
      {
        file: 'schema.js',
        anchor: 'PRIMARY KEY (analysis, environment, collection, journal_key, revision)',
        replacement: 'PRIMARY KEY (analysis, environment, collection, journal_key, format, revision)',
      },
    ],
  },
  {
    name: 'journal lookups ignore the environment namespace',
    plants: [{ file: 'journal.js', anchor: 'WHERE analysis = ? AND environment = ? AND collection = ? AND journal_key = ? ORDER BY revision DESC LIMIT 1', replacement: 'WHERE analysis = ? AND (environment = ? OR 1) AND collection = ? AND journal_key = ? ORDER BY revision DESC LIMIT 1' }],
  },
  {
    name: 'candidate lookup ignores the environment namespace',
    plants: [{ file: 'index.js', anchor: 'AND (r.environment = ? OR EXISTS', replacement: 'AND (r.environment = ? OR 1 OR EXISTS' }],
  },
  {
    name: 'acceptance reads ignore the environment namespace',
    plants: [
      { file: 'index.js', anchor: 'WHERE result_id = ? AND environment = ? ORDER BY acceptance_id', replacement: 'WHERE result_id = ? AND (environment = ? OR 1) ORDER BY acceptance_id' },
      { file: 'index.js', anchor: "if (text(row, 'environment') !== scope.environment) {", replacement: 'if (false) {' },
    ],
  },
  {
    name: 'the accepting environment is inferred from the reference',
    plants: [{ file: 'index.js', anchor: 'if (environment === published.environment) {', replacement: 'if (true) {' }],
  },
  {
    name: 'candidate lookup never admits promoted results',
    plants: [{ file: 'index.js', anchor: 'AND p.analysis = r.analysis AND p.environment = ?))', replacement: 'AND p.analysis = r.analysis AND p.environment = ? AND 0))' }],
  },
  {
    name: 'every result counts as promoted into every environment',
    plants: [{ file: 'index.js', anchor: 'return statements.promoted.get(resultId, scope.analysis, scope.environment) !== undefined;', replacement: 'return true;' }],
  },
  {
    name: 'the journal sequence is not persisted',
    plants: [{ file: 'journal.js', anchor: 'statements.setSequence.run(sequence);', replacement: 'void 0;' }],
  },
  {
    name: 'the promotion sequence is not persisted',
    plants: [{ file: 'index.js', anchor: 'statements.setPromotionSequence.run(promotionId);', replacement: 'void 0;' }],
  },
];

/** Emitted files a control may plant into, with their original bytes. */
const originals = new Map([...new Set(controls.flatMap((control) => control.plants.map((plant) => plant.file)))].map((file) => [file, readFileSync(join(dist, file), 'utf8')]));

/** Restore every emitted file a control may have planted into. */
function restoreAll() {
  for (const [file, content] of originals) {
    writeFileSync(join(dist, file), content);
  }
}

/** The Jest child currently running and its report directory, so a signal can stop and remove them. */
let running;
let reportDirectory;

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

/** Run the journal suites once in a fresh temporary directory and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'journal-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--json', `--outputFile=${out}`, '.test-build/test/journal'], { cwd: core, stdio: 'ignore' });
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

/** Apply every plant of one control to the original bytes, or report the first anchor that does not match exactly once. */
function planted(control) {
  const files = new Map();
  for (const plant of control.plants) {
    const current = files.get(plant.file) ?? originals.get(plant.file);
    const count = current.split(plant.anchor).length - 1;
    if (count !== 1) {
      return { error: `ANCHOR ${String(count)}x in ${plant.file}: ${control.name}` };
    }
    files.set(plant.file, current.replace(plant.anchor, plant.replacement));
  }
  return { files };
}

// Drift guard: `--check-anchors` plans every control against the current build and runs no suite.
if (anchorCheckRequested()) {
  const problems = controls.flatMap((control) => {
    const { error } = planted(control);
    return error === undefined ? [] : [error];
  });
  process.exit(reportAnchorCheck(problems, controls.length));
}

let failures = 0;
try {
  const baseline = await runSuites(undefined);
  console.log(`baseline: ${String(baseline.titles.size)} tests, ${String(baseline.failed.length)} failing`);
  if (baseline.failed.length > 0) {
    throw new Error('the unmodified build must pass every test before controls run');
  }
  for (const control of controls) {
    const plan = planted(control);
    if (plan.error !== undefined) {
      console.log(plan.error);
      failures += 1;
      continue;
    }
    for (const [file, content] of plan.files) {
      writeFileSync(join(dist, file), content);
    }
    try {
      const { failed } = await runSuites(baseline.titles);
      console.log(`\n## ${control.name}: ${String(failed.length)} failing`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0) failures += 1;
    } finally {
      restoreAll();
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
