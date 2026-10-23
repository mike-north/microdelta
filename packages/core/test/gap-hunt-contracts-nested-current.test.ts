/** Restart argument validation must resolve current forwarded data and never revive an old derived subject. */
import { describe, expect, test } from '@jest/globals';
import { baseWorld, reversedWorld } from './m4-acceptance/harness.js';
import { freshScenario, removeScenarios, sortedBodies } from './m4-acceptance/support.js';
import type { IWorld } from './m4-acceptance/analysis.js';

removeScenarios();

describe('gap hunt CMP-7 current forwarded and derived argument oracle', () => {
  test('renumbered derived subjects and changed forwarded fields agree with cold computation across successive restarts', () => {
    const retained = freshScenario();
    const first = retained.run({}, baseWorld());
    const renumbered: IWorld = baseWorld({ revision: 2, activityFinal: false, pullRequests: baseWorld().pullRequests.map(pull => pull.number === 101 ? { ...pull, number: 901 } : pull) });
    const second = retained.run({ reverse: true }, reversedWorld(renumbered));
    const coldSecond = freshScenario().run({}, renumbered);
    expect(second.result.summaries).toEqual(coldSecond.result.summaries);
    expect(second.result.report).toEqual(coldSecond.result.report);
    expect(second.bodies('assess')).toEqual(['901/A']);
    expect(second.reference('person:ben')).toBe(first.reference('person:ben'));
    expect(second.reference('person:cy')).toBe(first.reference('person:cy'));

    const changed: IWorld = { ...renumbered, revision: 3, pullRequests: renumbered.pullRequests.map(pull => pull.number === 201 ? { ...pull, merged: false } : pull) };
    const third = retained.run({ reverse: true }, reversedWorld(changed));
    const coldThird = freshScenario().run({}, changed);
    expect(third.result.summaries).toEqual(coldThird.result.summaries);
    expect(third.result.report).toEqual(coldThird.result.report);
    expect(third.bodies('assess')).toEqual(['201/A']);
    expect(sortedBodies(third, 'summary')).toEqual(['Ben']);
    expect(third.reference('person:ada')).toBe(second.reference('person:ada'));
    expect(third.reference('person:cy')).toBe(second.reference('person:cy'));

    // Reverting the input under the current origin may validate old exact work;
    // a historical derived argument is never substituted for the current PR number.
    const fourth = retained.run({}, { ...renumbered, revision: 4 });
    expect(fourth.result.summaries).toEqual(coldSecond.result.summaries);
    expect(fourth.result.report).toEqual(coldSecond.result.report);
    expect(fourth.bodies('assess')).toEqual([]);
  });
});
