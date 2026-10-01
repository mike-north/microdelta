/**
 * Verifies the example's paid-like assessor as an operator runs it: the
 * compiled CLI over the installed workspace packages, every command a
 * separate Node process over one store directory, driving the `microdelta`
 * facade. The paid-like assessor (`--rubric P`) sends each authored PR to the
 * example's fake provider (`src/provider.ts`), which never costs anything: it
 * answers after a deterministic latency, scores a merged PR 2 and an
 * unmerged PR 1 (rubric A's scores), and reports 100 tokens of usage per
 * answered assessment and 1 request per refusal. A per-PR script in the
 * provider directory makes it rate-limit with a retry time, lose a response,
 * refuse, answer slowly or stall.
 *
 * Every expected value below is written by hand from the fixture
 * (`data/acme-widget.json`), the README's rules and the owner decisions of
 * 2026-09-30, never captured from program output:
 *
 * - Six PRs are assessed: Ada's 101 (merged), 102 (merged) and 103 (open),
 *   Ben's 201 (merged) and 202 (open), and Cy's 301 (merged). Scores: Ada
 *   2 + 2 + 1 = 5, Ben 2 + 1 = 3, Cy 2, so the report text equals rubric A's.
 *   Six answered assessments report 6 x 100 = 600 tokens.
 * - A summary calls its assessments in PR-number order; with `--window 1`
 *   members resolve one at a time in canonical key order (Ada, Ben, Cy), so
 *   the provider receives 101, 102, 103, 201, 202, 301 in that order.
 * - A rate limit with a retry time defers only its own operation durably
 *   ("not before T", T = the request's receipt time plus the retry delay);
 *   siblings finish; exit mode reports T; a later run sends nothing before T
 *   and retries under the same operation identity (RUN-011).
 * - A soft stop admits nothing new and lets the admitted step drain,
 *   including its remaining first requests; a hard stop aborts the in-flight
 *   send, records its remote state, and publishes nothing partial (RUN-014).
 * - Usage is counted exactly once per report; an attempt whose process died
 *   before its report is unknown, never zero; a lost response is unknown and
 *   never replayed until the operator settles it (ACC-005, ACC-007, RUN-012).
 * - Environments are namespaced within one store; trial results satisfy
 *   production only through a recorded promotion (RUN-017).
 * - The outcome fold reports every settled status with coverage, never
 *   completeness while a member is unsettled, and reconsiders after repair
 *   (RUN-010).
 * - A second process waits for the writer lease, without a default deadline,
 *   and fails with a typed writer-busy error naming the holder only at an
 *   operator deadline (RUN-002).
 * - The facade mints every run identifier from 128 random host bits, so two
 *   processes' runs never share one in events or journal records.
 *
 * @see ../README.md
 * @see ../../../docs/plans/m5-operations.md (Consumer outcome)
 * @see ../../../docs/spec/operations.md (RUN-002, RUN-010 to RUN-014, RUN-017, ACC-003, ACC-005, ACC-007)
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const main = fileURLToPath(new URL('../dist/main.js', import.meta.url));

const ada = 'person:ada';
const ben = 'person:ben';
const cy = 'person:cy';
const designatedKeys = [ada, ben, cy];

const header = 'Contribution report for acme/widget, 2026-01-01 to 2026-04-01 (exclusive)';

/** The complete report text at threshold 1: the paid-like assessor scores as rubric A does. */
const coldText = [
  header,
  'Required: contributors with at least 1 authored pull request in the window',
  '- person:ada (score 5): Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.',
  '- person:ben (score 3): Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.',
  '- person:cy (score 2): Cy authored 1 pull request, 1 of which was merged, and submitted 1 review.',
  'Coverage: 3 required, 0 skipped; discovery closed',
].join('\n');

/** Every body a cold paid run executes once: discovery, three activities, three summaries, six assessments and the report. */
const coldExecutions = {
  contributors: 1,
  'person:ada/activity': 1,
  'person:ada/summary': 1,
  'person:ben/activity': 1,
  'person:ben/summary': 1,
  'person:cy/activity': 1,
  'person:cy/summary': 1,
  assessor: 6,
  report: 1,
};

/** A fresh store directory, removed after `body`. */
async function withStore(body) {
  const store = mkdtempSync(path.join(tmpdir(), 'microdelta-paid-'));
  try {
    await body(store);
  } finally {
    rmSync(store, { recursive: true, force: true });
  }
}

/** Write the provider's per-PR response script into the store's provider directory. */
function script(store, responses) {
  mkdirSync(path.join(store, 'provider'), { recursive: true });
  writeFileSync(path.join(store, 'provider', 'script.json'), `${JSON.stringify({ responses })}\n`);
}

/** The provider's ledger lines, in order. */
function ledger(store) {
  const file = path.join(store, 'provider', 'ledger.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line)) : [];
}

/** The PR numbers of one kind of ledger line, in order. */
function numbers(store, kind) {
  return ledger(store).filter((entry) => entry.kind === kind).map((entry) => entry.pullRequest);
}

/** Run one CLI command as its own process and parse its JSON output. */
function cli(...args) {
  const result = spawnSync(process.execPath, [main, ...args, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Start one CLI command as its own process; resolves with its exit status, signal and output. */
function started(...args) {
  const child = spawn(process.execPath, [main, ...args, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolve) => {
    child.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
  return { child, exited };
}

/** Poll until `condition` holds, failing with `description` after `timeout` milliseconds. */
async function until(condition, description, timeout = 20_000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting until ${description}`);
    }
    await delay(10);
  }
}

/** The operation events of a run's output, as `phase:status:reason@member` strings. */
function trace(output) {
  return output.events.filter((event) => event.kind === 'operation').map((event) => `${event.phase}${event.status === undefined ? '' : `:${event.status}`}${event.reason === undefined ? '' : `:${event.reason}`}@${event.member ?? '-'}`);
}

/** The usage summary fields a test asserts, by hand. */
function usageOf(output) {
  const { status, observed, unknown, operations, reports, requestAttempts } = output.usage;
  return { status, observed, unknown: unknown.length, operations, reports, requestAttempts };
}

/** The operation view of one PR in an `operations` output, found by the provider's ledger. */
function operationOf(store, operations, pullRequest) {
  const ids = new Set(ledger(store).filter((entry) => entry.pullRequest === pullRequest).map((entry) => entry.operation));
  return operations.operations.filter((view) => ids.has(view.operation));
}

test('paid-like-assessor-cold-run: six paid assessments, each usage report counted once, and a rerun pays nothing', () => {
  return withStore((store) => {
    const cold = cli('run', '--store', store, '--rubric', 'P');
    assert.equal(cold.text, coldText);
    assert.deepEqual(cold.executions, coldExecutions);
    assert.deepEqual([...numbers(store, 'received')].sort(), [101, 102, 103, 201, 202, 301]);
    assert.deepEqual([...numbers(store, 'applied')].sort(), [101, 102, 103, 201, 202, 301]);
    assert.deepEqual(usageOf(cold), { status: 'complete', observed: [{ unit: 'tokens', amount: 600 }], unknown: 0, operations: 6, reports: 6, requestAttempts: 6 });
    assert.equal(cold.waitingUntil, null);
    assert.match(cold.runId, /^run:[0-9a-f]{32}$/u);

    // A restart reuses every assessment: nothing is sent, and the usage total is unchanged.
    const rerun = cli('run', '--store', store, '--rubric', 'P');
    assert.equal(rerun.text, coldText);
    assert.deepEqual(rerun.executions, {});
    assert.equal(ledger(store).filter((entry) => entry.kind === 'received').length, 6);
    assert.deepEqual(usageOf(rerun), usageOf(cold));
    assert.notEqual(rerun.runId, cold.runId);
  });
});

test('durable-quota-deferral: exit mode reports "waiting until T", a run before T sends nothing, a resume run after T retries the same operation, and no two processes share a run ID', () => {
  return withStore(async (store) => {
    // Ben's merged PR 201 is rate-limited with a retry delay of 3 s; everything else answers.
    script(store, { 201: ['rate-limit:3000'] });
    const first = cli('run', '--store', store, '--rubric', 'P', '--deferral', 'exit');
    const [refused] = ledger(store).filter((entry) => entry.kind === 'received' && entry.pullRequest === 201);
    const T = refused.at + 3_000;
    assert.equal(first.waitingUntil, T);
    assert.equal(first.text, [
      'Report waiting: discovery is closed; pending members: person:ben',
      `Deferred work waits until ${new Date(T).toISOString()}`,
    ].join('\n'));
    // Only Ben's member waits: Ada and Cy finish; Ben's summary stopped at 201, so 202 was never sent.
    assert.deepEqual(Object.fromEntries(designatedKeys.map((key) => [key, first.members[key].status])), { [ada]: 'succeeded', [ben]: 'pending', [cy]: 'succeeded' });
    assert.deepEqual([...numbers(store, 'received')].sort(), [101, 102, 103, 201, 301]);
    assert.deepEqual(usageOf(first), { status: 'complete', observed: [{ unit: 'requests', amount: 1 }, { unit: 'tokens', amount: 400 }], unknown: 0, operations: 5, reports: 5, requestAttempts: 5 });

    // A run before T admits nothing of Ben's deferred work and sends nothing; it reports the same T.
    const early = cli('run', '--store', store, '--rubric', 'P', '--deferral', 'exit');
    assert.ok(Date.now() < T, 'precondition: the early run finished before T (the host was too slow for this case)');
    assert.equal(early.waitingUntil, T);
    assert.equal(early.members[ben].status, 'pending');
    assert.deepEqual(early.members[ben].blocked, { kind: 'deferred', operation: refused.operation, notBefore: T });
    assert.ok(trace(early).includes(`blocked:deferred:not-before@${ben}`), JSON.stringify(trace(early)));
    assert.deepEqual([...numbers(store, 'received')].sort(), [101, 102, 103, 201, 301]);

    // After T, the resume run retries 201 under the same operation, then sends 202; nothing else executes.
    await delay(Math.max(0, T - Date.now()) + 50);
    const resumed = cli('run', '--store', store, '--rubric', 'P');
    assert.equal(resumed.text, coldText);
    assert.equal(resumed.waitingUntil, null);
    assert.deepEqual(resumed.executions, { 'person:ben/summary': 1, assessor: 2, report: 1 });
    const requests201 = ledger(store).filter((entry) => entry.kind === 'received' && entry.pullRequest === 201);
    assert.equal(requests201.length, 2);
    assert.equal(requests201[1].operation, requests201[0].operation);
    assert.notEqual(requests201[1].requestAttempt, requests201[0].requestAttempt);
    assert.ok(requests201[1].at >= T, `the retry was sent at ${String(requests201[1].at)}, before T ${String(T)}`);
    assert.deepEqual(numbers(store, 'received').filter((number) => number === 202), [202]);
    // Six answered assessments (600 tokens) and the one refusal (1 request), each report once.
    assert.deepEqual(usageOf(resumed), { status: 'complete', observed: [{ unit: 'requests', amount: 1 }, { unit: 'tokens', amount: 600 }], unknown: 0, operations: 6, reports: 7, requestAttempts: 7 });

    // Three processes, three run identifiers: every event and journal record names its own process's run.
    const runs = [first.runId, early.runId, resumed.runId];
    for (const runId of runs) {
      assert.match(runId, /^run:[0-9a-f]{32}$/u);
    }
    assert.equal(new Set(runs).size, 3);
    for (const output of [first, early, resumed]) {
      assert.deepEqual([...new Set(output.events.map((event) => event.runId))], [output.runId]);
    }
    const inspected = cli('operations', '--store', store);
    const [operation201] = operationOf(store, inspected, 201);
    assert.deepEqual(operation201.attempts.map((attempt) => attempt.run), [first.runId, resumed.runId]);
    for (const view of inspected.operations) {
      for (const attempt of view.attempts) {
        assert.ok(attempt.run === first.runId || attempt.run === resumed.runId, `journal attempt of an unknown run ${String(attempt.run)}`);
      }
    }
  });
});

test('soft-then-hard-stop: a soft stop admits nothing new while the admitted step drains; a hard stop aborts the in-flight send and publishes nothing partial', () => {
  return withStore(async (store) => {
    // 102 answers after 1.5 s; 103 stalls until aborted. With a window of one, Ada's summary runs alone.
    script(store, { 102: ['slow:1500'], 103: ['stall'] });
    const run = started('run', '--store', store, '--rubric', 'P', '--window', '1');
    await until(() => numbers(store, 'received').includes(102), 'the provider received 102');
    run.child.kill('SIGINT');
    // The soft stop lets Ada's admitted summary drain: 102 completes and its next first request, 103, is still sent.
    await until(() => numbers(store, 'received').includes(103), 'the draining summary sent 103');
    run.child.kill('SIGINT');
    const { status, stdout, stderr } = await run.exited;
    assert.equal(status, 0, stderr);
    const output = JSON.parse(stdout);
    assert.deepEqual(output.stop, { level: 'hard', cause: 'operator', deadline: null });
    assert.deepEqual(output.events.filter((event) => event.kind === 'stop').map((event) => event.level), ['soft', 'hard']);
    // Nothing was admitted after the soft stop: Ben's and Cy's members never sent a request.
    assert.deepEqual(numbers(store, 'received'), [101, 102, 103]);
    assert.deepEqual(numbers(store, 'applied'), [101, 102]);
    assert.deepEqual(numbers(store, 'aborted'), [103]);
    assert.deepEqual(Object.fromEntries(designatedKeys.map((key) => [key, output.members[key].status])), { [ada]: 'cancelled', [ben]: 'cancelled', [cy]: 'cancelled' });
    assert.equal(output.report, null);
    assert.notEqual(output.fold.status, 'succeeded');
    // 101 and 102 were answered (200 tokens); the aborted 103 never reported, so its usage is unknown, never zero.
    assert.deepEqual(usageOf(output), { status: 'incomplete', observed: [{ unit: 'tokens', amount: 200 }], unknown: 1, operations: 3, reports: 2, requestAttempts: 3 });
    // The aborted request's remote state is recorded: the provider offers no cancellation, so it is unknown.
    const inspected = cli('operations', '--store', store);
    const [operation103] = operationOf(store, inspected, 103);
    assert.equal(operation103.status, 'unknown');
    assert.deepEqual(operation103.attempts.map((attempt) => attempt.remote), ['unknown']);
  });
});

test('usage-exactly-once: SIGKILL mid-request leaves that usage unknown, never zero and never replayed; reruns count every report once; the operator abandons the unknown', () => {
  return withStore(async (store) => {
    // With a window of one, Ada's three assessments complete before Ben's 201, which stalls; the process is then killed.
    // Its one-second writer lease lets the next process take over soon after (a dead holder's lease must expire first).
    script(store, { 201: ['stall'] });
    const killed = started('run', '--store', store, '--rubric', 'P', '--window', '1', '--lease-ms', '1000');
    await until(() => numbers(store, 'received').includes(201), 'the provider received 201');
    killed.child.kill('SIGKILL');
    assert.equal((await killed.exited).signal, 'SIGKILL');
    assert.deepEqual(numbers(store, 'received'), [101, 102, 103, 201]);

    // Inspection needs no writer: the dead run's 201 is still pending, and its usage is already unknown.
    const afterKill = cli('operations', '--store', store);
    assert.deepEqual(usageOf(afterKill), { status: 'incomplete', observed: [{ unit: 'tokens', amount: 300 }], unknown: 1, operations: 4, reports: 3, requestAttempts: 4 });
    assert.deepEqual(operationOf(store, afterKill, 201).map((view) => view.status), ['pending']);

    // The next run records the in-flight operation unknown and never replays it; Cy's 301 is answered.
    const second = cli('run', '--store', store, '--rubric', 'P');
    assert.ok(trace(second).includes(`recovered:unknown:recovered-after-crash@${ben}`), JSON.stringify(trace(second)));
    assert.equal(second.members[ben].status, 'pending');
    assert.deepEqual(second.members[ben].blocked, { kind: 'unknown-outcome', operation: operationOf(store, afterKill, 201)[0].operation, reason: 'not-repeat-safe' });
    assert.deepEqual(numbers(store, 'received'), [101, 102, 103, 201, 301]);
    assert.deepEqual(usageOf(second), { status: 'incomplete', observed: [{ unit: 'tokens', amount: 400 }], unknown: 1, operations: 5, reports: 4, requestAttempts: 5 });

    // Another run changes nothing: no request is sent and no report is counted twice.
    const third = cli('run', '--store', store, '--rubric', 'P');
    assert.deepEqual(numbers(store, 'received'), [101, 102, 103, 201, 301]);
    assert.deepEqual(usageOf(third), usageOf(second));

    // The operator abandons the unknown operation: its usage stays unknown, and the address is free again.
    const unknown = operationOf(store, cli('operations', '--store', store), 201)[0].operation;
    const settled = cli('settle', '--store', store, '--operation', unknown, '--abandon', '--operator', 'operator.ada');
    assert.equal(settled.operation.status, 'abandoned');
    const repaired = cli('run', '--store', store, '--rubric', 'P');
    assert.equal(repaired.text, coldText);
    const requests201 = ledger(store).filter((entry) => entry.kind === 'received' && entry.pullRequest === 201);
    assert.equal(requests201.length, 2);
    assert.notEqual(requests201[1].operation, requests201[0].operation);
    // Six answered assessments are 600 tokens; the killed attempt is still unknown, so the total is incomplete.
    assert.deepEqual(usageOf(repaired), { status: 'incomplete', observed: [{ unit: 'tokens', amount: 600 }], unknown: 1, operations: 7, reports: 6, requestAttempts: 7 });
  });
});

test('trial-production-isolation: a trial run, then a recorded promotion, then production reuses every promoted result and pays nothing', () => {
  return withStore((store) => {
    const trial = cli('run', '--store', store, '--rubric', 'P', '--environment', 'trial');
    assert.equal(trial.text, coldText);
    assert.equal(numbers(store, 'received').length, 6);

    // Before a promotion, production has nothing to reuse: trial results never satisfy it.
    const unpromoted = cli('check', '--store', store, '--rubric', 'P', '--environment', 'production');
    assert.notEqual(unpromoted.checked.discovery.kind, 'reusable');

    // The promotion names every result the trial report rests on: discovery, three activities,
    // six assessments, three summaries and the report itself.
    const promoted = cli('promote', '--store', store, '--rubric', 'P', '--from', 'trial', '--to', 'production');
    assert.equal(promoted.promotion.references.length, 14);
    assert.ok(promoted.promotion.references.includes(trial.fold.reference));
    for (const key of designatedKeys) {
      assert.ok(promoted.promotion.references.includes(trial.members[key].reference));
    }
    assert.deepEqual(promoted.promotion.target, { analysis: 'contribution-report:acme/widget:2026-Q1', environment: 'production' });

    const production = cli('run', '--store', store, '--rubric', 'P', '--environment', 'production');
    assert.equal(production.text, coldText);
    assert.deepEqual(production.executions, {});
    assert.equal(production.fold.kind, 'reused');
    assert.equal(production.fold.reference, trial.fold.reference);
    for (const key of designatedKeys) {
      assert.deepEqual(production.members[key], { status: 'succeeded', kind: 'reused', reference: trial.members[key].reference });
    }
    // Production paid for nothing: no request was sent, and its accounting is its own.
    assert.equal(numbers(store, 'received').length, 6);
    assert.deepEqual(usageOf(production), { status: 'complete', observed: [], unknown: 0, operations: 0, reports: 0, requestAttempts: 0 });
    assert.deepEqual(usageOf(trial), { status: 'complete', observed: [{ unit: 'tokens', amount: 600 }], unknown: 0, operations: 6, reports: 6, requestAttempts: 6 });
    const promotions = cli('operations', '--store', store, '--environment', 'production').promotions;
    assert.deepEqual(promotions.map((promotion) => promotion.promotionId), [promoted.promotion.promotionId]);
  });
});

test('outcome-fold-coverage: the status report never claims completeness while a member is unsettled, reports a failure with coverage, and reconsiders after repair', () => {
  return withStore((store) => {
    // 201's response is lost (unknown, never replayed); 301 is refused twice, then answered.
    script(store, { 201: ['lost'], 301: ['refuse', 'refuse', 'ok'] });
    const waiting = cli('status', '--store', store, '--rubric', 'P');
    assert.deepEqual(waiting.outcome, {
      status: 'waiting',
      coverage: { succeeded: [ada], skipped: [], failed: [cy], cancelled: [], pending: [ben], openDiscovery: false, complete: false },
    });
    assert.equal(waiting.text, [
      'Contributor status waiting: pending person:ben',
      'Coverage so far: 1 succeeded, 0 skipped, 1 failed, 0 cancelled, 1 pending; discovery closed',
    ].join('\n'));

    // The operator abandons the lost response's operation; Ben is answered on the next run, Cy is refused again.
    const unknown = operationOf(store, cli('operations', '--store', store), 201).find((view) => view.status === 'unknown').operation;
    cli('settle', '--store', store, '--operation', unknown, '--abandon', '--operator', 'operator.ada');
    const folded = cli('status', '--store', store, '--rubric', 'P');
    assert.equal(folded.outcome.status, 'folded');
    assert.deepEqual(folded.outcome.coverage, { succeeded: [ada, ben], skipped: [], failed: [cy], cancelled: [], pending: [], openDiscovery: false, complete: true });
    assert.equal(folded.text, [
      'Contributor status for acme/widget, 2026-01-01 to 2026-04-01 (exclusive)',
      '- person:ada: succeeded (score 5)',
      '- person:ben: succeeded (score 3)',
      '- person:cy: failed',
      'Coverage: 2 succeeded, 0 skipped, 1 failed, 0 cancelled; discovery closed',
    ].join('\n'));

    // Cy's third request is answered: the repaired member changes the fold's input, so it runs again.
    const repaired = cli('status', '--store', store, '--rubric', 'P');
    assert.equal(repaired.outcome.status, 'folded');
    assert.equal(repaired.outcome.kind, 'published');
    assert.notEqual(repaired.outcome.reference, folded.outcome.reference);
    assert.deepEqual(repaired.outcome.coverage, { succeeded: [ada, ben, cy], skipped: [], failed: [], cancelled: [], pending: [], openDiscovery: false, complete: true });
    assert.equal(repaired.text.split('\n')[3], '- person:cy: succeeded (score 2)');
    assert.deepEqual(numbers(store, 'received').filter((number) => number === 301), [301, 301, 301]);
  });
});

test('writer-wait-and-takeover: a second process waits for the lease instead of failing, and an operator deadline yields writer-busy naming the holder', () => {
  return withStore(async (store) => {
    // Ada's 101 answers after 3 s, so the first process holds the writer lease meanwhile.
    script(store, { 101: ['slow:3000'] });
    const holder = started('run', '--store', store, '--rubric', 'P');
    await until(() => numbers(store, 'received').includes(101), 'the holder sent 101');

    // With a 300 ms operator deadline, a second process fails with the typed writer-busy error naming the holder.
    const busy = spawnSync(process.execPath, [main, 'run', '--store', store, '--rubric', 'P', '--writer-deadline-ms', '300'], { encoding: 'utf8' });
    assert.equal(busy.status, 1);
    assert.match(busy.stderr, /^writer-busy: Storage's writer lease is held by microdelta-run:run:[0-9a-f]{32} until \d+; the operator deadline \d+ passed\n$/u);

    // Without a deadline, a second process started while the holder's request is still in flight waits.
    assert.deepEqual(numbers(store, 'applied'), []);
    const waiter = started('run', '--store', store, '--rubric', 'P');
    const held = await holder.exited;
    assert.equal(held.status, 0, held.stderr);
    const first = JSON.parse(held.stdout);
    assert.equal(first.text, coldText);
    assert.ok(busy.stderr.includes(`microdelta-run:${first.runId} `), busy.stderr);
    const waited = await waiter.exited;
    assert.equal(waited.status, 0, waited.stderr);
    const second = JSON.parse(waited.stdout);
    // The waiter ran after the holder published: it reused every result and sent nothing.
    assert.equal(second.text, coldText);
    assert.deepEqual(second.executions, {});
    assert.equal(second.fold.reference, first.fold.reference);
    assert.equal(numbers(store, 'received').length, 6);
    assert.notEqual(second.runId, first.runId);
  });
});

test('the example rejects malformed operational command lines with a usage message', () => {
  const usage = /usage: main\.js /u;
  return withStore((store) => {
    for (const args of [
      ['run', '--store', store, '--deferral', 'later'],
      ['run', '--store', store, '--window', '0'],
      ['run', '--store', store, '--permits', 'many'],
      ['run', '--store', store, '--writer-deadline-ms', '-5'],
      ['run', '--store', store, '--lease-ms', '0'],
      ['run', '--store', store, '--environment', 'staging'],
      ['settle', '--store', store, '--abandon'],
      ['settle', '--store', store, '--operation', 'op', '--resolve', 'maybe'],
      ['settle', '--store', store, '--operation', 'op', '--abandon', '--resolve', 'failed'],
      ['promote', '--store', store, '--from', 'trial'],
      ['promote', '--store', store, '--from', 'trial', '--to', 'trial'],
      ['operations', '--store', store, '--rubric', 'P'],
    ]) {
      const result = spawnSync(process.execPath, [main, ...args], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${args.join(' ')} unexpectedly succeeded`);
      assert.match(result.stderr, usage, args.join(' '));
    }
  });
});
