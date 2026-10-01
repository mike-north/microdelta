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
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { IWriterLease } from '@microdelta/history';
import { createNodeClock } from '@microdelta/machine-node';

import { SupervisionError, WriterBusyError, createStopController, openWorkspace } from '../../src/index.js';
import type { IWorkspace, IWorkspaceRunOptions } from '../../src/index.js';
import { cleanup, openHistory, openRaw } from '../durable-history/support.js';
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
  cleanup();
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

/** A one-shot gate a test opens to let awaiting work continue. */
function gate(): { readonly opened: Promise<void>; open(): void } {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Wait for real time; used only to let a waiter poll while the holder still holds. */
function elapse(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

describe('waiting for the writer lease through the workspace (RUN-002 owner decision)', () => {
  test('a second run waits while the first holds the writer, then publishes under the next fence once the first run closes', async () => {
    const holding = gate();
    const finish = gate();
    let held: IWriterLease | undefined;
    // The second run starts outside the first run's asynchronous context, as another caller would.
    const first = workspace.run(options('run:first'), async (run) => {
      await run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
      held = recordedWriter();
      holding.open();
      await finish.opened;
    });
    await holding.opened;
    const second = workspace.run(options('run:second', { writerWait: { pollMilliseconds: 10 } }), (run) => run.resolve(contributors.steps['person:ben'].summary, { requestKey: freshRequestKey() }));
    // The second run polls several times meanwhile and changes nothing the first holds.
    await elapse(60);
    expect(recordedWriter()).toEqual(held);
    finish.open();
    await first;
    if (held === undefined) {
      throw new Error('the first run did not hold the writer');
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

  test('SQLITE_BUSY exhaustion while waiting surfaces as the typed writer-busy outcome, marked contended and naming the recorded holder', async () => {
    const other = openHistory({ location: store.location, store: logicalStore, clock: createNodeClock() });
    const acquisition = other.acquireWriter({ holder: 'process:other', leaseMilliseconds: 60_000 });
    const locker = openRaw(store.location);
    locker.exec('BEGIN IMMEDIATE');
    let caught: unknown;
    try {
      await workspace.run(options('run:contended', { writerWait: { deadline: Date.now() } }), async (run) => {
        try {
          await run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        } catch (error: unknown) {
          caught = error;
        }
      });
    } finally {
      locker.exec('ROLLBACK');
    }
    expect(caught).toBeInstanceOf(WriterBusyError);
    if (!(caught instanceof WriterBusyError)) {
      throw new Error(`expected WriterBusyError, got ${String(caught)}`);
    }
    expect([caught.contended, caught.holder, caught.heldByThisRun]).toEqual([true, 'process:other', false]);
    expect(caught.message).toMatch(/busy/u);
    expect(other.currentWriter()).toEqual(acquisition.kind === 'acquired' ? acquisition.lease : undefined);
  });

  test.each([
    ['a zero poll interval', { pollMilliseconds: 0 }],
    ['a negative deadline', { deadline: -1 }],
  ])('%s is refused as an invalid request before any work', async (_name, writerWait) => {
    expect(await caughtCode(() => workspace.run(options('run:invalid', { writerWait }), () => 'never'))).toBe('invalid-request');
    expect(recordedWriter()).toBeUndefined();
  });
});

/**
 * Start a nested run from inside `outer`'s run and report how it settled
 * within 2 s: its error, `completed`, or that it was still waiting.
 */
async function nestedOutcome(start: () => Promise<unknown>): Promise<{ readonly outcome: unknown; readonly elapsed: number }> {
  const started = Date.now();
  const outcome = await Promise.race([start().then(() => 'completed', (error: unknown) => error), elapse(2_000).then(() => 'still waiting after 2 s')]);
  return { outcome, elapsed: Date.now() - started };
}

/** Assert a nested run was refused promptly with the typed invalid-request that names the reason. */
function expectNestedRefusal(result: { readonly outcome: unknown; readonly elapsed: number } | undefined): void {
  expect(result?.outcome).toBeInstanceOf(SupervisionError);
  expect(result?.outcome instanceof SupervisionError ? result.outcome.code : undefined).toBe('invalid-request');
  expect(result?.outcome instanceof Error ? result.outcome.message : '').toMatch(/inside an open run over the same store/u);
  expect(result?.elapsed).toBeLessThan(1_000);
}

describe('a run started from inside an open run over the same store', () => {
  test('is refused for a second workspace object opened over the same store file', async () => {
    const second = openWorkspace({ location: store.location, logicalStore });
    let result: { readonly outcome: unknown; readonly elapsed: number } | undefined;
    try {
      await workspace.run(options('run:outer'), async (outer) => {
        await outer.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        result = await nestedOutcome(() => second.run(options('run:inner'), (run) => run.resolve(contributors.steps['person:ben'].summary, { requestKey: freshRequestKey() })));
      });
    } finally {
      second.close();
    }
    expectNestedRefusal(result);
  });

  test('is refused when the second workspace names the same file by another spelling, through a symbolic link', async () => {
    const linkDirectory = mkdtempSync(join(tmpdir(), 'microdelta-link-'));
    const link = join(linkDirectory, 'store-link');
    symlinkSync(dirname(store.location), link);
    const second = openWorkspace({ location: `${link}/./${basename(store.location)}`, logicalStore });
    let result: { readonly outcome: unknown; readonly elapsed: number } | undefined;
    try {
      await workspace.run(options('run:outer'), async (outer) => {
        await outer.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        result = await nestedOutcome(() => second.run(options('run:inner'), (run) => run.resolve(contributors.steps['person:ben'].summary, { requestKey: freshRequestKey() })));
      });
    } finally {
      second.close();
      rmSync(linkDirectory, { recursive: true, force: true });
    }
    expectNestedRefusal(result);
  });

  test('is refused when a run over another store sits between it and the enclosing run over the same store', async () => {
    const otherStore = tempStore();
    const otherWorkspace = openWorkspace({ location: otherStore.location, logicalStore });
    let result: { readonly outcome: unknown; readonly elapsed: number } | undefined;
    try {
      await workspace.run(options('run:outer'), async (outer) => {
        await outer.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        await otherWorkspace.run(options('run:middle'), async () => {
          result = await nestedOutcome(() => workspace.run(options('run:inner'), (run) => run.resolve(contributors.steps['person:ben'].summary, { requestKey: freshRequestKey() })));
        });
      });
    } finally {
      otherWorkspace.close();
      otherStore.remove();
    }
    expectNestedRefusal(result);
  });
});

describe('a run started from inside an open run of the same workspace', () => {
  test('is refused promptly with invalid-request instead of waiting forever for the lease its caller holds', async () => {
    let outcome: unknown;
    let elapsed = Number.POSITIVE_INFINITY;
    await workspace.run(options('run:outer'), async (outer) => {
      await outer.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
      const started = Date.now();
      // No deadline: before the refusal existed, the inner run waited for the outer run's lease forever.
      const inner = workspace.run(options('run:inner'), (run) => run.resolve(contributors.steps['person:ben'].summary, { requestKey: freshRequestKey() }));
      outcome = await Promise.race([inner.then(() => 'completed', (error: unknown) => error), elapse(2_000).then(() => 'still waiting after 2 s')]);
      elapsed = Date.now() - started;
    });
    expect(outcome).toBeInstanceOf(SupervisionError);
    expect(outcome instanceof SupervisionError ? outcome.code : undefined).toBe('invalid-request');
    expect(outcome instanceof Error ? outcome.message : '').toMatch(/inside an open run over the same store/u);
    expect(elapsed).toBeLessThan(1_000);
  });

  test('is refused from ordinary work and nested helpers too, and the outer run still completes normally', async () => {
    const result = await workspace.run(options('run:outer'), async (outer) => {
      const inner = await outer.ordinary('nested attempt', () => caughtCode(workspace.run(options('run:inner'), () => 'never')));
      const published = await outer.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
      return [inner, published.kind];
    });
    expect(result.value).toEqual(['invalid-request', 'published']);
  });

  test('is allowed for another workspace over another store, which holds its own lease', async () => {
    const otherStore = tempStore();
    const otherWorkspace = openWorkspace({ location: otherStore.location, logicalStore });
    try {
      const result = await workspace.run(options('run:outer'), async (outer) => {
        await outer.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        const inner = await otherWorkspace.run(options('run:other-store'), (run) => run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() }));
        return inner.value.kind;
      });
      expect(result.value).toBe('published');
    } finally {
      otherWorkspace.close();
      otherStore.remove();
    }
  });

  test('is allowed once the outer run has closed, from code that outlived it', async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    await workspace.run(options('run:outer'), () => {
      escaped = () => workspace.run(options('run:after'), (run) => run.resolve(contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() }));
    });
    if (escaped === undefined) {
      throw new Error('the outer run did not capture its callback');
    }
    await expect(escaped()).resolves.toMatchObject({ value: { kind: 'published' } });
  });
});
