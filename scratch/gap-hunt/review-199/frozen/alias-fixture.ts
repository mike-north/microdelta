/**
 * Symbolic alias conformance plus a PROVISIONAL hard-link consumer requirement.
 * The specification names symbolic links; it does not explicitly promise hard
 * links. The red hard-link probe establishes the unsupported boundary only.
 */
import { linkSync, symlinkSync } from 'node:fs';
import { afterEach, expect, test } from '@jest/globals';
import { cleanup, freshLocation, openHistory, provenance, scope } from './durable-history/support.js';

afterEach(cleanup);

for (const aliasKind of ['symbolic', 'hard'] as const) {
  test(`${aliasKind} file alias observes the same fenced writer`, () => {
    const location = freshLocation();
    const seeded = openHistory({ location });
    seeded.close();
    const alias = `${location}.alias`;
    if (aliasKind === 'symbolic') {
      symlinkSync(location, alias);
    } else {
      linkSync(location, alias);
    }
    const first = openHistory({ location });
    const second = openHistory({ location: alias });
    const acquired = first.acquireWriter({ holder: 'first', leaseMilliseconds: 60_000 });
    if (acquired.kind !== 'acquired') {throw new Error('first failed to acquire');}
    expect(second.acquireWriter({ holder: 'second', leaseMilliseconds: 60_000 })).toEqual({ kind: 'held', holder: 'first', expiresAt: acquired.lease.expiresAt });
    const request = { ...scope, subject: 'alias', version: 1, attemptKey: 'alias', intentDigest: 'alias' };
    const attempt = first.allocateAttempt(acquired.lease, request);
    first.stageAttempt(acquired.lease, { attemptId: attempt.attemptId, payload: { value: 'retained' }, provenance: provenance('alias'), dependencies: [] });
    const reference = first.publishAttempt(acquired.lease, attempt.attemptId);
    expect(second.reader.readSubtree(reference, [])).toEqual({ value: 'retained' });
  });
}
