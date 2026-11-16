/**
 * SCD-3/4 behavioral controls. Each plant changes only the isolated emitted
 * Resolution build, then runs the complete fresh-process suite. Skipping
 * current source policy must fail the same-ID total assertion; flattening the
 * exact forwarded detail into parent evidence must fail the unconsumed-field
 * exact-reference assertion. A different failure is not discrimination proof.
 *
 * Baseline and restored builds must pass the exact same title inventory.
 * Package-load paths and complete artifact hashes are checked before each run;
 * source worktree builds are never mutated. --check-anchors participates in
 * npm test's automatic runner discovery. Run the full proof after build and
 * emitted test compilation: node packages/core/test/source-call/controls/source-call-mutation-controls.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { anchorCheckRequested, anchorProblems, reportAnchorCheck } from '../../durable-history/controls/anchor-check.mjs';
import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const sourceDist = join(root, 'packages/resolution/dist/src');

/** The fixed behavioral inventory judged for every Resolution mutation. */
const suites = Object.freeze(['source-call/restart.test.js']);

const controls = [
  {
    name: 'current dynamic source acceptance is skipped for a previous reference',
    file: 'resolution.js',
    anchor: "function currentSuppliedSourceChild(request, call) {\n        return childService.resolve",
    replacement: "function currentSuppliedSourceChild(request, call) {\n        const previous = history.findCandidates(suppliedSubject(call))[0];\n        if (previous !== undefined) { return Promise.resolve({ step: call.slot, result: { kind: 'reused', basis: 'finality', reference: previous.reference, acceptance: undefined }, evidence: newEvidence(request) }); }\n        return childService.resolve",
    breaks: 'source-call fresh-process durability same-ID changed detail refreshes and changes only consumers that observed it',
    assertion: message => /-\s+"total": 3,/u.test(message) && /\+\s+"total": 2,/u.test(message),
  },
  {
    name: 'forwarded detail is flattened into its parent observations',
    file: 'resolution.js',
    anchor: 'return Object.freeze({ data: materialization.materializeView(reference, binding) });',
    replacement: "const view = materialization.materializeView(reference, binding); if (request.kind === 'supplied-source') { tracking.snapshotOutput(view); } return Object.freeze({ data: view });",
    breaks: 'source-call fresh-process durability unconsumed refresh publishes a new source while assessment and person references remain exact',
    assertion: message => /-\s+"ada": "/u.test(message) && /\+\s+"ada": "/u.test(message),
  },
];

/** Emitted artifacts are hashed as whole files so every test run is tied to the intended plant. */
function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** The exact source-build bytes are used by the cheap anchor-only drift check. */
const sourceOriginals = new Map([...new Set(controls.map((control) => control.file))].map((file) => [file, readFileSync(join(sourceDist, file), 'utf8')]));

// Drift guard: `--check-anchors` verifies every anchor against the current build and runs no suite.
if (anchorCheckRequested()) {
  const plants = controls.map((control) => ({ control: control.name, file: join(sourceDist, control.file), text: sourceOriginals.get(control.file), anchor: control.anchor }));
  process.exit(reportAnchorCheck(anchorProblems(plants), controls.length));
}

/** The private checkout copy makes all mutation and package loading independent of the caller's build. */
const temporary = mkdtempSync(join(tmpdir(), 'source-call-controls-'));
const isolatedRoot = temporary;
for (const path of ['node_modules', 'packages']) {
  cpSync(join(root, path), join(isolatedRoot, path), { recursive: true, dereference: false, verbatimSymlinks: true });
}
cpSync(join(root, 'package.json'), join(isolatedRoot, 'package.json'));
const dist = join(isolatedRoot, 'packages/resolution/dist/src');
const core = join(isolatedRoot, 'packages/core');

/** Emitted files a control may plant into, with their original bytes. */
const originals = new Map([...new Set(controls.map((control) => control.file))].map((file) => [file, readFileSync(join(dist, file), 'utf8')]));
/** The hash expected for each copied artifact during baseline, mutant, and restored runs. */
const expectedArtifacts = new Map([...originals].map(([file, content]) => [file, digest(content)]));

/** Restore every emitted file a control may have planted into. */
function restoreAll() {
  for (const [file, content] of originals) {
    writeFileSync(join(dist, file), content);
  }
}

/** The Jest child currently running and its report directory, so a signal can stop and remove them. */
let running;
let reportDirectory;
let interruptedSignal;

// Stop the active suite and remember the signal; top-level cleanup removes the
// disposable checkout before the runner exits with the interruption status.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (interruptedSignal !== undefined) {
      return;
    }
    interruptedSignal = signal;
    running?.kill('SIGKILL');
    restoreAll();
    if (reportDirectory !== undefined) {
      rmSync(reportDirectory, { recursive: true, force: true });
    }
    console.log(`INTERRUPTED by ${signal}; emitted files restored`);
  });
}

/** Prove each Jest child resolves the copied package and only the expected emitted bytes. */
function verifyIsolatedLoad(label) {
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', "console.log(import.meta.resolve('@microdelta/resolution'))"], { cwd: core, encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0 || (probe.signal !== null && probe.signal !== undefined)) {
    throw new Error(`Resolution package-load probe failed before ${label}: ${probe.stderr ?? probe.error ?? String(probe.status)}`);
  }
  const loaded = realpathSync(fileURLToPath(probe.stdout.trim()));
  const isolatedEntry = realpathSync(join(dist, 'index.js'));
  if (!loaded.startsWith(`${realpathSync(isolatedRoot)}${sep}`) || loaded !== isolatedEntry) {
    throw new Error(`Resolution package escaped its isolated checkout before ${label}: loaded ${loaded}; expected ${isolatedEntry}`);
  }
  for (const [file, expected] of expectedArtifacts) {
    if (digest(readFileSync(join(dist, file), 'utf8')) !== expected) {
      throw new Error(`Unexpected isolated artifact hash for ${file} before ${label}`);
    }
  }
}

/** Run the exact Resolution suites once in the copied checkout and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'source-call-controls-'));
  reportDirectory = directory;
  try {
    verifyIsolatedLoad(expectedTitles === undefined ? 'baseline' : 'mutant or restored run');
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(isolatedRoot, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--json', `--outputFile=${out}`, '--runTestsByPath', ...suites.map((suite) => `.test-build/test/${suite}`)], { cwd: core, stdio: 'ignore' });
      running.on('error', reject);
      running.on('exit', (code) => {
        resolve(code);
      });
    });
    running = undefined;
    return judgeRun({ exitStatus, reportText: existsSync(out) ? readFileSync(out, 'utf8') : undefined, expectedTitles, suites: suites.map((suite) => suite.split('/').at(-1)) });
  } finally {
    rmSync(directory, { recursive: true, force: true });
    reportDirectory = undefined;
  }
}

let failures = 0;
try {
  const baseline = await runSuites(undefined);
  if (interruptedSignal !== undefined) {
    throw new Error('control run interrupted');
  }
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
    expectedArtifacts.set(control.file, digest(readFileSync(path, 'utf8')));
    try {
      const judged = await runSuites(baseline.titles);
      const { failed } = judged;
      if (!failed.includes(control.breaks) || !control.assertion(judged.failureMessages.get(control.breaks) ?? '')) {
        throw new Error(`Control did not fail its intended outcome assertion: ${control.name}; failures ${JSON.stringify(failed)}; target ${judged.failureMessages.get(control.breaks) ?? 'missing'}`);
      }
      if (interruptedSignal !== undefined) {
        throw new Error('control run interrupted');
      }
      console.log(`\n## ${control.name}: ${String(failed.length)} failing`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0) failures += 1;
    } finally {
      writeFileSync(path, original);
      expectedArtifacts.set(control.file, digest(original));
    }
    if (readFileSync(path, 'utf8') !== original) {
      throw new Error(`${control.file} was not restored after ${control.name}`);
    }
  }
  const restored = await runSuites(baseline.titles);
  if (interruptedSignal !== undefined) {
    throw new Error('control run interrupted');
  }
  console.log(`\nrestored: ${String(restored.titles.size)} tests, ${String(restored.failed.length)} failing`);
  if (restored.failed.length > 0) failures += 1;
} catch (error) {
  if (interruptedSignal === undefined) {
    console.log(`CONTROL RUN INVALID: ${error instanceof Error ? error.message : String(error)}`);
    failures += 1;
  }
} finally {
  try {
    restoreAll();
    for (const [file, content] of originals) {
      if (readFileSync(join(dist, file), 'utf8') !== content) {
        console.log(`NOT RESTORED: ${file}`);
        failures += 1;
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
if (interruptedSignal !== undefined) {
  process.exitCode = 130;
} else {
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${String(controls.length)} controls`);
  process.exitCode = failures > 0 ? 1 : 0;
}
