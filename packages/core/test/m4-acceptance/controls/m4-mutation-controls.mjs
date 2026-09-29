/**
 * Negative controls for the M4 independent-process acceptance suite
 * (issue #88). Each control plants exactly one wrong behavior into an owner's
 * emitted production build (never TypeScript source) — Reuse Resolution or
 * Definition — and reruns the unchanged M4 acceptance suites, whose worker
 * processes load those builds through the built facade. Every control names
 * the planned evidence cases (the suites' `describe` titles) it is predicted
 * to break, written before the control ran; a control fails the run when any
 * predicted case still passes, when no test fails at all, or when its anchor
 * does not match exactly once. Each Jest run is judged fail-closed by the
 * facade's shared `control-outcome.mjs` against exactly the four M4 suites.
 * Every planted file is restored after its control, on error, and on
 * SIGINT/SIGTERM/SIGHUP, and final bytes are compared with the originals.
 *
 * On-demand evidence command, not part of `npm test`: run `npm run build` and
 * `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/m4-acceptance/controls/m4-mutation-controls.mjs`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { judgeRun } from '../../durable-history/controls/control-outcome.mjs';
import { repositoryRoot } from '../../acceptance/controls/paths.mjs';

const root = repositoryRoot(import.meta.url);

/** Emitted production files a control may plant into. */
const targets = Object.freeze({
  resolution: join(root, 'packages/resolution/dist/src/resolution.js'),
  collection: join(root, 'packages/definition/dist/src/collection.js'),
  template: join(root, 'packages/definition/dist/src/template.js'),
  composition: join(root, 'packages/definition/dist/src/composition.js'),
  invocation: join(root, 'packages/definition/dist/src/invocation.js'),
});

/** The M4 acceptance suite files every run must execute. */
const suites = Object.freeze(['fold.test.js', 'keyed.test.js', 'nested.test.js', 'topology.test.js']);

/**
 * One planted defect per control, with the planned evidence cases predicted
 * to reject it. Predictions follow from the owning contracts, not from a run.
 */
const controls = [
  {
    name: 'an eligible source never consults its current finality hook',
    target: 'resolution',
    anchor: 'if (eligible !== undefined && invocation.hasFinality) {',
    replacement: 'if (false) {',
    breaks: ['keyed-cold-and-restarted-report'],
  },
  {
    name: 'a strict fold ignores its recorded membership fact',
    target: 'resolution',
    anchor: 'const change = membershipChange(recorded.membership, membership);',
    replacement: 'const change = undefined;',
    breaks: ['discovery-insert-delete-reorder'],
  },
  {
    name: 'a strict fold does not compare the member facts it consumed',
    target: 'resolution',
    anchor: "if (comparison.kind !== 'equal') {\n            return { verdict: 'miss', miss: memberOutputMiss(",
    replacement: "if (false) {\n            return { verdict: 'miss', miss: memberOutputMiss(",
    breaks: ['nested-changed-output', 'supplied-assessor-swap'],
  },
  {
    name: 'a nested parent does not compare the output it consumed from a call',
    target: 'resolution',
    anchor: "if (comparison.kind !== 'equal') {\n                return { verdict: 'miss', miss: callOutputMiss(",
    replacement: "if (false) {\n                return { verdict: 'miss', miss: callOutputMiss(",
    breaks: ['nested-changed-output', 'supplied-assessor-swap'],
  },
  {
    name: 'no equal-output cutoff: a re-executed call always misses its parent',
    target: 'resolution',
    anchor: "case 'published':\n                    outputs.set(call.index, resolved.result.reference);",
    replacement: "case 'published':\n                    if (resolved.result.kind === 'published') { return missed('changed-child-output', 'planted: no equal-output cutoff'); }\n                    outputs.set(call.index, resolved.result.reference);",
    breaks: ['nested-equal-output-cutoff', 'supplied-assessor-swap', 'custom-key-correspondence'],
  },
  {
    name: 'an argument derived after an observed untracked read is treated as justified',
    target: 'resolution',
    anchor: "if (validating && !recipe.justified) {\n                        return { status: 'miss', reason: 'unjustified-argument', detail: `${label} was derived",
    replacement: "if (false) {\n                        return { status: 'miss', reason: 'unjustified-argument', detail: `${label} was derived",
    breaks: ['binding-and-argument-misses'],
  },
  {
    name: 'an unreconstructible argument is rebuilt instead of missing the parent',
    target: 'resolution',
    anchor: "case 'unreconstructible':\n                    if (validating) {",
    replacement: "case 'unreconstructible':\n                    if (false) {",
    breaks: ['binding-and-argument-misses'],
  },
  {
    name: 'open discovery is treated as closed',
    target: 'resolution',
    anchor: "const openDiscovery = population.completion === 'open';",
    replacement: 'const openDiscovery = false;',
    breaks: ['strict-fold-readiness', 'closed-empty-population'],
  },
  {
    name: 'a refused member fails the fold instead of leaving it pending',
    target: 'resolution',
    anchor: "(result.disposition === 'cancelled' ? cancelled : pending).push(key);",
    replacement: "(result.disposition === 'cancelled' ? cancelled : failed).push(key);",
    breaks: ['strict-fold-readiness'],
  },
  {
    name: 'fold coverage omits skipped members',
    target: 'resolution',
    anchor: "skipped: Object.freeze(membership.flatMap((entry) => entry.status === 'skipped' ? [entry.key] : [])),",
    replacement: 'skipped: Object.freeze([]),',
    breaks: ['strict-fold-coverage', 'tracked-gate-instances'],
  },
  {
    name: 'a closed empty population waits instead of completing',
    target: 'resolution',
    anchor: 'if (openDiscovery || pending.length > 0) {',
    replacement: 'if (openDiscovery || pending.length > 0 || membership.length === 0) {',
    breaks: ['closed-empty-population'],
  },
  {
    name: 'duplicate member keys are silently collapsed',
    target: 'collection',
    anchor: 'else if (keyed.has(derived.key)) {\n            duplicates.add(derived.key);',
    replacement: 'else if (keyed.has(derived.key)) {\n            void duplicates;',
    breaks: ['duplicate-and-missing-identity'],
  },
  {
    name: 'a record without designated identity is not reported as a missing key',
    target: 'collection',
    anchor: "if (raw === undefined) {\n        return { status: 'failed', failure: { reason: 'missing-key'",
    replacement: "if (false) {\n        return { status: 'failed', failure: { reason: 'missing-key'",
    breaks: ['duplicate-and-missing-identity'],
  },
  {
    name: 'the custom key is ignored in favor of designated identity',
    target: 'collection',
    anchor: 'if (strategy.customKey === undefined) {\n        raw = ownData(member, strategy.identity).value;',
    replacement: 'if (true) {\n        raw = ownData(member, strategy.identity).value;',
    breaks: ['custom-key-correspondence'],
  },
  {
    name: 'an ambiguous supplied slot silently binds its first implementation',
    target: 'composition',
    anchor: "return occupants.length > 1 ? { status: 'ambiguous', descriptor, occupants: occupants.length } : { status: 'bound', descriptor, target: only.target };",
    replacement: "return { status: 'bound', descriptor, target: only.target };",
    breaks: ['binding-and-argument-misses'],
  },
  {
    name: 'a missing supplied slot is not refused when the parent opens',
    target: 'invocation',
    anchor: "if (occupants.length === 0) {\n        reject('missing-slot'",
    replacement: "if (false) {\n        reject('missing-slot'",
    breaks: ['binding-and-argument-misses'],
  },
  {
    name: 'a frozen member builder accepts a result-created operation',
    target: 'template',
    anchor: "if (!open) {\n            reject('frozen',",
    replacement: "if (false) {\n            reject('frozen',",
    breaks: ['frozen-template-topology'],
  },
  {
    name: 'composition keeps author input objects by reference',
    target: 'composition',
    anchor: 'return decodeSnapshot(encodeSnapshot(value));',
    replacement: 'return value;',
    breaks: ['frozen-template-topology'],
  },
  {
    name: 'a gate answering false still requires the member',
    target: 'template',
    anchor: "if (value === false) {\n        return { status: 'skipped' };",
    replacement: "if (value === false) {\n        return { status: 'required' };",
    breaks: ['tracked-gate-instances', 'strict-fold-coverage'],
  },
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

/** Run the M4 acceptance suites once and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'm4-acceptance-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', join(root, 'packages/core/jest.config.mjs'), '--runInBand', '--json', `--outputFile=${out}`, '.test-build/test/m4-acceptance/'], { cwd: root, stdio: 'ignore' });
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
    throw new Error('the unmodified builds must pass every M4 acceptance test before controls run');
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
      const unbroken = control.breaks.filter((name) => !failed.some((title) => inCase(title, name)));
      console.log(`\n## ${control.name}: ${String(failed.length)} failing${unbroken.length === 0 ? '' : `; PREDICTED CASES STILL PASSING: ${unbroken.join(', ')}`}`);
      for (const name of failed) console.log(`- ${name}`);
      if (failed.length === 0 || unbroken.length > 0) failures += 1;
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
