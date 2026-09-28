/**
 * M3 acceptance, A-03 current source policy through independent processes:
 * the current finality hook runs in every new process; true retains the exact
 * source without a check; false and absent hooks enter the current check; a
 * changed hook is what runs (stored acceptance cannot mask it); a changed
 * source implementation suppresses finality for the old candidate before any
 * admitted source work; explicit retention keeps the exact source reference;
 * fresh equal data publishes a distinct source while an equal-consuming
 * summary is kept.
 *
 * @see ../../../../docs/spec/acceptance.md (A-03)
 * @see ../../../../docs/spec/execution.md (REUSE-002, REUSE-004, RES-004)
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Candidate eligibility and current source policy)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { baseWorld, outcomeOf, referenceOf, scenario } from './harness.js';
import type { IProcessRun, IScenario } from './harness.js';

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

/** The exact source reference a member's report outcome consumed, from its current acceptance or publication. */
function acceptedSource(run: IProcessRun, member: 'person:ada' | 'person:ben'): unknown {
  return outcomeOf(run, member)['accepted'];
}

/** The cold run's exact source reference for a member, read from its summary's provenance. */
function coldSource(member: 'person:ada' | 'person:ben'): string {
  return s.inspect((history) => history.readEnvelope({ kind: 'completed-result', locator: referenceOf(cold, member) }).dependencies[0]?.locator ?? '');
}

describe('current-finality-under-cached-summary (A-03)', () => {
  test('an accepting current hook runs once per member in every new process and retains the exact source without a check', () => {
    for (const label of ['restart-1', 'restart-2']) {
      const next = s.run({ kind: 'report' }, { keys: s.saveKeys(label).file });
      for (const member of ['person:ada', 'person:ben'] as const) {
        expect(next.count('finality', member)).toBe(1);
        expect(next.count('check', member)).toBe(0);
        expect(acceptedSource(next, member)).toEqual([coldSource(member)]);
      }
    }
  });

  test('a false current answer enters the check, whose fresh equal data is a distinct source while the summary is kept', () => {
    s.writeWorld({ ...baseWorld(), final: { 'person:ada': false, 'person:ben': true } });
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('not-final').file });
    expect(next.count('finality', 'person:ada')).toBe(1);
    expect(next.count('check', 'person:ada')).toBe(1);
    expect(next.phases('person:ada', 'activity')).toEqual(['verify', 'finality', 'admit', 'claim', 'execute', 'publish']);
    const [freshSource] = acceptedSource(next, 'person:ada') as readonly string[];
    expect(freshSource).toBeDefined();
    expect(freshSource).not.toBe(coldSource('person:ada'));
    expect(outcomeOf(next, 'person:ada')).toMatchObject({ kind: 'reused', basis: 'validated', reference: referenceOf(cold, 'person:ada') });
    expect(next.count('summary')).toBe(0);
  });

  test('an absent finality hook enters the current check in every new process', () => {
    for (const label of ['absent-1', 'absent-2']) {
      const next = s.run({ kind: 'report' }, { keys: s.saveKeys(label).file, variation: { adaFinality: 'absent' } });
      expect(next.count('finality', 'person:ada')).toBe(0);
      expect(next.count('check', 'person:ada')).toBe(1);
      expect(next.phases('person:ada', 'activity')).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
      expect(outcomeOf(next, 'person:ada')).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ada') });
    }
  });

  test('a changed current finality hook is what runs; the earlier accepting decision cannot mask it', () => {
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('changed-hook').file, variation: { adaFinality: 'changed' } });
    expect(next.count('finality-changed', 'person:ada')).toBe(1);
    expect(next.count('finality', 'person:ada')).toBe(0);
    expect(next.count('check', 'person:ada')).toBe(1);
    expect(next.count('finality', 'person:ben')).toBe(1);
    expect(next.count('check', 'person:ben')).toBe(0);
  });

  test('a changed source implementation is not excused by an accepting hook: finality is skipped and admitted source work runs', () => {
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('changed-source').file, variation: { adaSource: 'changed' } });
    expect(next.count('finality', 'person:ada')).toBe(0);
    expect(next.count('check', 'person:ada')).toBe(1);
    expect(next.phases('person:ada', 'activity')).toEqual(['verify', 'admit', 'claim', 'execute', 'publish']);
    const admission = next.admissions.find((entry) => entry['member'] === 'person:ada' && entry['slot'] === 'activity');
    expect(admission).toMatchObject({ kind: 'source', reason: 'invalid' });
    expect(outcomeOf(next, 'person:ada')).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ada') });
  });
});

describe('retain-versus-fresh-equal (A-03/A-10)', () => {
  test('an explicit retention keeps the exact source reference and ends the claim without publishing', () => {
    s.writeWorld({ ...baseWorld(), final: { 'person:ada': false, 'person:ben': true }, check: { 'person:ada': 'retain', 'person:ben': 'fresh' } });
    const next = s.run({ kind: 'report' }, { keys: s.saveKeys('retain').file });
    expect(next.phases('person:ada', 'activity')).toEqual(['verify', 'finality', 'admit', 'claim', 'execute', 'accept', 'release']);
    expect(acceptedSource(next, 'person:ada')).toEqual([coldSource('person:ada')]);
    expect(outcomeOf(next, 'person:ada')).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ada') });
  });

  test('fresh equal data twice yields two distinct exact source references, each readable, while the summary is kept', () => {
    s.writeWorld({ ...baseWorld(), final: { 'person:ada': false, 'person:ben': true } });
    const first = s.run({ kind: 'report' }, { keys: s.saveKeys('fresh-1').file });
    const second = s.run({ kind: 'report' }, { keys: s.saveKeys('fresh-2').file });
    const sources = [coldSource('person:ada'), ...(acceptedSource(first, 'person:ada') as string[]), ...(acceptedSource(second, 'person:ada') as string[])];
    expect(new Set(sources).size).toBe(3);
    s.inspect((history) => {
      for (const locator of sources) {
        expect(history.reader.readSubtree({ kind: 'completed-result', locator }, [{ kind: 'property', key: 'profile' }])).toEqual({ id: 'gh:1001', name: 'Ada', avatarUrl: 'https://avatars.example/ada.png' });
      }
    });
    expect(outcomeOf(second, 'person:ada')).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ada') });
  });
});
