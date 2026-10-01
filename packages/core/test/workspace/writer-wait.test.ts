/**
 * The workspace's wait for the store's writer lease, through the facade a
 * consumer uses (UAT layer of the owner's 2026-09-30 concurrency decision):
 * a normal request that finds another run holding the writer waits, takes the
 * lease over through History's fencing once it is free, and fails with the
 * exported `WriterBusyError` naming the holder when the operator's deadline
 * passes first. A stop ends the wait. These cases run on Node's real timer
 * with short poll intervals. The deterministic cross-process cases, including
 * SQLite contention (`SQLITE_BUSY` exhaustion) as a typed outcome, are in
 * `test/concurrency/interleavings.test.ts` (L1–L7): contention is exercised in
 * plain Node worker processes because, inside Jest, the SQLite driver's error
 * class can belong to another test file's module registry, so an in-process
 * case would test Jest's module isolation rather than the facade.
 *
 * @see ../../../../docs/spec/operations.md (RUN-002 owner decision)
 * @see ../../../../docs/spec/execution.md (PUB-002, PUB-005)
 * @see ../../../../docs/plans/m5-operations.md (Writer lease)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { IWriterLease } from '@microdelta/history';
import { createNodeClock } from '@microdelta/machine-node';

import { SupervisionError, WriterBusyError, createStopController, openWorkspace } from '../../src/index.js';
import type { IResolutionOutcome, IRunResult, IWorkspace, IWorkspaceRunOptions } from '../../src/index.js';
import { openHistory } from '../durable-history/support.js';
import { composeContributors, resetWorld } from './fixture.js';
import type { IContributors, IHelpers, IInputs } from './fixture.js';
import { caughtCode, environment, freshRequestKey, locatorOf, logicalStore, tempStore } from './support.js';
import type { ITempStore } from './support.js';

let store: ITempStore;
let workspace: IWorkspace;
let contributors: IContributors;

beforeEach(() => {
  store = tempStore();
  resetWorld();
  workspace = openWorkspace({ location: store.location, logicalStore });
  contributors = composeContributors();
});

afterEach(() => {
  workspace.close();
  store.remove();
});

/** Run options over the fixture composition with a chosen run identity. */
function options(runId: string, extra: Partial<IWorkspaceRunOptions<IInputs, IHelpers>> = {}): IWorkspaceRunOptions<IInputs, IHelpers> {
  return { authoring: contributors.authoring, composition: contributors.composition, environment, runId, ...extra };
}

/** The writer recorded in the store, read through an independent History connection that grants nothing. */
function recordedWriter(): IWriterLease | undefined {
  const history = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
  try {
    return history.currentWriter();
  } finally {
    history.close();
  }
}

/** Wait for real time; used only to let a waiter poll while the holder still holds. */
function elapse(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

describe('waiting for the writer lease through the workspace (RUN-002 owner decision)', () => {
  test('a second run waits while the first holds the writer, then publishes under the next fence once the first run closes', async () => {
    let second: Promise<IRunResult<IResolutionOutcome>> | undefined;
    let held: IWriterLease | undefined;
    await workspace.run(options('run:first'), async (first) => {
      await first.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
      held = recordedWriter();
      second = workspace.run(options('run:second', { writerWait: { pollMilliseconds: 10 } }), (run) => run.resolve(contributors.steps['person:ben'].summary, { requestKey: freshRequestKey() }));
      // The second run polls several times meanwhile and changes nothing the first holds.
      await elapse(60);
      expect(recordedWriter()).toEqual(held);
    });
    if (second === undefined || held === undefined) {
      throw new Error('the first run did not start the second');
    }
    const result = await second;
    expect(result.value.kind).toBe('published');
    expect(locatorOf(result.value)).toMatch(/^mdh1\|/u);
    // The first run released at close; the second acquired with the next fence and released in turn.
    const history = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
    try {
      expect(history.currentWriter()).toBeUndefined();
      const acquisition = history.acquireWriter({ holder: 'probe', leaseMilliseconds: 1 });
      expect(acquisition.kind === 'acquired' ? acquisition.lease.fence : undefined).toBe(held.fence + 2);
    } finally {
      history.close();
    }
  });

  test('at the operator deadline a waiting run fails with the exported WriterBusyError naming the holder and its expiry', async () => {
    const other = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
    const acquisition = other.acquireWriter({ holder: 'process:other', leaseMilliseconds: 60_000 });
    if (acquisition.kind !== 'acquired') {
      throw new Error('the other process could not acquire');
    }
    const deadline = Date.now() + 40;
    let caught: unknown;
    await workspace.run(options('run:late', { writerWait: { deadline, pollMilliseconds: 10 } }), async (run) => {
      try {
        await run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
      } catch (error: unknown) {
        caught = error;
      }
      // Check-only requests still work while another process holds the writer.
      await expect(run.check(contributors.steps['person:ada'].summary)).resolves.toMatchObject({ kind: 'execution-required' });
    });
    expect(caught).toBeInstanceOf(WriterBusyError);
    expect(caught).toBeInstanceOf(SupervisionError);
    if (!(caught instanceof WriterBusyError)) {
      throw new Error('expected WriterBusyError');
    }
    expect([caught.code, caught.holder, caught.expiresAt, caught.deadline, caught.contended]).toEqual(['writer-busy', 'process:other', acquisition.lease.expiresAt, deadline, false]);
    expect(Date.now()).toBeGreaterThanOrEqual(deadline);
    // The holder's lease is untouched.
    expect(other.currentWriter()).toEqual(acquisition.lease);
    other.close();
  });

  test('a hard stop ends a waiting run at once with stopped and leaves the holder untouched', async () => {
    const other = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
    const acquisition = other.acquireWriter({ holder: 'process:other', leaseMilliseconds: 60_000 });
    const stop = createStopController();
    const started = Date.now();
    const code = workspace.run(options('run:stopped', { stop, writerWait: { pollMilliseconds: 10 } }), (run) => caughtCode(run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() })));
    await elapse(30);
    stop.request({ level: 'hard' });
    expect((await code).value).toBe('stopped');
    // There is no default deadline: only the stop ended this wait, long before the holder's lease expires.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(other.currentWriter()).toEqual(acquisition.kind === 'acquired' ? acquisition.lease : undefined);
    other.close();
  });

  test.each([
    ['a zero poll interval', { pollMilliseconds: 0 }],
    ['a negative deadline', { deadline: -1 }],
  ])('%s is refused as an invalid request before any work', async (_name, writerWait) => {
    expect(await caughtCode(() => workspace.run(options('run:invalid', { writerWait }), () => 'never'))).toBe('invalid-request');
    expect(recordedWriter()).toBeUndefined();
  });
});
