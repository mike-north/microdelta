/**
 * ACC-008 display invariance: querying usage from an optional observer cannot
 * supply execution policy. Compare independent identical runs with that usage
 * display absent/present, including a known missing usage report. This proves
 * one explicit observer path, not arbitrary side-effecting user callbacks.
 */
import { describe, expect, test } from '@jest/globals';

import { createWorld, installWorld } from './operations/fixture.js';
import { fakeTimer, openSession, statuses, tempStores } from './operations/harness.js';
import { members } from './operations/support.js';

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
