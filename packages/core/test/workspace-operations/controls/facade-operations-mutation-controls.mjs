/**
 * Behavioral discrimination controls for the facade's operational surface
 * and the example's paid-like assessor (issue #121). Each control plants
 * exactly one wrong behavior into emitted builds (never TypeScript source):
 * the facade's workspace module, both in its test build (which the facade's
 * operations suite imports) and in its `dist` (which the example's installed
 * `microdelta` resolves to), Run Supervision's `dist` (which both resolve
 * to), or the example's own `dist`. It then runs the
 * unchanged suites (the facade's `workspace-operations` Jest suite and the
 * example's spawned-process `paid.test.mjs`) and records which named tests
 * fail. A control whose anchor does not match exactly once in every planted
 * file, or that no test rejects, fails the run. Jest runs are judged
 * fail-closed by the facade's shared `control-outcome.mjs`; the example's
 * `node --test` run is judged by its TAP results against the baseline titles.
 * Every planted file is restored after its control, on error, and on
 * SIGINT/SIGTERM/SIGHUP, and the final bytes are compared with the originals.
 * A SIGKILL cannot be intercepted; rebuilding restores the files.
 *
 * It is an on-demand evidence command, not part of `npm test`: run
 * `npm run build` and `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/workspace-operations/controls/facade-operations-mutation-controls.mjs`.
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

import { anchorCheckRequested, anchorProblems, reportAnchorCheck } from '../../durable-history/controls/anchor-check.mjs';
import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';

const root = new URL('../../../../../', import.meta.url).pathname;
const core = join(root, 'packages/core');

/** Emitted files a control plants into, per target; each must contain the anchor exactly once. */
const targets = Object.freeze({
  facade: [join(core, '.test-build/src/workspace.js'), join(core, 'dist/src/workspace.js')],
  supervision: [join(root, 'packages/supervision/dist/src/supervision.js')],
  assessment: [join(root, 'examples/contribution-report/dist/assessment.js')],
  main: [join(root, 'examples/contribution-report/dist/main.js')],
});

/** The facade suite file every Jest run must execute. */
const suites = Object.freeze(['operations.test.js', 'async-supplied.test.js']);

const controls = [
  {
    name: 'the facade mints the same run identifier for every run',
    target: 'facade',
    anchor: 'const runId = runOptions.runId ?? `run:${random.randomIdentifier()}`;',
    replacement: "const runId = runOptions.runId ?? `run:${'0'.repeat(32)}`;",
  },
  {
    name: 'a caller may supply a run identifier in the facade\'s reserved minted form',
    target: 'facade',
    anchor: '|| mintedRunIdentifierRule.test(callerRunId))',
    replacement: '|| false)',
  },
  {
    name: 'a workspace given Accounting supplies no operation ports to its runs',
    target: 'facade',
    anchor: '...(operations === undefined ? {} : { operations }),',
    replacement: '...({}),',
  },
  {
    name: 'the deferral mode is not passed to Supervision',
    target: 'facade',
    anchor: '...(runOptions.deferral === undefined ? {} : { deferral: runOptions.deferral }),',
    replacement: '...({}),',
  },
  {
    name: 'the usage summary reads a fixed environment instead of the run\'s own',
    target: 'facade',
    anchor: 'return accounting.summarizeUsage({ ...filter, environment: live.context.environment });',
    replacement: "return accounting.summarizeUsage({ ...filter, environment: 'env:production' });",
  },
  {
    name: 'the facade does not hand History to Supervision as the promotion port',
    target: 'facade',
    anchor: 'promotion: history,',
    replacement: 'promotion: undefined,',
  },
  {
    name: 'a promotion targets the run\'s own environment instead of the requested one',
    target: 'supervision',
    anchor: 'target: { analysis: context.analysis, environment: valid.into },',
    replacement: 'target: { analysis: context.analysis, environment: context.environment },',
  },
  {
    name: 'a promotion takes the writer lease without waiting for another holder',
    target: 'supervision',
    anchor: 'const promotionLease = await writerLease();',
    replacement: 'const promotionLease = await awaitWriter({ writer, policy: { deadline: 0, pollMilliseconds: 1 }, timer, stop: state.stopped.signal, runId: context.runId });',
  },
  {
    name: 'stop intent is not checked before the promotion commit',
    target: 'supervision',
    anchor: "if (state.stopped.signal.aborted) {\n                        throw new SupervisionError('stopped', `Run ${context.runId} is stopped: it records no promotion`);",
    replacement: "if (false) {\n                        throw new SupervisionError('stopped', `Run ${context.runId} is stopped: it records no promotion`);",
  },
  {
    name: 'the paid-like assessment is declared safe to repeat, so a lost response is replayed',
    target: 'assessment',
    anchor: "name: 'assess',",
    replacement: "name: 'assess', safeToRepeat: true, retry: { maxAttempts: 3 },",
  },
  {
    name: 'a first interrupt requests a hard stop instead of a soft one',
    target: 'main',
    anchor: "stop.request({ level: interrupts === 1 ? 'soft' : 'hard' });",
    replacement: "stop.request({ level: 'hard' });",
  },
  {
    name: 'a promotion names only the report, not the results it rests on',
    target: 'main',
    anchor: 'references: [...references.values()],',
    replacement: 'references: [folded.outcome.outcome.reference],',
  },
];

/** The original bytes of every target file. */
const originals = new Map(Object.values(targets).flat().map((file) => [file, readFileSync(file, 'utf8')]));

// Drift guard: `--check-anchors` verifies every anchor in every file it plants into and runs no suite.
if (anchorCheckRequested()) {
  const plants = controls.flatMap((control) => targets[control.target].map((file) => ({ control: control.name, file, text: originals.get(file), anchor: control.anchor })));
  process.exit(reportAnchorCheck(anchorProblems(plants), controls.length));
}

/** Restore every target file. */
function restoreAll() {
  for (const [file, content] of originals) {
    writeFileSync(file, content);
  }
}

/** The child currently running and its report directory, so a signal can stop and remove them. */
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

/** Spawn one child and resolve its exit code, capturing stdout. */
function spawnChild(args, cwd) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    running = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    running.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    running.on('error', reject);
    running.on('exit', (code) => {
      running = undefined;
      resolve({ code, stdout });
    });
  });
}

/** Run the facade's operations suite and judge it fail-closed. A planted defect may leave a run sleeping, so Jest is forced to exit. */
async function runFacade(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'facade-operations-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const { code } = await spawnChild(['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--forceExit', '--testTimeout=15000', '--json', `--outputFile=${out}`, '--runTestsByPath', ...suites.map((suite) => `.test-build/test/workspace-operations/${suite}`)], core);
    return judgeRun({ exitStatus: code, reportText: existsSync(out) ? readFileSync(out, 'utf8') : undefined, expectedTitles, suites });
  } finally {
    rmSync(directory, { recursive: true, force: true });
    reportDirectory = undefined;
  }
}

/** Run the example's paid-like assessor verification and judge its TAP results fail-closed. */
async function runExample(expectedTitles) {
  const { code, stdout } = await spawnChild(['--test', '--test-reporter=tap', 'examples/contribution-report/test/paid.test.mjs'], root);
  if (code !== 0 && code !== 1) {
    throw new Error(`abnormal example exit ${String(code)}`);
  }
  const results = [...stdout.matchAll(/^(ok|not ok) \d+ - (.+)$/gmu)].map((match) => ({ status: match[1], title: match[2].trim() }));
  const titles = new Set(results.map((result) => result.title));
  if (results.length === 0 || titles.size !== results.length) {
    throw new Error('the example run reported no trustworthy results');
  }
  if (expectedTitles !== undefined && (titles.size !== expectedTitles.size || [...titles].some((title) => !expectedTitles.has(title)))) {
    throw new Error('example test titles differ from the baseline');
  }
  const failed = results.filter((result) => result.status === 'not ok').map((result) => result.title);
  if ((code === 0) !== (failed.length === 0)) {
    throw new Error(`example exit ${String(code)} disagrees with ${String(failed.length)} failing tests`);
  }
  return { titles, failed };
}

/** Run both suites once; `baseline` holds the expected titles per suite. */
async function runAll(baseline) {
  const facade = await runFacade(baseline?.facade);
  const example = await runExample(baseline?.example);
  return {
    titles: { facade: facade.titles, example: example.titles },
    failed: [...facade.failed.map((title) => `facade: ${title}`), ...example.failed.map((title) => `example: ${title}`)],
  };
}

let failures = 0;
try {
  const baseline = await runAll(undefined);
  console.log(`baseline: ${String(baseline.titles.facade.size + baseline.titles.example.size)} tests, ${String(baseline.failed.length)} failing`);
  if (baseline.failed.length > 0) {
    throw new Error('the unmodified builds must pass every test before controls run');
  }
  for (const control of controls) {
    const files = targets[control.target];
    const unmatched = files.filter((file) => originals.get(file).split(control.anchor).length - 1 !== 1);
    if (unmatched.length > 0) {
      console.log(`ANCHOR not matched exactly once in ${unmatched.join(', ')}: ${control.name}`);
      failures += 1;
      continue;
    }
    for (const file of files) {
      writeFileSync(file, originals.get(file).replace(control.anchor, control.replacement));
    }
    try {
      const { failed } = await runAll(baseline.titles);
      console.log(`\n## ${control.name}: ${String(failed.length)} failing`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0) failures += 1;
    } finally {
      for (const file of files) {
        writeFileSync(file, originals.get(file));
      }
    }
    if (files.some((file) => readFileSync(file, 'utf8') !== originals.get(file))) {
      throw new Error(`${control.target} was not restored after ${control.name}`);
    }
  }
  const restored = await runAll(baseline.titles);
  console.log(`\nrestored: ${String(restored.failed.length)} failing`);
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
