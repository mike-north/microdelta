/**
 * Instrumented publication-cost counterexample. Count array slots exposed by
 * getOwnPropertyNames during supported-value validation. This is bounded work
 * evidence for this shape, not a universal complexity proof or latency SLA.
 */
import { afterEach, expect, jest, test } from '@jest/globals';
import { encodeSelectedFact, encodeSnapshot, observe } from '@microdelta/value';

import { cleanup, freshLocation, openHistory, provenance, scope } from '../durable-history/support.js';

afterEach(cleanup);

/** Count inspected array slots while preserving native reflection behavior. */
function arraySlotWork(work: () => void): number {
  const original = Object.getOwnPropertyNames;
  let slots = 0;
  const probe = jest.spyOn(Object, 'getOwnPropertyNames').mockImplementation((value: object) => {
    if (Array.isArray(value)) {
      slots += value.length;
    }
    return original(value);
  });
  try {
    work();
    return slots;
  } finally {
    probe.mockRestore();
  }
}

test('doubling a flat record array keeps publication validation work linear like matched encoding', () => {
  const encodeWork: number[] = [];
  const publishWork: number[] = [];
  for (const size of [20, 40]) {
    const payload = Array.from({ length: size }, (_, index) => ({ key: `pr:${index}`, body: 'x'.repeat(32) }));
    encodeWork.push(arraySlotWork(() => { encodeSnapshot(payload); }));
    const history = openHistory({ location: freshLocation() });
    const acquisition = history.acquireWriter({ holder: 'array-work-probe', leaseMilliseconds: 10_000 });
    if (acquisition.kind !== 'acquired') {
      throw new Error('Expected fresh store writer');
    }
    const lease = acquisition.lease;
    const attempt = history.allocateAttempt(lease, { ...scope, subject: 'payload', version: 1, attemptKey: 'publish', intentDigest: 'publish' });
    publishWork.push(arraySlotWork(() => {
      history.stageAttempt(lease, { attemptId: attempt.attemptId, payload, provenance: provenance('scale'), dependencies: [] });
      history.publishAttempt(lease, attempt.attemptId);
    }));
  }
  const [encodedSmall, encodedLarge] = encodeWork;
  const [publishedSmall, publishedLarge] = publishWork;
  if (encodedSmall === undefined || encodedLarge === undefined || publishedSmall === undefined || publishedLarge === undefined) {
    throw new Error('Expected paired work measurements');
  }
  console.log(JSON.stringify({ sizes: [20, 40], encodeWork, publishWork }));
  expect(encodedSmall).toBeGreaterThan(0);
  expect(encodedLarge).toBeLessThanOrEqual(2 * encodedSmall);
  // Proposed scale regression boundary: avoid rereading the entire root per field.
  expect(publishedLarge).toBeLessThanOrEqual(2 * publishedSmall);
});

test('nested and independent flat payload controls receive their own validation work', () => {
  const nestedWork: number[] = [];
  const nestedEncodingWork: number[] = [];
  for (const size of [10, 20]) {
    const payload = Array.from({ length: size }, (_, index) => ({
      key: `pr:${index}`,
      reviews: [{ value: index }, { value: index + 1 }],
    }));
    nestedEncodingWork.push(arraySlotWork(() => { encodeSnapshot(payload); }));
    const history = openHistory({ location: freshLocation() });
    const acquisition = history.acquireWriter({ holder: `nested-array-work-${size}`, leaseMilliseconds: 10_000 });
    if (acquisition.kind !== 'acquired') {
      throw new Error('Expected fresh store writer');
    }
    const attempt = history.allocateAttempt(acquisition.lease, {
      ...scope,
      subject: 'nested-payload',
      version: 1,
      attemptKey: `publish-${size}`,
      intentDigest: `publish-${size}`,
    });
    nestedWork.push(arraySlotWork(() => {
      history.stageAttempt(acquisition.lease, {
        attemptId: attempt.attemptId,
        payload,
        provenance: provenance('nested-scale'),
        dependencies: [],
      });
      history.publishAttempt(acquisition.lease, attempt.attemptId);
    }));
  }
  const [smallNested, largeNested] = nestedWork;
  const [smallNestedEncoding, largeNestedEncoding] = nestedEncodingWork;
  if (smallNested === undefined || largeNested === undefined
    || smallNestedEncoding === undefined || largeNestedEncoding === undefined) {
    throw new Error('Expected paired nested work measurements');
  }
  expect(smallNestedEncoding).toBeGreaterThan(0);
  expect(largeNestedEncoding).toBeLessThanOrEqual(2 * smallNestedEncoding);
  expect(smallNested).toBeGreaterThan(0);
  expect(largeNested).toBeLessThanOrEqual(2 * smallNested);

  // Equal-size payloads are separate roots; each publication must validate its own data.
  const independentWork: number[] = [];
  for (const payloadValue of ['first', 'second'] as const) {
    const payload = Array.from({ length: 20 }, (_, index) => ({ key: `${payloadValue}:${index}` }));
    const history = openHistory({ location: freshLocation() });
    const acquisition = history.acquireWriter({ holder: `independent-${payloadValue}`, leaseMilliseconds: 10_000 });
    if (acquisition.kind !== 'acquired') {
      throw new Error('Expected fresh store writer');
    }
    const attempt = history.allocateAttempt(acquisition.lease, {
      ...scope,
      subject: 'independent-payload',
      version: 1,
      attemptKey: payloadValue,
      intentDigest: payloadValue,
    });
    independentWork.push(arraySlotWork(() => {
      history.stageAttempt(acquisition.lease, {
        attemptId: attempt.attemptId,
        payload,
        provenance: provenance(payloadValue),
        dependencies: [],
      });
      history.publishAttempt(acquisition.lease, attempt.attemptId);
    }));
  }
  const [firstIndependent, secondIndependent] = independentWork;
  if (firstIndependent === undefined || secondIndependent === undefined) {
    throw new Error('Expected independent payload measurements');
  }
  expect(firstIndependent).toBeGreaterThan(0);
  expect(secondIndependent).toBeGreaterThan(0);
});

test('unsupported array payloads fail during staging and leave no publishable result', () => {
  const accessor: unknown[] = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get: () => 'must not run' });
  accessor.length = 1;

  const cyclic: unknown[] = [];
  cyclic.push(cyclic);

  const shared = { value: 'one owning slot' };
  const sharedReference: unknown[] = [shared, shared];

  const withSymbol: unknown[] = [];
  Object.defineProperty(withSymbol, Symbol('unsupported'), { value: true });

  const withExtraProperty: unknown[] = [];
  Object.defineProperty(withExtraProperty, 'extra', { value: true, enumerable: true });

  const withCustomPrototype = new Proxy(new Array<unknown>(), {
    getPrototypeOf: (): object => Object.freeze({ marker: true }),
  });
  const invalidPayloads: readonly unknown[][] = [
    accessor,
    cyclic,
    sharedReference,
    withSymbol,
    withExtraProperty,
    withCustomPrototype,
  ];
  const history = openHistory({ location: freshLocation() });
  const acquisition = history.acquireWriter({ holder: 'array-negative-probe', leaseMilliseconds: 10_000 });
  if (acquisition.kind !== 'acquired') {
    throw new Error('Expected fresh store writer');
  }

  invalidPayloads.forEach((payload, index) => {
    const attemptKey = `invalid-${index}`;
    const attempt = history.allocateAttempt(acquisition.lease, {
      ...scope,
      subject: 'unsupported-array',
      version: 1,
      attemptKey,
      intentDigest: attemptKey,
    });
    expect(() => history.stageAttempt(acquisition.lease, {
      attemptId: attempt.attemptId,
      payload,
      provenance: provenance('unsupported-array'),
      dependencies: [],
    })).toThrow(TypeError);
    expect(history.recoverAttempt({
      ...scope,
      subject: 'unsupported-array',
      version: 1,
      attemptKey,
      intentDigest: attemptKey,
    }))
      .toMatchObject({ kind: 'incomplete', attempt: { state: 'allocated' } });
  });
});

test('a later independent array is validated even after an equal-length payload was accepted', () => {
  const history = openHistory({ location: freshLocation() });
  const acquisition = history.acquireWriter({ holder: 'independent-payload-probe', leaseMilliseconds: 10_000 });
  if (acquisition.kind !== 'acquired') {
    throw new Error('Expected fresh store writer');
  }
  const first = history.allocateAttempt(acquisition.lease, {
    ...scope,
    subject: 'independent-array',
    version: 1,
    attemptKey: 'valid-first',
    intentDigest: 'valid-first',
  });
  expect(() => history.stageAttempt(acquisition.lease, {
    attemptId: first.attemptId,
    payload: [],
    provenance: provenance('valid-first'),
    dependencies: [],
  })).not.toThrow();

  const invalidSecond: unknown[] = [];
  Object.defineProperty(invalidSecond, Symbol('unsupported'), { value: true });
  const second = history.allocateAttempt(acquisition.lease, {
    ...scope,
    subject: 'independent-array',
    version: 1,
    attemptKey: 'invalid-second',
    intentDigest: 'invalid-second',
  });
  expect(() => history.stageAttempt(acquisition.lease, {
    attemptId: second.attemptId,
    payload: invalidSecond,
    provenance: provenance('invalid-second'),
    dependencies: [],
  })).toThrow(TypeError);
  expect(history.recoverAttempt({
    ...scope,
    subject: 'independent-array',
    version: 1,
    attemptKey: 'invalid-second',
    intentDigest: 'invalid-second',
  })).toMatchObject({ kind: 'incomplete', attempt: { state: 'allocated' } });
});

test('published exact root and selected facts match the independent Value observation oracle', () => {
  const sparse = new Array<unknown>(5);
  sparse[0] = undefined;
  sparse[3] = -0;
  sparse[4] = Number.NaN;
  const base = { inherited: 'base' };
  const prototype = Object.create(base) as { own: string };
  prototype.own = 'parent';
  const custom = Object.create(prototype) as { local: string };
  custom.local = 'child';
  const payload = { rows: sparse, nested: [{ value: 'Ada' }], custom, ordered: { zeta: 1, alpha: 2 } };
  const history = openHistory({ location: freshLocation() });
  const acquisition = history.acquireWriter({ holder: 'exact-value-probe', leaseMilliseconds: 10_000 });
  if (acquisition.kind !== 'acquired') {
    throw new Error('Expected fresh store writer');
  }
  const attempt = history.allocateAttempt(acquisition.lease, {
    ...scope,
    subject: 'exact-value-payload',
    version: 1,
    attemptKey: 'exact-value',
    intentDigest: 'exact-value',
  });
  history.stageAttempt(acquisition.lease, {
    attemptId: attempt.attemptId,
    payload,
    provenance: provenance('exact-value'),
    dependencies: [],
  });
  const reference = history.publishAttempt(acquisition.lease, attempt.attemptId);

  expect(encodeSnapshot(history.reader.readSubtree(reference, []))).toBe(encodeSnapshot(payload));
  const requests = [
    { address: [{ kind: 'property', key: 'rows' }], operation: 'value' },
    { address: [{ kind: 'property', key: 'rows' }], operation: 'length' },
    { address: [{ kind: 'property', key: 'rows' }, { kind: 'index', index: 0 }], operation: 'own' },
    { address: [{ kind: 'property', key: 'rows' }, { kind: 'index', index: 1 }], operation: 'own' },
    { address: [{ kind: 'property', key: 'rows' }, { kind: 'index', index: 3 }], operation: 'value' },
    { address: [{ kind: 'property', key: 'rows' }, { kind: 'index', index: 4 }], operation: 'value' },
    { address: [{ kind: 'property', key: 'nested' }, { kind: 'index', index: 0 }, { kind: 'property', key: 'value' }], operation: 'value' },
    { address: [{ kind: 'property', key: 'custom' }, { kind: 'property', key: 'inherited' }], operation: 'value' },
    { address: [{ kind: 'property', key: 'custom' }, { kind: 'property', key: 'inherited' }], operation: 'own' },
    { address: [{ kind: 'property', key: 'custom' }, { kind: 'property', key: 'inherited' }], operation: 'membership' },
    { address: [{ kind: 'property', key: 'ordered' }], operation: 'keys' },
  ] as const;
  for (const request of requests) {
    expect(encodeSelectedFact(history.reader.readSelected(reference, request)))
      .toBe(encodeSelectedFact(observe(payload, request.address, request.operation)));
  }
});
