/**
 * Behavioral discrimination controls for Reuse Resolution (issues #56 and #144). Each control
 * plants one wrong behavior into an isolated copy of Resolution's emitted
 * build (never its TypeScript source), runs the fixed Resolution witness
 * suites over real durable History, and records the exact rejecting test. The
 * copy's package entry and artifact hashes are checked before every run so
 * evidence cannot come from the source checkout or an accidental sibling.
 * A control whose anchor does not match exactly once, or that no named test
 * rejects, fails the run. Every Jest run is judged fail-closed by the facade's
 * shared `control-outcome.mjs` against the exact suite and title inventory.
 * Planted files are restored after each control, on error, and on
 * SIGINT/SIGTERM/SIGHUP; handled signals unwind through final cleanup and
 * remove the disposable checkout. A SIGKILL cannot be intercepted, but it
 * cannot leave a mutant in the source checkout.
 *
 * It is an on-demand evidence command, not part of `npm test`: run
 * `npm run build` and `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/resolution/controls/resolution-mutation-controls.mjs`.
 * Controls must run serially.
 *
 * `--check-anchors` verifies that every anchor matches exactly once in the
 * current builds and exits without running any suite; `npm test` runs it for
 * every runner (anchor-check.test.mjs) so drift fails early.
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
const suites = Object.freeze([
  'resolution/source-policy.test.js',
  'resolution/summary-validation.test.js',
  'resolution/admission-recovery.test.js',
  'gap-hunt-contracts-resolution-144.test.js',
]);

const controls = [
  { name: "source candidates skip their own implementation and input validation", file: 'resolution.js', anchor: "const comparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run, member: memberRecord(request, step) }));\n            if (comparison.kind === 'equal') {", replacement: "const comparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run, member: memberRecord(request, step) }));\n            if (true) {" },
  { name: 'a false finality answer retains', file: 'resolution.js', anchor: 'if (decided.value) {', replacement: 'if (true) {' },
  { name: "a throwing finality hook becomes acceptance", file: 'resolution.js', anchor: "if (evaluated.kind === 'threw') {\n                    throw new ResolutionError('policy-failure', `Current finality of ${stepKey(step)} threw`, evaluated.error);\n                }\n                const decided = evaluated.value;", replacement: "const decided = evaluated.kind === 'threw' ? { value: true, observations: [] } : evaluated.value;" },
  { name: 'a non-boolean finality answer is accepted', file: 'resolution.js', anchor: "if (typeof decided.value !== 'boolean') {", replacement: 'if (false) {' },
  { name: 'retention is not tied to its own eligible carrier', file: 'resolution.js', anchor: 'if (eligible === undefined || held === undefined || held.token !== token || held.reference.locator !== eligible.reference.locator) {', replacement: 'if (eligible === undefined) {' },
  { name: 'look-alike envelopes are treated as controls', file: 'outcome.js', anchor: 'minted.get(value) : undefined;', replacement: '(minted.get(value) ?? value) : undefined;' },
  { name: 'previous-result reads are validated as current inputs', file: 'resolution.js', anchor: '.filter((item) => !isPreviousObservation(item.binding))', replacement: '.filter(() => true)' },
  { name: 'consumed child output facts are not compared', file: 'resolution.js', anchor: "if (childComparison.kind !== 'equal') {", replacement: 'if (false) {' },
  { name: 'unsupported witnesses are guessed as correspondence', file: 'resolution.js', anchor: "if (reconnected.status === 'unsupported') {", replacement: 'if (false) {' },
  { name: 'a recorded child need not be an exact dependency', file: 'resolution.js', anchor: 'if (!candidate.dependencies.some((dependency) => dependency.locator === child.reference.locator)) {', replacement: 'if (false) {' },
  { name: 'check-only evaluation proceeds to source work', file: 'resolution.js', anchor: "return done({ kind: 'uncertain', boundary: step });", replacement: 'void 0;' },
  { name: 'check-only memo reuse records acceptance', file: 'resolution.js', anchor: "return done({ kind: 'reused', basis: 'validated', reference: candidate.reference, acceptance: undefined });", replacement: 'void 0;' },
  { name: "a memo admission refusal is ignored", file: 'resolution.js', anchor: "const refusal = await admit(request, evidence, step, 'memo', versioned(declaration), candidates.length > 0 ? 'invalid' : 'cold');", replacement: "await admit(request, evidence, step, 'memo', versioned(declaration), candidates.length > 0 ? 'invalid' : 'cold'); const refusal = undefined;" },
  { name: "the intent digest ignores the invocation", file: 'intent.js', anchor: "options.step)]] : []),\n    ];\n    return `mdi1:${options.host.sha256(JSON.stringify(intent))}`;", replacement: "options.step)]] : []),\n    ];\n    return `mdi1:constant`;" },
  { name: "the attempt key ignores the request key", file: 'intent.js', anchor: "1, requestKey, structural(step), ...invocation]", replacement: "1, structural(step), ...invocation]" },
  { name: 'candidate lookup ignores the compatibility version', file: 'resolution.js', anchor: 'subject: declaration.subject, version: declaration.version });', replacement: 'subject: declaration.subject, version: 1 });' },
  { name: 'declared helpers are not tracked', file: 'resolution.js', anchor: 'helpers[slot] = tracking.tracked(state.value, { path: bindingPaths.callable(slot) });', replacement: 'helpers[slot] = state.value;' },
  { name: "the author callback is not tracked as the step's own implementation", file: 'resolution.js', anchor: "\n            const authored = tracking.tracked(callback, { path: bindingPaths.self });", replacement: "\n            const authored = callback;" },
  { name: "direct source invocations are not shared within a request", file: 'resolution.js', anchor: "const existing = request.sources.get(key);\n        if (existing !== undefined) {", replacement: "const existing = request.sources.get(key);\n        if (false) {" },
  { name: 'a body that swallowed a failed child still publishes', file: 'resolution.js', anchor: 'if (frame.failed !== undefined) {', replacement: 'if (false) {' },
  { name: 'a committed request key is served again by a normal request', file: 'resolution.js', anchor: "if (prior.kind !== 'absent') {", replacement: "if (prior.kind !== 'absent' && prior.kind !== 'completed') {" },
  { name: 'a child view is resolved through Promise assimilation', file: 'resolution.js', anchor: 'return Object.freeze({ data: materialization.materializeView(reference, { path: bindingPaths.child(slot) }) });', replacement: 'const view = materialization.materializeView(reference, { path: bindingPaths.child(slot) }); await view; return Object.freeze({ data: view });' },
  { name: 'a different current child subject is treated as lost correspondence', file: 'resolution.js', anchor: 'const resolved = await resolveSourceShared(request, childStep, childDeclaration);', replacement: "if (historical.subject !== childDeclaration.subject) { return { verdict: 'miss', miss: miss(candidate.reference, 'correspondence', 'subject differs') }; } const resolved = await resolveSourceShared(request, childStep, childDeclaration);" },
  { name: 'nested post-commit diagnostics stay with each step', file: 'resolution.js', anchor: 'return { misses: [], trace: [], diagnostics: request.diagnostics };', replacement: 'return { misses: [], trace: [], diagnostics: [] };' },
  { name: "supported source and memo provenance need not carry its own implementation evidence", file: 'evidence.js', anchor: "if (!observations.some(isOwnImplementation)) {\n        return malformed(`${kind} provenance lacks its own implementation observation`);\n    }\n    if (kind === 'source' && children.length > 0) {", replacement: "if (false) {\n        return malformed(`${kind} provenance lacks its own implementation observation`);\n    }\n    if (kind === 'source' && children.length > 0) {" },
  { name: 'supported source provenance may carry child edges', file: 'evidence.js', anchor: "if (kind === 'source' && children.length > 0) {", replacement: 'if (false) {' },
  { name: 'an unsuccessful attempt ending is not announced as abandon', file: 'resolution.js', anchor: "if (ending.ending !== 'retained') {", replacement: 'if (false) {' },
  { name: 'an ending History refused is still announced', file: 'resolution.js', anchor: 'could not be ended: ${frameworkDetail(error)}`);', replacement: "could not be ended: ${frameworkDetail(error)}`); emit(request, evidence, step, 'abandon');" },
  { name: 'a post-commit observer failure fails the call', file: 'resolution.js', anchor: 'if (preExecution.has(phase)) {', replacement: 'if (true) {' },
  // CMP-8 gate evidence must identify the actual author predicate, independently from its member reads.
  { name: 'a gate omits its own implementation evidence', file: 'resolution.js', anchor: "const gateInvoker = (callback, context) => {\n        // eslint-disable-next-line microdelta/tracked-captures -- Framework invoker: the callback is the author's actual gate from Definition's record, tracked so its implementation is the gate's own evidence.\n        const authored = tracking.tracked(callback, { path: bindingPaths.self });", replacement: 'const gateInvoker = (callback, context) => {\n        const authored = callback;' },
  // CMP-5 shares an in-flight direct memo invocation inside one parent request.
  { name: 'concurrent direct memo calls execute twice', file: 'resolution.js', anchor: 'const existing = request.memos.get(key);\n        if (existing !== undefined) {', replacement: 'const existing = request.memos.get(key);\n        if (false) {' },
  // A supplied invocation's digest distinguishes equal calls from changed arguments or implementation (History attempt intent).
  { name: 'supplied intent ignores its invocation', file: 'intent.js', anchor: '        options.arguments,\n        sourceText(options.run),\n        ...currentBindings(options.validation, options.slots),\n    ];\n    return `mdi1:${options.host.sha256(JSON.stringify(intent))}`;', replacement: "        options.arguments,\n        sourceText(options.run),\n        ...currentBindings(options.validation, options.slots),\n    ];\n    return 'mdi1:constant';" },
  // REUSE-008/RES-003 require a supplied candidate's historical evidence to identify its own callback.
  { name: 'supplied provenance accepts missing own implementation evidence', file: 'evidence.js', anchor: "if (!observations.some(isOwnImplementation)) {\n        return malformed(`${kind} provenance lacks its own implementation observation`);\n    }\n    if (kind === 'supplied' && calls.length > 0)", replacement: "if (kind !== 'supplied' && !observations.some(isOwnImplementation)) {\n        return malformed(`${kind} provenance lacks its own implementation observation`);\n    }\n    if (kind === 'supplied' && calls.length > 0)" },
  // CMP-8 fold reuse also requires the fold body's own implementation fact.
  { name: 'fold provenance accepts missing own implementation evidence', file: 'evidence.js', anchor: "if (!observations.some(isOwnImplementation)) {\n        return malformed('fold provenance lacks its own implementation observation');\n    }", replacement: "if (false) {\n        return malformed('fold provenance lacks its own implementation observation');\n    }" },
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
const temporary = mkdtempSync(join(tmpdir(), 'resolution-controls-'));
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
  const directory = mkdtempSync(join(tmpdir(), 'resolution-controls-'));
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
      const { failed } = await runSuites(baseline.titles);
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
