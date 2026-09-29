/**
 * Keyed member instances through the facade's real workspace path (issue
 * #85): Reuse Resolution resolves discovery under its current source policy,
 * keys the snapshot through Definition before any gate or member body,
 * evaluates each instance's gate in its own tracking frame and resolves each
 * required instance with its member binding; Run Supervision reports each
 * member's typed outcome. Each session is a fresh composition over the same
 * SQLite file, so only durable History survives between sessions. Expected
 * outcomes are derived by hand from the fixture data and the owning
 * contracts; the separate-process evidence is `restart.test.ts`.
 *
 * @see ../../../../docs/spec/composition.md (CMP-4, CMP-8 and the EXP-4 template and strict-fold selections)
 * @see ../../../../docs/spec/tracking.md (COL-1)
 * @see ../../../../docs/spec/operations.md (RUN-005, RUN-010)
 * @see ../../../../docs/plans/m4-composition.md ("Templates, keys and gates")
 * @see ../../../../experiments/exp-4/decision.md
 */
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { ResolutionError, openWorkspace } from '../../src/index.js';
import type { ICheckOutcome, IResolutionOutcome, IWorkspaceRun } from '../../src/index.js';
import { cleanup, freshLocation, openHistory } from '../durable-history/support.js';
import { analysis as keyedAnalysis, composeKeyed, contributors, createWorld, dee, resetWorld, world } from './fixture.js';
import type { IGateFault, IKeyed, IVariation } from './fixture.js';
import { environment, logged, logicalStore, referenceOf, runKeyed } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** Start a fresh helper log, keeping the world's data and policy answers. */
function clearLog(): void {
  world.log = [];
}

/** Run `body` in one workspace run over a freshly composed fixture at `location`. */
async function withRun<T>(location: string, variation: IVariation, body: (run: IWorkspaceRun, keyed: IKeyed) => Promise<T>): Promise<T> {
  const workspace = openWorkspace({ location, logicalStore });
  const keyed = composeKeyed(variation);
  try {
    const result = await workspace.run({ authoring: keyed.builders, composition: keyed.composition, environment }, (run) => body(run, keyed));
    return result.value;
  } finally {
    workspace.close();
  }
}

/** A fresh request key. */
function requestKey(): { readonly requestKey: string } {
  return { requestKey: `keyed-direct:${randomUUID()}` };
}

/** Expect a promise to reject with a ResolutionError of `code`, returning it. */
async function expectResolutionError(action: Promise<unknown>, code: ResolutionError['code']): Promise<ResolutionError> {
  let caught: unknown;
  try {
    await action;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ResolutionError);
  if (!(caught instanceof ResolutionError)) {
    throw new Error('expected a ResolutionError');
  }
  expect(caught.code).toBe(code);
  return caught;
}

/** Stored provenance observations as these tests read them. */
interface IStoredObservation {
  readonly binding: { readonly path: readonly string[] };
  readonly address: readonly { readonly key?: string; readonly index?: number }[];
}

/** One completed result's provenance observations. */
function provenanceObservations(location: string, locator: string): readonly IStoredObservation[] {
  const history = openHistory({ location, store: logicalStore });
  try {
    const content = history.readEnvelope({ kind: 'completed-result', locator }).provenance.content;
    const observations: unknown = typeof content === 'object' && content !== null ? Reflect.get(content, 'observations') : undefined;
    // Resolution's provenance stores its observations as a plain list of this shape.
    return observations as readonly IStoredObservation[];
  } finally {
    history.close();
  }
}

/** The binding roots one completed result's provenance observations use. */
function provenanceRoots(location: string, locator: string): readonly string[] {
  return [...new Set(provenanceObservations(location, locator).map((item) => item.binding.path[0] ?? ''))].sort();
}

/** The member fields one completed result's provenance observed through the member binding. */
function memberFields(location: string, locator: string): readonly string[] {
  return provenanceObservations(location, locator)
    .filter((item) => item.binding.path[0] === 'member')
    .map((item) => item.address.map((segment) => segment.key ?? String(segment.index)).join('.'));
}

/** The exact references published for one scoped subject in this store, latest first. */
function candidatesOf(location: string, subject: string): readonly string[] {
  const history = openHistory({ location, store: logicalStore });
  try {
    return history.findCandidates({ analysis: keyedAnalysis, environment, subject, version: 1 }).map((candidate) => candidate.reference.locator);
  } finally {
    history.close();
  }
}

describe('discovery and keying before any gate or member body (acceptance 1)', () => {
  test('cold: discovery resolves under its source policy and keys every member before any gate or body', async () => {
    const location = freshLocation();
    const report = await runKeyed(location, {});
    expect(report.factoryCalls).toBe(1);
    expect(report.discovery).toEqual({ kind: 'keyed', completion: 'complete', keys: ['person:ada', 'person:ben', 'person:cy'], reference: expect.any(String) });
    // Discovery ran and was keyed first; each member's gate precedes that member's own work.
    expect(report.log[0]).toBe('discover');
    for (const login of ['ada', 'ben', 'cy']) {
      const gate = report.log.indexOf(`gate:${login}`);
      expect(gate).toBeGreaterThan(0);
      expect(gate).toBeLessThan(report.log.indexOf(`describe:${login}`));
      expect(gate).toBeLessThan(report.log.indexOf(`summary:@${login}`));
    }
    // Every lifecycle event of the collection step precedes every instance event.
    const lastCollection = report.events.map((event) => event.startsWith('contributors/')).lastIndexOf(true);
    const firstInstance = report.events.findIndex((event) => !event.startsWith('contributors/'));
    expect(lastCollection).toBeLessThan(firstInstance);
    for (const key of ['person:ada', 'person:ben', 'person:cy']) {
      expect(report.members[key]).toMatchObject({ status: 'succeeded', kind: 'published', gate: { selected: 'required' } });
    }
  });

  test('a current source policy that requires a check reruns discovery only; finality acceptance runs no discovery body', async () => {
    const location = freshLocation();
    const cold = await runKeyed(location, {});
    clearLog();
    const accepted = await runKeyed(location, { order: 'reversed' });
    expect(accepted.log.filter((entry) => entry === 'discover')).toEqual([]);
    clearLog();
    world.discoveryFinal = false;
    const checked = await runKeyed(location, { order: 'reversed' });
    expect(checked.log.filter((entry) => entry === 'discover')).toHaveLength(1);
    for (const report of [accepted, checked]) {
      expect(logged(report, 'summary')).toEqual([]);
      for (const key of ['person:ada', 'person:ben', 'person:cy']) {
        expect(referenceOf(report, key)).toBe(referenceOf(cold, key));
      }
    }
  });

  test('refused discovery work is a typed pending discovery with no member outcomes and no gate', async () => {
    const location = freshLocation();
    const workspace = openWorkspace({ location, logicalStore });
    const keyed = composeKeyed();
    try {
      const result = await workspace.run({
        authoring: keyed.builders,
        composition: keyed.composition,
        environment,
        admission: { admit: () => ({ kind: 'denied', reason: 'discovery quota exhausted' }) },
      }, (run) => run.resolveMembers({ template: 'contributor', step: 'summary' }, requestKey()));
      expect(result.value.discovery).toEqual({ kind: 'pending', collection: keyed.collection, refused: keyed.collection, reason: 'discovery quota exhausted' });
      expect(result.value.members).toEqual([]);
      expect(world.log).toEqual([]);
    } finally {
      workspace.close();
    }
  });

  test('a rejected snapshot surfaces Definition\'s diagnostic and admits no gate or member work', async () => {
    resetWorld(createWorld([...contributors(), { ...dee(), key: 'person:ben' }]));
    const report = await runKeyed(freshLocation(), {});
    expect(report.discovery).toMatchObject({ kind: 'rejected', reason: 'duplicate-key', key: 'person:ben', collection: 'contributors', template: 'contributor', customKey: false });
    expect(report.members).toEqual({});
    expect(report.log).toEqual(['discover']);
    expect(report.admissions).toEqual(['source:contributors:acme/widget:2026-Q1']);
  });
});

describe('tracked gates (acceptance 2)', () => {
  test('an explicit false skips the member: it carries gate evidence, no result, and no work is admitted for it', async () => {
    const report = await runKeyed(freshLocation(), { minimumAuthored: 2 });
    expect(report.members['person:cy']).toEqual({ status: 'skipped', gate: { selected: 'skipped', bindings: ['callable', 'inputs', 'member', 'self'] } });
    expect(report.members['person:ada']).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(report.members['person:ben']).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(logged(report, 'describe')).not.toContain('cy');
    expect(report.admissions.filter((entry) => entry.endsWith('person:cy'))).toEqual([]);
  });

  test.each(['number', 'undefined', 'throws'] satisfies readonly IGateFault[])('a gate that %s fails only that member; it is never skipped', async (fault) => {
    world.gateFaults = { ben: fault };
    const report = await runKeyed(freshLocation(), {});
    expect(report.members['person:ben']).toMatchObject({ status: 'failed', code: 'gate-failure' });
    expect(report.members['person:ben']?.message).toMatch(fault === 'throws' ? /threw/u : new RegExp(`returned ${fault}`, 'u'));
    if (fault === 'throws') {
      expect(report.members['person:ben']?.cause).toBe('Error: gate lookup failed for ben');
    }
    expect(report.members['person:ada']).toMatchObject({ status: 'succeeded' });
    expect(report.members['person:cy']).toMatchObject({ status: 'succeeded' });
    expect(logged(report, 'describe')).not.toContain('ben');
    expect(report.admissions.filter((entry) => entry.endsWith('person:ben'))).toEqual([]);
  });

  test('each gate runs in its own frame: its reads are the member\'s gate evidence and never enter a step\'s provenance', async () => {
    const location = freshLocation();
    const report = await runKeyed(location, {});
    expect(report.members['person:ada']?.gate).toEqual({ selected: 'required', bindings: ['callable', 'inputs', 'member', 'self'] });
    // The summary recorded only its own reads: its calls, implementation, helper and the one member field it read itself.
    // The gate's input and its `login` read stay with the gate.
    expect(provenanceRoots(location, referenceOf(report, 'person:ada'))).toEqual(['call', 'callable', 'member', 'self']);
    expect(memberFields(location, referenceOf(report, 'person:ada'))).toEqual(['authored']);
  });
});

describe('promise gates (CMP-8)', () => {
  test.each(['promise', 'thenable'] satisfies readonly IGateFault[])('a gate that returns a %s fails only that member: it returned a promise, not a boolean', async (fault) => {
    world.gateFaults = { ben: fault };
    const report = await runKeyed(freshLocation(), {});
    expect(report.members['person:ben']).toMatchObject({ status: 'failed', code: 'gate-failure' });
    expect(report.members['person:ben']?.message).toMatch(/returned a promise, not a boolean/u);
    expect(report.members['person:ada']).toMatchObject({ status: 'succeeded' });
    expect(report.members['person:cy']).toMatchObject({ status: 'succeeded' });
    expect(report.admissions.filter((entry) => entry.endsWith('person:ben'))).toEqual([]);
  });
});

describe('refusal dispositions (CMP-8, RUN-010)', () => {
  test.each([
    ['the activity denied, the description cancelled', { 'activity/person:ada': 'denied', 'describer/': 'cancelled' }],
    ['the activity cancelled, the description denied', { 'activity/person:ada': 'cancelled', 'describer/': 'denied' }],
  ] as const)('a cancelled child dominates a denied one, whichever is refused first (%s)', async (_label, decisions) => {
    resetWorld(createWorld(contributors().filter((member) => member.key === 'person:ada')));
    world.stepDecisions = { ...decisions };
    const report = await runKeyed(freshLocation(), { concurrentCalls: true });
    expect(report.members['person:ada']).toMatchObject({ status: 'cancelled', reason: expect.stringMatching(/^cancelled by the fixture policy/u) });
    expect(logged(report, 'summary')).toEqual([]);
  });
});

describe('run-level failures (members request)', () => {
  test('an admission port that fails for one member fails the whole request; it is never one member\'s outcome', async () => {
    world.decisions = { 'person:ben': 'throws' };
    let caught: unknown;
    try {
      await runKeyed(freshLocation(), {});
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ResolutionError);
    expect(caught instanceof ResolutionError ? caught.code : undefined).toBe('admission-failure');
    expect(caught instanceof ResolutionError ? caught.message : '').toMatch(/person:ben/u);
  });
});

describe('typed member outcomes (acceptance 3, RUN-005)', () => {
  test('with discovery open, a member whose evidence is ready completes and publishes while siblings fail, wait or are cancelled', async () => {
    const location = freshLocation();
    resetWorld(createWorld([...contributors(), dee()], 'open'));
    world.failDescribe = ['cy'];
    world.decisions = { 'person:ben': 'denied', 'person:dee': 'cancelled' };
    const mixed = await runKeyed(location, {});
    expect(mixed.discovery).toMatchObject({ kind: 'keyed', completion: 'open', keys: ['person:ada', 'person:ben', 'person:cy', 'person:dee'] });
    expect(mixed.members['person:ada']).toMatchObject({ status: 'succeeded', kind: 'published' });
    expect(mixed.members['person:ben']).toMatchObject({ status: 'pending', refused: 'summary/person:ben', reason: 'denied by the fixture policy for person:ben' });
    expect(mixed.members['person:cy']).toMatchObject({ status: 'failed', code: 'execution-failure' });
    expect(mixed.members['person:dee']).toMatchObject({ status: 'cancelled', refused: 'summary/person:dee', reason: 'cancelled by the fixture policy for person:dee' });
    expect(logged(mixed, 'summary')).toEqual(['@ada']);
    // The published member result is an exact, readable completed result.
    const history = openHistory({ location, store: logicalStore });
    expect(history.reader.readSubtree({ kind: 'completed-result', locator: referenceOf(mixed, 'person:ada') }, [])).toEqual({ window: '2026-Q1', label: '@ada', authored: 3 });
    history.close();

    // Once admitted and repaired with discovery closed, only the unfinished members run.
    resetWorld(createWorld([...contributors(), dee()], 'complete'));
    world.discoveryFinal = false;
    const repaired = await runKeyed(location, { order: 'reversed' });
    expect(repaired.members['person:ada']).toMatchObject({ status: 'succeeded', kind: 'reused', reference: referenceOf(mixed, 'person:ada') });
    expect([...logged(repaired, 'summary')].sort()).toEqual(['@ben', '@cy', '@dee']);
    for (const key of ['person:ben', 'person:cy', 'person:dee']) {
      expect(repaired.members[key]).toMatchObject({ status: 'succeeded', kind: 'published' });
    }
  });
});

describe('member binding of member steps', () => {
  test('a member source reads its member\'s key to select that member\'s activity, as its own provenance', async () => {
    const location = freshLocation();
    await runKeyed(location, {});
    const history = openHistory({ location, store: logicalStore });
    const owners: Record<string, unknown> = {};
    const activities: Record<string, string> = {};
    try {
      for (const key of ['person:ada', 'person:ben', 'person:cy']) {
        const [locator] = history.findCandidates({ analysis: keyedAnalysis, environment, subject: `activity:acme/widget:2026-Q1:${key}`, version: 1 }).map((candidate) => candidate.reference.locator);
        if (locator === undefined) {
          throw new Error(`no activity for ${key}`);
        }
        activities[key] = locator;
        owners[key] = history.reader.readSubtree({ kind: 'completed-result', locator }, []);
      }
    } finally {
      history.close();
    }
    expect(owners).toEqual({
      'person:ada': { window: '2026-Q1', owner: 'person:ada' },
      'person:ben': { window: '2026-Q1', owner: 'person:ben' },
      'person:cy': { window: '2026-Q1', owner: 'person:cy' },
    });
    expect(memberFields(location, activities['person:ada'] ?? '')).toEqual(['key']);
  });

  test('a member removed from the current snapshot is an unbound instance in a later process, never a stale reuse', async () => {
    const location = freshLocation();
    const cold = await runKeyed(location, {});
    resetWorld(createWorld(contributors().filter((member) => member.key !== 'person:cy')));
    world.discoveryFinal = false;
    await withRun(location, { order: 'reversed' }, async (run, keyed) => {
      await expectResolutionError(run.resolve(keyed.instance('summary', 'person:cy'), requestKey()), 'unbound-step');
      await expectResolutionError(run.resolve(keyed.instance('activity', 'person:cy'), requestKey()), 'unbound-step');
    });
    expect(logged(world, 'summary')).toEqual([]);
    expect(logged(world, 'activity')).toEqual([]);
    // Its earlier publication is neither reused nor retracted.
    expect(candidatesOf(location, 'summary:acme/widget:2026-Q1:person:cy')).toEqual([referenceOf(cold, 'person:cy')]);
  });
});

describe('direct template instance requests', () => {
  test('resolve and check of one instance go through discovery, keying and its gate', async () => {
    const location = freshLocation();
    const outcomes = await withRun(location, {}, async (run, keyed) => ({
      ada: await run.resolve(keyed.instance('summary', 'person:ada'), requestKey()),
      activity: await run.check(keyed.instance('activity', 'person:ada')),
    }));
    expect(outcomes.ada).toMatchObject({ kind: 'published', step: { template: 'contributor', collection: 'contributors', memberKey: 'person:ada', slot: 'summary' } });
    expect(outcomes.activity).toMatchObject({ kind: 'reusable' });
    expect(logged(world, 'summary')).toEqual(['@ada']);

    const skipped = await withRun(location, { minimumAuthored: 2 }, async (run, keyed) => {
      const resolved: IResolutionOutcome = await run.resolve(keyed.instance('summary', 'person:cy'), requestKey());
      const checked: ICheckOutcome = await run.check(keyed.instance('summary', 'person:cy'));
      return { resolved, checked };
    });
    expect(skipped.resolved).toMatchObject({ kind: 'skipped', misses: [], trace: [], gate: { selected: 'skipped' } });
    expect(skipped.checked).toMatchObject({ kind: 'skipped', gate: { selected: 'skipped' } });
    expect(logged(world, 'describe')).toEqual(['ada']);
  });

  test('an instance outside the current collection, a failed gate and a rejected snapshot are distinct typed failures', async () => {
    const location = freshLocation();
    await withRun(location, {}, async (run, keyed) => {
      await expectResolutionError(run.resolve(keyed.instance('summary', 'person:zed'), requestKey()), 'unbound-step');
      world.gateFaults = { ada: 'number' };
      await expectResolutionError(run.resolve(keyed.instance('summary', 'person:ada'), requestKey()), 'gate-failure');
      world.discoveryFinal = false;
      world.roster = { members: [...contributors(), { ...dee(), key: 'person:ada' }], status: 'complete' };
      const rejected = await expectResolutionError(run.resolve(keyed.instance('summary', 'person:ben'), requestKey()), 'collection-rejected');
      expect(rejected.message).toMatch(/duplicate member key "person:ada".*`key` option/u);
    });
    expect(logged(world, 'summary')).toEqual([]);
  });
});
