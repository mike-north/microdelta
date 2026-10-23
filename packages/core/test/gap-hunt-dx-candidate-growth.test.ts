/** Measure eager candidate metadata work separately from acceptance-history readback. */
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { cleanup, freshLocation } from './durable-history/support.js';
import { resetWorld } from './resolution/fixture.js';
import { environment, openSession, payloadOf, referenceOf } from './resolution/support.js';

beforeEach(() => { resetWorld(); });
afterEach(cleanup);

/** Same-subject history should not be confused with unrelated stored results. */
test.each([100, 500, 1000].flatMap(count => [{ count, unrelated: false }, { count, unrelated: true }]))(
  'newest-valid resolution with $count retained results; unrelated=$unrelated',
  async ({ count, unrelated }) => {
    const location = freshLocation();
    const seed = openSession(location);
    let newest: string;
    try {
      const first = await seed.resolve(seed.contributors.steps['person:ada'].activity);
      const firstReference = referenceOf(first);
      const envelope = seed.history.readEnvelope({ kind: 'completed-result', locator: firstReference });
      const payload = payloadOf(seed.history, firstReference);
      newest = firstReference;
      for (let index = 1; index < count; index += 1) {
        const allocated = seed.history.allocateAttempt(seed.lease, {
          analysis: envelope.analysis, environment, subject: unrelated ? `unrelated:${String(index)}` : envelope.subject,
          version: envelope.version, attemptKey: `seed:${String(index)}`, intentDigest: `seed:${String(index)}`,
        });
        seed.history.stageAttempt(seed.lease, { attemptId: allocated.attemptId, payload, provenance: envelope.provenance, dependencies: envelope.dependencies });
        const reference = seed.history.publishAttempt(seed.lease, allocated.attemptId);
        if (!unrelated) { newest = reference.locator; }
      }
      // History intentionally returns every eligible result, newest first.
      const candidates = seed.history.findCandidates({ analysis: envelope.analysis, environment, subject: envelope.subject, version: envelope.version });
      expect(candidates).toHaveLength(unrelated ? 1 : count);
      expect(candidates[0]?.reference.locator).toBe(newest);
    } finally { seed.close(); }
    const current = openSession(location);
    try {
      const mark = current.sqlite.mark();
      const started = performance.now();
      const outcome = await current.resolve(current.contributors.steps['person:ada'].activity);
      const milliseconds = performance.now() - started;
      const evidence = current.sqlite.evidence(mark);
      expect(outcome.kind).toBe('reused');
      expect(referenceOf(outcome)).toBe(newest);
      expect(outcome.misses).toEqual([]);
      expect(current.admissions).toHaveLength(0);
      console.log(JSON.stringify({ count, unrelated, candidateRows: unrelated ? 1 : count, milliseconds, ...evidence }));
    } finally { current.close(); }
  }, 60_000,
);

/** Candidate narrowing keeps old version reuse independent of the latest publication. */
test('a newer different-version publication preserves rollback to the exact older result', async () => {
  const location = freshLocation();
  const first = openSession(location);
  let older: string;
  try { older = referenceOf(await first.resolve(first.contributors.steps['person:ada'].activity)); }
  finally { first.close(); }
  const changed = openSession(location, { adaActivityVersion: 2 });
  try {
    const outcome = await changed.resolve(changed.contributors.steps['person:ada'].activity);
    expect(outcome.kind).toBe('published');
    expect(referenceOf(outcome)).not.toBe(older);
  } finally { changed.close(); }
  const rollback = openSession(location);
  try {
    const outcome = await rollback.resolve(rollback.contributors.steps['person:ada'].activity);
    expect(outcome.kind).toBe('reused');
    expect(referenceOf(outcome)).toBe(older);
    expect(rollback.admissions).toHaveLength(0);
  } finally { rollback.close(); }
});
