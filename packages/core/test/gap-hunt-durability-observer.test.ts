/**
 * ACC-008 display invariance: querying usage from an optional observer cannot
 * supply execution policy. Compare independent identical runs with that usage
 * display absent/present, including a known missing usage report. This proves
 * one explicit observer path, not arbitrary side-effecting user callbacks.
 */
import { describe, expect, test } from '@jest/globals';

import { createNodeRandom } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import type { IRunEvent } from '@microdelta/supervision';
import { createTrackingObserver } from '@microdelta/tracking';

import { writerFor } from '../src/writer.js';
import { createWorld, installWorld } from './operations/fixture.js';
import { T0, fakeTimer, freshKey, machine, openSession, operationTrace, production, statuses, tempStores, until } from './operations/harness.js';
import { driveUntilSettled, members, received } from './operations/support.js';

/** The caller-visible execution and Accounting evidence, excluding run identities. */
interface IOutcome {
  readonly statuses: Readonly<Record<string, string>>;
  readonly sends: number;
  readonly observed: readonly { readonly unit: string; readonly amount: number }[];
  readonly unknownCount: number;
  readonly usageStatus: string;
}

/** Run the same three requests with or without a read-only usage display. */
async function scenario(displayUsage: boolean): Promise<IOutcome> {
  const stores = tempStores();
  const timer = fakeTimer();
  const world = installWorld(createWorld(() => timer.currentEpochMilliseconds(), ['pr-1', 'pr-2', 'pr-3']));
  world.provider.script('assess', 'pr-2', ['ok-no-usage']);
  const session = openSession(stores, timer);
  let displays = 0;
  let sawUnknown = false;
  try {
    const result = await members(session, displayUsage ? { observe: () => {
      const usage = session.usage();
      displays += 1;
      sawUnknown ||= usage.unknown.length > 0;
    } } : {}).done;
    const usage = session.usage();
    expect(displays > 0).toBe(displayUsage);
    expect(sawUnknown).toBe(displayUsage);
    return {
      statuses: statuses(result.value.members),
      sends: world.provider.ledger().filter((entry) => entry.kind === 'received').length,
      observed: usage.observed,
      unknownCount: usage.unknown.length,
      usageStatus: usage.status,
    };
  } finally { session.close(); stores.remove(); }
}

describe('GAP HUNT Accounting observer policy separation (ACC-008)', () => {
  test('adding/removing usage display preserves sends, outcomes and the unknown usage gap', async () => {
    const absent = await scenario(false);
    const present = await scenario(true);
    expect(present).toEqual(absent);
    expect(absent).toEqual({
      statuses: { 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' },
      sends: 3,
      observed: [{ unit: 'tokens', amount: 200 }],
      unknownCount: 1,
      usageStatus: 'incomplete',
    });
  });
});

/** Compare execution policy under a quota wake-up and an explicit author denial. */
async function deferredScenario(displayUsage: boolean, denyThird: boolean): Promise<IOutcome & { readonly trace: readonly string[]; readonly attempts: readonly number[]; readonly elapsed: number }> {
  const stores = tempStores();
  const timer = fakeTimer();
  const world = installWorld(createWorld(() => timer.currentEpochMilliseconds(), ['pr-1', 'pr-2', 'pr-3']));
  world.provider.script('assess', 'pr-1', ['rate-limit:60000', 'ok']);
  world.provider.script('assess', 'pr-2', ['ok-no-usage']);
  const session = openSession(stores, timer);
  const fixture = session.fixture;
  const events: IRunEvent[] = [];
  let displays = 0;
  try {
    const done = session.supervision.run({
      analysis: fixture.composition.scope, environment: production, runId: 'observer-policy',
      writer: writerFor(session.history, 'observer-policy', 24 * 60 * 60 * 1_000),
      operations: { journal: session.journal, accounting: session.accounting, random: createNodeRandom() },
      permits: 1, window: 1,
      admission: { admit: (request) => denyThird && request.step.memberKey === 'pr-3'
        ? { kind: 'denied', reason: 'author-gate' } : { kind: 'admitted' } },
      observers: [{ observe: (event): void => {
        events.push(event);
        if (displayUsage) { session.usage(); displays += 1; }
      } }],
      resolution: (ports) => createResolution({
        declarations: fixture.builders, composition: fixture.composition,
        bindings: { inputs: fixture.composition.topology.inputs, helpers: fixture.composition.topology.helpers },
        environment: production, history: session.history, tracking: createTrackingObserver(machine), host: machine,
        admission: ports.admission, observer: ports.observer, execution: ports.execution,
      }),
    }, (run) => run.resolveMembers({ template: 'pr', step: 'assess' }, freshKey()));
    done.catch(() => undefined);
    await until(() => timer.pending().includes(T0 + 60_000), 'quota refusal schedules its not-before wake-up');
    await until(() => received('pr-2').length === 1, 'a sibling proceeds while the refused operation waits');
    expect(received('pr-1')).toHaveLength(1);
    expect(timer.currentEpochMilliseconds()).toBe(T0);
    const result = await driveUntilSettled(timer, { events, done });
    const requests = received('pr-1');
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((request) => request.operation)).size).toBe(1);
    expect(new Set(requests.map((request) => request.requestAttempt)).size).toBe(2);
    expect(displays > 0).toBe(displayUsage);
    const usage = session.usage();
    return {
      statuses: statuses(result.value.members),
      sends: world.provider.ledger().filter((entry) => entry.kind === 'received').length,
      observed: usage.observed, unknownCount: usage.unknown.length, usageStatus: usage.status,
      trace: operationTrace(events), attempts: ['pr-1', 'pr-2', 'pr-3'].map((key) => received(key).length),
      elapsed: timer.currentEpochMilliseconds() - T0,
    };
  } finally { session.close(); stores.remove(); }
}

describe('GAP HUNT usage display under execution policy (ACC-008)', () => {
  test.each([false, true])('display preserves quota retry and explicit admission gate (deny third: %s)', async (denyThird) => {
    const absent = await deferredScenario(false, denyThird);
    const present = await deferredScenario(true, denyThird);
    expect(present).toEqual(absent);
    expect(absent.statuses).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': denyThird ? 'pending' : 'succeeded' });
    expect(absent.attempts).toEqual([2, 1, denyThird ? 0 : 1]);
    expect(absent.sends).toBe(denyThird ? 3 : 4);
    expect(absent.elapsed).toBe(60_000);
    expect(absent.observed).toHaveLength(2);
    expect(absent.observed).toEqual(expect.arrayContaining([{ unit: 'requests', amount: 1 }, { unit: 'tokens', amount: denyThird ? 100 : 200 }]));
    expect(absent.unknownCount).toBe(1);
    expect(absent.usageStatus).toBe('incomplete');
    expect(absent.trace).toContain('assess@pr-1:retry-scheduled:deferred:rate-limited');
    expect(absent.trace).toContain('assess@pr-1:retry-started');
  });
});
