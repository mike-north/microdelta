/**
 * M3 acceptance, A-02/A-04 current evidence through independent processes:
 * unread fields, consumed fields per member, called versus uncalled helper
 * implementations, compatibility version change and rollback, and equal-name
 * profile replacement with preserved original provenance. Every change is
 * made to the external world or the declarations of a new process; nothing
 * is reset in memory. Expected statistics are derived by hand.
 *
 * @see ../../../../docs/spec/acceptance.md (A-02, A-04)
 * @see ../../../../docs/spec/execution.md (REUSE-008)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Useful variations within the fixed M3 path)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import type { IWorld } from './analysis.js';
import { baseWorld, environment, outcomeOf, referenceOf, scenario, subjectOf } from './harness.js';
import type { IProcessRun, IScenario } from './harness.js';
import { adaExpected, benExpected } from './expected.js';

let s: IScenario;
let cold: IProcessRun;

beforeEach(() => {
  s = scenario();
  s.writeWorld(baseWorld());
  cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
});

afterEach(() => {
  s.remove();
});

/** The base world with a source policy change for a member, so its check runs. */
function worldWith(change: (world: IWorld) => IWorld, notFinal: readonly ('person:ada' | 'person:ben')[] = ['person:ada']): IWorld {
  const world = change(baseWorld());
  return { ...world, final: { 'person:ada': !notFinal.includes('person:ada'), 'person:ben': !notFinal.includes('person:ben') } };
}

describe('read-unread-and-called-helper (A-02)', () => {
  test('changing only unread labels and avatar publishes a fresh source but keeps the exact summary', () => {
    s.writeWorld(worldWith((world) => ({
      ...world,
      profiles: world.profiles.map((profile) => (profile.key === 'person:ada' ? { ...profile, avatarUrl: 'https://avatars.example/ada-2026.png' } : profile)),
      pullRequests: world.pullRequests.map((pull) => (pull.number === 101 ? { ...pull, labels: ['feature', 'ui'] } : pull)),
    })));
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('unread').file });
    expect(next.count('check', 'person:ada')).toBe(1);
    expect(next.phases('person:ada', 'activity')).toContain('publish');
    expect(outcomeOf(next, 'person:ada')).toMatchObject({ kind: 'reused', basis: 'validated', reference: referenceOf(cold, 'person:ada') });
    expect(next.count('summary')).toBe(0);
    expect(next.result?.['report']).toEqual([adaExpected, benExpected]);
  });

  test('Ada\'s consumed merged-status change reevaluates only Ada while Ben keeps his exact result', () => {
    s.writeWorld(worldWith((world) => ({ ...world, pullRequests: world.pullRequests.map((pull) => (pull.number === 103 ? { ...pull, merged: true } : pull)) })));
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('merged').file });
    expect(outcomeOf(next, 'person:ada')['kind']).toBe('published');
    expect(referenceOf(next, 'person:ada')).not.toBe(referenceOf(cold, 'person:ada'));
    expect(outcomeOf(next, 'person:ben')).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ben') });
    expect([next.count('summary', 'person:ada'), next.count('summary', 'person:ben')]).toEqual([1, 0]);
    // Hand-derived: PR 103 now merged, so all three of Ada's PRs were merged.
    expect(next.result?.['report']).toEqual([{ ...adaExpected, merged: 3, sentence: 'Ada authored 3 pull requests, 3 of which were merged, and submitted 5 reviews.' }, benExpected]);
  });

  test('Ada\'s consumed review change reevaluates only Ada while Ben keeps his exact result', () => {
    s.writeWorld(worldWith((world) => ({ ...world, reviews: [...world.reviews, { id: 'rv-ada-7', author: 'person:ada', submittedAt: '2026-03-10T12:00:00Z', state: 'submitted' }] })));
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('reviews').file });
    expect(outcomeOf(next, 'person:ada')['kind']).toBe('published');
    expect(outcomeOf(next, 'person:ben')).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ben') });
    expect(next.result?.['report']).toEqual([{ ...adaExpected, reviews: 6, sentence: 'Ada authored 3 pull requests, 2 of which were merged, and submitted 6 reviews.' }, benExpected]);
  });

  test('a changed called formatter reevaluates both summaries even though the sentences are unchanged', () => {
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('formatter').file, variation: { formatter: 'revised' } });
    for (const member of ['person:ada', 'person:ben'] as const) {
      expect(outcomeOf(next, member)['kind']).toBe('published');
      expect(referenceOf(next, member)).not.toBe(referenceOf(cold, member));
      expect(next.count('summary', member)).toBe(1);
    }
    expect(next.result?.['report']).toEqual([adaExpected, benExpected]);
  });

  test('a changed uncalled helper adds no dependency: both exact summaries are kept', () => {
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('legend').file, variation: { legend: 'revised' } });
    for (const member of ['person:ada', 'person:ben'] as const) {
      expect(outcomeOf(next, member)).toMatchObject({ kind: 'reused', reference: referenceOf(cold, member) });
    }
    expect(next.count('summary')).toBe(0);
  });
});

describe('compatibility-rollback (A-02, REUSE-008)', () => {
  test('version 1 to 2 misses, rollback to 1 retains the old exact result without rewinding the latest pointer, and changed-input rollback misses', () => {
    const v2 = s.run({ kind: 'report' }, { keys: s.saveKeys('v2').file, variation: { summaryVersion: 2 } });
    for (const member of ['person:ada', 'person:ben'] as const) {
      expect(outcomeOf(v2, member)['kind']).toBe('published');
      expect(referenceOf(v2, member)).not.toBe(referenceOf(cold, member));
    }
    const back = s.run({ kind: 'report' }, { keys: s.saveKeys('v1-again').file, variation: { summaryVersion: 1 } });
    for (const member of ['person:ada', 'person:ben'] as const) {
      expect(outcomeOf(back, member)).toMatchObject({ kind: 'reused', basis: 'validated', reference: referenceOf(cold, member) });
    }
    expect(back.count('summary')).toBe(0);
    // Current validation still ran for the rolled-back candidates' sources.
    expect(back.count('finality')).toBe(2);
    s.inspect((history) => {
      expect(history.readCurrent({ analysis: subjectOf('person:ada', 'summary').analysis, environment: subjectOf('person:ada', 'summary').environment, subject: subjectOf('person:ada', 'summary').subject })?.locator)
        .toBe(referenceOf(v2, 'person:ada'));
    });
    s.writeWorld(worldWith((world) => ({ ...world, pullRequests: world.pullRequests.map((pull) => (pull.number === 103 ? { ...pull, merged: true } : pull)) })));
    const changed = s.run({ kind: 'report' }, { keys: s.saveKeys('v1-changed').file, variation: { summaryVersion: 1 } });
    expect(outcomeOf(changed, 'person:ada')['kind']).toBe('published');
    expect(outcomeOf(changed, 'person:ben')).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ben') });
  });
});

describe('equal-name-profile-rebinding (A-04)', () => {
  test('a replaced profile with an equal name keeps the summary, a later name change invalidates it, and original provenance still resolves the old profile', () => {
    s.writeWorld(worldWith((world) => ({ ...world, profiles: world.profiles.map((profile) => (profile.key === 'person:ada' ? { ...profile, id: 'gh:9001' } : profile)) })));
    const replaced = s.run({ kind: 'report' }, { keys: s.saveKeys('replaced').file });
    expect(outcomeOf(replaced, 'person:ada')).toMatchObject({ kind: 'reused', basis: 'validated', reference: referenceOf(cold, 'person:ada') });
    expect(replaced.phases('person:ada', 'activity')).toContain('publish');
    const accepted = outcomeOf(replaced, 'person:ada')['accepted'];
    s.inspect((history) => {
      const summary = { kind: 'completed-result' as const, locator: referenceOf(cold, 'person:ada') };
      // Original provenance keeps the historical child: the old exact profile is still readable.
      const [originalChild] = history.readEnvelope(summary).dependencies;
      expect(originalChild === undefined ? undefined : history.reader.readSubtree(originalChild, [{ kind: 'property', key: 'profile' }])).toEqual({ id: 'gh:1001', name: 'Ada', avatarUrl: 'https://avatars.example/ada.png' });
      // The new current acceptance names the new child, whose profile is the replacement.
      const [currentChild] = history.readAcceptances(summary, environment).at(-1)?.dependencies ?? [];
      expect(currentChild === undefined ? [] : [currentChild.locator]).toEqual(accepted);
      expect(currentChild?.locator).not.toBe(originalChild?.locator);
      expect(currentChild === undefined ? undefined : history.reader.readSubtree(currentChild, [{ kind: 'property', key: 'profile' }])).toEqual({ id: 'gh:9001', name: 'Ada', avatarUrl: 'https://avatars.example/ada.png' });
    });
    s.writeWorld(worldWith((world) => ({ ...world, profiles: world.profiles.map((profile) => (profile.key === 'person:ada' ? { ...profile, id: 'gh:9001', name: 'Ada L.' } : profile)) })));
    const renamed = s.run({ kind: 'report' }, { keys: s.saveKeys('renamed').file });
    expect(outcomeOf(renamed, 'person:ada')['kind']).toBe('published');
    expect(renamed.result?.['report']).toEqual([{ ...adaExpected, name: 'Ada L.', sentence: 'Ada L. authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.' }, benExpected]);
  });
});
