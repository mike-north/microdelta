/**
 * Deterministic cross-process interleavings of History's single fenced writer
 * (M5 exit; PUB-002, PUB-004, PUB-005; A-09, A-10). Every scenario runs two or
 * more long-lived Node worker processes against one real SQLite file through
 * the production durable History, each with its own History handle, its own
 * in-memory lease objects and a Machine clock whose readings the test sets per
 * operation. The test chooses which worker performs each operation, so the
 * global order is fixed and every stale operation presents the lease object
 * its own live process was granted.
 *
 * The enumerated families are listed in the validation record; each maps to
 * an action or invariant of `experiments/exp-7/WriterLease.tla` or
 * `Publication.tla`. The L family runs a real Run Supervision wait for the
 * writer lease inside a worker, through the facade's writer port, on a timer
 * that fires only when the test advances the controlled clock, so polls,
 * takeover, the operator deadline and stops happen at chosen instants with no
 * real sleeps. F1 observes, in this process, which writer statements assign
 * the fence column. This evidence covers one local SQLite file and process
 * termination, not power loss, distributed clocks or multi-host coordination.
 *
 * @see ../../../../docs/spec/execution.md (PUB-002 through PUB-005)
 * @see ../../../../docs/spec/acceptance.md (A-09, A-10)
 * @see ../../../../experiments/exp-7/WriterLease.tla
 * @see ../../../../docs/validation/m5-concurrency-2026-09-30.md
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import type { ISqliteCapability, IWriterLease } from '@microdelta/history';
import { createNodeSqlite } from '@microdelta/machine-node';

import { cleanup, controlledClock, openHistory, openRaw } from '../durable-history/support.js';
import type { ISqliteConnection } from '../durable-history/support.js';
import {
  acceptanceFrom,
  attemptFrom,
  authorityOf,
  expectRefused,
  freshStore,
  heldFrom,
  inspectionFrom,
  leaseFrom,
  locatorFrom,
  readFrom,
  recoveryFrom,
  reopenForReading,
  snapshot,
  startWorker,
  stopWorkers,
} from './driver.js';
import type { IDurableState, IWorkerHandle } from './driver.js';
import { attemptRequest, concurrencyStore, labelAddress, lastPartAddress, subject } from './fixture.js';
import { parseWaitStatus } from './protocol.js';
import type { IHarnessCommand, IWaitStatus } from './protocol.js';

afterEach(async () => {
  await stopWorkers();
  cleanup();
});

/** Generous per-test bound: each scenario starts fresh processes. */
const scenarioTimeout = 60_000;

/** Start one worker on the shared file with a controlled clock. */
function worker(name: string, location: string): Promise<IWorkerHandle> {
  return startWorker(name, { location, store: concurrencyStore, clock: 'controlled' });
}

/** Run a command that must succeed and return its value. */
async function ok(target: IWorkerHandle, command: IHarnessCommand): Promise<unknown> {
  const reply = await target.step(command);
  if (!reply.ok) {
    throw new Error(`${target.name} ${command.op} failed: ${reply.error}: ${reply.message}`);
  }
  return reply.value;
}

/** Acquire the writer on `target` or fail the test. */
async function acquire(target: IWorkerHandle, at: number, holder: string, leaseMilliseconds: number): Promise<IWriterLease> {
  return leaseFrom(await ok(target, { op: 'acquire', at, holder, leaseMilliseconds }));
}

/** Allocate, stage and publish one keyed attempt on `target`; returns its locator. */
async function publishKey(target: IWorkerHandle, at: number, key: string, label: string): Promise<string> {
  await ok(target, { op: 'allocate', at, key });
  await ok(target, { op: 'stage', at: at + 1, key, label });
  return locatorFrom(await ok(target, { op: 'publish', at: at + 2, key }));
}

/**
 * The legitimate work of the first holder, A, before its authority lapses:
 * one published result (the seed) and two incomplete attempts, one allocated
 * and one staged. Returns A's lease and the seed's exact locator.
 */
async function firstHolderWork(a: IWorkerHandle, holder: string, leaseMilliseconds: number): Promise<{ readonly lease: IWriterLease; readonly seed: string }> {
  const lease = await acquire(a, 1_000, holder, leaseMilliseconds);
  const seed = await publishKey(a, 1_001, 'a-seed', 'seed');
  await ok(a, { op: 'allocate', at: 1_004, key: 'a-allocated' });
  await ok(a, { op: 'allocate', at: 1_005, key: 'a-staged' });
  await ok(a, { op: 'stage', at: 1_006, key: 'a-staged', label: 'a-late' });
  return { lease, seed };
}

/** The seven lease-guarded History mutations a stale holder must not perform. */
const staleOperations = ['renew', 'release', 'allocate', 'stage', 'publish', 'abandon', 'accept'] as const;
type IStaleOperation = (typeof staleOperations)[number];

/** The command a stale A sends for each operation, aimed at its own work or the seed. */
function staleCommand(operation: IStaleOperation, at: number, seed: string): IHarnessCommand {
  switch (operation) {
    case 'renew':
      return { op: 'renew', at, leaseMilliseconds: 100 };
    case 'release':
      return { op: 'release', at };
    case 'allocate':
      return { op: 'allocate', at, key: 'a-after-takeover' };
    case 'stage':
      return { op: 'stage', at, key: 'a-allocated', label: 'a-late' };
    case 'publish':
      return { op: 'publish', at, key: 'a-staged' };
    case 'abandon':
      return { op: 'abandon', at, key: 'a-staged' };
    case 'accept':
      return { op: 'accept', at, locator: seed };
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

/** The three lease-guarded mutations a stale A can aim at B's own staged attempt. */
const successorAttemptOperations = ['stage', 'publish', 'abandon'] as const;
type ISuccessorAttemptOperation = (typeof successorAttemptOperations)[number];

/** The command a stale A sends against B's staged `b-work`, named by B's attempt identity. */
function onBehalfCommand(operation: ISuccessorAttemptOperation, at: number, attemptId: number): IHarnessCommand {
  switch (operation) {
    case 'stage':
      return { op: 'stage', at, key: 'b-work', label: 'forged', attemptId };
    case 'publish':
      return { op: 'publish', at, key: 'b-work', attemptId };
    case 'abandon':
      return { op: 'abandon', at, key: 'b-work', attemptId };
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

/**
 * How the successor B comes to hold the writer while A keeps its lease
 * object. A's lease is 100 ms from 1 000, so it expires at 1 100.
 */
interface ITakeover {
  /** Scenario description. */
  readonly name: string;
  /** Holder names A and B present; equal names leave only the fence to tell them apart. */
  readonly holders: readonly [string, string];
  /** Whether A releases before B acquires. */
  readonly releaseFirst: boolean;
  /** B's clock reading at acquisition. */
  readonly takeoverAt: number;
  /** A's clock reading when it presents its stale lease. */
  readonly staleAt: number;
}

const takeovers: readonly ITakeover[] = [
  { name: 'T1 B takes over the expired lease under another holder name', holders: ['worker-a', 'worker-b'], releaseFirst: false, takeoverAt: 1_150, staleAt: 1_160 },
  { name: 'T2 B takes over the expired lease under the same holder name', holders: ['shared-holder', 'shared-holder'], releaseFirst: false, takeoverAt: 1_150, staleAt: 1_160 },
  { name: 'T3 B acquires under the same name after A releases, while A’s expiry is still ahead', holders: ['shared-holder', 'shared-holder'], releaseFirst: true, takeoverAt: 1_030, staleAt: 1_040 },
  { name: 'T4 B takes over after a forward clock jump and A acts at a regressed reading before its expiry', holders: ['shared-holder', 'shared-holder'], releaseFirst: false, takeoverAt: 50_000, staleAt: 1_050 },
];

/**
 * T0: A's lease has expired but no successor has acquired yet, so the
 * durable holder and fence still match A's lease and only the guard's expiry
 * branch can refuse it. B takes over afterwards.
 */
const expiredBeforeTakeover: ITakeover = { name: 'T0 A acts after its lease expired, before any successor acquires', holders: ['worker-a', 'worker-b'], releaseFirst: false, takeoverAt: 1_170, staleAt: 1_160 };

/** How far B's own work has progressed when A presents its stale lease. */
const positions = ['after B acquires', 'after B stages', 'after B publishes'] as const;
type IPosition = 'before B acquires' | (typeof positions)[number];

/** What a refused stale operation's message must say: which branch of the holder guard refused it. */
const notCurrentHolder = /is not the current holder/u;
const expiredLease = /expired at 1100$/u;

/** One stale-holder scenario: a takeover, when A acts, and the command A sends. */
interface IStaleScenario {
  readonly takeover: ITakeover;
  readonly position: IPosition;
  /** A's command, given the seed's locator and B's staged attempt identity once B has one. */
  readonly command: (seed: string, successorAttempt: number | undefined) => IHarnessCommand;
  /** The refusal branch the message must name. */
  readonly refusal: RegExp;
}

/**
 * Run one stale-holder scenario across two worker processes. A does its
 * legitimate work and loses authority; B takes over and works up to the
 * chosen position; A presents its own stale lease object. The refusal must
 * be typed, name the expected guard branch and change no compared durable row
 * but the high-water; B must then finish, publish and renew under its own
 * fence; and after every process closes, no partial or stale result may exist.
 */
async function runStaleScenario(scenario: IStaleScenario): Promise<void> {
  const { takeover, position } = scenario;
  const location = freshStore();
  const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
  const first = await firstHolderWork(a, takeover.holders[0], 100);
  if (takeover.releaseFirst) {
    await ok(a, { op: 'release', at: 1_020 });
  }
  const t = takeover.takeoverAt;

  /** Present A's stale lease and check that nothing but the high-water changed. */
  const presentStale = async (successorAttempt: number | undefined): Promise<void> => {
    const before = snapshot(location);
    expectRefused(await a.step(scenario.command(first.seed, successorAttempt)), 'StaleWriterError', scenario.refusal);
    const after = snapshot(location);
    // Only the persisted clock high-water may move; it never moves back.
    expect(authorityOf(after)).toEqual(authorityOf(before));
    expect(after.timeHighWater).toBeGreaterThanOrEqual(before.timeHighWater);
  };

  if (position === 'before B acquires') {
    await presentStale(undefined);
  }
  const successor = await acquire(b, t, takeover.holders[1], 1_000);
  // Every grant issues a strictly larger fence than any earlier grant.
  expect(successor.fence).toBeGreaterThan(first.lease.fence);
  if (position === 'after B acquires') {
    await presentStale(undefined);
  }
  const successorAttempt = attemptFrom(await ok(b, { op: 'allocate', at: t + 1, key: 'b-work' })).attemptId;
  await ok(b, { op: 'stage', at: t + 2, key: 'b-work', label: 'successor' });
  if (position === 'after B stages') {
    await presentStale(successorAttempt);
  }
  const published = locatorFrom(await ok(b, { op: 'publish', at: t + 3, key: 'b-work' }));
  if (position === 'after B publishes') {
    await presentStale(successorAttempt);
  }
  // B's authority is untouched: it renews under its own fence.
  const renewed = leaseFrom(await ok(b, { op: 'renew', at: t + 4, leaseMilliseconds: 1_000 }));
  // Renewal is evaluated at the persisted high-water, which A's refused operation may have raised.
  expect(renewed).toEqual({ holder: successor.holder, fence: successor.fence, expiresAt: Math.max(t + 4, takeover.staleAt) + 1_000 });

  await Promise.all([a.close(), b.close()]);
  expectNoPartialResult(location, { seed: first.seed, published, renewed });
}

/** T1–T4: every takeover kind, every stale operation on A's own work, every position of B's work. */
const takeoverCases = takeovers.flatMap((takeover) =>
  staleOperations.flatMap((operation) => positions.map((position) => ({ takeover, operation, position }))));

/** T0: every stale operation, refused by the expiry branch before anyone takes over. */
const expiryCases = staleOperations.map((operation) => ({ takeover: expiredBeforeTakeover, operation }));

/** O1–O4: every takeover kind, a stale A acting on B's staged attempt, after B stages. */
const onBehalfCases = takeovers.flatMap((takeover) => successorAttemptOperations.map((operation) => ({ takeover, operation })));

describe('a stale holder after takeover (T1–T4 × seven operations × three positions)', () => {
  test.each(takeoverCases.map((entry) => [entry.takeover.name, entry.operation, entry.position, entry] as const))(
    '%s: A’s stale %s %s is refused and B’s state is untouched',
    async (_name, operation, position, { takeover }) => {
      await runStaleScenario({ takeover, position, command: (seed) => staleCommand(operation, takeover.staleAt, seed), refusal: notCurrentHolder });
    },
    scenarioTimeout,
  );
});

describe('an expired holder before any takeover (T0 × seven operations)', () => {
  test.each(expiryCases.map((entry) => [entry.operation, entry] as const))(
    'T0: A’s %s after its own lease expired is refused by the expiry check, and B later takes over untouched',
    async (operation, { takeover }) => {
      await runStaleScenario({ takeover, position: 'before B acquires', command: (seed) => staleCommand(operation, takeover.staleAt, seed), refusal: expiredLease });
    },
    scenarioTimeout,
  );
});

describe('a stale holder acting on the successor’s attempt (O1–O4 × three operations)', () => {
  test.each(onBehalfCases.map((entry) => [entry.takeover.name, entry.operation, entry] as const))(
    '%s: A’s stale %s of B’s staged attempt is refused and B still publishes it',
    async (_name, operation, { takeover }) => {
      await runStaleScenario({
        takeover,
        position: 'after B stages',
        command: (_seed, successorAttempt) => {
          if (successorAttempt === undefined) {
            throw new Error('B has not allocated its attempt yet');
          }
          return onBehalfCommand(operation, takeover.staleAt, successorAttempt);
        },
        refusal: notCurrentHolder,
      });
    },
    scenarioTimeout,
  );
});

/**
 * After every process has closed, a fresh handle in this separate process
 * finds exactly the seed and the successor's result, both complete, the
 * successor's result current, A's incomplete attempts unchanged and no
 * acceptance recorded by the stale holder.
 */
function expectNoPartialResult(location: string, expected: { readonly seed: string; readonly published: string; readonly renewed: IWriterLease }): void {
  const history = reopenForReading(location, expected.renewed.expiresAt - 1);
  expect(history.currentWriter()).toEqual(expected.renewed);
  expect(history.readCurrent(subject)?.locator).toBe(expected.published);
  expect(history.findCandidates({ ...subject, version: 1 }).map((candidate) => candidate.reference.locator)).toEqual([expected.published, expected.seed]);
  for (const [locator, label] of [[expected.seed, 'seed'], [expected.published, 'successor']] as const) {
    const reference = { kind: 'completed-result', locator } as const;
    expect(history.reader.readSelected(reference, { operation: 'value', address: labelAddress }).fact).toBe(label);
    expect(history.reader.readSelected(reference, { operation: 'value', address: lastPartAddress }).fact).toBe(label);
    expect(history.verifyResult(reference)).toEqual({ kind: 'consistent' });
  }
  expect(history.recoverAttempt(attemptRequest('a-allocated'))).toMatchObject({ kind: 'incomplete', attempt: { state: 'allocated', result: null } });
  expect(history.recoverAttempt(attemptRequest('a-staged'))).toMatchObject({ kind: 'incomplete', attempt: { state: 'staged', result: null } });
  expect(history.recoverAttempt(attemptRequest('a-after-takeover'))).toEqual({ kind: 'absent' });
  expect(history.readAcceptances({ kind: 'completed-result', locator: expected.seed }, subject.environment)).toEqual([]);
  history.close();
}

describe('waiting, inspection and the clock high-water across processes', () => {
  test('W1: a waiting process observes the holder at every point of its work and changes nothing but the clock high-water', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 500);
    const holderSteps: readonly IHarnessCommand[] = [
      { op: 'allocate', at: 1_010, key: 'a-work' },
      { op: 'stage', at: 1_020, key: 'a-work', label: 'holder' },
      { op: 'publish', at: 1_030, key: 'a-work' },
      { op: 'renew', at: 1_040, leaseMilliseconds: 500 },
    ];
    let expiresAt = lease.expiresAt;
    for (const [index, step] of holderSteps.entries()) {
      const waitAt = 1_005 + index * 10;
      const before = snapshot(location);
      expect(heldFrom(await ok(b, { op: 'acquire', at: waitAt, holder: 'waiter-b', leaseMilliseconds: 500 }))).toEqual({ holder: 'holder-a', expiresAt });
      const after = snapshot(location);
      expect(authorityOf(after)).toEqual(authorityOf(before));
      expect(after.timeHighWater).toBe(Math.max(before.timeHighWater, waitAt));
      // The holder continues unaffected by the waiter's observation.
      const value = await ok(a, step);
      if (step.op === 'renew') {
        expiresAt = leaseFrom(value).expiresAt;
      }
    }
    expect(expiresAt).toBe(1_540);
    // Once the lease expires, the waiter takes over with the next fence.
    expect(await acquire(b, 1_540, 'waiter-b', 500)).toEqual({ holder: 'waiter-b', fence: lease.fence + 1, expiresAt: 2_040 });
  }, scenarioTimeout);

  test('W2: inspection and recovery need no lease, never read or persist time and change nothing while another process holds the writer', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 500);
    const seed = await publishKey(a, 1_001, 'a-seed', 'seed');
    await ok(a, { op: 'allocate', at: 1_010, key: 'a-staged' });
    await ok(a, { op: 'stage', at: 1_011, key: 'a-staged', label: 'staged' });

    const before = snapshot(location);
    // B never acquired; its clock is made to fail for these reads.
    expect(inspectionFrom(await ok(b, { op: 'inspect' }))).toEqual({ writer: lease, current: seed });
    expect(recoveryFrom(await ok(b, { op: 'recover', key: 'a-staged' }))).toMatchObject({ kind: 'incomplete', state: 'staged', locator: null });
    expect(recoveryFrom(await ok(b, { op: 'recover', key: 'a-seed' }))).toMatchObject({ kind: 'completed', state: 'completed', locator: seed });
    expect(recoveryFrom(await ok(b, { op: 'recover', key: 'never-allocated' }))).toEqual({ kind: 'absent', state: null, locator: null, endedFence: null });
    expect(readFrom(await ok(b, { op: 'read', locator: seed }))).toEqual({ label: 'seed', lastPart: 'seed', verification: 'consistent' });
    expect(snapshot(location)).toEqual(before);

    // The holder's authority is intact after the inspection.
    expect(locatorFrom(await ok(a, { op: 'publish', at: 1_020, key: 'a-staged' }))).not.toBe(seed);
  }, scenarioTimeout);

  test('W4: at exactly its recorded expiry a holder’s mutation is refused by the expiry check, one millisecond earlier it is accepted, and a waiter acquires at that same instant', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);
    expect(lease.expiresAt).toBe(1_100);
    expect(heldFrom(await ok(b, { op: 'acquire', at: 1_099, holder: 'holder-b', leaseMilliseconds: 100 }))).toEqual({ holder: 'holder-a', expiresAt: 1_100 });
    expect(attemptFrom(await ok(a, { op: 'allocate', at: 1_099, key: 'last-moment' })).state).toBe('allocated');
    const before = snapshot(location);
    expectRefused(await a.step({ op: 'allocate', at: 1_100, key: 'at-expiry' }), 'StaleWriterError', /expired at 1100$/u);
    expectRefused(await a.step({ op: 'renew', at: 1_100, leaseMilliseconds: 100 }), 'StaleWriterError', /expired at 1100$/u);
    const after = snapshot(location);
    expect(authorityOf(after)).toEqual(authorityOf(before));
    expect(after.timeHighWater).toBe(1_100);
    expect(await acquire(b, 1_100, 'holder-b', 100)).toEqual({ holder: 'holder-b', fence: lease.fence + 1, expiresAt: 1_200 });
  }, scenarioTimeout);

  test('W3: an expired lease never revives in another process at a regressed clock reading, and the next grant is evaluated at the high-water', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);
    // A forward reading finds the lease expired; the rejection records that time.
    expectRefused(await a.step({ op: 'allocate', at: 5_000, key: 'late' }), 'StaleWriterError');
    // Back at a reading before the recorded expiry, the lease is still refused.
    expectRefused(await a.step({ op: 'allocate', at: 1_050, key: 'revived' }), 'StaleWriterError');
    expectRefused(await a.step({ op: 'renew', at: 1_050, leaseMilliseconds: 100 }), 'StaleWriterError');
    // Another process at a regressed reading acquires as of the high-water, not its own reading.
    expect(await acquire(b, 1_060, 'holder-b', 100)).toEqual({ holder: 'holder-b', fence: lease.fence + 1, expiresAt: 5_100 });
    expect(snapshot(location).attempts).toEqual([]);
  }, scenarioTimeout);
});

describe('recovery of a stale holder’s work and exact references', () => {
  test('K1: a holder killed inside its publication commit while another process waits leaves no result; the successor completes the staged attempt by its key without restaging', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);
    const seed = await publishKey(a, 1_001, 'a-seed', 'seed');
    const staged = attemptFrom(await ok(a, { op: 'allocate', at: 1_010, key: 'a-work' }));
    await ok(a, { op: 'stage', at: 1_011, key: 'a-work', label: 'recovered' });
    await ok(a, { op: 'arm', role: 'publish' });
    await expect(a.step({ op: 'publish', at: 1_012, key: 'a-work' })).rejects.toThrow('exited');
    expect(await a.exit).toEqual({ code: null, signal: 'SIGKILL' });

    // The killed holder's lease row survives until expiry; the waiter observes it.
    expect(heldFrom(await ok(b, { op: 'acquire', at: 1_050, holder: 'holder-b', leaseMilliseconds: 1_000 }))).toEqual({ holder: 'holder-a', expiresAt: 1_100 });
    expect(recoveryFrom(await ok(b, { op: 'recover', key: 'a-work' }))).toMatchObject({ kind: 'incomplete', state: 'staged', locator: null });
    expect(inspectionFrom(await ok(b, { op: 'inspect' })).current).toBe(seed);

    const successor = await acquire(b, 1_100, 'holder-b', 1_000);
    expect(successor.fence).toBeGreaterThan(lease.fence);
    // The same key names the same attempt; its staged content is published as is.
    expect(attemptFrom(await ok(b, { op: 'allocate', at: 1_101, key: 'a-work' }))).toEqual({ ...staged, state: 'staged' });
    const published = locatorFrom(await ok(b, { op: 'publish', at: 1_102, key: 'a-work' }));
    expect(readFrom(await ok(b, { op: 'read', locator: published }))).toEqual({ label: 'recovered', lastPart: 'recovered', verification: 'consistent' });
    expect(recoveryFrom(await ok(b, { op: 'recover', key: 'a-work' }))).toMatchObject({ kind: 'completed', state: 'completed', locator: published, endedFence: successor.fence });
  }, scenarioTimeout);

  test('K2: a successor completes a live stale holder’s staged attempt; the stale holder is still refused, even for the now completed attempt', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const first = await firstHolderWork(a, 'holder-a', 100);
    const successor = await acquire(b, 1_150, 'holder-b', 1_000);
    expectRefused(await a.step({ op: 'publish', at: 1_151, key: 'a-staged' }), 'StaleWriterError');
    await ok(b, { op: 'allocate', at: 1_152, key: 'a-staged' });
    const published = locatorFrom(await ok(b, { op: 'publish', at: 1_153, key: 'a-staged' }));
    expect(readFrom(await ok(b, { op: 'read', locator: published }))).toEqual({ label: 'a-late', lastPart: 'a-late', verification: 'consistent' });
    // Re-publication of a completed attempt acknowledges it only for the current holder.
    expectRefused(await a.step({ op: 'publish', at: 1_154, key: 'a-staged' }), 'StaleWriterError');
    expect(locatorFrom(await ok(b, { op: 'publish', at: 1_155, key: 'a-staged' }))).toBe(published);
    expect(recoveryFrom(await ok(b, { op: 'recover', key: 'a-staged' }))).toMatchObject({ kind: 'completed', locator: published, endedFence: successor.fence });
    expect(first.lease.fence).toBeLessThan(successor.fence);
  }, scenarioTimeout);

  test('R1: an exact reference to a superseded result survives every process closing and resolves in a fresh process', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const first = await firstHolderWork(a, 'holder-a', 100);
    await acquire(b, 1_150, 'holder-b', 1_000);
    const newer = await publishKey(b, 1_151, 'b-work', 'successor');
    await Promise.all([a.close(), b.close()]);

    const reader = await worker('reader', location);
    expect(inspectionFrom(await ok(reader, { op: 'inspect' })).current).toBe(newer);
    expect(readFrom(await ok(reader, { op: 'read', locator: first.seed }))).toEqual({ label: 'seed', lastPart: 'seed', verification: 'consistent' });
    expect(readFrom(await ok(reader, { op: 'read', locator: newer }))).toEqual({ label: 'successor', lastPart: 'successor', verification: 'consistent' });
    await reader.close();
    expect(await reader.exit).toEqual({ code: 0, signal: null });
  }, scenarioTimeout);

  test('A1: a stale holder’s acceptance is refused and the successor’s acceptance never moves the current pointer', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const first = await firstHolderWork(a, 'holder-a', 100);
    const successor = await acquire(b, 1_150, 'holder-b', 1_000);
    const newer = await publishKey(b, 1_151, 'b-work', 'successor');
    expectRefused(await a.step({ op: 'accept', at: 1_160, locator: first.seed }), 'StaleWriterError');
    expect(acceptanceFrom(await ok(b, { op: 'accept', at: 1_161, locator: first.seed }))).toEqual({ fence: successor.fence });
    expect(inspectionFrom(await ok(b, { op: 'inspect' })).current).toBe(newer);
  }, scenarioTimeout);
});

describe('lifecycle guards under the current holder', () => {
  test('E1: the current holder cannot abandon another process’s completed attempt; the refusal rolls back and every row, including the high-water, is unchanged', async () => {
    const location = freshStore();
    const [a, b] = await Promise.all([worker('A', location), worker('B', location)]);
    const first = await firstHolderWork(a, 'holder-a', 100);
    await acquire(b, 1_150, 'holder-b', 1_000);
    // The stable key names A's completed seed attempt for B.
    expect(attemptFrom(await ok(b, { op: 'allocate', at: 1_151, key: 'a-seed' }))).toMatchObject({ state: 'completed', locator: first.seed });
    const before = snapshot(location);
    expectRefused(await b.step({ op: 'abandon', at: 1_152, key: 'a-seed' }), 'AttemptStateError');
    expect(snapshot(location)).toEqual(before);
    expect(inspectionFrom(await ok(b, { op: 'inspect' })).current).toBe(first.seed);
    expect(readFrom(await ok(b, { op: 'read', locator: first.seed }))).toEqual({ label: 'seed', lastPart: 'seed', verification: 'consistent' });
    // An incomplete attempt is still abandoned normally by the current holder.
    await ok(b, { op: 'allocate', at: 1_153, key: 'a-staged' });
    expect(attemptFrom(await ok(b, { op: 'abandon', at: 1_154, key: 'a-staged' }))).toMatchObject({ state: 'interrupted', locator: null });
  }, scenarioTimeout);
});

/** One assignment of the writer row's fence column, as a connection-local trigger saw it. */
interface IFenceWrite {
  readonly from: number;
  readonly to: number;
}

/**
 * Node's real SQLite capability, plus a connection-local (TEMP) trigger on the
 * connection History opens that records every statement assigning
 * `history_writer.last_fence`, even to its unchanged value. The trigger lives
 * only in that connection's temporary schema, so the store file and History's
 * schema validation are untouched.
 */
function fenceWriteTracingSqlite(): { readonly capability: ISqliteCapability; fenceWrites(): readonly IFenceWrite[] } {
  const real = createNodeSqlite();
  let traced: ISqliteConnection | undefined;
  return {
    capability: {
      openSqlite(location: string): ISqliteConnection {
        const connection = real.openSqlite(location);
        connection.exec('CREATE TEMP TABLE fence_writes (sequence INTEGER PRIMARY KEY, from_fence INTEGER NOT NULL, to_fence INTEGER NOT NULL)');
        connection.exec('CREATE TEMP TRIGGER trace_fence_writes AFTER UPDATE OF last_fence ON main.history_writer BEGIN INSERT INTO fence_writes (from_fence, to_fence) VALUES (OLD.last_fence, NEW.last_fence); END');
        traced = connection;
        return connection;
      },
    },
    fenceWrites(): readonly IFenceWrite[] {
      if (traced === undefined) {
        throw new Error('History has not opened the traced connection');
      }
      return traced.prepare('SELECT from_fence, to_fence FROM temp.fence_writes ORDER BY sequence').all()
        .map((row) => ({ from: Number(row.from_fence), to: Number(row.to_fence) }));
    },
  };
}

/** Run a waiting-run command that must succeed and return the waiter's status. */
async function waitStep(target: IWorkerHandle, command: IHarnessCommand): Promise<IWaitStatus> {
  return parseWaitStatus(await ok(target, command));
}

/** The kinds and times of a waiter's tries, for compact comparison with the expected poll schedule. */
function tries(status: IWaitStatus): readonly string[] {
  return status.attempts.map((attempt) => `${String(attempt.at)}:${attempt.kind}`);
}

/** Assert that a waiter's step changed no authority or data, and that the high-water did not move back. */
function expectOnlyHighWaterMoved(before: IDurableState, after: IDurableState): void {
  expect(authorityOf(after)).toEqual(authorityOf(before));
  expect(after.timeHighWater).toBeGreaterThanOrEqual(before.timeHighWater);
}

describe('waiting for the writer lease across processes (L1–L7)', () => {
  test('L1: a waiter polls at its interval and at the holder’s expiry while the holder works and renews, changes nothing but the clock high-water, and takes over only after expiry with the next fence', async () => {
    const location = freshStore();
    const [a, w] = await Promise.all([worker('A', location), worker('W', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);

    let before = snapshot(location);
    let status = await waitStep(w, { op: 'wait-start', at: 1_010, holder: 'waiter-w', leaseMilliseconds: 1_000, pollMilliseconds: 30, key: 'w-work' });
    expect(status.attempts).toEqual([{ at: 1_010, kind: 'held', holder: 'holder-a', expiresAt: 1_100, fence: null }]);
    expect(status.outcome).toEqual({ kind: 'pending' });
    expectOnlyHighWaterMoved(before, snapshot(location));

    before = snapshot(location);
    status = await waitStep(w, { op: 'wait-advance', at: 1_040 });
    expect(tries(status)).toEqual(['1010:held', '1040:held']);
    expectOnlyHighWaterMoved(before, snapshot(location));

    // The holder renews: the waiter sees the new expiry and keeps waiting.
    expect(leaseFrom(await ok(a, { op: 'renew', at: 1_050, leaseMilliseconds: 100 })).expiresAt).toBe(1_150);
    before = snapshot(location);
    status = await waitStep(w, { op: 'wait-advance', at: 1_070 });
    expect(status.attempts.at(-1)).toEqual({ at: 1_070, kind: 'held', holder: 'holder-a', expiresAt: 1_150, fence: null });
    expectOnlyHighWaterMoved(before, snapshot(location));

    // The holder keeps working under its lease while the waiter polls.
    const own = await publishKey(a, 1_080, 'a-work', 'holder');
    before = snapshot(location);
    status = await waitStep(w, { op: 'wait-advance', at: 1_149 });
    // Polls every 30 ms, and the next wake-up is the holder's expiry at 1 150, not 1 160.
    expect(tries(status)).toEqual(['1010:held', '1040:held', '1070:held', '1100:held', '1130:held']);
    expect(status.outcome).toEqual({ kind: 'pending' });
    expectOnlyHighWaterMoved(before, snapshot(location));

    status = await waitStep(w, { op: 'wait-advance', at: 1_150 });
    expect(tries(status)).toEqual(['1010:held', '1040:held', '1070:held', '1100:held', '1130:held', '1150:acquired']);
    expect(status.outcome).toMatchObject({ kind: 'acquired', holder: 'waiter-w', fence: lease.fence + 1, expiresAt: 2_150 });
    // The waiter published under its own fresh fence.
    const published = snapshot(location).results.at(-1);
    expect(published?.publishedFence).toBe(lease.fence + 1);
    // The superseded holder can no longer act.
    expectRefused(await a.step({ op: 'allocate', at: 1_151, key: 'a-late' }), 'StaleWriterError', notCurrentHolder);

    const finished = await waitStep(w, { op: 'wait-finish', at: 1_200 });
    expect(finished.pendingWakes).toBe(0);
    const after = snapshot(location);
    expect(after.writer).toEqual({ holder: null, lastFence: lease.fence + 1, expiresAt: 1_200 });
    // The waiter's result is current; the holder's earlier result stays retained.
    expect(inspectionFrom(await ok(a, { op: 'inspect' })).current).toBe(status.outcome.kind === 'acquired' ? status.outcome.published : 'not acquired');
    expect(readFrom(await ok(a, { op: 'read', locator: own })).label).toBe('holder');
  }, scenarioTimeout);

  test('L2: after the holder is SIGKILLed, a waiter is refused until the dead holder’s lease expires, wakes exactly at that expiry and takes over with the next fence', async () => {
    const location = freshStore();
    const [a, w] = await Promise.all([worker('A', location), worker('W', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);
    const seed = await publishKey(a, 1_001, 'a-seed', 'seed');
    await expect(a.step({ op: 'die' })).rejects.toThrow('exited');
    expect(await a.exit).toEqual({ code: null, signal: 'SIGKILL' });

    const before = snapshot(location);
    let status = await waitStep(w, { op: 'wait-start', at: 1_050, holder: 'waiter-w', leaseMilliseconds: 1_000, pollMilliseconds: 10_000, deadline: 60_000, key: 'w-work' });
    expect(status.attempts).toEqual([{ at: 1_050, kind: 'held', holder: 'holder-a', expiresAt: 1_100, fence: null }]);
    status = await waitStep(w, { op: 'wait-advance', at: 1_099 });
    expect(tries(status)).toEqual(['1050:held']);
    expectOnlyHighWaterMoved(before, snapshot(location));

    status = await waitStep(w, { op: 'wait-advance', at: 1_100 });
    expect(tries(status)).toEqual(['1050:held', '1100:acquired']);
    expect(status.outcome).toMatchObject({ kind: 'acquired', holder: 'waiter-w', fence: lease.fence + 1, expiresAt: 2_100 });
    expect(snapshot(location).results.map((result) => result.publishedFence)).toEqual([lease.fence, lease.fence + 1]);
    expect(readFrom(await ok(w, { op: 'read', locator: seed }))).toEqual({ label: 'seed', lastPart: 'seed', verification: 'consistent' });
    await waitStep(w, { op: 'wait-finish', at: 1_110 });
  }, scenarioTimeout);

  test('L3: at the operator deadline the waiter fails with the typed writer-busy error naming the holder, grants nothing, schedules nothing more and leaves the holder’s lease untouched', async () => {
    const location = freshStore();
    const [a, w] = await Promise.all([worker('A', location), worker('W', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);
    const before = snapshot(location);
    await waitStep(w, { op: 'wait-start', at: 1_010, holder: 'waiter-w', leaseMilliseconds: 1_000, pollMilliseconds: 20, deadline: 1_060, key: 'w-work' });
    let status = await waitStep(w, { op: 'wait-advance', at: 1_060 });
    expect(tries(status)).toEqual(['1010:held', '1030:held', '1050:held', '1060:held']);
    expect(status.outcome).toMatchObject({ kind: 'busy', error: 'WriterBusyError', holder: 'holder-a', expiresAt: 1_100, deadline: 1_060, contended: false });
    expect(status.outcome.kind === 'busy' ? status.outcome.message : '').toContain('holder-a');
    expect(status.pendingWakes).toBe(0);
    const after = snapshot(location);
    expectOnlyHighWaterMoved(before, after);
    expect(after.timeHighWater).toBe(1_060);

    // Nothing more happens after the deadline, even once the lease would be free.
    status = await waitStep(w, { op: 'wait-advance', at: 5_000 });
    expect(status.attempts).toHaveLength(4);
    // The holder's authority was never disturbed.
    expect(attemptFrom(await ok(a, { op: 'allocate', at: 1_070, key: 'a-after-deadline' })).allocatedFence).toBe(lease.fence);
    await waitStep(w, { op: 'wait-finish', at: 1_080 });
    expect(snapshot(location).writer).toEqual({ holder: 'holder-a', lastFence: lease.fence, expiresAt: 1_100 });
  }, scenarioTimeout);

  test.each([
    { deadline: 1_100, expected: ['1010:held', '1100:acquired'], outcome: 'acquired' },
    { deadline: 1_099, expected: ['1010:held', '1099:held'], outcome: 'busy' },
  ])('L4: with the holder’s lease expiring at 1 100 and the deadline at $deadline, the final attempt at the deadline ends $outcome', async ({ deadline, expected, outcome }) => {
    const location = freshStore();
    const [a, w] = await Promise.all([worker('A', location), worker('W', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);
    await waitStep(w, { op: 'wait-start', at: 1_010, holder: 'waiter-w', leaseMilliseconds: 1_000, pollMilliseconds: 10_000, deadline, key: 'w-work' });
    const status = await waitStep(w, { op: 'wait-advance', at: 2_000 });
    expect(tries(status)).toEqual(expected);
    if (outcome === 'acquired') {
      expect(status.outcome).toMatchObject({ kind: 'acquired', fence: lease.fence + 1 });
    } else {
      expect(status.outcome).toMatchObject({ kind: 'busy', holder: 'holder-a', expiresAt: 1_100, deadline });
      expect(snapshot(location).writer).toEqual({ holder: 'holder-a', lastFence: lease.fence, expiresAt: 1_100 });
    }
  }, scenarioTimeout);

  test('L5: while another process holds the writer and this process waits for it, check, recovery, inspection and exact reads need no lease and change nothing', async () => {
    const location = freshStore();
    const [a, w] = await Promise.all([worker('A', location), worker('W', location)]);
    await acquire(a, 1_000, 'holder-a', 100);
    const seed = await publishKey(a, 1_001, 'a-seed', 'seed');
    await waitStep(w, { op: 'wait-start', at: 1_010, holder: 'waiter-w', leaseMilliseconds: 1_000, pollMilliseconds: 10_000, key: 'w-work' });

    const before = snapshot(location);
    const checked = await ok(w, { op: 'wait-check' });
    expect(checked).toMatchObject({ checked: 'execution-required', recovered: 'absent', checks: 2, outcome: { kind: 'pending' } });
    // The run's check and recovery made no try for the lease.
    expect(parseWaitStatus(checked).attempts).toHaveLength(1);
    // History inspection from the waiting process, with its clock made to fail.
    expect(inspectionFrom(await ok(w, { op: 'inspect' })).current).toBe(seed);
    expect(recoveryFrom(await ok(w, { op: 'recover', key: 'a-seed' }))).toMatchObject({ kind: 'completed', locator: seed });
    expect(readFrom(await ok(w, { op: 'read', locator: seed }))).toEqual({ label: 'seed', lastPart: 'seed', verification: 'consistent' });
    // Every compared row, including the clock high-water, is unchanged.
    expect(snapshot(location)).toEqual(before);

    const status = await waitStep(w, { op: 'wait-advance', at: 1_100 });
    expect(tries(status)).toEqual(['1010:held', '1100:acquired']);
    await waitStep(w, { op: 'wait-finish', at: 1_101 });
  }, scenarioTimeout);

  test.each(['soft', 'hard'] as const)('L6: a %s stop ends a cross-process wait at once; no lease is granted and nothing more is tried', async (level) => {
    const location = freshStore();
    const [a, w] = await Promise.all([worker('A', location), worker('W', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);
    await waitStep(w, { op: 'wait-start', at: 1_010, holder: 'waiter-w', leaseMilliseconds: 1_000, pollMilliseconds: 20, key: 'w-work' });
    await waitStep(w, { op: 'wait-advance', at: 1_030 });
    let status = await waitStep(w, { op: 'wait-stop', level });
    expect(status.outcome).toMatchObject({ kind: 'stopped' });
    expect(status.pendingWakes).toBe(0);
    status = await waitStep(w, { op: 'wait-advance', at: 5_000 });
    expect(tries(status)).toEqual(['1010:held', '1030:held']);
    await waitStep(w, { op: 'wait-finish', at: 5_001 });
    expect(snapshot(location).writer).toEqual({ holder: 'holder-a', lastFence: lease.fence, expiresAt: 1_100 });
  }, scenarioTimeout);

  test('L7: SQLITE_BUSY exhaustion while another process holds SQLite’s write lock is a typed contended outcome, and at the deadline the typed writer-busy error naming the recorded holder, never a raw driver error', async () => {
    const location = freshStore();
    const [a, w] = await Promise.all([worker('A', location), worker('W', location)]);
    const lease = await acquire(a, 1_000, 'holder-a', 100);
    // This test process holds SQLite's write lock, so the waiter's acquisition exhausts its bounded busy wait.
    const locker = openRaw(location);
    locker.exec('BEGIN IMMEDIATE');
    let status: IWaitStatus;
    try {
      status = await waitStep(w, { op: 'wait-start', at: 1_010, holder: 'waiter-w', leaseMilliseconds: 1_000, pollMilliseconds: 10_000, deadline: 1_010, key: 'w-work' });
    } finally {
      locker.exec('ROLLBACK');
    }
    expect(status.attempts).toEqual([{ at: 1_010, kind: 'contended', holder: 'holder-a', expiresAt: 1_100, fence: null }]);
    expect(status.outcome).toMatchObject({ kind: 'busy', error: 'WriterBusyError', contended: true, holder: 'holder-a', expiresAt: 1_100, deadline: 1_010 });
    if (status.outcome.kind === 'busy') {
      expect(status.outcome.message).toMatch(/busy/u);
    }
    await waitStep(w, { op: 'wait-finish', at: 1_011 });
    // The holder is untouched and keeps its authority.
    expect(attemptFrom(await ok(a, { op: 'allocate', at: 1_020, key: 'a-after-contention' })).allocatedFence).toBe(lease.fence);
  }, scenarioTimeout);
});

describe('renewal and release keep the durable fence (defense in depth, #110 finding)', () => {
  test('F1: renew and release never assign the writer row’s last_fence; only a grant advances it', () => {
    const location = freshStore();
    const traced = fenceWriteTracingSqlite();
    const clock = controlledClock(1_000);
    const history = openHistory({ location, clock, sqlite: traced.capability, store: concurrencyStore });
    const first = leaseFrom(history.acquireWriter({ holder: 'holder-a', leaseMilliseconds: 100 }));
    expect(traced.fenceWrites()).toEqual([{ from: 0, to: first.fence }]);
    clock.set(1_050);
    const renewed = history.renewWriter(first, 100);
    expect(renewed).toEqual({ holder: 'holder-a', fence: first.fence, expiresAt: 1_150 });
    clock.set(1_060);
    history.releaseWriter(renewed);
    // Neither renewal nor release assigned the fence column, even to its unchanged value.
    expect(traced.fenceWrites()).toEqual([{ from: 0, to: first.fence }]);
    expect(snapshot(location).writer).toEqual({ holder: null, lastFence: first.fence, expiresAt: 1_060 });
    clock.set(1_070);
    const second = leaseFrom(history.acquireWriter({ holder: 'holder-a', leaseMilliseconds: 100 }));
    expect(second.fence).toBe(first.fence + 1);
    clock.set(1_080);
    history.releaseWriter(history.renewWriter(second, 100));
    expect(traced.fenceWrites()).toEqual([{ from: 0, to: first.fence }, { from: first.fence, to: second.fence }]);
    history.close();
  });
});

describe('the enumeration itself', () => {
  test('covers every varied dimension exactly once: 84 takeover cases, 7 expiry cases and 12 cases on the successor’s attempt', () => {
    const keys = [
      ...takeoverCases.map((entry) => `T|${entry.takeover.name}|${entry.operation}|${entry.position}`),
      ...expiryCases.map((entry) => `T0|${entry.operation}`),
      ...onBehalfCases.map((entry) => `O|${entry.takeover.name}|${entry.operation}`),
    ];
    expect([takeoverCases.length, expiryCases.length, onBehalfCases.length]).toEqual([
      takeovers.length * staleOperations.length * positions.length,
      staleOperations.length,
      takeovers.length * successorAttemptOperations.length,
    ]);
    expect([takeoverCases.length, expiryCases.length, onBehalfCases.length]).toEqual([84, 7, 12]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
