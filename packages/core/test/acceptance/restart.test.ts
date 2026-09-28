/**
 * M3 acceptance, TEST-1/2: cold run and complete restart through independent
 * processes over the real workspace path and SQLite History. Process A runs
 * the report and exits; later processes independently recreate declarations,
 * helpers and inputs against the same store file.
 *
 * Expected statistics and sentences are derived by hand from the M3 plan's
 * fixture decisions and the example's attribution rules:
 * - Ada: PRs 101 and 102 merged, 103 open (98 predates the window); five
 *   submitted reviews in the window (rv-ada-0 predates it, rv-ada-6 pending).
 * - Ben: PR 201 merged, 202 open (204 is created at the exclusive end); three
 *   submitted reviews in the window (rv-ben-4 follows it).
 *
 * @see ../../../../docs/spec/acceptance.md (TEST-1, TEST-2, A-02)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Concrete fixture decisions; Planned evidence names)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { adaExpected, benExpected } from './expected.js';
import { baseWorld, referenceOf, scenario } from './harness.js';
import type { IScenario } from './harness.js';


let s: IScenario;

beforeEach(() => {
  s = scenario();
  s.writeWorld(baseWorld());
});

afterEach(() => {
  s.remove();
});

describe('cold-and-restarted-report (TEST-1/2)', () => {
  test('a cold process publishes both sources and summaries once and assembles the ordered report once', () => {
    const cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
    expect(cold.result?.['report']).toEqual([adaExpected, benExpected]);
    for (const member of ['person:ada', 'person:ben'] as const) {
      expect(cold.phases(member, 'activity')).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
      expect(cold.phases(member, 'summary')).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
      expect(cold.count('check', member)).toBe(1);
      expect(cold.count('summary', member)).toBe(1);
      expect(cold.count('finality', member)).toBe(0);
    }
    expect(cold.ordinary('report')).toEqual(['begin', 'end']);
    // History holds exactly the four published results, each readable at its exact reference.
    s.inspect((history) => {
      const ada = history.reader.readSubtree({ kind: 'completed-result', locator: referenceOf(cold, 'person:ada') }, []);
      expect(ada).toEqual({ name: 'Ada', authored: 3, merged: 2, reviews: 5, sentence: adaExpected.sentence });
    });
  });

  test('an unchanged restart runs current finality, no summary bodies or checks, keeps exact references and assembles once', () => {
    const cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
    const restart = s.run({ kind: 'report' }, { keys: s.saveKeys('restart').file });
    for (const member of ['person:ada', 'person:ben'] as const) {
      expect(restart.result?.['outcomes']).toMatchObject({ [member]: { kind: 'reused', basis: 'validated', reference: referenceOf(cold, member) } });
      expect(restart.count('finality', member)).toBe(1);
      expect(restart.count('check', member)).toBe(0);
      expect(restart.count('summary', member)).toBe(0);
      expect(restart.phases(member, 'summary')).toEqual(['verify', 'accept']);
      expect(restart.phases(member, 'activity')).toEqual(['verify', 'finality', 'accept']);
    }
    expect(restart.ordinary('report')).toEqual(['begin', 'end']);
    expect(restart.result?.['report']).toEqual([adaExpected, benExpected]);
  });

  test('reversed registration and invocation order keep each member\'s own exact results and evidence', () => {
    const cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
    const reversed = s.run({ kind: 'report', order: ['person:ben', 'person:ada'] }, { keys: s.saveKeys('reversed').file, variation: { order: 'ben-first' } });
    expect(reversed.result?.['outcomes']).toEqual({
      'person:ben': expect.objectContaining({ kind: 'reused', reference: referenceOf(cold, 'person:ben') }),
      'person:ada': expect.objectContaining({ kind: 'reused', reference: referenceOf(cold, 'person:ada') }),
    });
    expect(reversed.count('summary')).toBe(0);
    // The report orders by stable key, not by resolution order.
    expect(reversed.result?.['report']).toEqual([adaExpected, benExpected]);
  });

  test('renamed display labels after restart do not change correspondence or reuse', () => {
    const cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
    const renamed = s.run({ kind: 'report' }, { keys: s.saveKeys('renamed').file, variation: { labels: 'renamed' } });
    for (const member of ['person:ada', 'person:ben'] as const) {
      expect(renamed.result?.['outcomes']).toMatchObject({ [member]: { kind: 'reused', reference: referenceOf(cold, member) } });
    }
    expect(renamed.count('summary')).toBe(0);
    expect(renamed.count('check')).toBe(0);
  });
});
