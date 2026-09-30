/**
 * Outcome tests for History's operation journal over Node's real SQLite
 * capability: fenced, atomic compare-and-set storage of Run Supervision's
 * opaque versioned records, namespaced per analysis, environment and format.
 * Expected values are written by hand from the owning contracts: the M5 plan's
 * History responsibilities, the owner decisions RUN-011/012/017 and EXP-8's
 * intent-before-send journal semantics. Process-termination evidence is in
 * `processes.test.ts`.
 *
 * @see ../../../../docs/spec/execution.md (PUB-002 fencing, PUB-003 never-reused identities)
 * @see ../../../../docs/spec/operations.md (RUN-011, RUN-012, RUN-017)
 * @see ../../../../experiments/exp-8/decision.md (mechanism 4: intent before send; mechanism 3: durable deferral)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { JournalConflictError, JournalVersionError, StaleWriterError } from '@microdelta/history';
import type { IJournalRecord } from '@microdelta/history';

import { cleanup, controlledClock, freshLocation, openHistory, openRaw } from '../durable-history/support.js';
import { acquire, deferral, deferralFormat, operation, operationFormat, production, trial, versionOne } from './support.js';

afterEach(cleanup);

describe('journal records under the current holder and fence', () => {
  test('a commit writes an owner record at revision 1 under the committing fence, and any process reads it back exactly and frozen', () => {
    const location = freshLocation();
    const history = openHistory({ location });
    const lease = acquire(history);
    const journal = history.openJournal({ formats: versionOne });
    const intent = { member: 'm-quota', name: 'assess', bindingDigest: 'sha256:binding', state: 'pending' };

    const committed = journal.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 0, record: operation(intent) }] });
    const expected: IJournalRecord = {
      ...trial,
      key: 'op-1',
      revision: 1,
      sequence: 1,
      fence: lease.fence,
      record: { format: operationFormat, formatVersion: 1, content: intent },
    };
    expect(committed).toEqual([expected]);
    expect(journal.read({ ...trial, format: operationFormat, key: 'op-1' })).toEqual(expected);
    expect(journal.read({ ...trial, format: operationFormat, key: 'op-2' })).toBeUndefined();

    // Returned records are frozen copies: mutating one cannot alter storage.
    const read = journal.read({ ...trial, format: operationFormat, key: 'op-1' });
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read?.record)).toBe(true);
    expect(Object.isFrozen(read?.record.content)).toBe(true);
    history.close();

    const reopened = openHistory({ location });
    expect(reopened.openJournal({ formats: versionOne }).read({ ...trial, format: operationFormat, key: 'op-1' })).toEqual(expected);
  });

  test('compare-and-set replaces only the current revision, retains every earlier revision immutably, and a stale expectation refuses the whole commit', () => {
    const location = freshLocation();
    const history = openHistory({ location });
    const lease = acquire(history);
    const journal = history.openJournal({ formats: versionOne });
    const address = { ...trial, format: operationFormat, key: 'op-1' };
    journal.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 0, record: operation({ state: 'pending' }) }] });

    const deferred = journal.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 1, record: operation({ state: 'deferred', notBefore: 10_800_000 }) }] });
    expect(deferred).toEqual([{ ...trial, key: 'op-1', revision: 2, sequence: 2, fence: lease.fence, record: operation({ state: 'deferred', notBefore: 10_800_000 }) }]);

    // Every expectation other than the current revision is refused and nothing changes.
    for (const expectedRevision of [0, 1, 3]) {
      expect(() => journal.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision, record: operation({ state: 'pending' }) }] })).toThrow(JournalConflictError);
    }
    expect(() => journal.commit(lease, { ...trial, writes: [{ key: 'op-absent', expectedRevision: 1, record: operation({ state: 'pending' }) }] })).toThrow(JournalConflictError);
    expect(journal.read(address)).toEqual(deferred[0]);

    // One conflicting write refuses the entire commit: the valid write beside it does not land.
    expect(() => journal.commit(lease, {
      ...trial,
      writes: [
        { key: 'op-2', expectedRevision: 0, record: operation({ state: 'pending' }) },
        { key: 'op-1', expectedRevision: 1, record: operation({ state: 'unknown' }) },
      ],
    })).toThrow(JournalConflictError);
    expect(journal.read({ ...address, key: 'op-2' })).toBeUndefined();

    // Refused commits consumed no journal sequence.
    const next = journal.commit(lease, { ...trial, writes: [{ key: 'op-2', expectedRevision: 0, record: operation({ state: 'pending' }) }] });
    expect(next.map((record) => record.sequence)).toEqual([3]);

    const raw = openRaw(location);
    expect(raw.prepare("SELECT revision, sequence FROM history_journal WHERE journal_key = 'op-1' ORDER BY revision").all()).toEqual([
      { revision: 1, sequence: 1 },
      { revision: 2, sequence: 2 },
    ]);
    for (const statement of ["UPDATE history_journal SET content = 'x'", 'DELETE FROM history_journal']) {
      expect(() => raw.exec(statement)).toThrow(/immutable/u);
    }
    raw.close();
  });

  test('a multi-record commit lands atomically, in write order, and a collection lists current revisions in order of first write', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const journal = history.openJournal({ formats: versionOne });
    const first = journal.commit(lease, {
      ...trial,
      writes: [
        { key: 'op-b', expectedRevision: 0, record: operation({ state: 'pending' }) },
        { key: 'op-a', expectedRevision: 0, record: operation({ state: 'pending' }) },
        { key: 'op-b', expectedRevision: 0, record: deferral({ notBefore: 10_800_000 }) },
      ],
    });
    expect(first.map((record) => [record.record.format, record.key, record.revision, record.sequence])).toEqual([
      [operationFormat, 'op-b', 1, 1],
      [operationFormat, 'op-a', 1, 2],
      [deferralFormat, 'op-b', 1, 3],
    ]);
    journal.commit(lease, { ...trial, writes: [{ key: 'op-b', expectedRevision: 1, record: operation({ state: 'deferred' }) }] });

    expect(journal.list({ ...trial, format: operationFormat }).map((record) => [record.key, record.revision, record.record.content])).toEqual([
      ['op-b', 2, { state: 'deferred' }],
      ['op-a', 1, { state: 'pending' }],
    ]);
    expect(journal.list({ ...trial, format: deferralFormat }).map((record) => [record.key, record.revision])).toEqual([['op-b', 1]]);
    expect(journal.list({ ...production, format: operationFormat })).toEqual([]);
  });

  test('a commit needs the current, unexpired holder and fence; a stale, expired, released or superseded lease writes nothing', () => {
    const clock = controlledClock(1_000);
    const history = openHistory({ location: freshLocation(), clock });
    const journal = history.openJournal({ formats: versionOne });
    const write = (key: string): { readonly key: string; readonly expectedRevision: number; readonly record: ReturnType<typeof operation> } => ({ key, expectedRevision: 0, record: operation({ state: 'pending' }) });

    const first = acquire(history, 'first', 100);
    clock.set(1_100);
    // Expired with no successor.
    expect(() => journal.commit(first, { ...trial, writes: [write('expired')] })).toThrow(StaleWriterError);

    const second = acquire(history, 'second', 100);
    expect(second.fence).toBe(2);
    // Superseded by a successor, even with a forged unexpired expiry.
    expect(() => journal.commit({ ...first, expiresAt: second.expiresAt }, { ...trial, writes: [write('superseded')] })).toThrow(StaleWriterError);
    // The successor's own holder name with the old fence is not the current token.
    expect(() => journal.commit({ ...second, fence: 1 }, { ...trial, writes: [write('old-fence')] })).toThrow(StaleWriterError);

    const committed = journal.commit(second, { ...trial, writes: [write('current')] });
    expect(committed.map((record) => [record.key, record.fence])).toEqual([['current', 2]]);

    history.releaseWriter(second);
    expect(() => journal.commit(second, { ...trial, writes: [write('released')] })).toThrow(StaleWriterError);
    expect(journal.list({ ...trial, format: operationFormat }).map((record) => record.key)).toEqual(['current']);
  });

  test('malformed commits, addresses and declarations are refused before any change', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const journal = history.openJournal({ formats: versionOne });
    const valid = { key: 'op-1', expectedRevision: 0, record: operation({ state: 'pending' }) };
    for (const request of [
      { ...trial, writes: [] },
      { ...trial, writes: [valid, valid] },
      { ...trial, writes: [{ ...valid, key: '' }] },
      { ...trial, writes: [{ ...valid, expectedRevision: -1 }] },
      { ...trial, writes: [{ ...valid, expectedRevision: 1.5 }] },
      { ...trial, writes: [{ ...valid, record: operation(() => 'not data') }] },
      { ...trial, environment: '', writes: [valid] },
      { ...trial, analysis: '', writes: [valid] },
    ]) {
      expect(() => journal.commit(lease, request)).toThrow(TypeError);
    }
    expect(() => journal.read({ ...trial, format: operationFormat, key: '' })).toThrow(TypeError);
    expect(() => journal.list({ ...trial, environment: '', format: operationFormat })).toThrow(TypeError);
    expect(journal.list({ ...trial, format: operationFormat })).toEqual([]);

    for (const formats of [
      [],
      [{ format: '', versions: [1] }],
      [{ format: operationFormat, versions: [] }],
      [{ format: operationFormat, versions: [0] }],
      [{ format: operationFormat, versions: [1.5] }],
      [{ format: operationFormat, versions: [1, 1] }],
      [{ format: operationFormat, versions: [1] }, { format: operationFormat, versions: [2] }],
    ]) {
      expect(() => history.openJournal({ formats })).toThrow(TypeError);
    }
    expect(journal.formats).toEqual(versionOne);
    expect(Object.isFrozen(journal.formats)).toBe(true);
  });
});

describe('declared record versions', () => {
  test('a record of an undeclared format or version is refused on write, and a stored record of an undeclared version is refused on read, list and compare-and-set', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const older = history.openJournal({ formats: versionOne });
    const newer = history.openJournal({ formats: [{ format: operationFormat, versions: [1, 2] }] });
    const address = { ...trial, format: operationFormat, key: 'op-1' };

    // Writes: an undeclared version or format is refused and nothing lands.
    expect(() => older.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 0, record: operation({ state: 'pending' }, 2) }] })).toThrow(JournalVersionError);
    expect(() => newer.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 0, record: deferral({ notBefore: 1 }) }] })).toThrow(JournalVersionError);
    expect(newer.read(address)).toBeUndefined();

    // A newer port writes version 2; the older port refuses to read, list or overwrite it.
    const stored = newer.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 0, record: operation({ state: 'pending', shape: 'v2' }, 2) }] });
    expect(() => older.read(address)).toThrow(JournalVersionError);
    expect(() => older.list({ ...trial, format: operationFormat })).toThrow(JournalVersionError);
    expect(() => older.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 1, record: operation({ state: 'unknown' }) }] })).toThrow(JournalVersionError);
    expect(newer.read(address)).toEqual(stored[0]);

    // Asking about a format the port never declared is refused, not reported as absent.
    expect(() => newer.read({ ...trial, format: deferralFormat, key: 'op-1' })).toThrow(JournalVersionError);
    expect(() => newer.list({ ...trial, format: deferralFormat })).toThrow(JournalVersionError);

    // A port that declares version 2 may move the record back to version 1 by compare-and-set.
    const downgraded = newer.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 1, record: operation({ state: 'unknown' }) }] });
    expect(downgraded.map((record) => [record.revision, record.record.formatVersion])).toEqual([[2, 1]]);
    expect(older.read(address)).toEqual(downgraded[0]);
  });
});

describe('journal namespaces', () => {
  test('the same key is a different record in another environment, analysis or format collection', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const journal = history.openJournal({ formats: versionOne });
    const otherAnalysis = { analysis: 'analysis:other', environment: trial.environment };
    journal.commit(lease, { ...trial, writes: [{ key: 'op-1', expectedRevision: 0, record: operation({ in: 'trial' }) }] });

    expect(journal.read({ ...production, format: operationFormat, key: 'op-1' })).toBeUndefined();
    expect(journal.read({ ...otherAnalysis, format: operationFormat, key: 'op-1' })).toBeUndefined();
    expect(journal.read({ ...trial, format: deferralFormat, key: 'op-1' })).toBeUndefined();

    // A new-key expectation holds independently in each namespace.
    const inProduction = journal.commit(lease, { ...production, writes: [{ key: 'op-1', expectedRevision: 0, record: operation({ in: 'production' }) }] });
    const inOther = journal.commit(lease, { ...otherAnalysis, writes: [{ key: 'op-1', expectedRevision: 0, record: operation({ in: 'other' }) }] });
    expect([inProduction[0]?.revision, inOther[0]?.revision]).toEqual([1, 1]);
    expect(journal.read({ ...trial, format: operationFormat, key: 'op-1' })?.record.content).toEqual({ in: 'trial' });
    expect(journal.read({ ...production, format: operationFormat, key: 'op-1' })?.record.content).toEqual({ in: 'production' });
    expect(journal.list({ ...production, format: operationFormat }).map((record) => [record.environment, record.key])).toEqual([[production.environment, 'op-1']]);
  });
});
