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
 * `Publication.tla`. This evidence covers one local SQLite file and process
 * termination, not power loss, distributed clocks or multi-host coordination.
 *
 * @see ../../../../docs/spec/execution.md (PUB-002 through PUB-005)
 * @see ../../../../docs/spec/acceptance.md (A-09, A-10)
 * @see ../../../../experiments/exp-7/WriterLease.tla
 * @see ../../../../docs/validation/m5-concurrency-2026-09-30.md
 */
import { afterEach, describe, expect, test } from '@jest/globals';

import type { IWriterLease } from '@microdelta/history';

import { cleanup } from '../durable-history/support.js';
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
import type { IWorkerHandle } from './driver.js';
import { attemptRequest, concurrencyStore, labelAddress, lastPartAddress, subject } from './fixture.js';
import type { IHarnessCommand } from './protocol.js';

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
  expect(history.readAcceptances({ kind: 'completed-result', locator: expected.seed })).toEqual([]);
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
