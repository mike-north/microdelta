/**
 * Outcome tests for History's durable SQLite authority, composed with Node's
 * real SQLite capability exactly as assembly will compose it. Each test opens
 * real files and reopens them through fresh handles; process-termination
 * evidence lives in `crash-recovery.test.ts`. Expected values come from the
 * owning contracts and from independent Value oracles over in-memory data,
 * never from History's own output.
 *
 * @see ../../../../docs/spec/execution.md (RES-001–007, REUSE-008, PUB-001–004)
 * @see ../../../../docs/spec/tracking.md (VAL-1/2, M3 nested selected-read decision)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (History, host operations and durable records)
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import {
  AttemptConflictError,
  AttemptStateError,
  HistoryClockError,
  HistoryIntegrityError,
  HistorySchemaError,
  StaleWriterError,
} from '@microdelta/history';
import type {
  IAttemptRequest,
  ICompletedResultReference,
  IDurableHistory,
  IVersionedRecord,
  IWriterLease,
} from '@microdelta/history';
import { encodeSelectedFact, encodeSnapshot, fingerprint, navigate, observe } from '@microdelta/value';
import type { IAddressSegment } from '@microdelta/value';

import {
  InjectedFault,
  adaActivity,
  cleanup,
  domainRecord,
  controlledClock,
  freshLocation,
  logicalStore,
  machine,
  observedSqlite,
  openHistory,
  openRaw,
  provenance,
  scope,
} from './support.js';

afterEach(cleanup);

/** Ada's summary subject: a complete opaque author string. */
const summarySubject = 'summary:acme/widget:2026-Q1:person:ada';

/** A property address from key names. */
function path(...keys: readonly (string | number)[]): readonly IAddressSegment[] {
  return keys.map((key) => typeof key === 'number' ? { kind: 'index', index: key } : { kind: 'property', key });
}

/** Build an attempt request with overridable parts. */
function attempt(attemptKey: string, overrides: Partial<IAttemptRequest> = {}): IAttemptRequest {
  return { ...scope, subject: summarySubject, version: 1, attemptKey, intentDigest: `intent:${attemptKey}`, ...overrides };
}

/** Acquire the writer or fail the test. */
function acquire(history: IDurableHistory, holder = 'writer', leaseMilliseconds = 10_000): IWriterLease {
  const acquisition = history.acquireWriter({ holder, leaseMilliseconds });
  if (acquisition.kind !== 'acquired') {
    throw new Error(`expected to acquire, observed ${JSON.stringify(acquisition)}`);
  }
  return acquisition.lease;
}

/** Allocate, stage and publish one result; returns its exact reference. */
function publish(
  history: IDurableHistory,
  lease: IWriterLease,
  payload: unknown,
  options: { readonly key: string; readonly request?: Partial<IAttemptRequest>; readonly provenance?: IVersionedRecord; readonly dependencies?: readonly ICompletedResultReference[] },
): ICompletedResultReference {
  const allocated = history.allocateAttempt(lease, attempt(options.key, options.request));
  history.stageAttempt(lease, {
    attemptId: allocated.attemptId,
    payload,
    provenance: options.provenance ?? provenance(options.key),
    dependencies: options.dependencies ?? [],
  });
  return history.publishAttempt(lease, allocated.attemptId);
}

/** Rewrite one locator component to address a different scope or result. */
function relocate(reference: ICompletedResultReference, index: number, replacement: unknown): ICompletedResultReference {
  const prefix = reference.locator.slice(0, reference.locator.indexOf('|') + 1);
  const parts = JSON.parse(reference.locator.slice(prefix.length)) as unknown[];
  parts[index] = replacement;
  return { kind: 'completed-result', locator: `${prefix}${JSON.stringify(parts)}` };
}

/** The independent MDO1 oracle fingerprint of a selected fact over in-memory data. */
function oracle(data: unknown, address: readonly IAddressSegment[], operation: 'value' | 'length' | 'keys' | 'own' | 'membership' = 'value'): string {
  return fingerprint(encodeSelectedFact(observe(data, address, operation)), machine);
}

/**
 * Deliberately corrupt a closed store with immutability triggers and foreign
 * keys temporarily disabled, restoring the exact trigger definitions so the
 * schema itself still validates and only the tampered content differs.
 */
function tamper(location: string, sql: string): void {
  const raw = openRaw(location);
  const triggers = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all();
  raw.exec('PRAGMA foreign_keys = OFF');
  for (const trigger of triggers) {
    raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
  }
  raw.exec(sql);
  for (const trigger of triggers) {
    raw.exec(String(trigger.sql));
  }
  raw.exec('PRAGMA foreign_keys = ON');
  raw.close();
}

/**
 * Corrupt a closed store as {@link tamper} does, additionally bypassing CHECK
 * constraints, to model corruption that storage constraints would reject.
 */
function tamperUnchecked(location: string, statement: string): void {
  tamper(location, `PRAGMA ignore_check_constraints = ON; ${statement}; PRAGMA ignore_check_constraints = OFF`);
}

describe('schema, logical store and exact scope', () => {
  test('a new file receives a versioned History schema distinct from the legacy Store and EXP-3, and reopens by logical identity', () => {
    const location = freshLocation();
    const history = openHistory({ location });
    const lease = acquire(history);
    const reference = publish(history, lease, adaActivity(), { key: 'k1' });
    history.close();

    const raw = openRaw(location);
    const identity = raw.prepare('SELECT schema_name, schema_version, logical_store FROM history_identity').get();
    expect(identity).toEqual({ schema_name: 'microdelta.history.durable', schema_version: 1, logical_store: logicalStore });
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name);
    // No legacy Store rows and no EXP-3 or EXP-nested candidate tables: every table is History-owned.
    expect(tables.every((name) => typeof name === 'string' && name.startsWith('history_'))).toBe(true);
    raw.close();

    const reopened = openHistory({ location });
    expect(reopened.logicalStore).toBe(logicalStore);
    expect(reopened.readEnvelope(reference).reference).toEqual(reference);
  });

  test('a file holding another logical store, another schema version, an incomplete or foreign schema is rejected before any work', () => {
    const other = freshLocation();
    openHistory({ location: other }).close();
    expect(() => openHistory({ location: other, store: 'store:another' })).toThrow(HistorySchemaError);

    const versioned = freshLocation();
    openHistory({ location: versioned }).close();
    tamper(versioned, 'UPDATE history_identity SET schema_version = 2');
    expect(() => openHistory({ location: versioned })).toThrow(HistorySchemaError);

    const incomplete = freshLocation();
    openHistory({ location: incomplete }).close();
    const partial = openRaw(incomplete);
    partial.exec('DROP TABLE history_acceptance_dependencies');
    partial.close();
    expect(() => openHistory({ location: incomplete })).toThrow(HistorySchemaError);

    const foreign = freshLocation();
    const exp3 = openRaw(foreign);
    exp3.exec('CREATE TABLE schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1, 1)');
    exp3.close();
    expect(() => openHistory({ location: foreign })).toThrow(HistorySchemaError);
    const untouched = openRaw(foreign);
    expect(untouched.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'history_%'").get()).toEqual({ n: 0 });
    untouched.close();

    const extra = freshLocation();
    openHistory({ location: extra }).close();
    const extended = openRaw(extra);
    extended.exec('CREATE TABLE history_unexpected (id INTEGER)');
    extended.close();
    expect(() => openHistory({ location: extra })).toThrow(HistorySchemaError);
  });

  test('exact references resolve their own snapshot; malformed, other-store, wrong-scope and missing references are integrity failures that never follow current', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const first = publish(history, lease, adaActivity({ name: 'Ada A' }), { key: 'a' });
    const second = publish(history, lease, adaActivity({ name: 'Ada B' }), { key: 'b' });
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toEqual(second);
    expect(history.reader.readSelected(first, { operation: 'value', address: path('profile', 'name') }).fact).toBe('Ada A');

    const invalid: readonly ICompletedResultReference[] = [
      { kind: 'completed-result', locator: first.locator.replace(/^[^|]*\|/u, 'mdh0|') },
      { kind: 'completed-result', locator: `${first.locator} ` },
      { kind: 'completed-result', locator: 'not a locator' },
      relocate(first, 0, 'store:another'),
      relocate(first, 1, 'analysis:another'),
      relocate(first, 2, 'env:another'),
      relocate(first, 3, 999),
      relocate(first, 3, 0),
    ];
    for (const reference of invalid) {
      expect(() => history.readEnvelope(reference)).toThrow(HistoryIntegrityError);
      expect(() => history.reader.readSelected(reference, { operation: 'value', address: path('profile', 'name') })).toThrow(HistoryIntegrityError);
      expect(() => history.reader.readNode(reference, path('profile'))).toThrow(HistoryIntegrityError);
      expect(() => history.reader.resolveFingerprint(reference, { kind: 'selected', operation: 'value', address: path('profile', 'name'), encoding: 'MDO1' })).toThrow(HistoryIntegrityError);
    }
  });

  test('subjects are complete opaque strings and analyses and environments scope them independently', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const base = publish(history, lease, adaActivity({ name: 'base' }), { key: 'base' });
    const prefixed = publish(history, lease, adaActivity({ name: 'prefixed' }), { key: 'prefixed', request: { subject: `step:${summarySubject}` } });
    const otherAnalysis = publish(history, lease, adaActivity({ name: 'analysis' }), { key: 'analysis', request: { analysis: 'analysis:other' } });
    const otherEnvironment = publish(history, lease, adaActivity({ name: 'environment' }), { key: 'environment', request: { environment: 'env:other' } });

    expect(history.findCandidates({ ...scope, subject: summarySubject, version: 1 }).map((candidate) => candidate.reference)).toEqual([base]);
    expect(history.readCurrent({ ...scope, subject: `step:${summarySubject}` })).toEqual(prefixed);
    expect(history.readCurrent({ analysis: 'analysis:other', environment: scope.environment, subject: summarySubject })).toEqual(otherAnalysis);
    expect(history.readCurrent({ analysis: scope.analysis, environment: 'env:other', subject: summarySubject })).toEqual(otherEnvironment);
    expect(history.readCurrent({ ...scope, subject: 'summary' })).toBeUndefined();
  });
});

describe('attempts, staging and atomic publication', () => {
  test('allocation commits a never-reused identity before staging, including across abandonment and reopen', () => {
    const location = freshLocation();
    const history = openHistory({ location });
    const lease = acquire(history);
    const first = history.allocateAttempt(lease, attempt('one'));
    const abandoned = history.abandonAttempt(lease, { attemptId: first.attemptId, outcome: 'failed', evidence: { format: 'test.outcome', formatVersion: 1, content: { error: 'boom' } } });
    expect(abandoned).toMatchObject({ state: 'failed', endedFence: lease.fence, result: null, outcome: { format: 'test.outcome', formatVersion: 1, content: { error: 'boom' } } });
    const second = history.allocateAttempt(lease, attempt('two'));
    history.releaseWriter(lease);
    history.close();

    const reopened = openHistory({ location });
    const lease2 = acquire(reopened, 'writer-2');
    const third = reopened.allocateAttempt(lease2, attempt('three'));
    expect([first.attemptId, second.attemptId, third.attemptId]).toEqual([1, 2, 3]);
    expect(() => reopened.stageAttempt(lease2, { attemptId: 99, payload: adaActivity(), provenance: provenance('x'), dependencies: [] })).toThrow(AttemptStateError);
    expect(() => reopened.stageAttempt(lease2, { attemptId: first.attemptId, payload: adaActivity(), provenance: provenance('x'), dependencies: [] })).toThrow(AttemptStateError);
    expect(() => reopened.publishAttempt(lease2, first.attemptId)).toThrow(AttemptStateError);
    expect(reopened.recoverAttempt(attempt('one'))).toMatchObject({ kind: 'unsuccessful', attempt: { attemptId: 1, state: 'failed' } });
  });

  test('a staged attempt is not a completed result, and publication installs everything in one commit', () => {
    const sqlite = observedSqlite();
    const location = freshLocation();
    const history = openHistory({ location, sqlite: sqlite.capability });
    const lease = acquire(history);
    const previous = publish(history, lease, adaActivity({ name: 'previous' }), { key: 'previous' });
    const allocated = history.allocateAttempt(lease, attempt('next'));
    const staged = history.stageAttempt(lease, { attemptId: allocated.attemptId, payload: adaActivity({ name: 'next' }), provenance: provenance('next'), dependencies: [previous] });
    expect(staged).toMatchObject({ state: 'staged', result: null });
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toEqual(previous);
    expect(history.findCandidates({ ...scope, subject: summarySubject, version: 1 }).map((candidate) => candidate.reference)).toEqual([previous]);

    sqlite.arm({ role: 'publish', action: 'throw' });
    expect(() => history.publishAttempt(lease, allocated.attemptId)).toThrow(InjectedFault);
    sqlite.arm(undefined);
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toEqual(previous);
    expect(history.recoverAttempt(attempt('next'))).toMatchObject({ kind: 'incomplete', attempt: { state: 'staged' } });
    const raw = openRaw(location);
    expect(raw.prepare('SELECT count(*) AS n FROM history_results').get()).toEqual({ n: 1 });
    expect(raw.prepare('SELECT count(*) AS n FROM history_nodes WHERE result_id = ?').get(allocated.attemptId)).toEqual({ n: 0 });
    raw.close();

    const reference = history.publishAttempt(lease, allocated.attemptId);
    expect(history.publishAttempt(lease, allocated.attemptId)).toEqual(reference);
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toEqual(reference);
    expect(history.readEnvelope(reference)).toMatchObject({
      reference, ...scope, subject: summarySubject, version: 1, attemptId: allocated.attemptId, encoding: 'MDS1',
      provenance: provenance('next'), dependencies: [previous],
    });
    expect(history.recoverAttempt(attempt('next'))).toMatchObject({ kind: 'completed', reference, attempt: { state: 'completed', endedFence: lease.fence } });
    expect(history.verifyResult(reference)).toEqual({ kind: 'consistent' });
  });

  test('fresh equal output is a distinct result, both exact results stay readable and current is the latest publication', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const first = publish(history, lease, adaActivity(), { key: 'first' });
    const second = publish(history, lease, adaActivity(), { key: 'second' });
    expect(second).not.toEqual(first);
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toEqual(second);
    for (const reference of [first, second]) {
      expect(history.reader.readSelected(reference, { operation: 'value', address: path('profile', 'name') }).fact).toBe('Ada');
    }
    expect(history.reader.resolveFingerprint(first, { kind: 'materialized-output', address: path('profile'), encoding: 'MDS1' }))
      .toEqual(history.reader.resolveFingerprint(second, { kind: 'materialized-output', address: path('profile'), encoding: 'MDS1' }));
  });

  test('stable keys identify one execution: same intent returns it, a changed intent or version rejects, and keys are scoped per subject', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    expect(history.recoverAttempt(attempt('request-1'))).toEqual({ kind: 'absent' });
    const first = history.allocateAttempt(lease, attempt('request-1'));
    expect(history.allocateAttempt(lease, attempt('request-1'))).toEqual(first);
    expect(() => history.allocateAttempt(lease, attempt('request-1', { intentDigest: 'intent:changed' }))).toThrow(AttemptConflictError);
    expect(() => history.allocateAttempt(lease, attempt('request-1', { version: 2 }))).toThrow(AttemptConflictError);
    expect(() => history.recoverAttempt(attempt('request-1', { intentDigest: 'intent:changed' }))).toThrow(AttemptConflictError);
    const otherSubject = history.allocateAttempt(lease, attempt('request-1', { subject: 'summary:acme/widget:2026-Q1:person:ben' }));
    expect(otherSubject.attemptId).not.toBe(first.attemptId);
    expect(history.recoverAttempt(attempt('request-1'))).toMatchObject({ kind: 'incomplete', attempt: first });
  });

  test('staged payloads must be supported Value data with a container root, and stored results cannot be altered through returned data', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const allocated = history.allocateAttempt(lease, attempt('invalid'));
    for (const payload of ['scalar', 42, null, { fn: () => 1 }, { big: 1n }, { [Symbol('s')]: 1 }]) {
      expect(() => history.stageAttempt(lease, { attemptId: allocated.attemptId, payload, provenance: provenance('x'), dependencies: [] })).toThrow();
    }
    expect(() => history.stageAttempt(lease, { attemptId: allocated.attemptId, payload: {}, provenance: { format: '', formatVersion: 1, content: {} }, dependencies: [] })).toThrow(TypeError);
    expect(() => history.stageAttempt(lease, { attemptId: allocated.attemptId, payload: {}, provenance: { format: 'f', formatVersion: 0, content: {} }, dependencies: [] })).toThrow(TypeError);
    expect(history.recoverAttempt(attempt('invalid'))).toMatchObject({ kind: 'incomplete', attempt: { state: 'allocated' } });

    const data = adaActivity() as { profile: { name: string } };
    const reference = publish(history, lease, data, { key: 'valid' });
    data.profile.name = 'mutated after publication';
    const subtree = history.reader.readSubtree(reference, path('profile')) as { name: string };
    expect(subtree.name).toBe('Ada');
    expect(() => {
      subtree.name = 'mutated read';
    }).toThrow(TypeError);
    const envelope = history.readEnvelope(reference);
    expect(Object.isFrozen(envelope.provenance.content)).toBe(true);
    expect(history.reader.readSelected(reference, { operation: 'value', address: path('profile', 'name') }).fact).toBe('Ada');
  });

  test('dependencies must be exact completed results in the same store and scope', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const source = publish(history, lease, adaActivity(), { key: 'source' });
    const elsewhere = publish(history, lease, adaActivity(), { key: 'elsewhere', request: { environment: 'env:other' } });
    const allocated = history.allocateAttempt(lease, attempt('summary'));
    for (const dependency of [elsewhere, relocate(source, 0, 'store:another'), relocate(source, 3, 999), { kind: 'completed-result', locator: 'bogus' } as const]) {
      expect(() => history.stageAttempt(lease, { attemptId: allocated.attemptId, payload: { total: 1 }, provenance: provenance('s'), dependencies: [dependency] })).toThrow(HistoryIntegrityError);
    }
    expect(history.recoverAttempt(attempt('summary'))).toMatchObject({ kind: 'incomplete', attempt: { state: 'allocated' } });
  });
});

describe('candidates, rollback and separate acceptance', () => {
  test('candidates filter by compatibility version, latest publication first, and rollback acceptance never rewinds current or rewrites provenance', () => {
    const location = freshLocation();
    const history = openHistory({ location });
    const lease = acquire(history);
    const v1Old = publish(history, lease, { total: 1 }, { key: 'v1-old' });
    const v1New = publish(history, lease, { total: 2 }, { key: 'v1-new' });
    const v2 = publish(history, lease, { total: 3 }, { key: 'v2', request: { version: 2 } });
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toEqual(v2);
    expect(history.findCandidates({ ...scope, subject: summarySubject, version: 1 }).map((candidate) => candidate.reference)).toEqual([v1New, v1Old]);
    expect(history.findCandidates({ ...scope, subject: summarySubject, version: 2 }).map((candidate) => candidate.reference)).toEqual([v2]);
    expect(history.findCandidates({ ...scope, subject: summarySubject, version: 3 })).toEqual([]);

    const envelopeBefore = history.readEnvelope(v1New);
    const raw = openRaw(location);
    const storedBefore = raw.prepare('SELECT provenance FROM history_results WHERE result_id = 2').get();
    raw.close();
    const currentChild = publish(history, lease, adaActivity({ name: 'current child' }), { key: 'child', request: { subject: 'activity:ada' } });
    const acceptance = history.recordAcceptance(lease, {
      reference: v1New,
      evidence: { format: 'test.acceptance', formatVersion: 1, content: { check: 'rollback to version 1' } },
      dependencies: [currentChild],
    });
    expect(acceptance).toMatchObject({ reference: v1New, fence: lease.fence, dependencies: [currentChild], evidence: { content: { check: 'rollback to version 1' } } });
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toEqual(v2);
    expect(history.readEnvelope(v1New)).toEqual(envelopeBefore);
    const rawAfter = openRaw(location);
    expect(rawAfter.prepare('SELECT provenance FROM history_results WHERE result_id = 2').get()).toEqual(storedBefore);
    rawAfter.close();
    expect(history.readAcceptances(v1New)).toEqual([acceptance]);
    expect(history.readAcceptances(v1Old)).toEqual([]);
    const second = history.recordAcceptance(lease, { reference: v1New, evidence: { format: 'test.acceptance', formatVersion: 1, content: { check: 'again' } }, dependencies: [] });
    expect(second.acceptanceId).toBeGreaterThan(acceptance.acceptanceId);
    expect(history.readAcceptances(v1New)).toEqual([acceptance, second]);
  });

  test('stored results and acceptances are immutable in storage', () => {
    const location = freshLocation();
    const history = openHistory({ location });
    const lease = acquire(history);
    const reference = publish(history, lease, adaActivity(), { key: 'immutable' });
    history.recordAcceptance(lease, { reference, evidence: { format: 'test.acceptance', formatVersion: 1, content: {} }, dependencies: [] });
    const raw = openRaw(location);
    for (const statement of [
      "UPDATE history_results SET payload = 'x'",
      'DELETE FROM history_results',
      "UPDATE history_nodes SET scalar = 'x'",
      'DELETE FROM history_addresses',
      "UPDATE history_acceptances SET evidence = 'x'",
      'DELETE FROM history_attempts',
    ]) {
      expect(() => raw.exec(statement)).toThrow(/immutable|FOREIGN KEY/u);
    }
    raw.close();
    expect(history.verifyResult(reference)).toEqual({ kind: 'consistent' });
  });
});

describe('single logical writer and clock policy', () => {
  test('one live holder at a time; release keeps the fence advancing', () => {
    const clock = controlledClock(1_000);
    const history = openHistory({ location: freshLocation(), clock });
    const first = acquire(history, 'first', 100);
    expect(first).toEqual({ holder: 'first', fence: 1, expiresAt: 1_100 });
    expect(history.acquireWriter({ holder: 'second', leaseMilliseconds: 100 })).toEqual({ kind: 'held', holder: 'first', expiresAt: 1_100 });
    clock.set(1_050);
    const renewed = history.renewWriter(first, 100);
    expect(renewed).toEqual({ holder: 'first', fence: 1, expiresAt: 1_150 });
    expect(() => history.renewWriter(first, 100)).not.toThrow();
    history.releaseWriter(renewed);
    expect(history.currentWriter()).toBeUndefined();
    expect(() => history.allocateAttempt(renewed, attempt('after-release'))).toThrow(StaleWriterError);
    expect(acquire(history, 'second', 100).fence).toBe(2);
  });

  test('a backward host clock never evaluates before the persisted high-water, so it cannot shorten a holder lease or resurrect an expired one', () => {
    const clock = controlledClock(1_000);
    const location = freshLocation();
    const history = openHistory({ location, clock });
    const first = acquire(history, 'first', 100);
    clock.set(1_090);
    history.allocateAttempt(first, attempt('observed-late'));
    clock.set(500);
    expect(history.acquireWriter({ holder: 'second', leaseMilliseconds: 100 })).toEqual({ kind: 'held', holder: 'first', expiresAt: 1_100 });
    // Renewal at a regressed reading is evaluated at the 1090 high-water.
    expect(history.renewWriter(first, 100)).toEqual({ holder: 'first', fence: 1, expiresAt: 1_190 });
    clock.set(1_200);
    expect(() => history.renewWriter(first, 100)).toThrow(StaleWriterError);
    clock.set(1_000);
    // The rejected renewal still recorded 1200, so a regressed clock cannot revive the lease.
    expect(() => history.allocateAttempt({ holder: 'first', fence: 1, expiresAt: 1_190 }, attempt('revived'))).toThrow(StaleWriterError);
    const reopened = openHistory({ location, clock: controlledClock(900) });
    expect(reopened.acquireWriter({ holder: 'second', leaseMilliseconds: 100 })).toEqual({ kind: 'acquired', lease: { holder: 'second', fence: 2, expiresAt: 1_300 } });
  });

  test('a forward jump can expire a lease early, after which the old fence cannot allocate, stage or publish even when the clock returns', () => {
    const clock = controlledClock(1_000);
    const history = openHistory({ location: freshLocation(), clock });
    const first = acquire(history, 'first', 1_000);
    const previous = publish(history, first, { total: 1 }, { key: 'before-jump' });
    const allocated = history.allocateAttempt(first, attempt('allocated-before-jump'));
    const staged = history.allocateAttempt(first, attempt('staged-before-jump'));
    history.stageAttempt(first, { attemptId: staged.attemptId, payload: { total: 2 }, provenance: provenance('late'), dependencies: [] });
    clock.set(10_000);
    const second = acquire(history, 'second', 100);
    expect(second.fence).toBe(2);
    clock.set(1_010);
    expect(() => history.allocateAttempt(first, attempt('after-jump'))).toThrow(StaleWriterError);
    expect(() => history.stageAttempt(first, { attemptId: allocated.attemptId, payload: { total: 3 }, provenance: provenance('late'), dependencies: [] })).toThrow(StaleWriterError);
    expect(() => history.publishAttempt(first, staged.attemptId)).toThrow(StaleWriterError);
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toEqual(previous);
    expect(history.recoverAttempt(attempt('staged-before-jump'))).toMatchObject({ kind: 'incomplete', attempt: { state: 'staged' } });
    expect(history.currentWriter()).toEqual(second);
  });

  test('a lease is fenced by its token alone: the same holder re-acquiring invalidates its previous fence', () => {
    const clock = controlledClock(1_000);
    const history = openHistory({ location: freshLocation(), clock });
    const old = acquire(history, 'worker', 100);
    const allocated = history.allocateAttempt(old, attempt('old-fence'));
    history.stageAttempt(old, { attemptId: allocated.attemptId, payload: { total: 1 }, provenance: provenance('old'), dependencies: [] });
    clock.set(1_200);
    const renewed = acquire(history, 'worker', 1_000);
    expect(renewed).toEqual({ holder: 'worker', fence: 2, expiresAt: 2_200 });
    // Same holder name, unexpired durable lease: only the fence distinguishes the stale token.
    const staleToken = { ...old, expiresAt: renewed.expiresAt };
    expect(() => history.publishAttempt(staleToken, allocated.attemptId)).toThrow(StaleWriterError);
    expect(() => history.renewWriter(staleToken, 100)).toThrow(StaleWriterError);
    expect(() => history.releaseWriter(staleToken)).toThrow(StaleWriterError);
    expect(history.currentWriter()).toEqual(renewed);
    expect(history.readCurrent({ ...scope, subject: summarySubject })).toBeUndefined();
    expect(history.publishAttempt(renewed, allocated.attemptId).kind).toBe('completed-result');
  });

  test('an unavailable or invalid clock reading refuses the operation without any change', () => {
    const clock = controlledClock(1_000);
    const history = openHistory({ location: freshLocation(), clock });
    const lease = acquire(history, 'first', 100);
    for (const reading of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      clock.set(reading);
      expect(() => history.allocateAttempt(lease, attempt('bad-clock'))).toThrow(HistoryClockError);
      expect(() => history.acquireWriter({ holder: 'other', leaseMilliseconds: 100 })).toThrow(HistoryClockError);
    }
    clock.fail();
    expect(() => history.renewWriter(lease, 100)).toThrow('host clock unavailable');
    clock.set(1_010);
    expect(history.recoverAttempt(attempt('bad-clock'))).toEqual({ kind: 'absent' });
    expect(history.currentWriter()).toEqual(lease);
    expect(() => history.acquireWriter({ holder: '', leaseMilliseconds: 100 })).toThrow(TypeError);
    expect(() => history.acquireWriter({ holder: 'x', leaseMilliseconds: 0 })).toThrow(TypeError);
  });
});

describe('exact selected reading from the generated index', () => {
  test('selected leaves, lengths and metadata fingerprints come from the index without root payload reads and equal independent Value oracles', () => {
    const sqlite = observedSqlite();
    const location = freshLocation();
    const writer = openHistory({ location, sqlite: sqlite.capability });
    const lease = acquire(writer);
    const data = adaActivity();
    const reference = publish(writer, lease, adaActivity(), { key: 'indexed' });
    writer.close();

    const reader = openHistory({ location, sqlite: sqlite.capability });
    const start = sqlite.mark();
    const root = reader.reader.readNode(reference, []);
    expect(root).toEqual({ kind: 'record', address: [] });
    expect(reader.reader.readNode(reference, path('pullRequests'))).toEqual({ kind: 'array', address: path('pullRequests'), length: 3 });
    const name = reader.reader.readSelected(reference, { operation: 'value', address: path('profile', 'name') });
    expect(name).toEqual(observe(data, path('profile', 'name'), 'value'));
    const merged = [0, 1, 2].map((index) => reader.reader.readNode(reference, path('pullRequests', index, 'merged')));
    expect(merged).toEqual([0, 1, 2].map((index) => ({ kind: 'scalar', selected: observe(data, path('pullRequests', index, 'merged'), 'value') })));
    expect(reader.reader.readSelected(reference, { operation: 'length', address: path('reviews') }).fact).toBe(5);
    expect(reader.reader.readSelected(reference, { operation: 'keys', address: path('profile') }).fact).toEqual(['id', 'name', 'avatarUrl']);
    expect(reader.reader.readSelected(reference, { operation: 'membership', address: path('profile', 'missing') }).fact).toBe(false);
    const reads = sqlite.evidence(start);
    expect(reads.rootPayloadCells).toBe(0);
    expect(reads.stagedCells).toBe(0);
    // Exactly the four consumed scalar leaves: one name and three merged flags.
    expect(reads.scalarCells).toBe(4);

    const compareStart = sqlite.mark();
    for (const [address, operation] of [
      [path('profile', 'name'), 'value'],
      [path('pullRequests', 2, 'merged'), 'value'],
      [path('reviews'), 'length'],
      [path('profile'), 'keys'],
      [path('profile', 'nickname'), 'value'],
      [path('pullRequests'), 'value'],
    ] as const) {
      expect(reader.reader.resolveFingerprint(reference, { kind: 'selected', operation, address, encoding: 'MDO1' }))
        .toEqual({ kind: 'compatible', fingerprint: oracle(data, address, operation) });
    }
    expect(reader.reader.resolveFingerprint(reference, { kind: 'materialized-output', address: path('profile'), encoding: 'MDS1' }))
      .toEqual({ kind: 'compatible', fingerprint: fingerprint(encodeSnapshot((data as { profile: unknown }).profile), machine) });
    expect(reader.reader.resolveFingerprint(reference, { kind: 'selected', operation: 'value', address: path('profile', 0), encoding: 'MDO1' }))
      .toEqual({ kind: 'incompatible' });
    expect(reader.reader.resolveFingerprint(reference, { kind: 'selected', operation: 'value', address: path('profile', 'name'), encoding: 'MDO2' as 'MDO1' }))
      .toEqual({ kind: 'incompatible' });
    const comparison = sqlite.evidence(compareStart);
    expect(comparison).toMatchObject({ rootPayloadCells: 0, scalarCells: 0, stagedCells: 0 });
  });

  test('unread changes keep consumed fingerprints equal while consumed changes differ, and old exact references stay stable', () => {
    const history = openHistory({ location: freshLocation() });
    const lease = acquire(history);
    const base = publish(history, lease, adaActivity(), { key: 'base' });
    const unread = publish(history, lease, adaActivity({ avatar: 'https://avatars.example/new.png' }), { key: 'unread' });
    const consumed = publish(history, lease, adaActivity({ merged103: true }), { key: 'consumed' });
    const fingerprintOf = (reference: ICompletedResultReference, address: readonly IAddressSegment[]): unknown =>
      history.reader.resolveFingerprint(reference, { kind: 'selected', operation: 'value', address, encoding: 'MDO1' });
    expect(fingerprintOf(unread, path('profile', 'name'))).toEqual(fingerprintOf(base, path('profile', 'name')));
    expect(fingerprintOf(unread, path('pullRequests', 2, 'merged'))).toEqual(fingerprintOf(base, path('pullRequests', 2, 'merged')));
    expect(fingerprintOf(consumed, path('pullRequests', 2, 'merged'))).not.toEqual(fingerprintOf(base, path('pullRequests', 2, 'merged')));
    expect(history.reader.readSelected(base, { operation: 'value', address: path('pullRequests', 2, 'merged') }).fact).toBe(false);
    expect(history.reader.readSubtree(base, path('profile'))).toEqual({ id: 'gh:1001', name: 'Ada', avatarUrl: 'https://avatars.example/ada.png' });
    expect(Object.keys(history.reader.readSubtree(base, path('profile')) as object)).toEqual(['id', 'name', 'avatarUrl']);
  });
});

describe('valid-domain parity of the indexed reader', () => {
  /** Addresses covering present, absent, inherited, shadowed, hole, present-undefined and invalid selections. */
  const addresses: readonly (readonly IAddressSegment[])[] = [
    [],
    ...['ordered', 'sparse', 'present', 'child', 'bare', 'record', 'list', 'numbers', 'nothing', 'then', 'missing', 'toString'].map((key) => path(key)),
    ...['own', 'inherited', 'shadowed', 'depth', 'box', 'missing', 'constructor'].map((key) => path('child', key)),
    path('child', 'box', 'label'), path('child', 'box', 'missing'),
    path('bare', 'only'), path('bare', 'toString'), path('bare', 'missing'),
    path('record', '0'), path('record', 0), path('record', 'a.b'),
    path('numbers', 'notANumber'), path('numbers', 'negativeZero'), path('numbers', 'infinity'),
    path('missing', 'deep'), path('nothing', 'deep'), path('list', '0'), path('list', 0), path('list', 1),
    ...[0, 1, 2, 3, 4].map((index) => path('sparse', index)),
    ...[0, 1, 2, 3].map((index) => path('present', index)),
  ];

  test('every selection over the accepted Value edge domain equals the in-memory Value answer after reopen, without root payload reads', () => {
    const sqlite = observedSqlite();
    const location = freshLocation();
    const writer = openHistory({ location });
    const data = domainRecord();
    const reference = publish(writer, acquire(writer), domainRecord(), { key: 'edges' });
    writer.close();
    const history = openHistory({ location, sqlite: sqlite.capability });
    expect(history.verifyResult(reference)).toEqual({ kind: 'consistent' });
    const start = sqlite.mark();
    let compared = 0;
    for (const address of addresses) {
      for (const operation of ['value', 'own', 'membership', 'length', 'keys'] as const) {
        const request = { operation, address };
        let expected: ReturnType<typeof observe> | undefined;
        try {
          expected = observe(data, address, operation);
        } catch (error: unknown) {
          expect(error).toBeInstanceOf(TypeError);
        }
        if (expected === undefined) {
          expect(() => history.reader.readSelected(reference, request)).toThrow(TypeError);
          expect(history.reader.resolveFingerprint(reference, { kind: 'selected', ...request, encoding: 'MDO1' })).toEqual({ kind: 'incompatible' });
        } else {
          expect(encodeSelectedFact(history.reader.readSelected(reference, request))).toBe(encodeSelectedFact(expected));
          expect(history.reader.resolveFingerprint(reference, { kind: 'selected', ...request, encoding: 'MDO1' }))
            .toEqual({ kind: 'compatible', fingerprint: fingerprint(encodeSelectedFact(expected), machine) });
        }
        compared += 2;
      }
      let node: ReturnType<typeof navigate> | undefined;
      try {
        node = navigate(data, address);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(TypeError);
      }
      if (node === undefined) {
        expect(() => history.reader.readNode(reference, address)).toThrow(TypeError);
      } else {
        expect(history.reader.readNode(reference, address)).toEqual(node);
      }
      compared += 1;
    }
    expect(compared).toBe(addresses.length * 11);
    expect(sqlite.evidence(start).rootPayloadCells).toBe(0);
    for (const address of [[], path('child'), path('child', 'box'), path('sparse'), path('present'), path('bare'), path('ordered')]) {
      const expected = address.length === 0 ? data : observe(data, address, 'value').fact;
      expect(encodeSnapshot(history.reader.readSubtree(reference, address))).toBe(encodeSnapshot(expected));
      expect(history.reader.resolveFingerprint(reference, { kind: 'materialized-output', address, encoding: 'MDS1' }))
        .toEqual({ kind: 'compatible', fingerprint: fingerprint(encodeSnapshot(expected), machine) });
    }
  });
});

describe('meaningful corruption is detected, never repaired', () => {
  /** Publish a source and a dependent summary, then return both references and the file. */
  function publishedPair(): { readonly location: string; readonly history: IDurableHistory; readonly lease: IWriterLease; readonly source: ICompletedResultReference; readonly summary: ICompletedResultReference } {
    const location = freshLocation();
    const history = openHistory({ location });
    const lease = acquire(history);
    const source = publish(history, lease, adaActivity(), { key: 'source', request: { subject: 'activity:ada' } });
    const summary = publish(history, lease, { authored: 3 }, { key: 'summary', dependencies: [source] });
    return { location, history, lease, source, summary };
  }

  /** Close a published pair, corrupt it, and reopen it through a fresh handle. */
  function corruptAndReopen(pair: { readonly location: string; readonly history: IDurableHistory }, sql: string, unchecked = false): IDurableHistory {
    pair.history.close();
    (unchecked ? tamperUnchecked : tamper)(pair.location, sql);
    return openHistory({ location: pair.location });
  }

  /** SQL removing one completed result and its index while keeping its completed attempt row. */
  const removeResult = (resultId: number): string => [
    'history_addresses', 'history_edges', 'history_nodes', 'history_current', 'history_results',
  ].map((table) => `DELETE FROM ${table} WHERE result_id = ${String(resultId)}`).join('; ');

  test('a tampered scalar leaf fails its indexed digest on read and in verification', () => {
    const { location, history, source } = publishedPair();
    tamper(location, `UPDATE history_nodes SET scalar = replace(scalar, 'Ada', 'Eve') WHERE result_id = 1 AND scalar LIKE '%Ada%'`);
    expect(() => history.reader.readSelected(source, { operation: 'value', address: path('profile', 'name') })).toThrow(HistoryIntegrityError);
    expect(history.verifyResult(source)).toMatchObject({ kind: 'inconsistent' });
  });

  test('a tampered index row or stored encoding is detected', () => {
    const { location, history, source } = publishedPair();
    tamper(location, `UPDATE history_addresses SET value_fingerprint = 'forged' WHERE result_id = 1 AND address = '[["p","profile"],["p","name"]]'`);
    expect(history.verifyResult(source)).toMatchObject({ kind: 'inconsistent' });
    tamper(location, `UPDATE history_results SET encoding = 'MDS9' WHERE result_id = 1`);
    expect(() => history.reader.readNode(source, path('profile'))).toThrow(HistoryIntegrityError);
    expect(() => history.readEnvelope(source)).toThrow(HistoryIntegrityError);
  });

  test('index metadata contradicting its node kind is an integrity failure, never a Value answer or incompatible', () => {
    const lengthless = publishedPair();
    tamperUnchecked(lengthless.location, `UPDATE history_nodes SET array_length = NULL WHERE result_id = 1 AND kind = 'array' AND node_id = (SELECT node_id FROM history_addresses WHERE result_id = 1 AND address = '[["p","reviews"]]')`);
    expect(() => lengthless.history.reader.readSelected(lengthless.source, { operation: 'length', address: path('reviews') })).toThrow(HistoryIntegrityError);
    expect(() => lengthless.history.reader.readNode(lengthless.source, path('reviews'))).toThrow(HistoryIntegrityError);
    expect(() => lengthless.history.reader.resolveFingerprint(lengthless.source, { kind: 'selected', operation: 'length', address: path('reviews'), encoding: 'MDO1' })).toThrow(HistoryIntegrityError);

    const duplicated = publishedPair();
    tamperUnchecked(duplicated.location, `UPDATE history_nodes SET own_keys = '["id","id","avatarUrl"]' WHERE result_id = 1 AND node_id = (SELECT node_id FROM history_addresses WHERE result_id = 1 AND address = '[["p","profile"]]')`);
    expect(() => duplicated.history.reader.resolveFingerprint(duplicated.source, { kind: 'selected', operation: 'keys', address: path('profile'), encoding: 'MDO1' })).toThrow(HistoryIntegrityError);

    const unfingerprinted = publishedPair();
    tamperUnchecked(unfingerprinted.location, `UPDATE history_addresses SET value_fingerprint = NULL WHERE result_id = 1 AND address = '[["p","profile"],["p","name"]]'`);
    expect(() => unfingerprinted.history.reader.resolveFingerprint(unfingerprinted.source, { kind: 'selected', operation: 'value', address: path('profile', 'name'), encoding: 'MDO1' })).toThrow(HistoryIntegrityError);
  });

  test('recovery never reports a completed attempt whose exact result no longer resolves', () => {
    const { location, history } = publishedPair();
    tamper(location, removeResult(2));
    expect(() => history.recoverAttempt(attempt('summary'))).toThrow(HistoryIntegrityError);
  });

  test('completed retry paths never acknowledge a missing result after reopen; corruption is not turned into a miss', () => {
    const pair = publishedPair();
    const reopened = corruptAndReopen(pair, removeResult(2));
    // The lost-acknowledgment retry routes: re-allocating the same key and re-publishing the same attempt.
    expect(() => reopened.allocateAttempt(pair.lease, attempt('summary'))).toThrow(HistoryIntegrityError);
    expect(() => reopened.publishAttempt(pair.lease, 2)).toThrow(HistoryIntegrityError);
    expect(() => reopened.recoverAttempt(attempt('summary'))).toThrow(HistoryIntegrityError);
    // The attempt is still recorded as completed; nothing was downgraded to incomplete or absent.
    const raw = openRaw(pair.location);
    expect(raw.prepare('SELECT state FROM history_attempts WHERE attempt_id = 2').get()).toEqual({ state: 'completed' });
    raw.close();
    // Positive control: the healthy completed source still acknowledges by its key.
    expect(reopened.allocateAttempt(pair.lease, attempt('source', { subject: 'activity:ada' })).result).toEqual(pair.source);
    expect(reopened.publishAttempt(pair.lease, 1)).toEqual(pair.source);
  });

  test('candidate, current and dependency metadata reject a result whose producing attempt is not completed or whose encoding is unsupported', () => {
    const regressed = publishedPair();
    // A valid allocated row shape, so only the completion contract is violated.
    const reopened = corruptAndReopen(regressed, "UPDATE history_attempts SET state = 'allocated', ended_fence = NULL WHERE attempt_id = 1");
    expect(() => reopened.findCandidates({ ...scope, subject: 'activity:ada', version: 1 })).toThrow(HistoryIntegrityError);
    expect(() => reopened.readCurrent({ ...scope, subject: 'activity:ada' })).toThrow(HistoryIntegrityError);
    expect(() => reopened.readEnvelope(regressed.summary)).toThrow(HistoryIntegrityError);
    expect(() => reopened.findCandidates({ ...scope, subject: summarySubject, version: 1 })).toThrow(HistoryIntegrityError);
    expect(() => reopened.readEnvelope(regressed.source)).toThrow(HistoryIntegrityError);
    // The attempt row now contradicts its published result; recovery and retry must not present it as incomplete work.
    expect(() => reopened.recoverAttempt(attempt('source', { subject: 'activity:ada' }))).toThrow(HistoryIntegrityError);
    expect(() => reopened.allocateAttempt(regressed.lease, attempt('source', { subject: 'activity:ada' }))).toThrow(HistoryIntegrityError);

    const reencoded = publishedPair();
    const other = corruptAndReopen(reencoded, "UPDATE history_results SET encoding = 'MDS9' WHERE result_id = 1");
    expect(() => other.readCurrent({ ...scope, subject: 'activity:ada' })).toThrow(HistoryIntegrityError);
    expect(() => other.findCandidates({ ...scope, subject: 'activity:ada', version: 1 })).toThrow(HistoryIntegrityError);
    expect(() => other.findCandidates({ ...scope, subject: summarySubject, version: 1 })).toThrow(HistoryIntegrityError);
    expect(() => other.readEnvelope(reencoded.summary)).toThrow(HistoryIntegrityError);
  });

  test('a missing index address or node for a present member is an integrity failure, never an absent-member fact', () => {
    const name = path('profile', 'name');
    const selections = (history: IDurableHistory, reference: ICompletedResultReference, address: readonly IAddressSegment[]): readonly (() => unknown)[] => [
      () => history.reader.readNode(reference, address),
      ...(['value', 'own', 'membership'] as const).map((operation) => () => history.reader.readSelected(reference, { operation, address })),
      ...(['value', 'own', 'membership'] as const).map((operation) => () => history.reader.resolveFingerprint(reference, { kind: 'selected', operation, address, encoding: 'MDO1' })),
      () => history.reader.resolveFingerprint(reference, { kind: 'materialized-output', address, encoding: 'MDS1' }),
    ];

    const addressless = publishedPair();
    const withoutAddress = corruptAndReopen(addressless, `DELETE FROM history_addresses WHERE result_id = 1 AND address = '[["p","profile"],["p","name"]]'`);
    for (const read of selections(withoutAddress, addressless.source, name)) {
      expect(read).toThrow(HistoryIntegrityError);
    }
    // A genuinely absent sibling of the same record still answers from metadata.
    expect(withoutAddress.reader.readSelected(addressless.source, { operation: 'membership', address: path('profile', 'nickname') }).fact).toBe(false);

    const nodeless = publishedPair();
    const withoutNode = corruptAndReopen(nodeless, `DELETE FROM history_nodes WHERE result_id = 1 AND node_id = (SELECT node_id FROM history_addresses WHERE result_id = 1 AND address = '[["p","profile"],["p","name"]]')`);
    for (const read of selections(withoutNode, nodeless.source, name)) {
      expect(read).toThrow(HistoryIntegrityError);
    }

    const elementless = publishedPair();
    const withoutElement = corruptAndReopen(elementless, `DELETE FROM history_addresses WHERE result_id = 1 AND address = '[["p","pullRequests"],["i",1]]'`);
    for (const read of selections(withoutElement, elementless.source, path('pullRequests', 1))) {
      expect(read).toThrow(HistoryIntegrityError);
    }
    // A present element's surviving descendant evidence and an index past the end are unaffected.
    expect(withoutElement.reader.readSelected(elementless.source, { operation: 'value', address: path('pullRequests', 1, 'merged') }).fact).toBe(true);
    expect(withoutElement.reader.readSelected(elementless.source, { operation: 'own', address: path('pullRequests', 7) }).fact).toBe(false);
  });

  test('a dangling or wrong-scope dependency and malformed provenance are integrity failures on the dependent envelope', () => {
    const dangling = publishedPair();
    tamper(dangling.location, 'DELETE FROM history_addresses WHERE result_id = 1; DELETE FROM history_edges WHERE result_id = 1; DELETE FROM history_nodes WHERE result_id = 1; DELETE FROM history_current WHERE result_id = 1; DELETE FROM history_results WHERE result_id = 1');
    expect(() => dangling.history.readEnvelope(dangling.summary)).toThrow(HistoryIntegrityError);

    const moved = publishedPair();
    tamper(moved.location, `UPDATE history_attempts SET environment = 'env:moved' WHERE attempt_id = 1; UPDATE history_results SET environment = 'env:moved' WHERE result_id = 1; UPDATE history_current SET environment = 'env:moved' WHERE result_id = 1`);
    expect(() => moved.history.readEnvelope(moved.summary)).toThrow(HistoryIntegrityError);

    const malformed = publishedPair();
    tamper(malformed.location, `UPDATE history_results SET provenance = 'not MDS1' WHERE result_id = 2`);
    expect(() => malformed.history.readEnvelope(malformed.summary)).toThrow(HistoryIntegrityError);
    expect(() => malformed.history.findCandidates({ ...scope, subject: summarySubject, version: 1 })).toThrow(HistoryIntegrityError);
  });
});
