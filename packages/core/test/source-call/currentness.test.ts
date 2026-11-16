/** Source currentness and consumed-output retention are independent decisions (SCD-3/4). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openWorkspace } from 'microdelta';
import type { IFoldReport, IWorkspace } from 'microdelta';
import { composeFixture, createWorld, installWorld, logicalStore } from './fixture.js';
import type { IVariation, IWorld } from './fixture.js';

let directory: string;
let workspace: IWorkspace;
let world: IWorld;
let requests = 0;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'microdelta-source-call-'));
  workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore });
  world = createWorld(); installWorld(world);
});
afterEach(() => { workspace.close(); rmSync(directory, { recursive: true, force: true }); });
/** A distinct Resolution request always reestablishes current source acceptance. */
async function report(variation: IVariation = {}): Promise<IFoldReport> {
  const fixture = composeFixture(variation);
  requests += 1;
  const result = await workspace.run({ authoring: fixture.authoring, composition: fixture.composition, environment: 'production' }, run => run.resolveFold(fixture.report, { requestKey: `source-call:${String(requests)}` }));
  return result.value;
}
/** Exact independent person references are the acceptance boundary. */
function references(result: IFoldReport): Readonly<Record<string, string>> {
  return Object.fromEntries(result.members.flatMap(member => member.status === 'succeeded' ? [[member.key, member.outcome.reference.locator]] : []));
}
/** Count real author/helper calls, separately from finality and retained references. */
function calls(prefix: string): string[] { return world.trace.filter(event => event.startsWith(prefix)); }

describe('completed-search source calls', () => {
  test('cold work completes both people and never starts their details before completed search', async () => {
    const result = await report();
    expect(result.outcome.status).toBe('succeeded');
    expect(Object.keys(references(result)).sort()).toEqual(['ada', 'grace']);
    expect(calls('detail:').length).toBe(3);
    expect(calls('assess:').length).toBe(3);
    expect(calls('summary:').sort()).toEqual(['summary:ada', 'summary:grace']);
    expect(world.trace.indexOf('search-complete:ada')).toBeLessThan(world.trace.findIndex(event => event.startsWith('detail:repo#101:')));
    expect(world.trace.indexOf('search-complete:grace')).toBeLessThan(world.trace.findIndex(event => event.startsWith('detail:repo#201:')));
  });

  test('same ID with changed consumed detail refreshes only affected downstream references', async () => {
    const first = references(await report());
    world = { ...world, details: { ...world.details, 'repo#101': { id: 'repo#101', merged: true, title: '101' } }, trace: [] }; installWorld(world);
    const changed = references(await report());
    expect(calls('detail:').length).toBe(3);
    expect(calls('finality:').length).toBe(3);
    expect(calls('assess:')).toEqual(['assess:repo#101']);
    expect(calls('summary:')).toEqual(['summary:ada']);
    expect(changed.ada).not.toBe(first.ada);
    expect(changed.grace).toBe(first.grace);
  });

  test.each(['equal', 'unconsumed'] as const)('%s full refresh preserves exact assessment and person references', async mode => {
    const first = references(await report());
    world = { ...world, details: { ...world.details, 'repo#101': { id: 'repo#101', merged: false, title: mode === 'equal' ? '101' : 'unconsumed change' } }, trace: [] }; installWorld(world);
    const refreshed = references(await report());
    expect(calls('detail:').length).toBe(3);
    expect(calls('assess:')).toEqual([]);
    expect(calls('summary:')).toEqual([]);
    expect(refreshed).toEqual(first);
  });
});

/** SCD-5 membership and SCD-1 call sharing exercise existing identity semantics. */
describe('source-call membership and sharing', () => {
  test('changed membership aborts the old call prefix before refreshing removed detail', async () => {
    const first = references(await report());
    world = { ...world, searches: { ...world.searches, ada: { count: 2, ids: ['repo#101', 'repo#103'] } }, trace: [] }; installWorld(world);
    const changed = references(await report());
    expect(calls('detail:').map(event => event.split(':')[1]).sort()).toEqual(['repo#101', 'repo#103', 'repo#201']);
    expect(calls('assess:')).toEqual(['assess:repo#103']);
    expect(calls('summary:')).toEqual(['summary:ada']);
    expect(changed.ada).not.toBe(first.ada);
    expect(changed.grace).toBe(first.grace);
  });

  test('certified empty search produces an explicit zero-detail person result', async () => {
    world = { ...world, searches: { ...world.searches, ada: { count: 0, ids: [] } } }; installWorld(world);
    const result = await report();
    expect(result.outcome.status).toBe('succeeded');
    expect(calls('detail:').map(event => event.split(':')[1])).toEqual(['repo#201']);
    expect(calls('summary:').sort()).toEqual(['summary:ada', 'summary:grace']);
  });

  test('same qualified PR under two people shares equal source and assessment calls within one request', async () => {
    world = { ...world, searches: { ada: { count: 1, ids: ['repo#101'] }, grace: { count: 1, ids: ['repo#101'] } } }; installWorld(world);
    const first = references(await report());
    expect(calls('detail:').length).toBe(1);
    expect(calls('assess:')).toEqual(['assess:repo#101']);
    expect(Object.keys(first).sort()).toEqual(['ada', 'grace']);
    expect(first.ada).not.toBe(first.grace);
    world = { ...world, accepts: { 'repo#101': true }, trace: [] }; installWorld(world);
    expect(references(await report())).toEqual(first);
    expect(calls('detail:')).toEqual([]);
    expect(calls('finality:').length).toBe(1);
  });

  test('differing consumed source arguments do not coalesce or reach finality as compatible history', async () => {
    world = { ...world, searches: { ada: { count: 1, ids: ['repo#101'] }, grace: { count: 1, ids: ['repo#101'] } }, accepts: { 'repo#101': true } }; installWorld(world);
    const variation: IVariation = { selected: [{ key: 'ada', argument: 'A' }, { key: 'grace', argument: 'B' }] };
    const first = references(await report(variation));
    expect(calls('detail:').sort()).toEqual(['detail:repo#101:A:standard:previous=false', 'detail:repo#101:B:standard:previous=false']);
    expect(calls('finality:')).toEqual([]);
    world = { ...world, trace: [] }; installWorld(world);
    expect(references(await report(variation))).toEqual(first);
    expect(calls('detail:')).toEqual([]);
    expect(calls('finality:').length).toBe(2);
  });

  test('changed argument facts invalidate before a true finality hook receives previous data', async () => {
    await report();
    world = { ...world, accepts: { 'repo#101': true, 'repo#102': true, 'repo#201': true }, trace: [] }; installWorld(world);
    await report({ selected: [{ key: 'ada', argument: 'changed' }, { key: 'grace', argument: 'same' }] });
    expect(calls('detail:').sort()).toEqual(['detail:repo#101:changed:standard:previous=false', 'detail:repo#102:changed:standard:previous=false']);
    expect(calls('finality:').map(event => event.split(':')[1])).toEqual(['repo#201']);
  });
});

/** Source acceptance never excuses incompatible implementation or input evidence. */
describe('source-call eligibility before current policy', () => {
  test('changed source implementation cannot be excused by true finality', async () => {
    await report();
    world = { ...world, accepts: { 'repo#101': true, 'repo#102': true, 'repo#201': true }, trace: [] }; installWorld(world);
    await report({ implementation: 'revised' });
    expect(calls('detail:').length).toBe(3);
    expect(calls('detail:').every(event => event.endsWith('previous=false'))).toBe(true);
    expect(calls('finality:')).toEqual([]);
    expect(calls('assess:')).toEqual([]);
    expect(calls('summary:')).toEqual([]);
  });

  test('changed consumed source-policy input is ineligible before finality', async () => {
    await report();
    world = { ...world, accepts: { 'repo#101': true, 'repo#102': true, 'repo#201': true }, trace: [] }; installWorld(world);
    await report({ policy: { binding: 'different', revision: 2 } });
    expect(calls('detail:').length).toBe(3);
    expect(calls('detail:').every(event => event.endsWith('previous=false'))).toBe(true);
    expect(calls('finality:')).toEqual([]);
  });

  test('a prior true hook answer cannot bypass current false policy', async () => {
    await report();
    world = { ...world, accepts: { 'repo#101': true, 'repo#102': true, 'repo#201': true }, trace: [] }; installWorld(world);
    await report();
    expect(calls('detail:')).toEqual([]);
    expect(calls('finality:').length).toBe(3);
    world = { ...world, accepts: {}, trace: [] }; installWorld(world);
    await report({ policy: { binding: 'standard', revision: 2 } });
    expect(calls('detail:').length).toBe(3);
    expect(calls('detail:').every(event => event.endsWith('previous=true'))).toBe(true);
    expect(calls('finality:').every(event => event.includes(':2:'))).toBe(true);
  });

  test('a changed prompt reruns assessments despite currently accepted detail', async () => {
    const first = references(await report());
    world = { ...world, accepts: { 'repo#101': true, 'repo#102': true, 'repo#201': true }, trace: [] }; installWorld(world);
    const changed = references(await report({ prompt: { text: 'changed', weight: 2 } }));
    expect(calls('detail:')).toEqual([]);
    expect(calls('assess:').length).toBe(3);
    expect(calls('summary:').length).toBe(2);
    expect(changed.ada).not.toBe(first.ada);
    expect(changed.grace).not.toBe(first.grace);
  });
});

/** Required failure never turns into an empty or partial successful person. */
describe('source-call strictness', () => {
  test.each(['failed', 'truncated'] as const)('%s search cannot become an empty success and does not block another person', async failure => {
    world = { ...world, searchFailures: { ada: failure } }; installWorld(world);
    const result = await report();
    expect(result.outcome.status).toBe('failed');
    expect(result.members.map(member => [member.key, member.status])).toEqual([['ada', 'failed'], ['grace', 'succeeded']]);
    expect(calls('detail:').map(event => event.split(':')[1])).toEqual(['repo#201']);
    expect(calls('summary:')).toEqual(['summary:grace']);
  });

  test.each([{ count: 2, ids: ['repo#101', 'repo#101'] }, { count: 1, ids: [''] }, { count: 2, ids: ['repo#101'] }])('uncertified population %j rejects before detail admission', async search => {
    world = { ...world, searches: { ...world.searches, ada: search } }; installWorld(world);
    const result = await report();
    expect(result.outcome.status).toBe('failed');
    expect(calls('detail:').map(event => event.split(':')[1])).toEqual(['repo#201']);
  });

  test('required detail failure withholds its person summary while another person settles', async () => {
    world = { ...world, detailFailures: ['repo#101'] }; installWorld(world);
    const result = await report();
    expect(result.outcome.status).toBe('failed');
    expect(result.members.map(member => [member.key, member.status])).toEqual([['ada', 'failed'], ['grace', 'succeeded']]);
    expect(calls('summary:')).toEqual(['summary:grace']);
  });
});
