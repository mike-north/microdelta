/** RUN-018 distinguishes successful author-selected execution from meaningful semantic coverage. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { openWorkspace } from 'microdelta';
import type { IRunEvent, IWorkspace } from 'microdelta';
import { runTrial } from './trial-adequacy-fixture.js';
import type { ITrialInputs, ITrialLedger } from './trial-adequacy-fixture.js';

/** The full authored roster contains staff who are deliberately outside this trial. */
const noStaffTrial: ITrialInputs = {
  roster: [{ key: 'ada', staff: false, datum: 4 }, { key: 'grace', staff: true, datum: 8 }], selected: ['ada'],
};
let directory: string;
let workspace: IWorkspace;
let accounting: IDurableAccounting;
let ledger: ITrialLedger;
let events: IRunEvent[];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'author-trial-adequacy-'));
  accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'usage.sqlite'), logicalStore: 'trial-usage' });
  workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'trial-adequacy', accounting });
  ledger = { bodies: [], models: [] };
  events = [];
});
afterEach(() => { workspace.close(); accounting.close(); rmSync(directory, { recursive: true, force: true }); });

describe('RUN-018 author-composed trial evidence through generated public facade', () => {
  test('a no-staff selection succeeds with empty leadership input and no leadership/model/excluded work', async () => {
    const result = await runTrial(workspace, noStaffTrial, ledger, event => events.push(event));
    expect(result.context.environment).toBe('trial');
    expect(result.value.leadershipInput).toEqual({ status: 'complete', members: [] });
    expect(result.value.leadership.discovery).toMatchObject({ kind: 'keyed', completion: 'complete', keys: [] });
    expect(result.value.leadership.outcome).toMatchObject({ status: 'succeeded', outcome: { coverage: { closed: true, required: [], skipped: [] } } });
    expect(result.value.leadershipResult).toEqual({ analyzed: [] });
    expect(result.value.plot.selected).toEqual(['ada']);
    expect(ledger.bodies.filter(body => body.startsWith('leadership:'))).toEqual([]);
    expect(ledger.bodies.some(body => body.includes('grace'))).toBe(false);
    expect(ledger.models).toEqual([]);
    expect(events.filter(event => event.kind === 'operation' || event.kind === 'send')).toEqual([]);
    expect(noStaffTrial.selected).toEqual(['ada']);
  });

  test('a one-point plotting input executes exactly once without adding data or claiming representativeness', async () => {
    const result = await runTrial(workspace, noStaffTrial, ledger, event => events.push(event));
    expect(result.value.plot).toEqual({ selected: ['ada'], input: [4], output: [4] });
    expect(result.value.plotOutcome.kind).toBe('published');
    expect(ledger.bodies.filter(body => body === 'plot')).toHaveLength(1);
    expect(ledger.models).toEqual([]);
    expect(events.filter(event => event.kind === 'operation' || event.kind === 'send')).toEqual([]);
    expect(Object.keys(result.value).sort()).toEqual(['leadership', 'leadershipInput', 'leadershipResult', 'plot', 'plotOutcome']);
  });

  test('an explicitly selected staff member really exercises the leadership path; exclusion never means disabled code', async () => {
    const inputs: ITrialInputs = { ...noStaffTrial, selected: ['grace'] };
    const result = await runTrial(workspace, inputs, ledger, event => events.push(event));
    expect(result.value.leadershipInput).toEqual({ status: 'complete', members: [{ key: 'grace', staff: true, datum: 8 }] });
    expect(result.value.leadershipResult).toEqual({ analyzed: ['grace'] });
    expect(result.value.plot).toEqual({ selected: ['grace'], input: [8], output: [8] });
    expect(ledger.bodies.filter(body => body.startsWith('leadership:'))).toEqual(['leadership:grace']);
    expect(ledger.models).toEqual(['grace']);
    expect(ledger.bodies.some(body => body.includes('ada'))).toBe(false);
  });
});
