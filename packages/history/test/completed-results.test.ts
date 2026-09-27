import { describe, expect, test } from '@jest/globals';
import { observe } from '@microdelta/value';
import type { ISelectedFact } from '@microdelta/value';

import type {
  ICompletedResultReader,
  ICompletedResultReference,
  ISelectedFingerprintRequest,
  ISelectedFingerprintResolution,
} from '../src/index.js';

/** A test-owned exact-snapshot reader makes reference dispatch visible without implying a backend. */
function createFakeReader(): {
  readonly reader: ICompletedResultReader;
  readonly setCurrent: (reference: ICompletedResultReference) => void;
  readonly payloadReads: () => number;
} {
  const snapshots = new Map<string, Readonly<Record<string, unknown>>>();
  const metadata = new Map<string, string>();
  let current: ICompletedResultReference | undefined;
  let reads = 0;
  const keyFor = (reference: ICompletedResultReference, request: ISelectedFingerprintRequest): string =>
    `${reference.locator}:${JSON.stringify(request)}`;
  return {
    reader: {
      readSelected(reference: ICompletedResultReference, request): ISelectedFact {
        reads += 1;
        const snapshot = snapshots.get(reference.locator);
        if (snapshot === undefined) {
          throw new TypeError(`Unknown completed result ${reference.locator}`);
        }
        return observe(snapshot, request.address, request.operation);
      },
      resolveFingerprint(reference: ICompletedResultReference, request: ISelectedFingerprintRequest): ISelectedFingerprintResolution {
        if (!snapshots.has(reference.locator)) {
          return { kind: 'unavailable' };
        }
        if (request.kind === 'selected' && request.encoding !== 'MDO1') {
          return { kind: 'incompatible' };
        }
        if (request.kind === 'projection' && request.encoding !== 'MDP1') {
          return { kind: 'incompatible' };
        }
        const fingerprint = metadata.get(keyFor(reference, request));
        return fingerprint === undefined ? { kind: 'unavailable' } : { kind: 'compatible', fingerprint };
      },
    },
    setCurrent(reference) {
      current = reference;
      if (reference.locator === 'snapshot-A') {
        snapshots.set(reference.locator, Object.freeze({ name: 'Ada', large: 'A payload' }));
      } else {
        snapshots.set(reference.locator, Object.freeze({ name: 'Grace', large: 'B payload' }));
      }
      const request: ISelectedFingerprintRequest = {
        kind: 'selected', operation: 'value', address: [{ kind: 'property', key: 'name' }], encoding: 'MDO1',
      };
      metadata.set(keyFor(reference, request), `digest-${reference.locator}`);
      void current;
    },
    payloadReads: () => reads,
  };
}

describe('completed-result locator and selected-reading contracts', () => {
  test('a saved reference resolves its exact snapshot after current moves from A to B', () => {
    const fake = createFakeReader();
    const a: ICompletedResultReference = { kind: 'completed-result', locator: 'snapshot-A' };
    const b: ICompletedResultReference = { kind: 'completed-result', locator: 'snapshot-B' };
    fake.setCurrent(a);
    fake.setCurrent(b);

    const read = { operation: 'value', address: [{ kind: 'property', key: 'name' }] } as const;
    expect(fake.reader.readSelected(a, read).fact).toBe('Ada');
    expect(fake.reader.readSelected(b, read).fact).toBe('Grace');
  });

  test('compatible metadata match and mismatch resolve without payload reads; explicit reads are positive controls', () => {
    const fake = createFakeReader();
    const reference: ICompletedResultReference = { kind: 'completed-result', locator: 'snapshot-A' };
    const request: ISelectedFingerprintRequest = {
      kind: 'selected', operation: 'value', address: [{ kind: 'property', key: 'name' }], encoding: 'MDO1',
    };
    fake.setCurrent(reference);
    const initialReads = fake.payloadReads();

    expect(fake.reader.resolveFingerprint(reference, request)).toEqual({ kind: 'compatible', fingerprint: 'digest-snapshot-A' });
    expect(Reflect.apply(fake.reader.resolveFingerprint, fake.reader, [reference, { ...request, encoding: 'unsupported' }])).toEqual({ kind: 'incompatible' });
    expect(fake.payloadReads()).toBe(initialReads);
    expect(fake.reader.readSelected(reference, { operation: request.operation, address: request.address }).fact).toBe('Ada');
    expect(fake.payloadReads()).toBe(initialReads + 1);
  });
});
