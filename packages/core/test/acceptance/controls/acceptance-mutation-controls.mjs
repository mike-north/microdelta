/**
 * Negative controls for the M3 independent-process acceptance harness
 * (issue #58). Each control plants exactly one wrong behavior into an owner's
 * emitted production build (never TypeScript source) — Resolution, History,
 * Supervision — and reruns the unchanged acceptance suites, whose worker
 * processes load those builds through the built facade. A control that no
 * acceptance test rejects, or whose anchor does not match exactly once,
 * fails the run. Each Jest run is judged fail-closed by the facade's shared
 * `control-outcome.mjs` against exactly the eight acceptance suites. Every
 * planted file is restored after its control, on error, and on
 * SIGINT/SIGTERM/SIGHUP, and final bytes are compared with the originals.
 *
 * On-demand evidence command, not part of `npm test`: run `npm run build` and
 * `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/acceptance/controls/acceptance-mutation-controls.mjs`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';
import { repositoryRoot } from './paths.mjs';

const root = repositoryRoot(import.meta.url);

/** Emitted production files a control may plant into. */
const targets = Object.freeze({
  resolution: join(root, 'packages/resolution/dist/src/resolution.js'),
  intent: join(root, 'packages/resolution/dist/src/intent.js'),
  history: join(root, 'packages/history/dist/src/durable/index.js'),
  index: join(root, 'packages/history/dist/src/durable/selected-index.js'),
  supervision: join(root, 'packages/supervision/dist/src/supervision.js'),
});

/** The acceptance suite files every run must execute. */
const suites = Object.freeze(['admission-observers.test.js', 'changes.test.js', 'crash-recovery.test.js', 'integrity-io.test.js', 'lease-expiry.test.js', 'planned-fault.test.js', 'restart.test.js', 'source-policy.test.js']);

const controls = [
  { name: 'a source candidate skips its own implementation and input validation', target: 'resolution', anchor: "if (comparison.kind === 'equal') {", replacement: 'if (true) {' },
  { name: 'an eligible source never consults its current finality hook', target: 'resolution', anchor: 'if (eligible !== undefined && invocation.hasFinality) {', replacement: 'if (false) {' },
  { name: 'a false current finality answer retains', target: 'resolution', anchor: 'if (decided.value) {', replacement: 'if (true) {' },
  { name: 'consumed child output facts are not compared', target: 'resolution', anchor: "if (childComparison.kind !== 'equal') {", replacement: 'if (false) {' },
  { name: 'candidate lookup ignores the compatibility version', target: 'resolution', anchor: 'subject: declaration.subject, version: declaration.version });', replacement: 'subject: declaration.subject, version: 1 });' },
  { name: 'check-only proceeds to source work', target: 'resolution', anchor: "return done({ kind: 'uncertain', boundary: step });", replacement: 'void 0;' },
  { name: 'a memo admission refusal is ignored', target: 'resolution', anchor: "const refusal = await admit(request, evidence, step, 'memo'", replacement: "const refusal = undefined; await admit(request, evidence, step, 'memo'" },
  { name: 'a normal request resumes a key whose execution is incomplete', target: 'resolution', anchor: "if (prior.kind !== 'absent') {", replacement: "if (prior.kind === 'completed') {" },
  { name: 'the recovery intent ignores the current declaration', target: 'intent', anchor: 'return `mdi1:${options.host.sha256(JSON.stringify(intent))}`;', replacement: 'return `mdi1:constant`;' },
  { name: 'an incomplete attempt is reported as absent', target: 'history', anchor: "case 'staged':\n                return Object.freeze({ kind: 'incomplete', attempt });", replacement: "case 'staged':\n                return Object.freeze({ kind: 'absent' });" },
  { name: 'fingerprint validation also materializes the source result payload', target: 'index', anchor: 'resolveFingerprint(reference, request) {\n            const resultId = resolve(reference);', replacement: 'resolveFingerprint(reference, request) {\n            const resultId = resolve(reference);\n            statements.payload.get(resultId);' },
  { name: 'a selected scalar read also loads the whole root payload', target: 'index', anchor: 'const row = statements.scalarPayload.get(resultId, metadata.nodeId);', replacement: 'statements.payload.get(resultId); const row = statements.scalarPayload.get(resultId, metadata.nodeId);' },
  { name: 'recovery takes the writer lease', target: 'supervision', anchor: 'return within(() => resolution.recover({ step, requestKey: request.requestKey }));', replacement: 'return within(() => { writer.lease(); return resolution.recover({ step, requestKey: request.requestKey }); });' },
];

/** Original bytes of every target. */
const originals = new Map(Object.values(targets).map((file) => [file, readFileSync(file, 'utf8')]));

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

/** Run the acceptance suites once and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'acceptance-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', join(root, 'packages/core/jest.config.mjs'), '--runInBand', '--json', `--outputFile=${out}`, '--runTestsByPath', ...suites.map((suite) => `packages/core/.test-build/test/acceptance/${suite}`)], { cwd: root, stdio: 'ignore' });
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

let failures = 0;
try {
  const baseline = await runSuites(undefined);
  console.log(`baseline: ${String(baseline.titles.size)} tests, ${String(baseline.failed.length)} failing`);
  if (baseline.failed.length > 0) {
    throw new Error('the unmodified builds must pass every acceptance test before controls run');
  }
  for (const control of controls) {
    const file = targets[control.target];
    const original = originals.get(file);
    const matches = original.split(control.anchor).length - 1;
    if (matches !== 1) {
      console.log(`ANCHOR ${String(matches)}x: ${control.name}`);
      failures += 1;
      continue;
    }
    writeFileSync(file, original.replace(control.anchor, control.replacement));
    try {
      const { failed } = await runSuites(baseline.titles);
      console.log(`\n## ${control.name}: ${String(failed.length)} failing`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0) failures += 1;
    } finally {
      writeFileSync(file, original);
    }
    if (readFileSync(file, 'utf8') !== original) {
      throw new Error(`${control.target} was not restored after ${control.name}`);
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
