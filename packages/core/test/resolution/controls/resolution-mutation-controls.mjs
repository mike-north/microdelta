/**
 * Behavioral discrimination controls for Reuse Resolution (issue #56). Each
 * control plants exactly one wrong behavior into Resolution's emitted build
 * (never its TypeScript source), runs the unchanged Resolution assembly suites
 * over real durable History, and records which named tests fail; the emitted
 * file is restored afterwards and the restored build must pass every test. A
 * control whose anchor does not match exactly once, or that no test rejects,
 * fails the run. Every Jest run is judged fail-closed by the facade's shared
 * `control-outcome.mjs` against exactly the three Resolution suites. Every
 * planted file is restored after its control, on error, and on
 * SIGINT/SIGTERM/SIGHUP, and the final bytes are compared with the originals.
 * A SIGKILL cannot be intercepted; rebuilding Resolution restores the files.
 *
 * It is an on-demand evidence command, not part of `npm test`: run
 * `npm run build` and `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/resolution/controls/resolution-mutation-controls.mjs`.
 * Controls must run serially.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';

const root = new URL('../../../../../', import.meta.url).pathname;
const dist = join(root, 'packages/resolution/dist/src');
const core = join(root, 'packages/core');

/** The Resolution suite files every run must execute. */
const suites = Object.freeze(['source-policy.test.js', 'summary-validation.test.js', 'admission-recovery.test.js']);

const controls = [
  { name: 'source candidates skip their own implementation and input validation', file: 'resolution.js', anchor: "if (comparison.kind === 'equal') {", replacement: 'if (true) {' },
  { name: 'a false finality answer retains', file: 'resolution.js', anchor: 'if (decided.value) {', replacement: 'if (true) {' },
  { name: 'a throwing finality hook becomes acceptance', file: 'resolution.js', anchor: "throw new ResolutionError('policy-failure', `Current finality of ${stepKey(step)} failed: ${describe(error)}`, error);", replacement: 'decided = { value: true, observations: [] };' },
  { name: 'a non-boolean finality answer is accepted', file: 'resolution.js', anchor: "if (typeof decided.value !== 'boolean') {", replacement: 'if (false) {' },
  { name: 'retention is not tied to its own eligible carrier', file: 'resolution.js', anchor: 'if (eligible === undefined || held === undefined || held.token !== token || held.reference.locator !== eligible.reference.locator) {', replacement: 'if (eligible === undefined) {' },
  { name: 'look-alike envelopes are treated as controls', file: 'outcome.js', anchor: 'minted.get(value) : undefined;', replacement: '(minted.get(value) ?? value) : undefined;' },
  { name: 'previous-result reads are validated as current inputs', file: 'resolution.js', anchor: '.filter((item) => !isPreviousObservation(item.binding))', replacement: '.filter(() => true)' },
  { name: 'consumed child output facts are not compared', file: 'resolution.js', anchor: "if (childComparison.kind !== 'equal') {", replacement: 'if (false) {' },
  { name: 'unsupported witnesses are guessed as correspondence', file: 'resolution.js', anchor: "if (reconnected.status === 'unsupported') {", replacement: 'if (false) {' },
  { name: 'a recorded child need not be an exact dependency', file: 'resolution.js', anchor: 'if (!candidate.dependencies.some((dependency) => dependency.locator === child.reference.locator)) {', replacement: 'if (false) {' },
  { name: 'check-only evaluation proceeds to source work', file: 'resolution.js', anchor: "return done({ kind: 'uncertain', boundary: step });", replacement: 'void 0;' },
  { name: 'check-only memo reuse records acceptance', file: 'resolution.js', anchor: "return done({ kind: 'reused', basis: 'validated', reference: candidate.reference, acceptance: undefined });", replacement: 'void 0;' },
  { name: 'a memo admission refusal is ignored', file: 'resolution.js', anchor: "const refusal = await admit(request, evidence, step, 'memo', declaration, candidates.length > 0 ? 'invalid' : 'cold');", replacement: "await admit(request, evidence, step, 'memo', declaration, candidates.length > 0 ? 'invalid' : 'cold'); const refusal = undefined;" },
  { name: 'the intent digest ignores the invocation', file: 'intent.js', anchor: 'return `mdi1:${options.host.sha256(JSON.stringify(intent))}`;', replacement: 'return `mdi1:constant`;' },
  { name: 'the attempt key ignores the request key', file: 'intent.js', anchor: '1, requestKey, structural(step)]', replacement: '1, structural(step)]' },
  { name: 'candidate lookup ignores the compatibility version', file: 'resolution.js', anchor: 'subject: declaration.subject, version: declaration.version });', replacement: 'subject: declaration.subject, version: 1 });' },
  { name: 'declared helpers are not tracked', file: 'resolution.js', anchor: 'helpers[slot] = tracking.tracked(state.value, { path: bindingPaths.callable(slot) });', replacement: 'helpers[slot] = state.value;' },
  { name: "the author callback is not tracked as the step's own implementation", file: 'resolution.js', anchor: 'const authored = tracking.tracked(callback, { path: bindingPaths.self });', replacement: 'const authored = callback;' },
  { name: 'direct invocations are not shared within a request', file: 'resolution.js', anchor: 'if (existing !== undefined) {', replacement: 'if (false) {' },
  { name: 'a body that swallowed a failed child still publishes', file: 'resolution.js', anchor: 'if (frame.failed !== undefined) {', replacement: 'if (false) {' },
  { name: 'a committed request key is served again by a normal request', file: 'resolution.js', anchor: "if (prior.kind !== 'absent') {", replacement: "if (prior.kind !== 'absent' && prior.kind !== 'completed') {" },
  { name: 'a child view is resolved through Promise assimilation', file: 'resolution.js', anchor: 'return Object.freeze({ data: materialization.materializeView(reference, { path: bindingPaths.child(slot) }) });', replacement: 'const view = materialization.materializeView(reference, { path: bindingPaths.child(slot) }); await view; return Object.freeze({ data: view });' },
  { name: 'a different current child subject is treated as lost correspondence', file: 'resolution.js', anchor: 'const resolved = await resolveSourceShared(request, childStep, childDeclaration);', replacement: "if (historical.subject !== childDeclaration.subject) { return { verdict: 'miss', miss: miss(candidate.reference, 'correspondence', 'subject differs') }; } const resolved = await resolveSourceShared(request, childStep, childDeclaration);" },
  { name: 'nested post-commit diagnostics stay with each step', file: 'resolution.js', anchor: 'return { misses: [], trace: [], diagnostics: request.diagnostics };', replacement: 'return { misses: [], trace: [], diagnostics: [] };' },
  { name: 'supported provenance need not carry its own implementation evidence', file: 'evidence.js', anchor: 'if (!observations.some(isOwnImplementation)) {', replacement: 'if (false) {' },
  { name: 'supported source provenance may carry child edges', file: 'evidence.js', anchor: "if (kind === 'source' && children.length > 0) {", replacement: 'if (false) {' },
  { name: 'an unsuccessful attempt ending is not announced as abandon', file: 'resolution.js', anchor: "if (ending.ending !== 'retained') {", replacement: 'if (false) {' },
  { name: 'an ending History refused is still announced', file: 'resolution.js', anchor: 'could not be ended: ${describe(error)}`);', replacement: "could not be ended: ${describe(error)}`); emit(request, evidence, step, 'abandon');" },
  { name: 'a post-commit observer failure fails the call', file: 'resolution.js', anchor: 'if (preExecution.has(phase)) {', replacement: 'if (true) {' },
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

/** Run the Resolution suites once in a fresh temporary directory and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'resolution-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--json', `--outputFile=${out}`, '.test-build/test/resolution'], { cwd: core, stdio: 'ignore' });
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
