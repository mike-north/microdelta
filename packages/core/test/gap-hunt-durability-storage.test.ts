/**
 * GAP HUNT: real SQLITE_FULL rollback and physical-file damage boundaries.
 * A per-connection page cap exhausts only a synthetic temporary database;
 * it never consumes the host disk. These probes establish failure atomicity,
 * not power-loss or device-failure durability (PUB-004's explicit limit).
 */
import { readFileSync, truncateSync, writeFileSync } from 'node:fs';

import { afterEach, describe, expect, test } from '@jest/globals';
import type { IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeSqlite } from '@microdelta/machine-node';
import type { ISqliteCapability } from '@microdelta/history';

import { cleanup, controlledClock, freshLocation, openHistory, provenance, scope } from './durable-history/support.js';

afterEach(cleanup);

/** A caller-saved identity for one execution, scoped independently of display text. */
function request(key: string) {
  return { ...scope, subject: 'gap-hunt:durability', version: 1, attemptKey: key, intentDigest: `intent:${key}` };
}

/** Acquire the synthetic store's single writer. */
function acquire(history: IDurableHistory): IWriterLease {
  const result = history.acquireWriter({ holder: 'gap-hunt', leaseMilliseconds: 60_000 });
  if (result.kind !== 'acquired') {
    throw new Error(`unexpected lease result ${result.kind}`);
  }
  return result.lease;
}

/** Wrap the real capability with a strictly local page limit controlled by the test. */
function cappedSqlite(): { readonly capability: ISqliteCapability; cap(): void; uncap(): void } {
  const real = createNodeSqlite();
  let connection: ReturnType<ISqliteCapability['openSqlite']> | undefined;
  return {
    capability: {
      openSqlite(location) {
        connection = real.openSqlite(location);
        return connection;
      },
    },
    cap() {
      if (connection === undefined) {throw new Error('store not opened');}
      const count = connection.prepare('PRAGMA page_count').get()?.['page_count'];
      if (typeof count !== 'number') {throw new Error('missing page count');}
      connection.exec(`PRAGMA max_page_count = ${String(count)}`);
    },
    uncap() {
      if (connection === undefined) {throw new Error('store not opened');}
      connection.exec('PRAGMA max_page_count = 1000000');
    },
  };
}

describe('GAP HUNT storage failure atomicity (PUB-001, PUB-003, PUB-004)', () => {
  test.each(['stage', 'publish'] as const)('SQLITE_FULL during %s preserves old exact history and incomplete evidence, then permits recovery', (boundary) => {
    const location = freshLocation();
    const sqlite = cappedSqlite();
    const history = openHistory({ location, sqlite: sqlite.capability, clock: controlledClock(1_000) });
    const lease = acquire(history);
    const seed = history.allocateAttempt(lease, request('seed'));
    history.stageAttempt(lease, { attemptId: seed.attemptId, payload: { value: 'old' }, provenance: provenance('seed'), dependencies: [] });
    const old = history.publishAttempt(lease, seed.attemptId);
    const next = history.allocateAttempt(lease, request('fault'));
    // One large scalar requires duplicate staged/completed storage at publication.
    const payload = { value: 'x'.repeat(256_000) };
    const stage = (): void => { history.stageAttempt(lease, { attemptId: next.attemptId, payload, provenance: provenance('fault'), dependencies: [] }); };
    if (boundary === 'publish') {stage();}
    sqlite.cap();
    const action = boundary === 'stage' ? stage : (): void => { history.publishAttempt(lease, next.attemptId); };
    expect(action).toThrow(expect.objectContaining({ code: 'SQLITE_FULL' }));
    expect(history.readCurrent({ ...scope, subject: request('seed').subject })).toEqual(old);
    expect(history.reader.readSubtree(old, [])).toEqual({ value: 'old' });
    expect(history.recoverAttempt(request('fault'))).toMatchObject({ kind: 'incomplete', attempt: { state: boundary === 'stage' ? 'allocated' : 'staged' } });
    sqlite.uncap();
    if (boundary === 'stage') {stage();}
    const fresh = history.publishAttempt(lease, next.attemptId);
    history.releaseWriter(lease);
    history.close();
    const reopened = openHistory({ location });
    expect(reopened.reader.readSubtree(old, [])).toEqual({ value: 'old' });
    expect(reopened.reader.readSubtree(fresh, [])).toEqual(payload);
    expect(reopened.recoverAttempt(request('fault'))).toMatchObject({ kind: 'completed', reference: fresh });
    const later = reopened.allocateAttempt(acquire(reopened), request('later'));
    expect(later.attemptId).toBeGreaterThan(next.attemptId);
  });

  test.each(['header', 'truncated'] as const)('physical %s damage rejects a reopened synthetic store without replacing it', (damage) => {
    const location = freshLocation();
    const history = openHistory({ location });
    const lease = acquire(history);
    const allocated = history.allocateAttempt(lease, request('seed'));
    history.stageAttempt(lease, { attemptId: allocated.attemptId, payload: { value: 'retained' }, provenance: provenance('seed'), dependencies: [] });
    history.publishAttempt(lease, allocated.attemptId);
    history.releaseWriter(lease);
    history.close();
    if (damage === 'header') {
      const bytes = readFileSync(location);
      bytes[0] = 0;
      writeFileSync(location, bytes);
    } else {
      truncateSync(location, 100);
    }
    const damaged = readFileSync(location);
    expect(() => openHistory({ location })).toThrow();
    expect(readFileSync(location)).toEqual(damaged);
  });
});
