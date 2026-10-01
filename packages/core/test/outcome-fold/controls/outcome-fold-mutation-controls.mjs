/**
 * Negative controls for the outcome-fold evidence (issue #120, planned
 * evidence `outcome-fold-coverage`). Each control plants exactly one wrong
 * behavior into an owner's emitted production build (never TypeScript
 * source), Reuse Resolution or Run Supervision, and reruns the unchanged
 * outcome-fold suites (in-process, nested run operations and separate-process), whose
 * workspaces and worker processes load those builds through the built facade.
 * Every control names the planned evidence cases (the suites' `describe`
 * titles) it is predicted to break, written from the owning contract before
 * the control ran; a control fails the run when any predicted case still
 * passes, when no test fails at all, or when any of its anchors does not
 * match exactly once. Each Jest run is judged fail-closed by the facade's
 * shared `control-outcome.mjs` against exactly the three outcome-fold suites.
 * Every planted file is restored after its control, on error, and on
 * SIGINT/SIGTERM/SIGHUP, and final bytes are compared with the originals.
 *
 * On-demand evidence command, not part of `npm test`: run `npm run build` and
 * `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/outcome-fold/controls/outcome-fold-mutation-controls.mjs`.
 *
 * `--check-anchors` verifies that every anchor matches exactly once in the
 * current builds and exits without running any suite; `npm test` runs it for
 * every runner (anchor-check.test.mjs) so drift fails early.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { anchorCheckRequested, reportAnchorCheck } from '../../durable-history/controls/anchor-check.mjs';
import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';
import { repositoryRoot } from '../../acceptance/controls/paths.mjs';

const root = repositoryRoot(import.meta.url);

/** Emitted production files a control may plant into. */
const targets = Object.freeze({
  resolution: join(root, 'packages/resolution/dist/src/resolution.js'),
  supervision: join(root, 'packages/supervision/dist/src/supervision.js'),
});

/** The outcome-fold suite files every run must execute. */
const suites = Object.freeze(['outcome-fold.test.js', 'nested-run-operations.test.js', 'restart.test.js']);

/** The planned evidence cases: the suites' `describe` titles. */
const cases = Object.freeze({
  completeness: 'completeness: never complete while anything is unsettled (acceptance 1)',
  settled: 'settled statuses with coverage (acceptance 1, 3)',
  repair: 'repair makes the outcome fold reconsider (acceptance 2)',
  separation: 'separation from strict folds (acceptance 3)',
  stop: 'stop interactions (RUN-014)',
  nested: 'nested run operations are undeclared calls (CMP-9, RUN-002)',
  processes: 'outcome-fold-coverage',
});

/**
 * One planted defect per control, with the planned evidence cases predicted
 * to reject it. Predictions follow from the owning contracts, not from a run.
 */
const controls = [
  {
    name: 'a pending member counts as settled, so the fold claims a complete set while work is unsettled',
    target: 'resolution',
    anchor: "if (openDiscovery || pending.length > 0) {\n            return { status: 'waiting', coverage: incompleteCoverage(",
    replacement: "if (openDiscovery) {\n            return { status: 'waiting', coverage: incompleteCoverage(",
    breaks: [cases.completeness],
  },
  {
    name: 'open discovery counts as closed, so the fold claims a complete set while discovery is unsettled',
    target: 'resolution',
    anchor: "if (openDiscovery || pending.length > 0) {\n            return { status: 'waiting', coverage: incompleteCoverage(",
    replacement: "if (pending.length > 0) {\n            return { status: 'waiting', coverage: incompleteCoverage(",
    breaks: [cases.completeness],
  },
  {
    name: 'a failed member is treated as unsettled, so the fold never folds a failure',
    target: 'resolution',
    anchor: "membership.push(Object.freeze({ key, status: 'failed' }));\n                continue;",
    replacement: 'pending.push(key);\n                continue;',
    breaks: [cases.settled, cases.repair, cases.separation, cases.processes],
  },
  {
    name: 'a cancelled member is treated as pending, so a stopped run waits instead of settling it for that run',
    target: 'resolution',
    anchor: "if (result.disposition === 'cancelled') {\n                        membership.push(Object.freeze({ key, status: 'cancelled' }));",
    replacement: "if (false) {\n                        membership.push(Object.freeze({ key, status: 'cancelled' }));",
    breaks: [cases.settled, cases.stop],
  },
  {
    name: 'coverage omits failed members',
    target: 'resolution',
    anchor: "failed: keysOf('failed'),",
    replacement: 'failed: Object.freeze([]),',
    breaks: [cases.settled, cases.repair, cases.separation, cases.processes],
  },
  {
    name: 'a fold ignores its recorded membership fact, so repairing a failure never reconsiders it',
    target: 'resolution',
    anchor: 'const change = membershipChange(recorded.membership, membership);',
    replacement: 'const change = undefined;',
    breaks: [cases.repair, cases.processes],
  },
  {
    name: 'a cancelled member that now succeeds is not a membership change',
    target: 'resolution',
    anchor: 'else if (was !== status) {',
    replacement: "else if (was !== status && !(was === 'cancelled' && status === 'included')) {",
    breaks: [cases.settled],
  },
  {
    name: 'strict and outcome fold results are interchangeable candidates',
    target: 'resolution',
    anchor: "if (provenance.kind !== declaration.kind || (provenance.kind !== 'fold' && provenance.kind !== 'outcome-fold')) {",
    replacement: "if (provenance.kind !== 'fold' && provenance.kind !== 'outcome-fold') {",
    breaks: [cases.separation],
  },
  {
    name: 'nested run operation not refused',
    target: 'supervision',
    anchor: 'if (!state.open || caller === undefined || (caller.attempt === undefined && caller.lane === undefined)) {',
    replacement: 'if (true) {',
    breaks: [cases.nested],
  },
  {
    name: 'a closed run reports undeclared-call instead of run-closed',
    target: 'supervision',
    anchor: 'if (!state.open || caller === undefined || (caller.attempt === undefined && caller.lane === undefined)) {',
    replacement: 'if (caller === undefined || (caller.attempt === undefined && caller.lane === undefined)) {',
    breaks: [cases.nested],
  },
  {
    name: 'only a step attempt is refused, not member work',
    target: 'supervision',
    anchor: 'if (!state.open || caller === undefined || (caller.attempt === undefined && caller.lane === undefined)) {',
    replacement: 'if (!state.open || caller === undefined || caller.attempt === undefined) {',
    breaks: [cases.nested],
  },
];

/** The edits one control applies. */
function editsOf(control) {
  return control.edits ?? [{ target: control.target, anchor: control.anchor, replacement: control.replacement }];
}

/** Original bytes of every target. */
const originals = new Map(Object.values(targets).map((file) => [file, readFileSync(file, 'utf8')]));

/**
 * Plan every edit of a control against the original bytes: the planted file
 * contents, or the first anchor that does not match exactly once (a control
 * with any bad anchor plants nothing).
 */
function planControl(control) {
  const planted = new Map();
  for (const edit of editsOf(control)) {
    const file = targets[edit.target];
    const current = planted.get(file) ?? originals.get(file);
    const matches = current.split(edit.anchor).length - 1;
    if (matches !== 1) {
      return { error: `ANCHOR ${String(matches)}x in ${edit.target}: ${control.name}` };
    }
    planted.set(file, current.replace(edit.anchor, () => edit.replacement));
  }
  return { planted };
}

// Drift guard: `--check-anchors` plans every control against the current builds and runs no suite.
if (anchorCheckRequested()) {
  const problems = controls.flatMap((control) => {
    const { error } = planControl(control);
    return error === undefined ? [] : [error];
  });
  process.exit(reportAnchorCheck(problems, controls.length));
}

/** Restore every target. */
function restoreAll() {
  for (const [file, content] of originals) {
    writeFileSync(file, content);
  }
}

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

/** Run the outcome-fold suites once and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'outcome-fold-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', join(root, 'packages/core/jest.config.mjs'), '--runInBand', '--forceExit', '--json', `--outputFile=${out}`, '.test-build/test/outcome-fold/'], { cwd: join(root, 'packages/core'), stdio: 'ignore' });
      running.on('error', reject);
      running.on('exit', (code) => resolve(code));
    });
    running = undefined;
    return judgeRun({ exitStatus, reportText: existsSync(out) ? readFileSync(out, 'utf8') : undefined, expectedTitles, suites });
  } finally {
    rmSync(directory, { recursive: true, force: true });
    reportDirectory = undefined;
  }
}

/** Whether a failing test title belongs to one planned evidence case (its `describe` title). */
function inCase(title, name) {
  return title.startsWith(`${name} `);
}

let failures = 0;
try {
  const baseline = await runSuites(undefined);
  console.log(`baseline: ${String(baseline.titles.size)} tests, ${String(baseline.failed.length)} failing`);
  if (baseline.failed.length > 0) {
    throw new Error('the unmodified builds must pass every outcome-fold test before controls run');
  }
  for (const control of controls) {
    const { planted, error } = planControl(control);
    if (error !== undefined) {
      console.log(error);
      failures += 1;
      continue;
    }
    for (const [file, content] of planted) {
      writeFileSync(file, content);
    }
    try {
      const { failed } = await runSuites(baseline.titles);
      const unbroken = control.breaks.filter((name) => !failed.some((title) => inCase(title, name)));
      console.log(`\n## ${control.name}: ${String(failed.length)} failing${unbroken.length === 0 ? '' : `; PREDICTED CASES STILL PASSING: ${unbroken.join(', ')}`}`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0 || unbroken.length > 0) failures += 1;
    } finally {
      for (const file of planted.keys()) {
        writeFileSync(file, originals.get(file));
      }
    }
    for (const file of planted.keys()) {
      if (readFileSync(file, 'utf8') !== originals.get(file)) {
        throw new Error(`${file} was not restored after ${control.name}`);
      }
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
  if (readFileSync(file, 'utf8') !== content) {
    console.log(`NOT RESTORED: ${file}`);
    failures += 1;
  }
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${String(controls.length)} controls`);
process.exit(failures > 0 ? 1 : 0);
