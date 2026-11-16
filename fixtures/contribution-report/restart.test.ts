/** Actual process termination separates policy acceptance, current source work and immutable retained provenance. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openDurableHistory } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { reportAnalysis } from '../../examples/contribution-report/src/controlled/application.js';
import type { IReportInputs } from '../../examples/contribution-report/src/controlled/application.js';
import { baseInputs } from './fixture.js';
import { isProcessReport } from './process-protocol.js';
import type { IProcessJob, IProcessOptions, IProcessReport } from './process-protocol.js';

/** Every evaluation starts a separately initialized package/facade composition. */
const worker = fileURLToPath(new URL('./process-worker.js', import.meta.url));
let directory: string;
let keys = 0;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'controlled-report-restart-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
/** No graph callback, provider instance or acceptance cache survives between child processes. */
function run(options: IProcessOptions = {}, inputs: IReportInputs = baseInputs, mode: IProcessJob['mode'] = 'normal', environment = 'production'): IProcessReport {
  keys += 1;
  const job: IProcessJob = { directory, options, inputs, mode, requestKey: `process:${String(keys)}`, environment };
  const child = spawnSync(process.execPath, [worker, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
  if (child.status !== 0) { throw new Error(`Controlled worker failed: ${child.stderr}`); }
  const parsed: unknown = JSON.parse(child.stdout);
  if (!isProcessReport(parsed)) { throw new Error('Invalid controlled process evidence'); }
  return parsed;
}
/** Independently retained person identities are observable even when the strict report is incomplete. */
function references(report: IProcessReport): Readonly<Record<string, string>> { return Object.fromEntries(report.people.flatMap(person => person.reference === undefined ? [] : [[person.key, person.reference.locator]])); }
/** Read exact immutable candidates through generated History APIs, without a writer or private facade imports. */
function exact(subject: string) {
  const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: createNodeClock(), sha256: createNodeMachine(), location: join(directory, 'history.sqlite'), logicalStore: 'controlled-history' });
  try {
    const envelope = history.findCandidates({ analysis: reportAnalysis, environment: 'production', subject, version: 1 })[0];
    if (envelope === undefined) { throw new Error(`Missing independently expected subject ${subject}`); }
    return { envelope, data: history.reader.readSubtree(envelope.reference, []) };
  } finally { history.close(); }
}

describe('controlled report fresh-process acceptance', () => {
  test('unchanged restart executes current hooks and reuses exact source, assessment and person references with honest sends', () => {
    const first = run();
    expect(first.status).toBe('complete');
    expect(first.report?.people.map(person => [person.key, person.count, person.score])).toEqual([['ada', 2, 4], ['grace', 2, 4]]);
    expect(first.requests).toBe(24); expect(first.assessments).toBe(4);
    const detail = exact('detail:acme/widget#101');
    const discussion = exact('discussion:acme/widget#101');
    const assessment = exact('assessment:acme/widget#101');
    const second = run({ searchPageSize: 2 });
    expect(references(second)).toEqual(references(first));
    expect(second.trace.filter(event => /^(?:detail|discussion)-hook:/u.test(event))).toHaveLength(8);
    expect(second.trace.filter(event => /^(?:detail|discussion|assessment|summary)-body:/u.test(event))).toEqual([]);
    expect(second.requests).toBe(2); expect(second.assessments).toBe(0);
    expect(exact('detail:acme/widget#101')).toEqual(detail);
    expect(exact('discussion:acme/widget#101')).toEqual(discussion);
    expect(exact('assessment:acme/widget#101')).toEqual(assessment);
  });
  test('equal refreshed source records new provenance while exact assessment/person survive; consumed change affects only Ada', () => {
    const inputs = { ...baseInputs, settling: { ...baseInputs.settling, quietSeconds: 1_000_000, closedDay: '2025-12-31' } };
    const first = run({}, inputs);
    const source = exact('detail:acme/widget#101');
    const assessed = exact('assessment:acme/widget#101');
    const second = run({ label: 'unread-change' }, { ...inputs, scope: { ...inputs.scope, observation: 'observation-b' } });
    expect(references(second)).toEqual(references(first));
    expect(second.requests).toBe(24); expect(second.assessments).toBe(0);
    expect(exact('detail:acme/widget#101').envelope.reference).not.toEqual(source.envelope.reference);
    expect(exact('assessment:acme/widget#101')).toEqual(assessed);
    const third = run({ merged: [102, 201, 202] }, { ...inputs, scope: { ...inputs.scope, observation: 'observation-c' } });
    expect(third.assessments).toBe(1);
    expect(third.report?.people.map(person => person.score)).toEqual([3, 4]);
    expect(references(third).grace).toBe(references(first).grace);
    expect(references(third).ada).not.toBe(references(first).ada);
    expect(source.data).toMatchObject({ merged: true, labels: ['unread'] });
  });
  test('failed traversal cannot certify membership; fresh authorized root traversal reuses previous eligible work', () => {
    const first = run();
    const failed = run({}, baseInputs, 'fail-grace');
    expect(failed.status).toBe('incomplete'); expect(failed.report).toBeUndefined();
    expect(references(failed).ada).toBe(references(first).ada);
    expect(failed.trace.filter(event => event.startsWith('search-complete:'))).toEqual(['search-complete:ada']);
    const resumed = run({ ids: { ada: [101, 103], grace: [201, 202] } });
    expect(resumed.status).toBe('complete'); expect(resumed.assessments).toBe(1);
    expect(resumed.trace.some(event => event.includes('#102'))).toBe(false);
    expect(references(resumed).grace).toBe(references(first).grace);
  });
  test('SIGKILL after committed Ada and pending Grace preserves Ada, no partial Grace and unknown send usage', () => {
    keys += 1;
    const job: IProcessJob = { directory, inputs: baseInputs, options: {}, requestKey: `crash:${String(keys)}`, mode: 'crash-after-ada' };
    const killed = spawnSync(process.execPath, [worker, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
    expect(killed.signal).toBe('SIGKILL');
    const receipt: unknown = JSON.parse(readFileSync(join(directory, 'crash-receipt.json'), 'utf8'));
    expect(receipt).toMatchObject({ reference: { locator: expect.any(String) }, assessments: 2 });
    const ada = exact('summary:ada');
    const restarted = run();
    expect(references(restarted).ada).toBe(ada.envelope.reference.locator);
    expect(restarted.assessments).toBe(2);
    expect(restarted.usage.unknown).toBeGreaterThan(0);
    expect(restarted.report?.people.map(person => person.score)).toEqual([4, 4]);
  });
  test('explicit trial widening reuses only its environment and never supplies production without promotion', () => {
    const empty = run({}, { ...baseInputs, selected: [] }, 'normal', 'trial');
    expect(empty.status).toBe('complete'); expect(empty.report?.selected).toEqual([]); expect(empty.requests).toBe(0); expect(empty.assessments).toBe(0);
    const trial = run({}, { ...baseInputs, selected: ['ada'] }, 'normal', 'trial');
    expect(trial.report?.selected).toEqual(['ada']); expect(trial.assessments).toBe(2);
    expect(trial.trace.some(event => /(?:summary-body:grace|#20[12])/u.test(event))).toBe(false);
    const widened = run({}, baseInputs, 'normal', 'trial');
    expect(widened.assessments).toBe(2); expect(references(widened).ada).toBe(references(trial).ada);
    const production = run();
    expect(production.assessments).toBe(4);
    expect(references(production).ada).not.toBe(references(trial).ada);
  });
});
