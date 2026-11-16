/** Explicit report input and settling outcomes follow TEST-3 and CR-4/5. */
import { describe, expect, test } from '@jest/globals';
import { dailyCoverage, parseRoster, quietFinal, selectPeople, validateAssessment, validateScope } from '../../examples/contribution-report/src/controlled/model.js';

/** Current HR records include a quoted comma and an employee explicitly inactive. */
const csv = 'employee_id,github_login,name,active\r\nada,ada,"Lovelace, Ada",true\r\ngrace,grace,Grace Hopper,true\r\nretired,retired,Retired,false\r\n';

describe('explicit current HR and report scope', () => {
  test('quoted CSV and explicit selection preserve HR identity and deterministic order', () => {
    const roster = parseRoster(csv);
    expect(roster).toEqual([{ key: 'ada', login: 'ada', name: 'Lovelace, Ada', active: true }, { key: 'grace', login: 'grace', name: 'Grace Hopper', active: true }, { key: 'retired', login: 'retired', name: 'Retired', active: false }]);
    expect(selectPeople(roster, ['grace', 'ada']).map(person => person.key)).toEqual(['ada', 'grace']);
    expect(selectPeople(parseRoster(csv.replace('Grace Hopper,true', 'Grace Hopper,false')), ['ada'])).toHaveLength(1);
  });
  test.each([
    ['unclosed quote', csv + 'x,x,"bad,true'],
    ['duplicate employee', csv + 'ada,other,Duplicate,true\n'],
    ['missing identity', csv + ',other,Missing,true\n'],
    ['wrong header', csv.replace('employee_id', 'id')],
    ['malformed boolean', csv.replace('Grace Hopper,true', 'Grace Hopper,yes')],
    ['extra column', csv + 'extra,extra,Extra,true,unparsed\n'],
  ])('%s is rejected before provider work', (_label, value) => { expect(() => parseRoster(value)).toThrow('roster'); });
  test('unknown, duplicate and inactive explicit selection cannot silently disappear', () => {
    const roster = parseRoster(csv);
    for (const ids of [['missing'], ['ada', 'ada'], ['retired']]) { expect(() => selectPeople(roster, ids)).toThrow('selection'); }
    expect(selectPeople(roster, [])).toEqual([]);
  });
  test('scope retains exact half-open seconds and rejects unsupported precision or implicit repositories', () => {
    const scope = { repositories: ['acme/widget'], start: 100, end: 200, cutoff: 200, observation: 'observation-a' };
    expect(validateScope(scope)).toEqual(scope);
    for (const next of [{ ...scope, start: 100.5 }, { ...scope, end: 100 }, { ...scope, repositories: [] }, { ...scope, observation: '' }]) { expect(() => validateScope(next)).toThrow('scope'); }
  });
  test('assessment schema refuses malformed or out-of-range model output', () => {
    expect(validateAssessment({ score: 2, explanation: 'A concrete contribution.' })).toEqual({ score: 2, explanation: 'A concrete contribution.' });
    for (const value of [undefined, {}, { score: NaN, explanation: 'bad' }, { score: -1, explanation: 'bad' }, { score: 2, explanation: '' }, { score: 2, explanation: 'valid', fabricated: true }]) { expect(() => validateAssessment(value)).toThrow('assessment'); }
  });
});

describe('independent quiet and daily settling', () => {
  test('quiet finality requires terminal state, complete coverage and absence of recent or future activity', () => {
    expect(quietFinal({ terminalAt: 100, latestActivity: 120, complete: true }, 200, 50)).toBe(true);
    for (const evidence of [{ terminalAt: null, latestActivity: 120, complete: true }, { terminalAt: 201, latestActivity: 120, complete: true }, { terminalAt: 100, latestActivity: 151, complete: true }, { terminalAt: 100, latestActivity: 201, complete: true }, { terminalAt: 100, latestActivity: 120, complete: false }]) { expect(quietFinal(evidence, 200, 50)).toBe(false); }
    expect(quietFinal({ terminalAt: 100, latestActivity: 150, complete: true }, 200, 50)).toBe(true);
  });
  test('inclusive closed day is clipped to report bounds, with a truthful provisional remainder', () => {
    const start = Date.parse('2026-01-01T12:00:00Z') / 1_000;
    const end = Date.parse('2026-01-03T12:00:00Z') / 1_000;
    expect(dailyCoverage(start, end, '2026-01-01')).toEqual({ closed: [start, Date.parse('2026-01-02T00:00:00Z') / 1_000], provisional: [Date.parse('2026-01-02T00:00:00Z') / 1_000, end] });
    expect(dailyCoverage(start, end, '2026-01-04')).toEqual({ closed: [start, end], provisional: [end, end] });
    expect(() => dailyCoverage(start, end, '2026-02-31')).toThrow('daily');
  });
});
