import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import type { Fingerprint, ResultKey } from '../../../src/types.js';
import type { FieldRow, GenerationRow, Store, SubjectRow } from '../../../src/store/index.js';

/**
 * A backend's test-only counter at its actual value-read/deserialization boundary.
 * The suite resets it after insertion and verifies a positive control with getFields.
 * @public
 */
export interface ValueReadProbe {
  reset(): void;
  count(): number;
}

/**
 * Opens a fresh store for each test. The optional algorithm models persisted metadata
 * at open time; factories must reject a mismatch with their runtime algorithm.
 * Instrumentation is optional for third-party backends, but both shipped backends
 * must provide it to qualify SA-3 without relying on wall-clock timing.
 * @public
 */
export interface StoreConformanceOptions {
  create(options?: { fingerprintAlgorithm?: string }): Store | Promise<Store>;
  fingerprintAlgorithm: string;
  probeValueReads?(store: Store): ValueReadProbe;
}

/** Fixtures use distinct opaque fingerprints; hashing belongs to another component. */
function fingerprint(value: string): Fingerprint {
  return value as Fingerprint;
}

/** Construct a caller-owned tuple, deliberately independent of identity hashing. */
function key(step = 'summarize', revision = 1, subjectHash = 'subject'): ResultKey {
  return { step, revision, subjectHash };
}

/** Construct a structurally complete subject without performing lifecycle transitions. */
function subject(resultKey: ResultKey = key()): SubjectRow {
  return {
    key: resultKey,
    subject: { kind: 'step', name: resultKey.step, inputs: [{ kind: 'type', type: 'PR', key: '4521' }] },
    version: 0,
    currentGeneration: null,
    claim: null,
    durations: [],
  };
}

/** Generations are caller-allocated rows; the fixture intentionally uses arbitrary numbers. */
function generation(resultKey: ResultKey = key(), number = 7): GenerationRow {
  return {
    key: resultKey,
    generation: number,
    state: 'claimed',
    reads: [{ kind: 'field', arg: 0, path: 'title', fingerprint: fingerprint('title-fp') }],
    identity: { kind: 'type', type: 'PR', key: '4521' },
    startedAt: 100,
    endedAt: null,
    cost: { usd: 2 },
    arrival: 'batch',
  };
}

/** A value-bearing field row whose fingerprint is supplied, never recomputed by storage. */
function field(resultKey: ResultKey = key(), path = 'title', number = 7): FieldRow {
  return { key: resultKey, generation: number, path, fingerprint: fingerprint(`${path}-fp`), value: { title: 'before' } };
}

/** Narrow a value-bearing field without asserting away the backend's runtime shape. */
function hasTitle(value: unknown): value is { title: string } {
  return typeof value === 'object' && value !== null && 'title' in value && typeof value.title === 'string';
}

/** Assert fixture data before mutation so malformed backend output fails clearly. */
function titleValue(value: unknown): { title: string } {
  if (!hasTitle(value)) {
    throw new Error('Expected an object with a string title');
  }
  return value;
}

/**
 * Register reusable backend qualification tests for SA-1 through SA-7.
 * Register this from a Jest test module; the suite imports no concrete backend.
 * Mutation tests enforce rev 9's retained-value isolation at the storage seam.
 * This suite does not assert atomicity across subject, generation, and field rows:
 * the supplied Store contract does not provide that operation.
 * @public
 */
export function storeConformance(name: string, options: StoreConformanceOptions): void {
  describe(`Store conformance: ${name}`, () => {
    let store: Store;

    beforeEach(async () => {
      store = await options.create();
    });

    afterEach(async () => {
      await store.close();
    });

    test('SA-1: exactly one of 64 same-version CAS contenders wins', async () => {
      await store.putSubject(subject());
      const contenders = Array.from({ length: 64 }, (_, index) => store.casSubject(key(), 0, {
        claim: { generation: 7, holder: `holder-${index}`, leaseUntil: 1_000, progress: null },
      }));
      const won = await Promise.all(contenders);
      expect(won.filter(Boolean)).toHaveLength(1);
      const row = await store.getSubject(key());
      expect(row?.version).toBe(1);
      expect(row?.claim?.holder).toBe(`holder-${won.indexOf(true)}`);
    });

    test('SA-1: stale and missing CAS return false without applying any patch', async () => {
      await store.putSubject(subject());
      expect(await store.casSubject(key(), 0, { durations: [10], currentGeneration: 7 })).toBe(true);
      const before = await store.getSubject(key());
      expect(await store.casSubject(key(), 0, { durations: [99], currentGeneration: 99 })).toBe(false);
      expect(await store.getSubject(key())).toEqual(before);
      expect(await store.casSubject(key('missing'), 0, { durations: [99] })).toBe(false);
      expect(await store.getSubject(key('missing'))).toBeUndefined();
    });

    test('SA-1: successful writes increment the stored version once, including empty patches', async () => {
      await store.putSubject({ ...subject(), version: 19 });
      expect(await store.casSubject(key(), 19, {})).toBe(true);
      expect((await store.getSubject(key()))?.version).toBe(20);
      expect(await store.casSubject(key(), 20, { currentGeneration: 88 })).toBe(true);
      expect((await store.getSubject(key()))?.version).toBe(21);
    });

    test.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
      'SA-1: subject insertion rejects invalid CAS version %s without inserting',
      async (version) => {
        await expect(store.putSubject({ ...subject(), version })).rejects.toBeInstanceOf(RangeError);
        expect(await store.getSubject(key())).toBeUndefined();
      },
    );

    test('SA-1: exhausted CAS versions reject instead of letting multiple contenders win', async () => {
      const exhausted = { ...subject(), version: Number.MAX_SAFE_INTEGER };
      await store.putSubject(exhausted);
      await expect(store.casSubject(key(), Number.MAX_SAFE_INTEGER, { durations: [99] })).rejects.toBeInstanceOf(RangeError);
      expect(await store.getSubject(key())).toEqual(exhausted);
      // A stale token remains an ordinary lost race, even when the stored token is exhausted.
      expect(await store.casSubject(key(), Number.MAX_SAFE_INTEGER - 1, { durations: [88] })).toBe(false);
      expect(await store.getSubject(key())).toEqual(exhausted);
    });

    test('SA-1/SA-2: concurrent inserts produce one row; losers cannot overwrite the winner', async () => {
      const attempts = await Promise.allSettled(Array.from({ length: 64 }, (_, index) =>
        store.putSubject({ ...subject(), durations: [index] })));
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      for (const attempt of attempts) {
        if (attempt.status === 'rejected') {
          expect(attempt.reason).toMatchObject({ name: 'DuplicateRowError' });
        }
      }
      const winner = attempts.findIndex((attempt) => attempt.status === 'fulfilled');
      expect((await store.getSubject(key()))?.durations).toEqual([winner]);
    });

    test('SA-2: subject and generation inserts never replace existing rows', async () => {
      const originalSubject = subject();
      const originalGeneration = generation();
      await store.putSubject(originalSubject);
      await store.putGeneration(originalGeneration);
      await expect(store.putSubject({ ...originalSubject, currentGeneration: 99 })).rejects.toMatchObject({ name: 'DuplicateRowError' });
      await expect(store.putGeneration({ ...originalGeneration, state: 'abandoned' })).rejects.toMatchObject({ name: 'DuplicateRowError' });
      expect(await store.getSubject(key())).toEqual(originalSubject);
      expect(await store.getGeneration(key(), 7)).toEqual(originalGeneration);
    });

    test('SA-2: concurrent generation inserts have one winner', async () => {
      const attempts = await Promise.allSettled(Array.from({ length: 16 }, (_, index) =>
        store.putGeneration({ ...generation(), cost: { tokens: index } })));
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      for (const attempt of attempts) {
        if (attempt.status === 'rejected') {
          expect(attempt.reason).toMatchObject({ name: 'DuplicateRowError' });
        }
      }
      expect((await store.getGeneration(key(), 7))?.cost).toEqual({ tokens: attempts.findIndex((attempt) => attempt.status === 'fulfilled') });
    });

    test('tuple addressing isolates separator, Unicode, revision, generation, and path collisions', async () => {
      const keys = [key('a|1', 2, 'b'), key('a', 1, '2|b'), key('a:1', 2, 'b'), key('a', 1, '2:b'), key('a\u00001', 2, 'b'), key('a', 1, '2\u0000b'), key('😀', 1, '雪'), key('😀', 2, '雪')];
      for (const [index, resultKey] of keys.entries()) {
        await store.putSubject({ ...subject(resultKey), durations: [index] });
        await store.putGeneration({ ...generation(resultKey), cost: { index } });
        await store.putFields([{ ...field(resultKey), value: index }, { ...field(resultKey, 'title', 8), value: index + 100 }, { ...field(resultKey, 'title|8'), value: index + 200 }]);
      }
      for (const [index, resultKey] of keys.entries()) {
        expect((await store.getSubject(resultKey))?.durations).toEqual([index]);
        expect((await store.getGeneration(resultKey, 7))?.cost).toEqual({ index });
        expect((await store.getFields(resultKey, 7, ['title']))[0]?.value).toBe(index);
        expect((await store.getFields(resultKey, 8, ['title']))[0]?.value).toBe(index + 100);
        expect((await store.getFields(resultKey, 7, ['title|8']))[0]?.value).toBe(index + 200);
      }
    });

    test('tuple addressing distinguishes nonfinite numeric revisions and generations', async () => {
      const numbers = [NaN, Infinity, -Infinity, 0];
      for (const [revisionIndex, revision] of numbers.entries()) {
        const resultKey = key('numeric', revision);
        await store.putSubject({ ...subject(resultKey), durations: [revisionIndex] });
        for (const [generationIndex, number] of numbers.entries()) {
          await store.putGeneration({ ...generation(resultKey, number), cost: { revisionIndex, generationIndex } });
          await store.putFields([{ ...field(resultKey, 'payload', number), value: { revisionIndex, generationIndex } }]);
        }
      }
      for (const [revisionIndex, revision] of numbers.entries()) {
        const resultKey = key('numeric', revision);
        expect((await store.getSubject(resultKey))?.durations).toEqual([revisionIndex]);
        for (const [generationIndex, number] of numbers.entries()) {
          expect((await store.getGeneration(resultKey, number))?.cost).toEqual({ revisionIndex, generationIndex });
          expect((await store.getFields(resultKey, number, ['payload']))[0]?.value).toEqual({ revisionIndex, generationIndex });
        }
      }
    });

    test('retained rows are isolated from caller mutations after insertion', async () => {
      const inputSubject = subject();
      const inputGeneration = generation();
      const inputField = field();
      await store.putSubject(inputSubject);
      await store.putGeneration(inputGeneration);
      await store.putFields([inputField]);
      inputSubject.key.step = 'changed';
      inputSubject.subject.inputs = [];
      inputSubject.durations.push(55);
      inputGeneration.cost.usd = 999;
      inputGeneration.reads.length = 0;
      titleValue(inputField.value).title = 'changed';
      inputField.fingerprint = fingerprint('changed');
      expect(await store.getSubject(key())).toEqual(subject());
      expect(await store.getGeneration(key(), 7)).toEqual(generation());
      expect(await store.getFields(key(), 7, ['title'])).toEqual([field()]);
    });

    test('retained rows are isolated from caller mutations after reading', async () => {
      await store.putSubject(subject());
      await store.putGeneration(generation());
      await store.putFields([field()]);
      const readSubject = await store.getSubject(key());
      const readGeneration = await store.getGeneration(key(), 7);
      const readFields = await store.getFields(key(), 7, ['title']);
      expect(readSubject).toBeDefined();
      expect(readGeneration).toBeDefined();
      if (readSubject !== undefined) { readSubject.durations.push(777); readSubject.subject.inputs = []; }
      if (readGeneration !== undefined) { readGeneration.reads.length = 0; readGeneration.cost.usd = 999; }
      for (const readField of readFields) { titleValue(readField.value).title = 'changed'; }
      expect(await store.getSubject(key())).toEqual(subject());
      expect(await store.getGeneration(key(), 7)).toEqual(generation());
      expect(await store.getFields(key(), 7, ['title'])).toEqual([field()]);
    });

    test('CAS copies nested patches and returns isolated progress data', async () => {
      await store.putSubject(subject());
      const progress = { title: 'page 1' };
      const patch = { claim: { generation: 7, holder: 'worker', leaseUntil: 1_000, progress: { fingerprint: fingerprint('progress'), value: progress } }, durations: [123] };
      expect(await store.casSubject(key(), 0, patch)).toBe(true);
      progress.title = 'changed';
      patch.claim.holder = 'changed';
      patch.durations.push(999);
      const row = await store.getSubject(key());
      expect(row?.claim?.holder).toBe('worker');
      expect(row?.claim?.progress?.value).toEqual({ title: 'page 1' });
      expect(row?.durations).toEqual([123]);
      if (row?.claim?.progress !== null && row?.claim?.progress !== undefined) {
        titleValue(row.claim.progress.value).title = 'read mutation';
      }
      expect((await store.getSubject(key()))?.claim?.progress?.value).toEqual({ title: 'page 1' });
    });

    test('generation patches copy nested data and preserve omitted columns', async () => {
      await store.putGeneration(generation());
      const patch = { cost: { usd: 9 }, error: { message: 'provider failed' } };
      await store.updateGeneration(key(), 7, patch);
      patch.cost.usd = 99;
      patch.error.message = 'changed';
      expect(await store.getGeneration(key(), 7)).toEqual({ ...generation(), cost: { usd: 9 }, error: { message: 'provider failed' } });
    });

    test('generation updates reject missing rows and cannot alter tuple identity', async () => {
      await expect(store.updateGeneration(key(), 404, { state: 'current' })).rejects.toMatchObject({ name: 'MissingRowError' });
      await store.putGeneration(generation());
      const movedKey = { state: 'current' as const, key: key('other') };
      const movedGeneration = { state: 'current' as const, generation: 8 };
      await expect(store.updateGeneration(key(), 7, movedKey)).rejects.toMatchObject({ name: 'InvalidStorePatchError' });
      await expect(store.updateGeneration(key(), 7, movedGeneration)).rejects.toMatchObject({ name: 'InvalidStorePatchError' });
      expect(await store.getGeneration(key(), 7)).toEqual(generation());
      expect(await store.getGeneration(key('other'), 7)).toBeUndefined();
      expect(await store.getGeneration(key(), 8)).toBeUndefined();
    });

    test('CAS guards key and version even for structurally assignable extra properties', async () => {
      await store.putSubject(subject());
      // Structural assignment permits extra columns even without an unsafe cast.
      const movedKey = { durations: [], key: key('other') };
      const movedVersion = { durations: [], version: 99 };
      await expect(store.casSubject(key(), 0, movedKey)).rejects.toMatchObject({ name: 'InvalidStorePatchError' });
      await expect(store.casSubject(key(), 0, movedVersion)).rejects.toMatchObject({ name: 'InvalidStorePatchError' });
      expect(await store.getSubject(key())).toEqual(subject());
    });

    test('field batches are insert-only and a duplicate leaves the entire batch untouched', async () => {
      await store.putFields([field()]);
      await expect(store.putFields([field(key(), 'new'), { ...field(), value: 'overwrite' }])).rejects.toMatchObject({ name: 'DuplicateRowError' });
      expect(await store.getFields(key(), 7, ['new', 'title'])).toEqual([field()]);
      await expect(store.putFields([field(key(), 'new'), field(key(), 'new')])).rejects.toMatchObject({ name: 'DuplicateRowError' });
      expect(await store.getFields(key(), 7, ['new'])).toEqual([]);
    });

    test('concurrent field batches with an overlapping address have one complete winner', async () => {
      const attempts = await Promise.allSettled([
        store.putFields([{ ...field(), value: 'first' }, field(key(), 'first-only')]),
        store.putFields([{ ...field(), value: 'second' }, field(key(), 'second-only')]),
      ]);
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      const firstWon = attempts[0]?.status === 'fulfilled';
      expect((await store.getFields(key(), 7, ['title']))[0]?.value).toBe(firstWon ? 'first' : 'second');
      expect(await store.getFields(key(), 7, [firstWon ? 'second-only' : 'first-only'])).toEqual([]);
    });

    test('SA-3: fingerprint queries return supplied fingerprints and omit missing paths', async () => {
      await store.putFields([field(key(), ''), field()]);
      expect(await store.getFingerprints(key(), 7, ['title', 'missing', ''])).toEqual(new Map([
        ['title', fingerprint('title-fp')], ['', fingerprint('-fp')],
      ]));
      expect(await store.getFingerprints(key('missing'), 7, ['title'])).toEqual(new Map());
      expect(await store.getFields(key(), 7, ['missing'])).toEqual([]);
      expect(await store.getFields(key(), 7, [])).toEqual([]);
      const fingerprints = await store.getFingerprints(key(), 7, ['title']);
      fingerprints.set('title', fingerprint('changed'));
      expect((await store.getFingerprints(key(), 7, ['title'])).get('title')).toBe(fingerprint('title-fp'));
    });

    const probeTest = options.probeValueReads === undefined ? test.skip : test;
    probeTest('SA-3: fingerprint reads load zero values, independent of payload size', async () => {
      const probe = options.probeValueReads?.(store);
      expect(probe).toBeDefined();
      if (probe === undefined) { return; }
      for (const size of [16, 1_048_576]) {
        const path = `payload-${size}`;
        await store.putFields([{ ...field(key(), path), value: 'x'.repeat(size) }]);
        probe.reset();
        expect((await store.getFingerprints(key(), 7, [path])).get(path)).toBe(fingerprint(`${path}-fp`));
        expect(probe.count()).toBe(0);
        await store.getFields(key(), 7, [path]);
        expect(probe.count()).toBeGreaterThan(0);
      }
    });

    test('SA-4: expiry uses strict less-than, oldest-first ordering, and the requested limit', async () => {
      for (const [index, leaseUntil] of [300, 100, 200, 400].entries()) {
        await store.putSubject({ ...subject(key(`claim-${index}`)), claim: { generation: index, holder: 'holder', leaseUntil, progress: null } });
      }
      await store.putSubject(subject(key('unclaimed')));
      const rows = await store.expiredClaims(300, 1);
      expect(rows.map((row) => row.claim?.leaseUntil)).toEqual([100]);
      expect((await store.expiredClaims(300, 10)).map((row) => row.claim?.leaseUntil)).toEqual([100, 200]);
      expect(await store.expiredClaims(300, 0)).toEqual([]);
      expect(await store.expiredClaims(100, 10)).toEqual([]);
    });

    test('SA-4: expiry reads neither sweep nor mutate claims and return isolated rows', async () => {
      const original = { ...subject(), claim: { generation: 7, holder: 'holder', leaseUntil: 100, progress: null } };
      await store.putSubject(original);
      const expired = await store.expiredClaims(101, 10);
      expect(expired).toEqual([original]);
      expect(await store.getSubject(key())).toEqual(original);
      for (const row of expired) { row.claim = null; row.durations.push(88); }
      expect(await store.expiredClaims(101, 10)).toEqual([original]);
    });

    test('SA-5: metadata reports schema and the runtime algorithm, with isolated reads', async () => {
      const metadata = await store.meta();
      expect(metadata).toEqual({ schemaVersion: 1, fingerprintAlgorithm: options.fingerprintAlgorithm });
      metadata.schemaVersion = 999;
      metadata.fingerprintAlgorithm = 'changed';
      expect(await store.meta()).toEqual({ schemaVersion: 1, fingerprintAlgorithm: options.fingerprintAlgorithm });
    });

    test('SA-5: opening incompatible persisted fingerprint metadata rejects explicitly', async () => {
      // The factory models an existing store, not a request to switch algorithms.
      await expect(Promise.resolve().then(() => options.create({ fingerprintAlgorithm: `incompatible-with-${options.fingerprintAlgorithm}` })))
        .rejects.toMatchObject({ name: 'FingerprintAlgorithmMismatchError' });
    });

    test('SA-7: storing arbitrary generation numbers and states performs no lifecycle work', async () => {
      await store.putSubject(subject());
      await store.putGeneration({ ...generation(key(), 19), state: 'current' });
      await store.putGeneration({ ...generation(key(), 3), state: 'current' });
      await store.putFields([field()]);
      expect(await store.getSubject(key())).toEqual(subject());
      expect((await store.listGenerations(key())).map((row) => [row.generation, row.state]).sort((a, b) => Number(a[0]) - Number(b[0])))
        .toEqual([[3, 'current'], [19, 'current']]);
      expect(await store.getGeneration(key(), 7)).toBeUndefined();
      await store.updateGeneration(key(), 19, { state: 'abandoned' });
      expect((await store.getGeneration(key(), 3))?.state).toBe('current');
      expect(await store.getSubject(key())).toEqual(subject());
    });

    test('generation listings are isolated and restricted to the complete subject tuple', async () => {
      await store.putGeneration(generation());
      await store.putGeneration(generation(key('other')));
      const rows = await store.listGenerations(key());
      expect(rows).toEqual([generation()]);
      for (const row of rows) { row.cost.usd = 999; row.reads.length = 0; }
      rows.length = 0;
      expect(await store.listGenerations(key())).toEqual([generation()]);
      expect(await store.listGenerations(key('missing'))).toEqual([]);
    });
  });
}
