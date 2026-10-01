/**
 * Separate-process evidence for History's operation journal, environment
 * namespaces and recorded promotion. Every scenario drives the production
 * authority from independent Node child processes against one real SQLite
 * file, kills a writer with SIGKILL just before or just after a commit, and
 * inspects the result from fresh processes and fresh handles. This proves the
 * selected single-file process-termination scope only: not power loss,
 * filesystem failure or multi-host behavior.
 *
 * @see ../../../../docs/spec/execution.md (PUB-002, PUB-004)
 * @see ../../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-017)
 * @see ../../../../experiments/exp-8/decision.md (intent before send; kill-after-intent)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { HistoryIntegrityError, StaleWriterError } from '@microdelta/history';
import type { IAttemptRequest, IJournalRecord, IPromotionRecord, IWriterLease } from '@microdelta/history';

import { expectClean, expectKilled, runWorker, valueOf } from '../durable-history/processes.js';
import { cleanup, controlledClock, freshLocation, openHistory } from '../durable-history/support.js';
import type { IWorkerStep } from '../durable-history/worker.js';
import { operation, operations, production, trial, versionOne } from './support.js';

afterEach(cleanup);

/** Ada's summary subject. */
const summary = 'summary:acme/widget:2026-Q1:person:ada';

/** The journal address of the operation every scenario records. */
const intentAddress = { ...trial, collection: operations, key: 'op-assess-ada' };

/** An intent record committed before a (fixture) send. */
const intent = { member: 'm-ada', name: 'assess', bindingDigest: 'sha256:binding', state: 'pending' };

/** The steps that commit the intent as a new key under the worker's lease. */
function commitIntent(expectedRevision = 0, content: unknown = intent): IWorkerStep {
  return { op: 'journal-commit', scope: trial, writes: [{ collection: operations, key: intentAddress.key, expectedRevision, record: operation(content) }] };
}

/** An attempt request for Ada's summary in one environment. */
function request(environment: string, attemptKey: string): IAttemptRequest {
  return { analysis: trial.analysis, environment, subject: summary, version: 1, attemptKey, intentDigest: `intent:${attemptKey}` };
}

/** Read the intent record through a fresh handle in this test process. */
function readIntent(location: string, now: number): IJournalRecord | undefined {
  const history = openHistory({ location, clock: controlledClock(now) });
  const record = history.openJournal({ formats: versionOne }).read(intentAddress);
  history.close();
  return record;
}

describe('process death around the journal commit', () => {
  test('a kill just before the journal commit leaves no record and issues no sequence; a successor writes the key as new', () => {
    const location = freshLocation();
    expectKilled(runWorker(location, [
      { op: 'time', at: 1_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'journal', formats: versionOne },
      { op: 'arm', role: 'journal' },
      commitIntent(),
    ]), 4);

    expect(readIntent(location, 1_050)).toBeUndefined();
    const successor = expectClean(runWorker(location, [
      { op: 'time', at: 1_100 },
      { op: 'acquire', holder: 'successor', lease: 100 },
      { op: 'journal', formats: versionOne },
      commitIntent(),
    ]));
    // The rolled-back commit issued nothing: the successor's write is sequence 1 under fence 2.
    expect(valueOf(successor[3])).toEqual([{ ...trial, collection: operations, key: intentAddress.key, revision: 1, sequence: 1, fence: 2, record: operation(intent) }]);
  });

  test('a kill just after the journal commit leaves the intent durable; a new process reads it and only a successor fence can advance it by compare-and-set', () => {
    const location = freshLocation();
    const killed = runWorker(location, [
      { op: 'time', at: 1_000 },
      { op: 'acquire', holder: 'killed', lease: 100 },
      { op: 'journal', formats: versionOne },
      commitIntent(),
      { op: 'kill' },
    ]);
    expectKilled(killed, 4);
    const committed = valueOf<readonly IJournalRecord[]>(killed.trace[3]);
    expect(committed).toEqual([{ ...trial, collection: operations, key: intentAddress.key, revision: 1, sequence: 1, fence: 1, record: operation(intent) }]);

    // A reader in another process sees exactly the committed intent while the dead lease is still live.
    const reader = expectClean(runWorker(location, [
      { op: 'time', at: 1_050 },
      { op: 'journal', formats: versionOne },
      { op: 'journal-read', address: intentAddress },
      { op: 'acquire', holder: 'successor', lease: 100 },
    ]));
    expect(valueOf(reader[2])).toEqual(committed[0]);
    expect(valueOf(reader[3])).toEqual({ kind: 'held', holder: 'killed', expiresAt: 1_100 });

    // After expiry a successor recovers it: a new-key write conflicts, the current revision advances.
    const successor = runWorker(location, [
      { op: 'time', at: 1_100 },
      { op: 'acquire', holder: 'successor', lease: 100 },
      { op: 'journal', formats: versionOne },
      commitIntent(0),
      commitIntent(1, { ...intent, state: 'unknown' }),
    ]);
    expect(successor.status).toBe(0);
    expect(successor.trace.map((entry) => [entry.op, entry.ok, entry.error])).toEqual([
      ['time', true, undefined],
      ['acquire', true, undefined],
      ['journal', true, undefined],
      ['journal-commit', false, 'JournalConflictError'],
      ['journal-commit', true, undefined],
    ]);
    expect(readIntent(location, 1_150)).toEqual({ ...trial, collection: operations, key: intentAddress.key, revision: 2, sequence: 2, fence: 2, record: operation({ ...intent, state: 'unknown' }) });
  });
});

describe('fencing and namespacing across processes', () => {
  test('a stale holder process can neither commit journal records nor promote after a successor acquires', () => {
    const location = freshLocation();
    const first = expectClean(runWorker(location, [
      { op: 'time', at: 1_000 },
      { op: 'acquire', holder: 'stale', lease: 100 },
      { op: 'allocate', request: request(trial.environment, 'trial-ada') },
      { op: 'stage', payload: { label: 'trial' }, label: 'trial' },
      { op: 'publish' },
      { op: 'journal', formats: versionOne },
      commitIntent(),
    ]));
    const staleLease = valueOf<{ lease: IWriterLease }>(first[1]).lease;
    const trialLocator = valueOf<{ locator: string }>(first[4]).locator;
    expectClean(runWorker(location, [{ op: 'time', at: 1_150 }, { op: 'acquire', holder: 'successor', lease: 1_000 }]));

    const stale = runWorker(location, [
      { op: 'time', at: 1_160 },
      { op: 'use-lease', lease: staleLease },
      { op: 'journal', formats: versionOne },
      commitIntent(1, { ...intent, state: 'succeeded' }),
      { op: 'promote', target: production, locators: [trialLocator], label: 'late' },
    ]);
    expect(stale.status).toBe(0);
    expect(stale.trace.slice(3).map((entry) => [entry.op, entry.ok, entry.error])).toEqual([
      ['journal-commit', false, StaleWriterError.name],
      ['promote', false, StaleWriterError.name],
    ]);
    expect(readIntent(location, 1_170)).toMatchObject({ revision: 1, fence: 1, record: { content: intent } });
    const history = openHistory({ location, clock: controlledClock(1_170) });
    expect(history.readPromotions({ target: production })).toEqual([]);
  });

  test('trial results and journal records stay out of production in every later process until a promotion, which then admits the named result', () => {
    const location = freshLocation();
    const trialRun = expectClean(runWorker(location, [
      { op: 'time', at: 1_000 },
      { op: 'acquire', holder: 'trial-run', lease: 100 },
      { op: 'allocate', request: request(trial.environment, 'trial-ada') },
      { op: 'stage', payload: { label: 'trial' }, label: 'trial' },
      { op: 'publish' },
      { op: 'journal', formats: versionOne },
      commitIntent(),
      { op: 'release' },
    ]));
    const trialLocator = valueOf<{ locator: string }>(trialRun[4]).locator;

    const productionRun = runWorker(location, [
      { op: 'time', at: 1_010 },
      { op: 'acquire', holder: 'production-run', lease: 100 },
      { op: 'candidates', subject: { ...production, subject: summary, version: 1 } },
      { op: 'journal', formats: versionOne },
      { op: 'journal-read', address: { ...intentAddress, ...production } },
      { op: 'accept', locator: trialLocator, environment: production.environment },
      { op: 'release' },
    ]);
    expect(productionRun.trace.map((entry) => [entry.op, entry.ok, entry.error ?? entry.value])).toEqual([
      ['time', true, 1_010],
      ['acquire', true, expect.objectContaining({ kind: 'acquired' })],
      ['candidates', true, []],
      ['journal', true, versionOne],
      ['journal-read', true, null],
      ['accept', false, HistoryIntegrityError.name],
      ['release', true, null],
    ]);

    // A kill just before the promotion commit records nothing.
    expectKilled(runWorker(location, [
      { op: 'time', at: 1_020 },
      { op: 'acquire', holder: 'operator', lease: 100 },
      { op: 'arm', role: 'promote' },
      { op: 'promote', target: production, locators: [trialLocator], label: 'killed' },
    ]), 3);
    const unpromoted = expectClean(runWorker(location, [{ op: 'time', at: 1_030 }, { op: 'candidates', subject: { ...production, subject: summary, version: 1 } }]));
    expect(valueOf(unpromoted[1])).toEqual([]);

    const promoted = expectClean(runWorker(location, [
      { op: 'time', at: 1_200 },
      { op: 'acquire', holder: 'operator', lease: 100 },
      { op: 'promote', target: production, locators: [trialLocator], label: 'reviewed' },
      { op: 'release' },
    ]));
    const promotion = valueOf<IPromotionRecord>(promoted[2]);
    expect(promotion).toMatchObject({ promotionId: 1, target: production, fence: 4, references: [{ locator: trialLocator }], evidence: { content: { label: 'reviewed' } } });

    const after = expectClean(runWorker(location, [
      { op: 'time', at: 1_210 },
      { op: 'acquire', holder: 'production-run', lease: 100 },
      { op: 'candidates', subject: { ...production, subject: summary, version: 1 } },
      { op: 'accept', locator: trialLocator, environment: production.environment },
      { op: 'candidates', subject: { ...trial, subject: summary, version: 1 } },
      { op: 'journal', formats: versionOne },
      { op: 'journal-read', address: { ...intentAddress, ...production } },
    ]));
    expect(valueOf(after[2])).toEqual([trialLocator]);
    expect(valueOf(after[3])).toMatchObject({ environment: production.environment, reference: { locator: trialLocator } });
    expect(valueOf(after[4])).toEqual([trialLocator]);
    expect(valueOf(after[6])).toBeNull();
  });
});
