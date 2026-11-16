/** Complete recorded scenarios then one-fact mutations test semantic sensitivity without native execution. */
import { expect, test } from '@jest/globals';
import { readFile } from 'node:fs/promises';
import { validateLedger } from '../node/schedule.js';
import { evaluateCell } from '../node/oracle.js';
import { scenario, change } from './recorded-scenarios.js';
const ledger = validateLedger(JSON.parse(await readFile(new URL('../../../../experiments/exp-wal-coordinated-snapshot/command-ledger.json', import.meta.url), 'utf8')) as unknown);
const row = (id: string) => { const found = ledger.rows.find(value => value.id === id); if (!found) {
    throw new Error('Missing fixture row');
} return found; };
const assess = (id: string, records = scenario(row(id)), fixture = true, cleanup = true) => evaluateCell(id, records, [], cleanup, row(id).orderedCommands, fixture);
test.each(ledger.rows.filter(value => value.id !== 'C-forbidden-effects').map(value => value.id))('%s complete selected recorded scenario qualifies', id => { expect(assess(id).outcome).toBe('observed'); });
test.each([['Q4', 'W.holdUncommittedC'], ['Q4', 'W.rollbackC'], ['Q18', 'R.readB'], ['Q18', 'R.end'], ['Q5', 'R.end']])('%s cannot credit failed required %s from later matching values', (id, stage) => { expect(assess(id, change(scenario(row(id)), stage, { kind: 'failed', pair: undefined })).outcome).not.toBe('observed'); });
test.each([['Q5', 'W.checkpoint-blocked', { checkpoint: [{ busy: 0, log: 0, checkpointed: 0 }] }], ['C-false-release', 'V.checkpoint-still-blocked', { checkpoint: undefined }], ['C-torn', 'C.metaB', { meta: { revision: 3 } }], ['C-torn', 'C.currentC', { current: { revision: 2, value: 'B' } }], ['C-immediate', 'W.commitB-after-release', { pair: { revision: 1, currentRevision: 1, value: 'A' } }], ['Q18', 'R.close', { facts: { state: 'closed', open: true, inTransaction: false, readonly: true } }], ['Q18', 'R.status-ended', { facts: { state: 'ended', open: false, inTransaction: false, readonly: true } }], ['Q1', 'R.profile', { profile: {} }]])('%s rejects missing/wrong required %s fact', (id, stage, patch) => { if (typeof id !== 'string' || typeof stage !== 'string' || typeof patch !== 'object' || patch === null) {
    throw new Error('bad mutation');
} expect(assess(id, change(scenario(row(id)), stage, patch)).outcome).not.toBe('observed'); });
test.each(['Q1', 'Q7'])('proved healthy mandatory %s native refusal is REJECT even after cleanup failure', id => { const records = change(scenario(row(id)), 'R.open', { kind: 'failed', failure: { type: 'SqliteError', code: 'SQLITE_CANTOPEN', message: 'native refusal' }, facts: { state: 'closed', open: null, inTransaction: null, readonly: null }, cleanup: { kind: 'closed', failures: [] } }); expect(assess(id, records).outcome).toBe('counterexample'); expect(assess(id, records, true, false).outcome).toBe('counterexample'); });
test('unproved setup never promotes a wrong pair or native refusal into candidate counterexample', () => { expect(assess('Q3', change(scenario(row('Q3')), 'R.anchor', { pair: { revision: 1, currentRevision: 1, value: 'A' } }), false).outcome).toBe('unproved'); expect(assess('Q1', change(scenario(row('Q1')), 'R.open', { kind: 'failed', failure: { code: 'SQLITE_CANTOPEN' } }), false).outcome).toBe('unproved'); });
for (const selected of ledger.rows.filter(value => value.id !== 'C-forbidden-effects')) {
    test(`${selected.id} every required stage kind and presence is independently necessary`, () => { const valid = scenario(selected); expect(assess(selected.id, valid).outcome).toBe('observed'); for (const entry of valid) {
        expect(assess(selected.id, change(valid, entry.stage, { kind: 'unexpected' })).outcome).not.toBe('observed');
        expect(assess(selected.id, valid.filter(value => value !== entry)).outcome).not.toBe('observed');
    } });
}
test.each(['Q6', 'Q8', 'Q9', 'Q10'])('%s unavailable effective permission fixture remains an explicit limitation', id => { const valid = scenario(row(id)); const entry = valid.find(value => value.stage === 'R.profile'); if (!entry || typeof entry.reply.profile !== 'object' || entry.reply.profile === null || !('create' in entry.reply.profile)) {
    throw new Error('bad fixture');
} const bad = { ...entry.reply.profile, create: { ok: true } }; const result = assess(id, change(valid, 'R.profile', { profile: bad })); expect(result.outcome).toBe('unavailable'); expect(result.limitation).toBeDefined(); expect(assess(id, change(valid, 'R.profile', { profile: bad }), true, false).outcome).toBe('unproved'); });
