/**
 * Private writer refusal provenance distinguishes an error the writer wait
 * constructs from a host value with the same shape. No source, provider, lease
 * mutation or traversal is performed; the writer and timer are owner ports.
 */
import { describe, expect, test } from '@jest/globals';

import { SupervisionError } from '../src/errors.js';
import { createAbortSource } from '../src/control.js';
import { awaitWriter, writerWaitPolicy } from '../src/writer.js';
import { fakeTimer } from './support.js';

/** A host's exact thrown value is distinct from a writer-generated stop. */
const stoppedHost = new SupervisionError('stopped', 'host error shaped like a writer refusal');

describe('writer-generated stop provenance', () => {
  test.each([false, true])('reports the exact generated refusal when stop was already effective=%p', async alreadyStopped => {
    const stop = createAbortSource(); const timer = fakeTimer(); const observed: unknown[] = [];
    if (alreadyStopped) { stop.abort(); }
    const wait = {
      writer: { tryLease: () => ({ kind: 'held' as const, holder: 'other', expiresAt: Number.MAX_SAFE_INTEGER }), release: () => undefined },
      policy: writerWaitPolicy(undefined), timer, stop: stop.signal, runId: 'writer-proof',
      stopped: (error: SupervisionError): void => { observed.push(error); },
    };
    const result = awaitWriter(wait).then(() => ({ kind: 'granted' as const }), (error: unknown) => ({ kind: 'rejected' as const, error }));
    if (!alreadyStopped) { stop.abort(); }
    const outcome = await result;
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.error).toBeInstanceOf(SupervisionError); expect(observed).toHaveLength(1); expect(observed[0]).toBe(outcome.error);
    }
    expect(stop.listenerCount).toBe(0); expect(timer.scheduled.every(entry => entry.cancelled)).toBe(true);
  });

  test.each([undefined, stoppedHost])('a host lease failure is not writer stop provenance (%p)', async error => {
    const stop = createAbortSource(); const observed: unknown[] = [];
    const wait = {
      writer: { tryLease: (): never => { throw error; }, release: () => undefined },
      policy: writerWaitPolicy(undefined), timer: fakeTimer(), stop: stop.signal, runId: 'host-proof',
      stopped: (failure: SupervisionError): void => { observed.push(failure); },
    };
    const result = awaitWriter(wait).then(() => ({ kind: 'granted' as const }), (failure: unknown) => ({ kind: 'rejected' as const, failure }));
    const outcome = await result; expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') { expect(outcome.failure).toBe(error); } expect(observed).toEqual([]);
  });

  test('a stopped-shaped timer failure remains a host failure, not a generated stop', async () => {
    const stop = createAbortSource(); const observed: unknown[] = [];
    const wait = {
      writer: { tryLease: () => ({ kind: 'held' as const, holder: 'other', expiresAt: Number.MAX_SAFE_INTEGER }), release: () => undefined },
      policy: writerWaitPolicy(undefined), timer: { ...fakeTimer(), schedule: (): never => { throw stoppedHost; } }, stop: stop.signal, runId: 'timer-proof',
      stopped: (error: SupervisionError): void => { observed.push(error); },
    };
    await expect(awaitWriter(wait)).rejects.toBe(stoppedHost); expect(observed).toEqual([]);
  });
});
