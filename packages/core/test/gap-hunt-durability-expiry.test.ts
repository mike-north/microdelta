/**
 * PUB-002 selected protocol requires an unexpired lease at each mutation.
 * Probe the exact endpoint, supplementing existing forward/backward clock and
 * same-holder fence tests. No process/crash claim follows from this test.
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { StaleWriterError } from '@microdelta/history';

import { cleanup, controlledClock, freshLocation, openHistory, provenance, scope } from './durable-history/support.js';
import { acquire, attempt, publish } from './journal/support.js';

afterEach(cleanup);

describe('GAP HUNT exact lease endpoint (PUB-002)', () => {
  test.each([1_099, 1_100])('ownership-sensitive mutations at %i respect the unexpired endpoint1100', (now) => {
    const clock = controlledClock(1_000);
    const history = openHistory({ location: freshLocation(), clock });
    const lease = acquire(history, 'old', 100);
    const previous = publish(history, lease, scope, 'subject', { key: 'previous' });
    const staged = history.allocateAttempt(lease, attempt(scope, 'subject', 'staged'));
    history.stageAttempt(lease, { attemptId: staged.attemptId, payload: { value: 'next' }, provenance: provenance('next'), dependencies: [] });
    const allocated = history.allocateAttempt(lease, attempt(scope, 'another', 'allocated'));
    clock.set(now);
    if (now === 1_099) {
      expect(() => history.allocateAttempt(lease, attempt(scope, 'third', 'live'))).not.toThrow();
      expect(() => history.stageAttempt(lease, { attemptId: allocated.attemptId, payload: {}, provenance: provenance('live'), dependencies: [] })).not.toThrow();
      expect(history.publishAttempt(lease, staged.attemptId)).not.toEqual(previous);
      expect(history.renewWriter(lease, 100).kind).toBe('renewed');
      expect(() => history.releaseWriter(lease)).not.toThrow();
    } else {
      expect(() => history.allocateAttempt(lease, attempt(scope, 'third', 'expired'))).toThrow(StaleWriterError);
      expect(() => history.stageAttempt(lease, { attemptId: allocated.attemptId, payload: {}, provenance: provenance('expired'), dependencies: [] })).toThrow(StaleWriterError);
      expect(() => history.publishAttempt(lease, staged.attemptId)).toThrow(StaleWriterError);
      expect(() => history.renewWriter(lease, 100)).toThrow(StaleWriterError);
      expect(() => history.releaseWriter(lease)).toThrow(StaleWriterError);
      const successor = acquire(history, 'new', 100);
      expect(successor.fence).toBe(lease.fence + 1);
      expect(() => history.releaseWriter(lease)).toThrow(StaleWriterError);
      expect(history.currentWriter()).toEqual(successor);
      expect(history.readCurrent({ ...scope, subject: 'subject' })).toEqual(previous);
    }
  });
});
