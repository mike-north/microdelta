/**
 * M3 acceptance, basic A-19 through independent processes, with durable
 * state checked on the real store rather than only observer logs: eligible
 * hits never reach a denying admission policy; a refused miss leaves no
 * claim, attempt, body or result; source work needed to validate a cached
 * summary has its own admission; check-only starts no work; a pre-execution
 * observer failure stops only that call and leaves no attempt; a post-commit
 * observer failure is a diagnostic beside the committed, reusable result.
 *
 * @see ../../../../docs/spec/acceptance.md (A-19)
 * @see ../../../../docs/spec/execution.md (REUSE-009)
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { baseWorld, outcomeOf, referenceOf, scenario, subjectOf } from './harness.js';
import type { IScenario } from './harness.js';

let s: IScenario;

beforeEach(() => {
  s = scenario();
  s.writeWorld(baseWorld());
});

afterEach(() => {
  s.remove();
});

/** Completed summary results for a member, read from the real store. */
function summaries(member: 'person:ada' | 'person:ben'): readonly string[] {
  return s.inspect((history) => history.findCandidates(subjectOf(member, 'summary')).map((candidate) => candidate.reference.locator));
}

describe('admission-and-observer-boundaries (A-19)', () => {
  test('eligible hits are served before a denying policy is ever consulted', () => {
    const cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
    const denied = s.run({ kind: 'report' }, { keys: s.saveKeys('denied').file, deny: [{ kind: 'memo' }, { kind: 'source' }] });
    for (const member of ['person:ada', 'person:ben'] as const) {
      expect(outcomeOf(denied, member)).toMatchObject({ kind: 'reused', reference: referenceOf(cold, member) });
    }
    expect(denied.admissions).toEqual([]);
  });

  test('a refused cold miss leaves no attempt, body, source work or result, and strands no writer', () => {
    const saved = s.saveKeys('refused');
    const refused = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: saved.file, deny: [{ memberKey: 'person:ada', slot: 'summary' }] });
    expect(outcomeOf(refused)).toMatchObject({ kind: 'refused', reason: 'acceptance budget exhausted' });
    expect(refused.phases('person:ada', 'summary')).toEqual(['verify', 'admit', 'refuse']);
    expect(refused.count('summary') + refused.count('check')).toBe(0);
    expect(summaries('person:ada')).toEqual([]);
    expect(s.inspect((history) => history.currentWriter())).toBeUndefined();
    expect(s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file }).result?.['recovered']).toEqual({ kind: 'absent' });
    const admitted = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('admitted').file });
    expect(outcomeOf(admitted)['kind']).toBe('published');
  });

  test('source work required to validate a cached summary obeys its own admission', () => {
    const cold = s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
    s.writeWorld({ ...baseWorld(), final: { 'person:ada': false, 'person:ben': true } });
    const refused = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('source-denied').file, deny: [{ kind: 'source' }] });
    expect(outcomeOf(refused)).toMatchObject({ kind: 'refused', refused: { slot: 'activity', memberKey: 'person:ada' } });
    expect(refused.admissions).toEqual([expect.objectContaining({ member: 'person:ada', slot: 'activity', kind: 'source', reason: 'source-policy', denied: true })]);
    expect(refused.count('check') + refused.count('summary')).toBe(0);
    expect(summaries('person:ada')).toEqual([referenceOf(cold, 'person:ada')]);
    const memoDenied = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('memo-denied').file, deny: [{ kind: 'memo' }] });
    expect(outcomeOf(memoDenied)).toMatchObject({ kind: 'reused', reference: referenceOf(cold, 'person:ada') });
    expect(memoDenied.admissions.map((entry) => entry['kind'])).toEqual(['source']);
  });

  test('check-only reports the source boundary and starts no work, admission or write', () => {
    s.run({ kind: 'report' }, { keys: s.saveKeys('cold').file });
    s.writeWorld({ ...baseWorld(), final: { 'person:ada': false, 'person:ben': true } });
    const before = summaries('person:ada');
    const checked = s.run({ kind: 'check', member: 'person:ada' });
    expect(checked.result?.['checked']).toMatchObject({ kind: 'uncertain', boundary: { slot: 'activity', memberKey: 'person:ada' } });
    expect(checked.count('check') + checked.count('summary')).toBe(0);
    expect(checked.admissions).toEqual([]);
    expect(summaries('person:ada')).toEqual(before);
    const coldStore = scenario();
    try {
      coldStore.writeWorld(baseWorld());
      expect(coldStore.run({ kind: 'check', member: 'person:ben' }).result?.['checked']).toEqual({ kind: 'execution-required' });
    } finally {
      coldStore.remove();
    }
  });

  test('a pre-execution observer failure stops only that call and leaves no attempt', () => {
    const saved = s.saveKeys('observer-pre');
    const failed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: saved.file, throwAt: { phase: 'admit', memberKey: 'person:ada', slot: 'summary' } });
    expect(failed.error).toMatchObject({ code: 'observer-failure' });
    expect(failed.count('summary') + failed.count('check')).toBe(0);
    expect(summaries('person:ada')).toEqual([]);
    expect(s.run({ kind: 'recover', member: 'person:ada' }, { keys: saved.file }).result?.['recovered']).toEqual({ kind: 'absent' });
    expect(outcomeOf(s.run({ kind: 'resolve', member: 'person:ben' }, { keys: s.saveKeys('ben').file }))['kind']).toBe('published');
  });

  test('a post-commit observer failure is a diagnostic beside the committed result, which a new process reuses exactly', () => {
    const committed = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('observer-post').file, throwAt: { phase: 'publish', memberKey: 'person:ada', slot: 'summary' } });
    expect(outcomeOf(committed)).toMatchObject({ kind: 'published' });
    expect(committed.result?.['diagnostics']).toEqual([expect.stringContaining('acceptance observer failure at publish')]);
    const reused = s.run({ kind: 'resolve', member: 'person:ada' }, { keys: s.saveKeys('after').file });
    expect(outcomeOf(reused)).toMatchObject({ kind: 'reused', reference: referenceOf(committed) });
    expect(reused.count('summary')).toBe(0);
  });
});
