/**
 * Negative controls for the M5 independent-process acceptance suite
 * (issue #122). Each control plants exactly one wrong behavior into an
 * owner's emitted production build (never TypeScript source): Run
 * Supervision's operation engine, run engine and execution controls,
 * History's durable lease authority and candidate lookup, Resource
 * Accounting's durable adapter and summary, or the facade's writer port. It
 * then reruns the unchanged M5 acceptance suites, whose worker processes load
 * those builds through the built facade.
 *
 * The controls cover the guards the M5 exit names: stop, deferral, no blind
 * replay, accounting exactly once, fencing and privacy, plus environment
 * isolation and run-scope lifecycle. Every control names the planned evidence
 * cases (the suites' `describe` titles) it is predicted to break, written
 * before the control ran; a control fails the run when any predicted case
 * still passes, when no test fails at all, or when any of its anchors does
 * not match exactly once. A control is one defect, which may need
 * coordinated edits. Each Jest run is judged fail-closed by the facade's
 * shared `control-outcome.mjs` against exactly the ten M5 suites. Every
 * planted file is restored after its control, on error, and on
 * SIGINT/SIGTERM/SIGHUP, and final bytes are compared with the originals.
 *
 * Two weakenings are deliberately absent because this layer cannot observe
 * them, and owner-level controls already cover them: a holder guard without
 * its fence check is masked here because the facade names every run's lease
 * holder uniquely (the concurrency controls of #110 plant it with shared
 * holder names), and a waiter that ignores the operator deadline would only
 * hang the waiting process (the concurrency controls run it against bounded
 * owner tests).
 *
 * On-demand evidence command, not part of `npm test`: run `npm run build` and
 * `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/m5-acceptance/controls/m5-mutation-controls.mjs`.
 * `--check-anchors` verifies that every anchor matches exactly once in the
 * current builds and exits without running any suite; `--only <text>` runs
 * only the controls whose name contains `<text>`.
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
  engine: join(root, 'packages/supervision/dist/src/operation-engine.js'),
  records: join(root, 'packages/supervision/dist/src/records.js'),
  supervision: join(root, 'packages/supervision/dist/src/supervision.js'),
  execution: join(root, 'packages/supervision/dist/src/execution.js'),
  history: join(root, 'packages/history/dist/src/durable/index.js'),
  accounting: join(root, 'packages/accounting/dist/src/sqlite/index.js'),
  summary: join(root, 'packages/accounting/dist/src/summary.js'),
  port: join(root, 'packages/core/dist/src/writer.js'),
});

/** The M5 acceptance suite files every run must execute. */
const suites = Object.freeze([
  'deferral.test.js',
  'environments.test.js',
  'lifecycle.test.js',
  'outcome-fold.test.js',
  'privacy.test.js',
  'publication.test.js',
  'replay.test.js',
  'stop.test.js',
  'usage.test.js',
  'writer.test.js',
]);

/**
 * One planted defect per control, grouped by the guard it removes, with the
 * planned evidence cases predicted to reject it. Predictions follow from the
 * owning contracts, not from a run. A control is either one
 * `{ target, anchor, replacement }` edit or an `edits` list applied together.
 */
const controls = [
  // Stop (RUN-014): no admission or retry after a soft stop; a hard stop ends every wait and records remote state.
  {
    guard: 'stop',
    name: 'a soft stop admits new work',
    target: 'supervision',
    anchor: 'if (!state.stopped.signal.aborted || isDraining(demandedBy)) {',
    replacement: 'if (true) {',
    breaks: ['soft-then-hard-stop'],
  },
  {
    // Two coordinated edits: the send-time refusal, and the permit wait that a stop cancels for a retry.
    guard: 'stop',
    name: 'a soft stop does not refuse a retry',
    edits: [
      { target: 'execution', anchor: "if (level === 'soft' && retry) {", replacement: 'if (false) {' },
      {
        target: 'execution',
        anchor: 'run.permits.acquire(retry || attempt === undefined ? run.stopped.signal : run.hard.signal)',
        replacement: 'run.permits.acquire(attempt === undefined ? run.stopped.signal : run.hard.signal)',
      },
    ],
    breaks: ['soft-then-hard-stop'],
  },
  {
    guard: 'stop',
    name: 'a stop does not end a deferral sleep',
    target: 'supervision',
    anchor: 'const remove = state.stopped.signal.onAbort(() => {\n                    cancel();\n                    resolve(false);\n                });',
    replacement: 'const remove = () => undefined;',
    breaks: ['soft-then-hard-stop'],
  },
  {
    guard: 'stop',
    name: "a hard stop's remote state is not made durable",
    target: 'engine',
    anchor: "const settledRemotely = sent.remote === 'cancelled';",
    replacement: "const settledRemotely = sent.remote === 'cancelled'; if (settledRemotely || !settledRemotely) { return { stored: current, outcome: { kind: 'error', error: new SupervisionError('stopped', 'aborted') } }; }",
    breaks: ['soft-then-hard-stop'],
  },
  // Deferral (RUN-011): "not before T" is durable, holds no permit or lane, releases the lease, and keeps its identity.
  {
    guard: 'deferral',
    name: 'a deferral is not honored before its time',
    target: 'engine',
    anchor: "if (record.status === 'deferred' && record.notBefore !== undefined && now() < record.notBefore) {",
    replacement: 'if (false) {',
    breaks: ['durable-quota-deferral'],
  },
  {
    guard: 'deferral',
    name: 'the writer lease is kept while only deferred work remains',
    target: 'supervision',
    anchor: 'if (passes.active > 0) {',
    replacement: 'if (true) {',
    breaks: ['durable-quota-deferral'],
  },
  {
    guard: 'deferral',
    name: 'a timed wait keeps its window lane',
    target: 'execution',
    anchor: 'lendLane(lane);',
    replacement: 'void lane;',
    breaks: ['durable-quota-deferral'],
  },
  {
    guard: 'deferral',
    name: 'an unsettled address is forgotten, so a resumed deferral mints a new operation',
    target: 'engine',
    anchor: 'let stored = locate(subject, request.name, request.binding);',
    replacement: 'let stored = undefined;',
    breaks: ['durable-quota-deferral'],
  },
  // No blind replay (RUN-012): an unknown outcome is retried only with a safety basis, never by a tainted attempt.
  {
    guard: 'no-replay',
    name: 'an unknown outcome is replayed blindly',
    target: 'records',
    anchor: 'export function unknownRetry(record, spent) {',
    replacement: "export function unknownRetry(record, spent) { return 'retry';",
    breaks: ['no-blind-replay'],
  },
  {
    guard: 'no-replay',
    name: 'a tainted step attempt keeps sending',
    target: 'engine',
    anchor: 'if (attempt.pending !== undefined) {',
    replacement: 'if (false) {',
    breaks: ['no-blind-replay'],
  },
  {
    guard: 'no-replay',
    name: 'an address resolved as succeeded is minted and sent again',
    target: 'records',
    anchor: "return isUnsettled(record.status) || (record.status === 'resolved' && record.settlement?.outcome === 'succeeded');",
    replacement: 'return isUnsettled(record.status);',
    breaks: ['operator-resolves-unknown'],
  },
  {
    guard: 'no-replay',
    name: 'the provider idempotency key is not sent',
    target: 'engine',
    anchor: 'idempotencyKey: request.providerIdempotency ? operation : undefined',
    replacement: 'idempotencyKey: undefined',
    breaks: ['no-blind-replay', 'usage-exactly-once'],
  },
  // Accounting exactly once (ACC-003, ACC-005, ACC-007): every report once, unknown never zero.
  {
    guard: 'accounting',
    name: 'a usage report is acknowledged twice',
    target: 'engine',
    anchor: "emit('usage-acknowledged', record,",
    replacement: "ports.accounting.acknowledgeUsage({ environment: context.environment, operation: record.operation, requestAttempt, report: `provider:${usage.report}#again`, quantities: usage.quantities }); emit('usage-acknowledged', record,",
    breaks: ['usage-exactly-once'],
  },
  {
    guard: 'accounting',
    name: 'an unknown outcome is reported as zero usage',
    target: 'engine',
    anchor: "const unknown = settledAs('unknown', 'unknown');",
    replacement: "ports.accounting.acknowledgeUsage({ environment: context.environment, operation, requestAttempt, report: 'provider:zero', quantities: [] }); const unknown = settledAs('unknown', 'unknown');",
    breaks: ['no-blind-replay', 'operator-resolves-unknown'],
  },
  {
    guard: 'accounting',
    name: 'the usage intent is not recorded before the send',
    target: 'engine',
    anchor: 'ports.accounting.recordUsageIntent({',
    replacement: 'void ({',
    breaks: ['usage-exactly-once'],
  },
  {
    guard: 'accounting',
    name: 'Accounting records a redelivered report again',
    target: 'accounting',
    anchor: 'const recorded = recordedReport(report.environment, report.operation, report.report);',
    replacement: "const recorded = undefined; statements.insertReport.run(report.environment, report.operation, report.report + '#redelivered', report.requestAttempt);",
    breaks: ['usage-exactly-once'],
  },
  {
    guard: 'accounting',
    name: 'Accounting keys a report identity globally rather than per operation',
    target: 'accounting',
    anchor: 'const row = statements.report.get(environment, operation, report);',
    replacement: "const row = connection.prepare('SELECT request_attempt FROM accounting_reports WHERE environment = ? AND report = ?').get(environment, report);",
    breaks: ['usage-exactly-once'],
  },
  {
    guard: 'accounting',
    name: 'Accounting counts unreported request attempts as reported (zero)',
    target: 'summary',
    anchor: '.filter((intent) => !intent.reported)',
    replacement: '.filter(() => false)',
    breaks: ['usage-exactly-once'],
  },
  // Fencing (PUB-004, ruling R): takeover only after expiry with the next fence; a stale holder cannot act.
  {
    guard: 'fence',
    name: 'the holder guard ignores lease expiry',
    target: 'history',
    anchor: 'else if (writer.expiresAt <= now) {',
    replacement: 'else if (false) {',
    breaks: ['stale-holder-interleavings'],
  },
  {
    guard: 'fence',
    name: 'acquisition takes over an unexpired holder',
    target: 'history',
    anchor: 'if (writer.holder !== null && writer.expiresAt > now) {',
    replacement: 'if (false) {',
    breaks: ['writer-wait-and-takeover'],
  },
  {
    guard: 'fence',
    name: 'a takeover reuses the previous fence',
    target: 'history',
    anchor: "const fence = safeSum(writer.lastFence, 1, 'writer fence');",
    replacement: 'const fence = writer.lastFence === 0 ? 1 : writer.lastFence;',
    breaks: ['writer-wait-and-takeover', 'stale-holder-interleavings'],
  },
  {
    guard: 'fence',
    name: "a waiter's observation advances the fence",
    target: 'history',
    anchor: "acquisition = Object.freeze({ kind: 'held', holder: writer.holder, expiresAt: writer.expiresAt });",
    replacement: "statements.setHolder.run(writer.lastFence + 1, writer.holder, writer.expiresAt); acquisition = Object.freeze({ kind: 'held', holder: writer.holder, expiresAt: writer.expiresAt });",
    breaks: ['writer-wait-and-takeover'],
  },
  {
    guard: 'fence',
    name: 'release clears the writer row without the holder guard',
    target: 'history',
    anchor: 'releaseWriter(lease) {\n            asHolder(lease, (now) => {',
    replacement: 'releaseWriter(lease) {\n            ((presented, operation) => connection.transaction(() => operation(readWriter().timeHighWater)))(lease, (now) => {',
    breaks: ['stale-holder-interleavings'],
  },
  {
    guard: 'fence',
    name: "the facade's writer port keeps a stale lease instead of acquiring afresh",
    target: 'port',
    anchor: '                    held = undefined;\n                }\n            }\n            const acquisition',
    replacement: '                    return acquired(held);\n                }\n            }\n            const acquisition',
    breaks: ['stale-holder-interleavings'],
  },
  // Privacy (RUN-013): events and diagnostics carry identifiers, codes, times and usage figures, never values.
  {
    guard: 'privacy',
    name: 'operation events carry the request binding',
    target: 'engine',
    anchor: 'name: record.name,',
    replacement: 'name: record.name, binding: record.binding,',
    breaks: ['event-privacy'],
  },
  {
    guard: 'privacy',
    name: "a diagnostic repeats the adapter's error text",
    target: 'engine',
    anchor: 'const response = classify(sent);',
    replacement: "const response = classify(sent); if (sent.kind === 'threw') { engine.diagnose(`lost-response: ${String(sent.error)}`); }",
    breaks: ['event-privacy'],
  },
  // Environment isolation (RUN-017) and run-scope lifecycle (A-18).
  {
    guard: 'environment',
    name: 'candidate lookup admits results of any environment without a promotion',
    target: 'history',
    anchor: 'AND (r.environment = ? OR EXISTS',
    replacement: 'AND (r.environment = ? OR 1 OR EXISTS',
    breaks: ['trial-production-isolation'],
  },
  {
    guard: 'lifecycle',
    name: "a closed run's context is still available to an escaped callback",
    target: 'supervision',
    anchor: 'if (!frame.run.open) {',
    replacement: 'if (false) {',
    breaks: ['lifecycle-isolation'],
  },
];

/**
 * `--only <text>` limits a run to the controls whose name contains `<text>`,
 * for investigating one control; a limited run is not the evidence run.
 */
const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex === -1 ? undefined : process.argv[onlyIndex + 1];
const selected = only === undefined ? controls : controls.filter((control) => control.name.includes(only));

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
if (process.argv.includes('--check-anchors')) {
  const problems = controls.flatMap((control) => {
    const { error } = planControl(control);
    return error === undefined ? [] : [error];
  });
  for (const problem of problems) {
    console.log(problem);
  }
  console.log(`${problems.length === 0 ? 'ANCHORS OK' : 'ANCHORS FAIL'}: ${String(controls.length)} controls`);
  process.exit(problems.length === 0 ? 0 : 1);
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

/** Run the M5 acceptance suites once and judge the run fail-closed. */
async function runSuites(expectedTitles) {
  const directory = mkdtempSync(join(tmpdir(), 'm5-acceptance-controls-'));
  reportDirectory = directory;
  try {
    const out = join(directory, 'report.json');
    const exitStatus = await new Promise((resolve, reject) => {
      running = spawn(process.execPath, ['--experimental-vm-modules', join(root, 'node_modules/jest/bin/jest.js'), '--config', join(root, 'packages/core/jest.config.mjs'), '--runInBand', '--json', `--outputFile=${out}`, '.test-build/test/m5-acceptance/'], { cwd: join(root, 'packages/core'), stdio: 'ignore' });
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
    throw new Error('the unmodified builds must pass every M5 acceptance test before controls run');
  }
  for (const control of selected) {
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
      console.log(`\n## [${control.guard}] ${control.name}: ${String(failed.length)} failing${unbroken.length === 0 ? '' : `; PREDICTED CASES STILL PASSING: ${unbroken.join(', ')}`}`);
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
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${String(selected.length)} controls${only === undefined ? '' : ` (limited to "${only}")`}`);
process.exit(failures > 0 ? 1 : 0);
