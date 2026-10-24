/** Controlled reproduction of the old facade fixture spending its lease before send. */
import { expect, jest, test } from '@jest/globals';
import { createStopController } from '../../src/index.js';
import { cleanup } from '../durable-history/support.js';
import { createWorld, installWorld } from './fixture.js';
import { freshKey, openStopSession, runIn } from './session.js';
import { tempStore } from './support.js';
import { untilRunReaches, within } from './lease-boundary.js';

test('old short lease can expire during setup before any provider send', async () => {
  const store = tempStore();
  const world = installWorld(createWorld(['item:1']));
  let now = 1_000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  let closeSession: (() => void) | undefined;
  let running: Promise<unknown> | undefined;
  const stop = createStopController();
  try {
    const session = openStopSession(store.location, { leaseMilliseconds: 150 });
    closeSession = () => { session.close(); };
    const started = runIn(session, { stop, observers: [{ observe(event) {
      if (event.kind === 'step' && event.event.phase === 'verify') { now += 300; }
    } }] }, (run) => run.resolve(session.fixture.instance('item:1'), { requestKey: freshKey() }));
    running = started;
    const result = await within(started, 'old fixture setup probe');
    expect(result.value).toMatchObject({ kind: 'refused', reason: 'lease-lost', disposition: 'denied' });
    expect(world.provider.received).toEqual([]);
  } finally {
    try {
      stop.request({ level: 'hard' });
      world.provider.release('item:1');
      if (running !== undefined) { await within(running.catch(() => undefined), 'setup probe cleanup'); }
    } finally {
      try { closeSession?.(); } finally { clock.mockRestore(); cleanup(); store.remove(); }
    }
  }
});

test('a completed pre-send denial is reported instead of a boundary polling timeout', async () => {
  const outcome = { kind: 'refused', reason: 'lease-lost', disposition: 'denied' };
  await expect(untilRunReaches(Promise.resolve(outcome), () => false, 'provider send', 2)).rejects.toMatchObject({
    message: 'Run ended before provider send', cause: { kind: 'returned', value: outcome },
  });
});

test('a rejected pre-send run retains its actual failure in the boundary error', async () => {
  const failure = new Error('setup failed');
  await expect(untilRunReaches(Promise.reject(failure), () => false, 'provider send', 2)).rejects.toMatchObject({
    message: 'Run ended before provider send', cause: { kind: 'threw', error: failure },
  });
});

test('an unobserved boundary stays bounded when its run never settles', async () => {
  await expect(untilRunReaches(new Promise<never>(() => undefined), () => false, 'provider send', 2)).rejects.toThrow('timed out waiting until provider send');
});

test('a boundary already reached remains observable when its run also settles', async () => {
  await expect(untilRunReaches(Promise.resolve('finished'), () => true, 'provider send', 1)).resolves.toBeUndefined();
});

test('completion waits have a real bounded deadline', async () => {
  await expect(within(new Promise<never>(() => undefined), 'missing completion', 5)).rejects.toThrow('timed out waiting for missing completion');
});
