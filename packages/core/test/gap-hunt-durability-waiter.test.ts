/**
 * Selected M5 cancellation boundary: each run owns its stop intent while a
 * second run waits for the single writer. Two callers demand the same subject,
 * but this is serialized lease waiting, not an invented shared-work scheduler.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';

import { authoring, createStopController, currentExecution, openWorkspace } from '../src/index.js';

/** The explicitly bound external work boundary; no hidden captured influence. */
interface IHelpers { readonly work: () => Promise<{ readonly retained: boolean }> }

/** One barrier controlled by the test rather than wall-clock completion. */
function gate(): { readonly promise: Promise<void>; open(): void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

describe('GAP HUNT stopped writer waiter preserves active owner (RUN-002, RUN-014)', () => {
  test('stopping another run demanding the same subject leaves its active owner live; the result later reuses', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-waiter-owner-'));
    const entered = gate();
    const finish = gate();
    const builders = authoring<object, IHelpers>();
    let calls = 0;
    const work = async (): Promise<{ readonly retained: boolean }> => {
      calls += 1;
      entered.open();
      await finish.promise;
      expect(currentExecution().stop.level).toBe('none');
      return { retained: true };
    };
    const value = builders.memo({ subject: 'same-subject', run: ({ helpers }) => helpers.work() });
    const composition = builders.compose({ scope: 'waiter-owner', inputs: [], helpers: [{ slot: 'work', helper: work }], steps: [{ slot: 'value', declaration: value }] });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'waiter-owner' });
    const options = { authoring: builders, composition, environment: 'env:same' };
    const target = { scope: 'waiter-owner', role: 'step', slot: 'value' } as const;
    const stop = createStopController();
    try {
      const owner = workspace.run(options, (run) => run.resolve(target, { requestKey: 'owner' }));
      await entered.promise;
      const waiter = workspace.run({ ...options, stop, writerWait: { pollMilliseconds: 5 } }, (run) => run.resolve(target, { requestKey: 'waiter' }));
      // Handle rejection immediately; only the explicit stop ends this wait.
      const stopped = waiter.then(() => 'unexpected-success', (error: unknown) => error);
      await new Promise<void>((resolve) => { setTimeout(resolve, 25); });
      expect(calls).toBe(1);
      stop.request({ level: 'hard' });
      expect(await stopped).toMatchObject({ code: 'stopped' });
      expect(calls).toBe(1);
      finish.open();
      const completed = await owner;
      expect(completed.value.kind).toBe('published');
      const later = await workspace.run(options, (run) => run.resolve(target, { requestKey: 'later' }));
      expect(later.value.kind).toBe('reused');
      if (completed.value.kind === 'published' && later.value.kind === 'reused') {
        expect(later.value.reference).toEqual(completed.value.reference);
      }
      expect(calls).toBe(1);
    } finally { finish.open(); workspace.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
