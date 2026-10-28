/** Intended evidence outcomes precede the mechanism; synthetic controls test the oracles, never claim measured candidate support. */
import { expect, test } from '@jest/globals';

import { assertCommittedPair, classifyCandidate, readFailure, sourceEffects } from '../src/evidence.js';
import type { ICaseEvidence, ICorrelatedPair, IMandatoryLayout, ISourceImage } from '../src/protocol.js';

/** Fixed literal revisions are independent expected values for the small SQL fixture. */
const committedB: ICorrelatedPair = { revision: 2, currentRevision: 2, value: 'B' };
/** This complete model exists only to challenge verdict rules; no collector has supplied this proof. */
function completeModel(id: IMandatoryLayout): ICaseEvidence {
  return { id, fixtureHealth: 'verified-healthy', execution: 'observed', committed: 'satisfied', coherence: 'satisfied',
    domainMutation: 'none', attribution: 'reader-only', sourceEffects: [], transientAbsence: 'qualified' };
}
/** Both mandatory ordinary layouts must survive the same independent assertions. */
function models(): readonly ICaseEvidence[] { return [completeModel('closed-wal-no-sidecars'), completeModel('active-wal')]; }
/** Source image fixtures describe sampled bytes; they have no native/transient observation authority. */
function image(sha256: string, sidecar = false): ISourceImage {
  return { files: [{ name: 'store.sqlite', bytes: 4096, sha256 }, ...(sidecar ? [{ name: 'store.sqlite-shm', bytes: 32768, sha256: 'c'.repeat(64) }] : [])] };
}

test('the value oracle rejects held old A as a current-B answer without calling the legitimate old snapshot a SQLite defect', () => {
  expect(assertCommittedPair(committedB, committedB)).toEqual({ kind: 'satisfied' });
  expect(assertCommittedPair({ revision: 1, currentRevision: 1, value: 'A' }, committedB)).toEqual({ kind: 'counterexample', reason: 'stale-or-wrong-value' });
});
test('the same pair oracle rejects two individually valid reads combined across a writer commit', () => {
  expect(assertCommittedPair({ revision: 2, currentRevision: 3, value: 'C' }, committedB)).toEqual({ kind: 'counterexample', reason: 'mixed-revisions' });
});
test('a complete proof model requires both healthy layouts and both independent evidence axes', () => {
  expect(classifyCandidate(models())).toBe('PASS');
  expect(classifyCandidate([completeModel('active-wal')])).toBe('INCONCLUSIVE');
});
test.each(['closed-wal-no-sidecars', 'active-wal'] as const)('refusing verified healthy %s rejects the candidate rather than adopting a narrower reader', id => {
  expect(classifyCandidate([...models().filter(cell => cell.id !== id), { ...completeModel(id), execution: 'refused', committed: 'unproved', coherence: 'unproved' }])).toBe('REJECT');
});
test('uncertain fixture health cannot manufacture a decisive healthy-layout counterexample', () => {
  expect(classifyCandidate(models().map(cell => ({ ...cell, fixtureHealth: 'unproved', execution: 'refused' })))).toBe('INCONCLUSIVE');
});
test('reader-attributable SHM mutation rejects strict support even when committed/coherent domain reads succeed', () => {
  expect(classifyCandidate([{ ...completeModel('closed-wal-no-sidecars'), sourceEffects: [{ kind: 'created', name: 'store.sqlite-shm' }] },
    { ...completeModel('active-wal'), execution: 'unexecuted', committed: 'unproved', coherence: 'unproved' }])).toBe('REJECT');
});
test('a changed source file without reader-only attribution is inconclusive rather than blamed on the reader', () => {
  expect(classifyCandidate(models().map(cell => ({ ...cell, attribution: 'unproved', sourceEffects: [{ kind: 'content-changed', name: 'store.sqlite-shm' }] })))).toBe('INCONCLUSIVE');
});
test('endpoint equality alone cannot establish operation-wide absence of transient native effects', () => {
  expect(classifyCandidate(models().map(cell => ({ ...cell, transientAbsence: 'unproved' })))).toBe('INCONCLUSIVE');
});
test.each(['committed', 'coherence'] as const)('a positive %s counterexample rejects the mechanism independently of source effects', key => {
  expect(classifyCandidate(models().map(cell => ({ ...cell, [key]: 'counterexample' })))).toBe('REJECT');
});
test('a positive observed domain mutation cannot be classified as a read-only candidate pass', () => {
  expect(classifyCandidate(models().map(cell => ({ ...cell, domainMutation: 'observed' })))).toBe('REJECT');
});
test('the source oracle detects sampled content, creation and removal using the same comparison', () => {
  expect(sourceEffects(image('a'.repeat(64)), image('b'.repeat(64), true))).toEqual([
    { kind: 'content-changed', name: 'store.sqlite' }, { kind: 'created', name: 'store.sqlite-shm' },
  ]);
  expect(sourceEffects(image('a'.repeat(64), true), image('a'.repeat(64)))).toEqual([{ kind: 'removed', name: 'store.sqlite-shm' }]);
});
test('a deliberately restored image demonstrates endpoint blindness rather than upgrading it to absence proof', () => {
  const before = image('a'.repeat(64)); const changed = image('b'.repeat(64), true);
  expect(sourceEffects(before, changed)).not.toEqual([]);
  expect(sourceEffects(before, image('a'.repeat(64)))).toEqual([]);
  expect(classifyCandidate(models().map(cell => ({ ...cell, transientAbsence: 'unproved' })))).toBe('INCONCLUSIVE');
});
test('a valid foreign SQLite query failure stays a query failure with its original cause, never History corruption', () => {
  const cause = Object.freeze({ name: 'SqliteError', code: 'SQLITE_ERROR', message: 'no such table: snapshot_meta' });
  const failure = readFailure(cause, 'query');
  expect(failure.kind).toBe('query-failed'); expect(failure.cause).toBe(cause);
});
test.each([
  ['ENOENT', 'absent'], ['SQLITE_CORRUPT', 'corrupt'], ['SQLITE_NOTADB', 'corrupt'],
  ['SQLITE_READONLY_ROLLBACK', 'recovery-required'], ['SQLITE_READONLY_RECOVERY', 'recovery-required'], ['SQLITE_BUSY', 'busy'],
])('host-evidenced %s retains its meaning and exact in-process cause', (code, kind) => {
  const cause = Object.freeze({ code }); const failure = readFailure(cause, 'open');
  expect(failure.kind).toBe(kind); expect(failure.cause).toBe(cause);
});
test('message text alone cannot turn an unknown error into busy, corruption or a store-identity diagnosis', () => {
  const cause = Object.freeze({ message: 'SQLITE_BUSY corrupt wrong History store' });
  expect(readFailure(cause, 'open')).toEqual({ kind: 'failed', cause });
});
