/**
 * Behavioral discrimination controls for external operations (issue #119).
 * Each control plants exactly one wrong behavior into Run Supervision's (or,
 * for the promoted-candidate rule, Reuse Resolution's) emitted build, never
 * its TypeScript source, runs the unchanged operation suites over the real
 * packages, and records which named tests fail; the emitted file is restored
 * afterwards and the restored build must pass every test. A control whose
 * anchor does not match exactly once, or that no test rejects, fails the
 * run. Every Jest run is judged fail-closed by the facade's shared
 * `control-outcome.mjs` against exactly the operation suites. Every planted
 * file is restored after its control, on error, and on SIGINT/SIGTERM/SIGHUP,
 * and the final bytes are compared with the originals. A SIGKILL cannot be
 * intercepted; rebuilding the packages restores the files.
 *
 * It is an on-demand evidence command, not part of `npm test`: run
 * `npm run build` and `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/operations/controls/operations-mutation-controls.mjs`.
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
const supervision = join(root, 'packages/supervision/dist/src');
const resolution = join(root, 'packages/resolution/dist/src');

/** The operation suite files every run must execute. */
const suites = Object.freeze(['operations.test.js', 'replay.test.js', 'operator.test.js', 'environments.test.js', 'privacy.test.js', 'processes.test.js', 'outcome-fold.test.js', 'boundaries.test.js']);

const controls = [
  {
    name: 'the operation intent is not committed before the send',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'current = write(lease, intent, before.revision);', replacement: 'current = before;',
  },
  {
    name: "Accounting's usage intent is not recorded before the send",
    directory: supervision, file: 'operation-engine.js',
    anchor: 'ports.accounting.recordUsageIntent({', replacement: 'void ({',
  },
  {
    name: 'an unknown outcome is replayed blindly',
    directory: supervision, file: 'records.js',
    anchor: 'export function unknownRetry(record, spent) {', replacement: "export function unknownRetry(record, spent) { return 'retry';",
  },
  {
    name: 'a pending attempt keeps sending (no taint guard)',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'if (attempt.pending !== undefined) {', replacement: 'if (false) {',
  },
  {
    name: 'a deferral is not honored before its time',
    directory: supervision, file: 'operation-engine.js',
    anchor: "if (record.status === 'deferred' && record.notBefore !== undefined && now() < record.notBefore) {", replacement: 'if (false) {',
  },
  {
    name: 'the writer lease is kept while only deferred work remains',
    directory: supervision, file: 'supervision.js',
    anchor: 'if (passes.active > 0) {', replacement: 'if (true) {',
  },
  {
    name: 'a usage report is acknowledged twice',
    directory: supervision, file: 'operation-engine.js',
    anchor: "emit('usage-acknowledged', record,",
    replacement: "ports.accounting.acknowledgeUsage({ environment: context.environment, operation: record.operation, requestAttempt, report: `provider:${usage.report}#again`, quantities: usage.quantities }); emit('usage-acknowledged', record,",
  },
  {
    name: 'an unknown outcome is reported as zero usage',
    directory: supervision, file: 'operation-engine.js',
    anchor: "const unknown = settledAs('unknown', 'unknown');",
    replacement: "ports.accounting.acknowledgeUsage({ environment: context.environment, operation, requestAttempt, report: 'provider:zero', quantities: [] }); const unknown = settledAs('unknown', 'unknown');",
  },
  {
    name: 'operation events carry the request binding',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'name: record.name,', replacement: 'name: record.name, binding: record.binding,',
  },
  {
    name: 'a timed wait keeps its window lane',
    directory: supervision, file: 'execution.js',
    anchor: 'lendLane(lane);', replacement: 'void lane;',
  },
  {
    name: "a hard stop's remote state is not made durable",
    directory: supervision, file: 'operation-engine.js',
    anchor: "const settledRemotely = sent.remote === 'cancelled';",
    replacement: "const settledRemotely = sent.remote === 'cancelled'; if (settledRemotely || !settledRemotely) { return { stored: current, outcome: { kind: 'error', error: new SupervisionError('stopped', 'aborted') } }; }",
  },
  {
    name: 'a pending operation is judged in flight by run identifier, which repeats across processes',
    directory: supervision, file: 'operation-engine.js',
    anchor: "return stored.record.status === 'pending' && lease !== undefined && stored.fence !== lease.fence;",
    replacement: "return stored.record.status === 'pending' && stored.record.attempts.at(-1)?.run !== context.runId;",
  },
  {
    name: 'a resumed pass executes again a step that settled in an earlier pass',
    directory: supervision, file: 'supervision.js',
    anchor: 'if (caller?.request?.settled.has(descriptorKey(request.step)) === true) {', replacement: 'if (false) {',
  },
  {
    name: 'an unsettled operation cancels its step instead of leaving it pending',
    directory: resolution, file: 'resolution.js',
    anchor: "return { kind: 'refused', refused: step, reason, disposition: 'denied' };", replacement: "return { kind: 'refused', refused: step, reason, disposition: 'cancelled' };",
  },
  {
    name: 'a resolved-succeeded address is minted and sent again',
    directory: supervision, file: 'records.js',
    anchor: "return isUnsettled(record.status) || (record.status === 'resolved' && record.settlement?.outcome === 'succeeded');", replacement: 'return isUnsettled(record.status);',
  },
  {
    name: 'an operator identity that is not an identifier is accepted',
    directory: supervision, file: 'operation-engine.js',
    anchor: "if ((action !== 'resolve' && action !== 'abandon') || !nonempty(operation) || !isIdentifier(operator)) {", replacement: "if ((action !== 'resolve' && action !== 'abandon') || !nonempty(operation) || !nonempty(operator)) {",
  },
  {
    name: 'a stop admits a resumable deferral',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'if (resumable && stopped) {', replacement: 'if (false) {',
  },
  {
    name: 'the lease is released while another pass is active',
    directory: supervision, file: 'supervision.js',
    anchor: 'if (passes.active > 0) {', replacement: 'if (false) {',
  },
  {
    name: 'the lease is kept when the last active pass ends while a request sleeps',
    directory: supervision, file: 'supervision.js',
    anchor: 'if (passes.sleeping > 0) {', replacement: 'if (false) {',
  },
  {
    name: 'a pending operation committed under the current fence is judged dead',
    directory: supervision, file: 'operation-engine.js',
    anchor: "return stored.record.status === 'pending' && lease !== undefined && stored.fence !== lease.fence;", replacement: "return stored.record.status === 'pending';",
  },
  {
    name: 'two calls at one address may proceed at once',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'if (inProgress.has(address)) {', replacement: 'if (false) {',
  },
  {
    name: 'operation identities come from store-local attempt numbers',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'operation: mintOperation(),', replacement: 'operation: `op-${stepAttempt}`,',
  },
  {
    name: 'an Accounting intent that is not durable fails the member',
    directory: supervision, file: 'operation-engine.js',
    anchor: "const restored = current.revision !== before.revision && current.record.status === 'deferred' ? current.record.notBefore : undefined;", replacement: "throw new SupervisionError('operation-unrecorded', 'intent not durable');",
  },
  {
    name: 'a woken pass with a deadline fails busy at once instead of waiting up to the deadline',
    directory: supervision, file: 'supervision.js',
    edits: [
      { anchor: 'function leaseForPass() {\n            return writerLease();\n        }', replacement: "function leaseForPass(number) {\n            if (number > 1 && writerPolicy.deadline !== undefined) {\n                const attempt = writer.tryLease();\n                if (attempt.kind !== 'acquired') {\n                    throw new SupervisionError('writer-busy', 'woken pass gave up');\n                }\n                return Promise.resolve(attempt.lease);\n            }\n            return writerLease();\n        }" },
      { anchor: 'lease = await leaseForPass();', replacement: 'lease = await leaseForPass(number);' },
    ],
  },
  {
    // The reversed interim rule: a woken pass without a deadline tried once and returned waiting.
    name: 'a woken pass without a deadline returns waiting instead of waiting for the lease',
    directory: supervision, file: 'supervision.js',
    edits: [
      { anchor: 'function leaseForPass() {\n            return writerLease();\n        }', replacement: "function leaseForPass(number) {\n            if (number > 1 && writerPolicy.deadline === undefined) {\n                const attempt = writer.tryLease();\n                return Promise.resolve(attempt.kind === 'acquired' ? attempt.lease : undefined);\n            }\n            return writerLease();\n        }" },
      { anchor: 'lease = await leaseForPass();', replacement: "lease = await leaseForPass(number);\n                    if (lease === undefined) {\n                        return previous;\n                    }" },
    ],
  },
  {
    name: 'an ended attempt may still send an operation',
    directory: supervision, file: 'operation-engine.js',
    edits: [
      { anchor: "throw new SupervisionError('invalid-request', `Operation ${request.name} was called after its step attempt ended; nothing was sent`);", replacement: 'void 0;' },
      { anchor: "throw new EndedAttemptError('the step attempt ended before the send');", replacement: 'void 0;' },
    ],
  },
  {
    name: 'a caller request key may take the reserved pass separator',
    directory: supervision, file: 'supervision.js',
    anchor: "if (typeof callerKey === 'string' && callerKey.includes(passSeparator)) {", replacement: 'if (false) {',
  },
  {
    name: 'the relaxed historical check admits a dependency of another analysis',
    directory: resolution, file: 'resolution.js',
    anchor: 'return historical.analysis === analysis;', replacement: 'return true;',
  },
  {
    name: 'a retry after an unconfirmed intent mints a new request attempt (M3)',
    directory: supervision, file: 'operation-engine.js',
    anchor: "const unsent = last?.status === 'not-sent' && last.intent === 'unconfirmed' ? last : undefined;", replacement: 'const unsent = undefined;',
  },
  {
    name: 'the intent retry delay does not grow',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'const doublings = Math.max(0, failures - 1);', replacement: 'const doublings = 0;',
  },
  {
    name: 'a random identifier of any alphanumeric shape is accepted',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'const randomRule = /^[0-9a-f]{32}$/u;', replacement: 'const randomRule = /^[0-9a-z]{16,64}$/u;',
  },
  {
    name: 'a durable intent does not reset the intent backoff (L4)',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'if (intent.unrecorded !== 0) {', replacement: 'if (false) {',
  },
  {
    name: 'settling an operation tries the writer once instead of waiting (L6)',
    directory: supervision, file: 'supervision.js',
    anchor: "operationsOf('Settling an operation').settle(settlement, await writerLease())",
    replacement: "operationsOf('Settling an operation').settle(settlement, (() => { const tried = writer.tryLease(); if (tried.kind !== 'acquired') { throw new SupervisionError('writer-busy', 'single try without waiting'); } return tried.lease; })())",
  },
  {
    name: "a stop during a woken pass's lease wait rejects instead of returning the earlier report",
    directory: supervision, file: 'supervision.js',
    anchor: "if (previous === undefined || woken === undefined || !(error instanceof SupervisionError) || error.code !== 'stopped') {", replacement: 'if (true) {',
  },
  {
    name: 'an attempt whose intent recorded nothing is reused with its stale attribution',
    directory: supervision, file: 'operation-engine.js',
    anchor: "const unsent = last?.status === 'not-sent' && last.intent === 'unconfirmed' ? last : undefined;", replacement: "const unsent = last?.status === 'not-sent' ? last : undefined;",
  },
  {
    name: "an unconfirmed attempt loses its mark when its reuse meets a failure that recorded nothing",
    directory: supervision, file: 'operation-engine.js',
    anchor: "const unconfirmed = intentMayHaveLanded(error) ? 'unconfirmed' : unsent?.intent;", replacement: "const unconfirmed = intentMayHaveLanded(error) ? 'unconfirmed' : undefined;",
  },
  {
    name: 'abandoning an operation resolved as succeeded overwrites the earlier resolution (audit trail lost)',
    directory: supervision, file: 'operation-engine.js',
    anchor: 'resolution: consumed ? stored.record.settlement : stored.record.resolution,', replacement: 'resolution: undefined,',
  },
  {
    name: 'a legacy not-sent attempt without the mark is read as having recorded nothing (P3)',
    directory: supervision, file: 'records.js',
    anchor: "? (field(attempt, 'status') === 'not-sent' ? 'unconfirmed' : undefined)", replacement: '? undefined',
  },
  {
    name: "Resolution refuses a promoted candidate's trial provenance",
    directory: resolution, file: 'resolution.js',
    anchor: 'return historical.analysis === analysis;', replacement: 'return historical.analysis === analysis && historical.environment === environment;',
  },
];

/** Emitted files a control may plant into, with their original bytes. */
const originals = new Map([...new Set(controls.map((control) => join(control.directory, control.file)))].map((path) => [path, readFileSync(path, 'utf8')]));

// Drift guard: `--check-anchors` verifies every anchor against the current builds and runs no suite.
if (anchorCheckRequested()) {
  const plants = controls.flatMap((control) => {
    const path = join(control.directory, control.file);
    return (control.edits ?? [{ anchor: control.anchor }]).map((edit) => ({ control: control.name, file: path, text: originals.get(path), anchor: edit.anchor }));
  });
  process.exit(reportAnchorCheck(anchorProblems(plants), controls.length));
}

/** Restore every emitted file a control may have planted into. */
function restoreAll() {
  for (const [path, content] of originals) {
    writeFileSync(path, content);
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

/** Run the operation suites once in a fresh temporary directory and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'operations-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', 'jest.config.mjs', '--runInBand', '--json', `--outputFile=${out}`, '--testTimeout=30000', '--runTestsByPath', ...suites.map((suite) => `.test-build/test/operations/${suite}`)], { cwd: core, stdio: 'ignore' });
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
    const path = join(control.directory, control.file);
    const original = originals.get(path);
    // A control plants one edit, or several edits that together remove one behavior.
    const edits = control.edits ?? [{ anchor: control.anchor, replacement: control.replacement }];
    const counts = edits.map((edit) => original.split(edit.anchor).length - 1);
    if (counts.some((count) => count !== 1)) {
      console.log(`ANCHOR ${counts.join('/')}x: ${control.name}`);
      failures += 1;
      continue;
    }
    writeFileSync(path, edits.reduce((text, edit) => text.replace(edit.anchor, edit.replacement), original));
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
for (const [path, content] of originals) {
  if (readFileSync(path, 'utf8') !== content) {
    console.log(`NOT RESTORED: ${path}`);
    failures += 1;
  }
}
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${String(controls.length)} controls`);
process.exit(failures > 0 ? 1 : 0);
