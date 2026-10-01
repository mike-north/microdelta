/**
 * Process-termination and stale-holder evidence for History's durable
 * authority (PUB-001–004, A-09/A-10). Every scenario runs lifecycle steps in
 * independent Node child processes against one real SQLite file through the
 * production authority, kills them with SIGKILL at a selected boundary, and
 * inspects the reopened file from this separate test process. This proves the
 * selected single-file process-termination scope only: not concurrent writers,
 * power loss, filesystem failure or M5 safety.
 *
 * @see ../../../../docs/spec/execution.md (PUB-001 through PUB-004)
 * @see ../../../../experiments/exp-7/README.md (retained protocol model)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, test } from '@jest/globals';
import { StaleWriterError } from '@microdelta/history';
import type { IAttemptRequest, IDurableHistory, IWriterLease } from '@microdelta/history';

import { expectClean, expectKilled, runWorker, valueOf } from './processes.js';
import { adaActivity, cleanup, controlledClock, freshLocation, openHistory, openRaw, scope } from './support.js';

afterEach(cleanup);

/** A stable execution request for Ada's summary. */
function request(attemptKey: string, intentDigest = 'intent:summary:v1'): IAttemptRequest {
  return { ...scope, subject: 'summary:acme/widget:2026-Q1:person:ada', version: 1, attemptKey, intentDigest };
}

/**
 * Seed one completed, current result for the subject in its own process and
 * return its exact locator. Every kill scenario asserts it stays readable.
 */
function seedPrevious(location: string): string {
  const trace = expectClean(runWorker(location, [
    { op: 'time', at: 1_000 },
    { op: 'acquire', holder: 'seed', lease: 100 },
    { op: 'allocate', request: request('seed-request') },
    { op: 'stage', payload: adaActivity({ name: 'Ada (seed)' }), label: 'seed' },
    { op: 'publish' },
    { op: 'release' },
  ]));
  return valueOf<{ locator: string }>(trace[4]).locator;
}

/** Durable state that the tests compare across process boundaries. */
interface IDurableSnapshot {
  readonly writer: IWriterLease | undefined;
  readonly current: string | undefined;
  readonly attempts: readonly string[];
  readonly results: number;
}

/** Inspect durable state through a fresh handle in this process. */
function inspect(location: string): IDurableSnapshot {
  const raw = openRaw(location);
  const attempts = raw.prepare('SELECT attempt_id, attempt_key, state, staged_payload IS NOT NULL AS has_staged FROM history_attempts ORDER BY attempt_id').all()
    .map((row) => `${String(row.attempt_id)}:${String(row.attempt_key)}:${String(row.state)}:${String(row.has_staged)}`);
  const results = raw.prepare('SELECT count(*) AS n FROM history_results').get()?.n;
  raw.close();
  const history = openHistory({ location });
  const snapshot = {
    writer: history.currentWriter(),
    current: history.readCurrent({ ...scope, subject: request('x').subject })?.locator,
    attempts,
    results: typeof results === 'number' ? results : -1,
  };
  history.close();
  return snapshot;
}

/** Open History with a clock at `now` for follow-up assertions in this process. */
function reopenAt(location: string, now: number): IDurableHistory {
  return openHistory({ location, clock: controlledClock(now) });
}

describe('process death at each publication boundary', () => {
  test('a kill after acquisition leaves the lease until expiry, then a successor gets a larger fence', () => {
    const location = freshLocation();
    const seed = seedPrevious(location);
    expectKilled(runWorker(location, [
      { op: 'time', at: 2_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'kill' },
    ]), 2);

    const early = expectClean(runWorker(location, [{ op: 'time', at: 2_050 }, { op: 'acquire', holder: 'successor', lease: 100 }]));
    expect(valueOf(early[1])).toEqual({ kind: 'held', holder: 'killed', expiresAt: 2_100 });

    const later = expectClean(runWorker(location, [{ op: 'time', at: 2_100 }, { op: 'acquire', holder: 'successor', lease: 100 }]));
    // Seed consumed fence 1 and the killed holder fence 2; the successor must get 3.
    expect(valueOf(later[1])).toEqual({ kind: 'acquired', lease: { holder: 'successor', fence: 3, expiresAt: 2_200 } });

    const history = reopenAt(location, 2_150);
    expect(history.readCurrent({ ...scope, subject: request('x').subject })?.locator).toBe(seed);
    expect(history.reader.readSelected({ kind: 'completed-result', locator: seed }, { operation: 'value', address: [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'name' }] }).fact).toBe('Ada (seed)');
  });

  test('a kill after the allocation commit consumes that attempt identity without a result', () => {
    const location = freshLocation();
    const seed = seedPrevious(location);
    const killed = runWorker(location, [
      { op: 'time', at: 2_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'allocate', request: request('allocated-then-killed') },
      { op: 'kill' },
    ]);
    expectKilled(killed, 3);
    const allocated = valueOf<{ attemptId: number; state: string }>(killed.trace[2]);
    expect(allocated.state).toBe('allocated');

    expect(inspect(location)).toMatchObject({ current: seed, results: 1, attempts: ['1:seed-request:completed:0', `${String(allocated.attemptId)}:allocated-then-killed:allocated:0`] });

    const next = expectClean(runWorker(location, [
      { op: 'time', at: 2_200 },
      { op: 'acquire', holder: 'successor', lease: 100 },
      { op: 'allocate', request: request('fresh-request') },
      { op: 'recover', request: request('allocated-then-killed') },
    ]));
    expect(valueOf<{ attemptId: number }>(next[2]).attemptId).toBeGreaterThan(allocated.attemptId);
    expect(valueOf(next[3])).toMatchObject({ kind: 'incomplete', attempt: { attemptId: allocated.attemptId, state: 'allocated' } });
  });

  test('a kill inside the allocation transaction leaves no attempt and issues no identity', () => {
    const location = freshLocation();
    seedPrevious(location);
    const before = inspect(location);
    expectKilled(runWorker(location, [
      { op: 'time', at: 2_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'arm', role: 'allocate' },
      { op: 'allocate', request: request('killed-inside-allocation') },
    ]), 3);

    expect(inspect(location).attempts).toEqual(before.attempts);
    const next = expectClean(runWorker(location, [
      { op: 'time', at: 2_200 },
      { op: 'recover', request: request('killed-inside-allocation') },
      { op: 'acquire', holder: 'successor', lease: 100 },
      { op: 'allocate', request: request('killed-inside-allocation') },
    ]));
    expect(valueOf(next[1])).toEqual({ kind: 'absent' });
    // The rolled-back allocation never issued its identity, so the next one is seed + 1.
    expect(valueOf<{ attemptId: number }>(next[3]).attemptId).toBe(2);
  });

  test('a kill after the staging commit leaves candidate evidence that is not a result', () => {
    const location = freshLocation();
    const seed = seedPrevious(location);
    expectKilled(runWorker(location, [
      { op: 'time', at: 2_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'allocate', request: request('staged-then-killed') },
      { op: 'stage', payload: adaActivity({ name: 'Ada (staged)' }), label: 'staged' },
      { op: 'kill' },
    ]), 4);

    expect(inspect(location)).toMatchObject({ current: seed, results: 1, attempts: ['1:seed-request:completed:0', '2:staged-then-killed:staged:1'] });
    const history = reopenAt(location, 2_050);
    expect(history.findCandidates({ ...scope, subject: request('x').subject, version: 1 }).map((candidate) => candidate.reference.locator)).toEqual([seed]);
    expect(history.recoverAttempt(request('staged-then-killed'))).toMatchObject({ kind: 'incomplete', attempt: { state: 'staged', result: null } });
  });

  test('a kill inside the staging transaction leaves the attempt allocated without content', () => {
    const location = freshLocation();
    const seed = seedPrevious(location);
    expectKilled(runWorker(location, [
      { op: 'time', at: 2_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'allocate', request: request('killed-inside-stage') },
      { op: 'arm', role: 'stage' },
      { op: 'stage', payload: adaActivity(), label: 'never-committed' },
    ]), 4);

    // The prior current result and the result set are intact; the killed staging left no content.
    expect(inspect(location)).toMatchObject({ current: seed, results: 1, attempts: ['1:seed-request:completed:0', '2:killed-inside-stage:allocated:0'] });
  });

  test('a kill just before the publication commit publishes nothing; a later holder publishes without rerunning the body', () => {
    const location = freshLocation();
    const seed = seedPrevious(location);
    const counter = join(dirname(location), 'body-calls.txt');
    expectKilled(runWorker(location, [
      { op: 'time', at: 2_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'allocate', request: request('killed-inside-publish') },
      { op: 'body', counter },
      { op: 'stage', payload: adaActivity({ name: 'Ada (fresh)' }), label: 'fresh' },
      { op: 'arm', role: 'publish' },
      { op: 'publish' },
    ]), 6);

    expect(inspect(location)).toMatchObject({ current: seed, results: 1, attempts: ['1:seed-request:completed:0', '2:killed-inside-publish:staged:1'] });

    const resumed = expectClean(runWorker(location, [
      { op: 'time', at: 2_200 },
      { op: 'recover', request: request('killed-inside-publish') },
      { op: 'acquire', holder: 'successor', lease: 100 },
      { op: 'allocate', request: request('killed-inside-publish') },
      { op: 'publish' },
    ]));
    expect(valueOf(resumed[1])).toMatchObject({ kind: 'incomplete', attempt: { attemptId: 2, state: 'staged' } });
    const published = valueOf<{ locator: string }>(resumed[4]).locator;
    expect(readFileSync(counter, 'utf8')).toBe('body\n');

    const history = reopenAt(location, 2_250);
    expect(history.readCurrent({ ...scope, subject: request('x').subject })?.locator).toBe(published);
    expect(history.reader.readSelected({ kind: 'completed-result', locator: published }, { operation: 'value', address: [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'name' }] }).fact).toBe('Ada (fresh)');
    expect(history.readEnvelope({ kind: 'completed-result', locator: seed }).attemptId).toBe(1);
  });

  test('a kill after the publication commit but before acknowledgment is recovered by its stable key without rerunning the body', () => {
    const location = freshLocation();
    const seed = seedPrevious(location);
    const counter = join(dirname(location), 'body-calls.txt');
    const acknowledgment = join(dirname(location), 'acknowledged.txt');
    const killed = runWorker(location, [
      { op: 'time', at: 2_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'allocate', request: request('lost-acknowledgment') },
      { op: 'body', counter },
      { op: 'stage', payload: adaActivity({ name: 'Ada (committed)' }), label: 'committed' },
      { op: 'publish' },
      { op: 'kill' },
      { op: 'acknowledge', file: acknowledgment },
    ]);
    expectKilled(killed, 6);
    const committed = valueOf<{ locator: string }>(killed.trace[5]).locator;
    expect(existsSync(acknowledgment)).toBe(false);

    const recovered = expectClean(runWorker(location, [
      { op: 'time', at: 2_010 },
      { op: 'recover', request: request('lost-acknowledgment') },
      { op: 'time', at: 2_200 },
      { op: 'acquire', holder: 'successor', lease: 100 },
      { op: 'allocate', request: request('lost-acknowledgment') },
    ]));
    expect(valueOf(recovered[1])).toMatchObject({ kind: 'completed', reference: { kind: 'completed-result', locator: committed }, attempt: { attemptId: 2, state: 'completed' } });
    expect(valueOf(recovered[4])).toMatchObject({ attemptId: 2, state: 'completed', result: { locator: committed } });
    expect(readFileSync(counter, 'utf8')).toBe('body\n');

    const conflicting = runWorker(location, [{ op: 'recover', request: request('lost-acknowledgment', 'intent:summary:changed') }]);
    expect(conflicting.trace).toEqual([expect.objectContaining({ ok: false, error: 'AttemptConflictError' })]);

    const history = reopenAt(location, 2_250);
    expect(history.readCurrent({ ...scope, subject: request('x').subject })?.locator).toBe(committed);
    expect(history.readEnvelope({ kind: 'completed-result', locator: seed }).reference.locator).toBe(seed);
  });
});

describe('stale holders across processes', () => {
  test('an expired holder cannot renew, allocate, stage, publish, abandon, accept or release after a successor acquires', () => {
    const location = freshLocation();
    const seed = seedPrevious(location);
    const first = expectClean(runWorker(location, [
      { op: 'time', at: 2_000 },
      { op: 'acquire', holder: 'stale', lease: 100 },
      { op: 'allocate', request: request('stale-attempt') },
      { op: 'stage', payload: adaActivity({ name: 'Ada (stale)' }), label: 'stale' },
    ]));
    const staleLease = valueOf<{ lease: IWriterLease }>(first[1]).lease;

    const successor = expectClean(runWorker(location, [
      { op: 'time', at: 2_150 },
      { op: 'acquire', holder: 'successor', lease: 1_000 },
      { op: 'allocate', request: request('successor-attempt') },
      { op: 'stage', payload: adaActivity({ name: 'Ada (successor)' }), label: 'successor' },
      { op: 'publish' },
    ]));
    const current = valueOf<{ locator: string }>(successor[4]).locator;
    const before = inspect(location);
    expect(before.current).toBe(current);

    const stale = runWorker(location, [
      { op: 'time', at: 2_160 },
      { op: 'use-lease', lease: staleLease },
      { op: 'use-attempt', attemptId: 2 },
      { op: 'renew', lease: 100 },
      { op: 'allocate', request: request('stale-second-attempt') },
      { op: 'stage', payload: adaActivity(), label: 'late' },
      { op: 'publish' },
      { op: 'abandon', outcome: 'interrupted' },
      { op: 'accept', locator: seed, environment: scope.environment },
      { op: 'release' },
    ]);
    expect(stale.status).toBe(0);
    expect(stale.trace.slice(3).map((entry) => [entry.op, entry.ok, entry.error])).toEqual([
      ['renew', false, StaleWriterError.name],
      ['allocate', false, StaleWriterError.name],
      ['stage', false, StaleWriterError.name],
      ['publish', false, StaleWriterError.name],
      ['abandon', false, StaleWriterError.name],
      ['accept', false, StaleWriterError.name],
      ['release', false, StaleWriterError.name],
    ]);
    // Holder, fence, expiry, current pointer, attempts and results are all unchanged.
    expect(inspect(location)).toEqual(before);
  });
});
