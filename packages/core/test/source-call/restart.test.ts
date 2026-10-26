/** Fresh-process acceptance for current dynamic sources, exact History, and ordered replay (SCD-1–6). */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openHistory } from '../durable-history/support.js';
import { createWorld, logicalStore, scope } from './fixture.js';
import type { IVariation, IWorld } from './fixture.js';
import { isWorkerReport } from './protocol.js';
import type { IJob, IWorkerReport } from './protocol.js';

/** Compiled worker imports the real generated facade package. */
const worker = fileURLToPath(new URL('./worker.js', import.meta.url));
let directory: string;
let requests = 0;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'microdelta-source-call-restart-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
/** A complete process exit separates every evaluation, including current policy hooks. */
function run(world: IWorld = createWorld(), variation: IVariation = {}): IWorkerReport {
  requests += 1;
  const job: IJob = { location: join(directory, 'history.sqlite'), requestKey: `restart:${String(requests)}`, world, variation };
  const child = spawnSync(process.execPath, [worker, JSON.stringify(job)], { encoding: 'utf8', timeout: 60_000 });
  if (child.status !== 0) { throw new Error(`source-call worker failed ${String(child.status)}: ${child.stderr}`); }
  const value: unknown = JSON.parse(child.stdout);
  if (!isWorkerReport(value)) { throw new Error(`Invalid worker report: ${child.stdout}`); }
  return value;
}
/** Each independent person's exact reference is observable even when the outer report fails. */
function references(report: IWorkerReport): Readonly<Record<string, string>> { return Object.fromEntries(report.members.flatMap(member => member.reference === undefined ? [] : [[member.key, member.reference.locator]])); }
/** Stable author subjects locate source/assessment histories independently of their callers. */
function exact(subject: string) {
  const history = openHistory({ location: join(directory, 'history.sqlite'), store: logicalStore });
  try {
    const candidates = history.findCandidates({ analysis: scope, environment: 'production', subject, version: 1 });
    const latest = candidates[0];
    if (latest === undefined) { throw new Error(`No result for ${subject}`); }
    return { envelope: latest, payload: history.reader.readSubtree(latest.reference, []), candidates: candidates.map(candidate => candidate.reference.locator) };
  } finally { history.close(); }
}
/** Current hooks accept detail while search still reestablishes its population. */
function accepted(): IWorld { return { ...createWorld(), accepts: { 'repo#101': true, 'repo#102': true, 'repo#201': true } }; }

describe('source-call fresh-process durability', () => {
  test('unchanged restart reexecutes current hooks and retains exact source, assessment and person references', () => {
    const first = run();
    expect(first.status).toBe('succeeded');
    expect(first.data).toEqual({ people: [{ key: 'ada', count: 2, total: 2 }, { key: 'grace', count: 1, total: 1 }] });
    const source = exact('detail:repo#101');
    const assessment = exact('assessment:repo#101');
    const restarted = run(accepted(), { order: 'reverse' });
    expect(references(restarted)).toEqual(references(first));
    expect(restarted.trace.filter(event => event.startsWith('finality:'))).toHaveLength(3);
    expect(restarted.trace.filter(event => /^(?:detail|assess|summary):/u.test(event))).toEqual([]);
    expect(exact('detail:repo#101')).toEqual(source);
    expect(exact('assessment:repo#101')).toEqual(assessment);
    const reconsidered = run(createWorld());
    expect(reconsidered.trace.filter(event => event.startsWith('finality:'))).toHaveLength(3);
    expect(reconsidered.trace.filter(event => event.startsWith('detail:'))).toHaveLength(3);
    expect(references(reconsidered)).toEqual(references(first));
  });

  test('same-ID changed detail refreshes and changes only consumers that observed it', () => {
    const first = run();
    const oldSource = exact('detail:repo#101');
    const oldAssessment = exact('assessment:repo#101');
    const initial = createWorld();
    const next = { ...initial, details: { ...initial.details, 'repo#101': { id: 'repo#101', merged: true, title: '101' } } };
    const changed = run(next, { order: 'reverse' });
    expect(changed.status).toBe('succeeded');
    expect(changed.data).toEqual({ people: [{ key: 'ada', count: 2, total: 3 }, { key: 'grace', count: 1, total: 1 }] });
    expect(changed.trace.filter(event => event.startsWith('detail:'))).toHaveLength(3);
    expect(changed.trace.filter(event => event.startsWith('assess:'))).toEqual(['assess:repo#101']);
    expect(changed.trace.filter(event => event.startsWith('summary:'))).toEqual(['summary:ada']);
    expect(references(changed).ada).not.toBe(references(first).ada);
    expect(references(changed).grace).toBe(references(first).grace);
    expect(exact('detail:repo#101').envelope.reference).not.toEqual(oldSource.envelope.reference);
    expect(exact('assessment:repo#101').envelope.reference).not.toEqual(oldAssessment.envelope.reference);
    const history = openHistory({ location: join(directory, 'history.sqlite'), store: logicalStore });
    try {
      expect(history.readEnvelope(oldSource.envelope.reference)).toEqual(oldSource.envelope);
      expect(history.reader.readSubtree(oldSource.envelope.reference, [])).toEqual({ id: 'repo#101', merged: false, title: '101' });
    } finally { history.close(); }
  });

  test.each(['equal', 'unconsumed'] as const)('%s refresh publishes a new source while assessment and person references remain exact', mode => {
    const first = run();
    const source = exact('detail:repo#101');
    const assessment = exact('assessment:repo#101');
    const initial = createWorld();
    const next = { ...initial, details: { ...initial.details, 'repo#101': { id: 'repo#101', merged: false, title: mode === 'equal' ? '101' : 'changed unconsumed title' } } };
    const refreshed = run(next);
    expect(refreshed.trace.filter(event => event.startsWith('detail:'))).toHaveLength(3);
    expect(references(refreshed)).toEqual(references(first));
    expect(refreshed.trace.filter(event => /^(?:assess|summary):/u.test(event))).toEqual([]);
    expect(exact('detail:repo#101').envelope.reference).not.toEqual(source.envelope.reference);
    expect(exact('detail:repo#101').candidates).toHaveLength(2);
    expect(exact('assessment:repo#101')).toEqual(assessment);
  });

  test('membership replacement refreshes surviving and new IDs without replaying the removed call', () => {
    const first = run();
    const survivor = exact('assessment:repo#101');
    const initial = createWorld();
    const changed = run({ ...initial, searches: { ...initial.searches, ada: { count: 2, ids: ['repo#101', 'repo#103'] } } });
    expect(changed.trace.filter(event => event.startsWith('detail:')).map(event => event.split(':')[1]).sort()).toEqual(['repo#101', 'repo#103', 'repo#201']);
    expect(exact('assessment:repo#101')).toEqual(survivor);
    expect(changed.trace.filter(event => event.startsWith('summary:'))).toEqual(['summary:ada']);
    expect(references(changed).grace).toBe(references(first).grace);
    expect(changed.data).toEqual({ people: [{ key: 'ada', count: 2, total: 3 }, { key: 'grace', count: 1, total: 1 }] });
  });

  test('same-ID sharing across people preserves the author subject and fresh-process exact reuse', () => {
    const initial = createWorld();
    const shared = { ...initial, searches: { ada: { count: 1, ids: ['repo#101'] }, grace: { count: 1, ids: ['repo#101'] } } };
    const first = run(shared);
    expect(first.trace.filter(event => event.startsWith('detail:'))).toHaveLength(1);
    expect(exact('detail:repo#101').envelope.subject).toBe('detail:repo#101');
    const next = run({ ...shared, accepts: { 'repo#101': true } });
    expect(references(next)).toEqual(references(first));
    expect(next.trace.filter(event => event.startsWith('finality:'))).toHaveLength(1);
    expect(next.trace.filter(event => /^(?:detail|assess|summary):/u.test(event))).toEqual([]);
  });

  test('differing consumed arguments preserve separate source attempts and eligibility after restart', () => {
    const initial = createWorld();
    const shared = { ...initial, searches: { ada: { count: 1, ids: ['repo#101'] }, grace: { count: 1, ids: ['repo#101'] } }, accepts: { 'repo#101': true } };
    const variation: IVariation = { selected: [{ key: 'ada', argument: 'A' }, { key: 'grace', argument: 'B' }] };
    const first = run(shared, variation);
    expect(first.trace.filter(event => event.startsWith('detail:'))).toHaveLength(2);
    const candidates = exact('detail:repo#101').candidates;
    expect(candidates).toHaveLength(2);
    const next = run(shared, { ...variation, order: 'reverse' });
    expect(references(next)).toEqual(references(first));
    expect(next.trace.filter(event => event.startsWith('finality:'))).toHaveLength(2);
    expect(next.trace.filter(event => event.startsWith('detail:'))).toEqual([]);
    expect(exact('detail:repo#101').candidates).toEqual(candidates);
  });

  test('new source provenance stays v1 and parent witnesses stay exactly v2', () => {
    run();
    const source = exact('detail:repo#101');
    expect(source.envelope.provenance).toMatchObject({ formatVersion: 1, content: { kind: 'source', step: { scope, role: 'callable', slot: 'detail' }, children: [] } });
    const summary = exact('summary:ada');
    expect(summary.envelope.provenance).toMatchObject({ formatVersion: 2, content: { kind: 'memo', calls: expect.arrayContaining([expect.objectContaining({ witness: expect.objectContaining({ version: 2, child: { scope, role: 'callable', slot: 'detail' } }) })]) } });
    const content: unknown = summary.envelope.provenance.content;
    if (typeof content !== 'object' || content === null || !('calls' in content) || !Array.isArray(content.calls)) { throw new Error('Missing nested calls'); }
    const calls: readonly unknown[] = content.calls;
    for (const call of calls) {
      if (typeof call !== 'object' || call === null || !('witness' in call) || typeof call.witness !== 'object' || call.witness === null) { throw new Error('Invalid nested call'); }
      expect(Object.keys(call.witness).sort()).toEqual(['arguments', 'child', 'index', 'parent', 'version']);
    }
    // The older ordinary source and supplied memo forms still resolve on this new reader.
    expect(exact('selected-people').envelope.provenance).toMatchObject({ formatVersion: 1, content: { kind: 'source', step: { role: 'step' } } });
    expect(exact('assessment:repo#101').envelope.provenance).toMatchObject({ formatVersion: 2, content: { kind: 'supplied', step: { role: 'callable' } } });
    expect(run(accepted()).status).toBe('succeeded');
  });
});

/** Compatibility and argument honesty use the existing source/memo provenance and recipe boundaries. */
describe('source-call candidate and argument boundaries', () => {
  test('explicit source retention keeps its exact reference while recording a current source check', () => {
    const first = run();
    const original = exact('detail:repo#101');
    const retained = run({ ...createWorld(), retain: true });
    expect(retained.status).toBe('succeeded');
    expect(retained.trace.filter(event => event.startsWith('detail:'))).toHaveLength(3);
    expect(retained.trace.filter(event => event.startsWith('finality:'))).toHaveLength(3);
    expect(references(retained)).toEqual(references(first));
    expect(exact('detail:repo#101')).toEqual(original);
  });

  test('memo provenance at the current source subject is rejected before finality receives previous data', () => {
    run();
    const mismatched = run(accepted(), { sourceSubject: 'assessment' });
    expect(mismatched.status).toBe('succeeded');
    expect(mismatched.trace.filter(event => event.startsWith('detail:'))).toHaveLength(3);
    expect(mismatched.trace.filter(event => event.startsWith('detail:')).every(event => event.endsWith('previous=false'))).toBe(true);
    expect(mismatched.trace.filter(event => event.startsWith('finality:'))).toEqual([]);
  });

  test('another callable slot with equal subject text rejects stored slot correspondence before finality', () => {
    run();
    const mismatched = run(accepted(), { sourceSlot: 'replacement-detail' });
    expect(mismatched.status).toBe('succeeded');
    expect(mismatched.trace.filter(event => event.startsWith('detail:'))).toHaveLength(3);
    expect(mismatched.trace.filter(event => event.startsWith('detail:')).every(event => event.endsWith('previous=false'))).toBe(true);
    expect(mismatched.trace.filter(event => event.startsWith('finality:'))).toEqual([]);
  });

  test.each(['untracked', 'opaque'] as const)('%s argument recipes cause an honest parent miss while accepted source calls remain reusable', argumentMode => {
    const first = run(createWorld(), { argumentMode });
    expect(first.status).toBe('succeeded');
    const restarted = run(accepted(), { argumentMode });
    expect(restarted.status).toBe('succeeded');
    expect(restarted.trace.filter(event => event.startsWith('detail:'))).toEqual([]);
    expect(restarted.trace.filter(event => event.startsWith('finality:'))).toHaveLength(3);
    expect(restarted.trace.filter(event => event.startsWith('summary:')).sort()).toEqual(['summary:ada', 'summary:grace']);
    expect(references(restarted).ada).not.toBe(references(first).ada);
    expect(references(restarted).grace).not.toBe(references(first).grace);
  });

  test('unconsumed differing source arguments do not automatically invalidate an eligible source candidate', () => {
    const initial = createWorld();
    const shared = { ...initial, searches: { ada: { count: 1, ids: ['repo#101'] }, grace: { count: 1, ids: ['repo#101'] } }, accepts: { 'repo#101': true } };
    run(shared, { consumeArgument: false, selected: [{ key: 'ada', argument: 'A' }, { key: 'grace', argument: 'B' }] });
    const previous = exact('detail:repo#101');
    const restarted = run(shared, { consumeArgument: false, selected: [{ key: 'ada', argument: 'C' }, { key: 'grace', argument: 'D' }] });
    expect(restarted.status).toBe('succeeded');
    expect(restarted.trace.filter(event => event.startsWith('detail:'))).toEqual([]);
    expect(restarted.trace.filter(event => event.startsWith('finality:'))).toHaveLength(2);
    expect(exact('detail:repo#101')).toEqual(previous);
  });
});
