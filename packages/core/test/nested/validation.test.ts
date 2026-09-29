/**
 * Nested memo validation through Reuse Resolution over real durable History
 * (issue #84). Each session is a fresh composition, Tracking observer and
 * Resolution over the same SQLite file, so only durable History survives
 * between them. Expected outcomes come from the owning contracts, derived by
 * hand from the fixture data:
 *
 * - Provenance v2 records ordered calls: each with its version-2 witness, the
 *   exact child result and a `call` binding for the consumed output facts.
 *   M3-shaped parents keep provenance v1 with its M3 meaning.
 * - Validation checks the parent's own evidence first, then each call in
 *   recorded order: reconnect the witness, rebuild forwarded arguments from
 *   current bindings or the current output of an earlier call, accept derived
 *   values only when recorded as justified, obtain the current child result
 *   under normal admission and compare only the facts consumed from it.
 * - A child executed during validation is reused when the parent executes; no
 *   child runs twice in one resolution; the parent body never runs as validation.
 * - Changed evidence, changed child output, missing and ambiguous bindings,
 *   unreconstructible and unjustified arguments and unsupported evidence are
 *   distinct misses with distinct diagnostics.
 *
 * @see ../../../../docs/spec/composition.md (CMP-5, CMP-6, CMP-7 and the EXP-4 argument recipe)
 * @see ../../../../docs/spec/execution.md (REUSE-005, REUSE-006, REUSE-007, transition table)
 * @see ../../../../docs/spec/artifacts/reuse-cases.json (F-04, F-05)
 * @see ../../../../docs/plans/m4-composition.md ("Nested invocation evidence", planned evidence names)
 * @see ../../../../experiments/exp-4/decision.md
 */
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import type { ICompletedResultReference } from '@microdelta/history';
import { ResolutionError } from '@microdelta/resolution';
import type { ICandidateMiss, ILifecycleEvent, IResolutionOutcome } from '@microdelta/resolution';
import { encodeSnapshot } from '@microdelta/value';

import { cleanup, freshLocation } from '../durable-history/support.js';
import { adaActivity, analysis, assessmentSubject, assessorSlot, defaultRubric, resetWorld, world } from './fixture.js';
import type { IMemberKey, IVariation } from './fixture.js';
import { assessmentVersioned, payloadOf, referenceOf, resolveSummaries, withNestedSession } from './support.js';
import type { INestedSession } from './support.js';

beforeEach(() => {
  resetWorld();
});
afterEach(cleanup);

/** Stored provenance content as the tests inspect it; History keeps it as opaque decoded data. */
interface IStoredCall {
  readonly index: number;
  readonly witness: {
    readonly version: number;
    readonly parent: Record<string, string>;
    readonly child: Record<string, string>;
    readonly index: number;
    readonly arguments: unknown;
  };
  readonly reference: ICompletedResultReference;
  readonly binding: { readonly path: readonly string[] };
}

/** A stored observation, as far as these tests read it. */
interface IStoredObservation {
  readonly binding: { readonly path: readonly string[] };
  readonly kind: string;
  readonly address: readonly { readonly kind: string; readonly key?: string; readonly index?: number }[];
}

/** Read one result's provenance record. */
function provenanceOf(session: INestedSession, locator: string): { readonly format: string; readonly formatVersion: number; readonly content: Record<string, unknown> } {
  const envelope = session.history.readEnvelope({ kind: 'completed-result', locator });
  return { format: envelope.provenance.format, formatVersion: envelope.provenance.formatVersion, content: envelope.provenance.content as Record<string, unknown> };
}

/** The ordered calls a version-2 memo provenance records. */
function callsOf(session: INestedSession, locator: string): readonly IStoredCall[] {
  return provenanceOf(session, locator).content['calls'] as readonly IStoredCall[];
}

/** The observations a provenance records. */
function observationsOf(session: INestedSession, locator: string): readonly IStoredObservation[] {
  return provenanceOf(session, locator).content['observations'] as readonly IStoredObservation[];
}

/** Every lifecycle event of one member's summary step, as phases. */
function summaryPhases(session: INestedSession, key: IMemberKey): string[] {
  return session.events.filter((event) => event.step.memberKey === key && event.step.slot === 'summary').map((event) => event.phase);
}

/** Position of the first event matching `predicate`, or -1. */
function firstIndex(events: readonly ILifecycleEvent[], predicate: (event: ILifecycleEvent) => boolean): number {
  return events.findIndex(predicate);
}

/** Whether an event belongs to the supplied assessor slot. */
function isAssessor(event: ILifecycleEvent): boolean {
  return event.step.role === 'callable' && event.step.slot === 'assessor';
}

/** Whether an event is `phase` of one member's step `slot`. */
function isStep(key: IMemberKey, slot: string, phase: ILifecycleEvent['phase']): (event: ILifecycleEvent) => boolean {
  return (event) => event.step.memberKey === key && event.step.slot === slot && event.phase === phase;
}

/** Cold run: publish both summaries and every child once; return the exact references. */
async function coldRun(location: string, variation: IVariation = {}): Promise<Record<IMemberKey, string>> {
  return withNestedSession(location, variation, async (session) => {
    const outcomes = await resolveSummaries(session, variation);
    expect(outcomes['person:ada'].kind).toBe('published');
    expect(outcomes['person:ben'].kind).toBe('published');
    return { 'person:ada': referenceOf(outcomes['person:ada']), 'person:ben': referenceOf(outcomes['person:ben']) };
  });
}

/** Zero every invocation count, keeping remote data and finality answers. */
function resetCounts(): void {
  world.checks = { 'person:ada': 0, 'person:ben': 0 };
  world.initials = { 'person:ada': 0, 'person:ben': 0 };
  world.summaries = { 'person:ada': 0, 'person:ben': 0 };
  world.assessments = {};
}

/** Expect a promise to reject with a ResolutionError of `code`. */
async function expectFailure(promise: Promise<unknown>, code: ResolutionError['code']): Promise<ResolutionError> {
  let caught: unknown;
  try {
    await promise;
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

/** The reasons of an outcome's misses, in order. */
function reasons(outcome: IResolutionOutcome): ICandidateMiss['reason'][] {
  return outcome.misses.map((item) => item.reason);
}

/** The structured address of a PR within the activity result. */
function pullRequestAddress(index: number): readonly unknown[] {
  return [{ kind: 'property', key: 'pullRequests' }, { kind: 'index', index }];
}

describe('provenance v2 and cold execution', () => {
  test('a cold run records ordered calls with v2 witnesses, argument recipes, exact child references and per-call consumed facts', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    expect(world.summaries).toEqual({ 'person:ada': 1, 'person:ben': 1 });
    expect(world.initials).toEqual({ 'person:ada': 1, 'person:ben': 1 });
    expect(world.assessments).toEqual({ 101: 1, 102: 1, 103: 1, 201: 1, 202: 1 });
    await withNestedSession(location, {}, async (session) => {
      // Hand-derived: Ada 2 + 2 + 1 over three PRs; Ben 2 + 1 over two.
      expect(payloadOf(session.history, cold['person:ada'])).toEqual({ initial: 'A', total: 5, assessed: 3 });
      expect(payloadOf(session.history, cold['person:ben'])).toEqual({ initial: 'B', total: 3, assessed: 2 });
      const provenance = provenanceOf(session, cold['person:ada']);
      expect(provenance.format).toBe('microdelta.resolution.provenance');
      expect(provenance.formatVersion).toBe(2);
      expect(provenance.content['kind']).toBe('memo');
      const calls = callsOf(session, cold['person:ada']);
      const parent = { scope: analysis, role: 'step', slot: 'summary', memberKey: 'person:ada' };
      expect(calls.map((call) => [call.index, call.witness.version, call.witness.index, call.witness.child['slot'], call.binding.path])).toEqual([
        [0, 2, 0, 'activity', ['call', '0']],
        [1, 2, 1, 'initial', ['call', '1']],
        [2, 2, 2, 'assessor', ['call', '2']],
        [3, 2, 3, 'assessor', ['call', '3']],
        [4, 2, 4, 'assessor', ['call', '4']],
      ]);
      expect(calls[0]?.witness.parent).toEqual(parent);
      expect(calls[0]?.witness.arguments).toEqual({ form: 'empty' });
      expect(calls[2]?.witness.child).toEqual({ scope: analysis, role: 'callable', slot: 'assessor' });
      // CMP-7: a derived scalar (justified: no untracked read preceded it) and a forwarded origin in call 0's output.
      expect(calls[2]?.witness.arguments).toEqual([
        { form: 'derived', value: encodeSnapshot(101), justified: true },
        { form: 'forwarded', origin: { binding: 'child', call: 0, path: pullRequestAddress(0) }, justified: true },
      ]);
      expect(calls[4]?.witness.arguments).toEqual([
        { form: 'derived', value: encodeSnapshot(103), justified: true },
        { form: 'forwarded', origin: { binding: 'child', call: 0, path: pullRequestAddress(2) }, justified: true },
      ]);
      // Every recorded call's exact result is an exact dependency, in call order.
      const envelope = session.history.readEnvelope({ kind: 'completed-result', locator: cold['person:ada'] });
      expect(envelope.dependencies.map((item) => item.locator)).toEqual(calls.map((call) => call.reference.locator));
      // Consumed child facts are bound per call index; the child's own reads never enter the parent.
      const observations = observationsOf(session, cold['person:ada']);
      const scoreReads = observations.filter((item) => item.binding.path[0] === 'call' && item.address.at(-1)?.key === 'score');
      expect(scoreReads.map((item) => item.binding.path)).toEqual([['call', '2'], ['call', '3'], ['call', '4']]);
      expect(observations.some((item) => item.address.some((segment) => segment.key === 'title' || segment.key === 'explanation'))).toBe(false);
      expect(observations.some((item) => item.binding.path[0] === 'child' || item.binding.path[0] === 'argument')).toBe(false);
    });
  });

  test('an M3-shaped parent keeps provenance v1, and a supplied child records v2 with argument observations under its slot subject', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    await withNestedSession(location, {}, async (session) => {
      const calls = callsOf(session, cold['person:ada']);
      const initial = provenanceOf(session, calls[1]?.reference.locator ?? '');
      expect(initial.formatVersion).toBe(1);
      expect(initial.content['children']).toEqual([expect.objectContaining({ slot: 'activity', witness: expect.objectContaining({ version: 1 }) })]);
      // The child history subject comes from the slot's subject function over the derived PR number.
      const [assessment] = session.history.findCandidates(assessmentVersioned(assessmentSubject(101)));
      expect(assessment?.reference.locator).toBe(calls[2]?.reference.locator);
      const supplied = provenanceOf(session, calls[2]?.reference.locator ?? '');
      expect(supplied.formatVersion).toBe(2);
      expect(supplied.content['kind']).toBe('supplied');
      expect(supplied.content['step']).toEqual({ scope: analysis, role: 'callable', slot: 'assessor' });
      expect(supplied.content['calls']).toEqual([]);
      // Forwarded (and derived) arguments are observed by the child under the `argument` binding.
      const argumentReads = observationsOf(session, calls[2]?.reference.locator ?? '').filter((item) => item.binding.path[0] === 'argument');
      expect(argumentReads.map((item) => item.address)).toEqual(expect.arrayContaining([
        [{ kind: 'index', index: 0 }],
        [{ kind: 'index', index: 1 }, { kind: 'property', key: 'merged' }],
        [{ kind: 'index', index: 1 }, { kind: 'property', key: 'title' }],
      ]));
      expect(argumentReads.every((item) => item.binding.path.length === 1)).toBe(true);
    });
  });

  test('an unchanged restart with reversed registration reuses every exact reference and runs no body', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    resetCounts();
    await withNestedSession(location, { order: 'reversed' }, async (session) => {
      const outcomes = await resolveSummaries(session, { order: 'reversed' });
      for (const key of ['person:ada', 'person:ben'] as const) {
        expect(outcomes[key]).toMatchObject({ kind: 'reused', basis: 'validated', misses: [] });
        expect(referenceOf(outcomes[key])).toBe(cold[key]);
      }
      expect(session.admissions).toEqual([]);
      // Current acceptance names each current call result by index; provenance keeps the historical ones.
      const adaOutcome = outcomes['person:ada'];
      if (adaOutcome.kind !== 'reused') {
        throw new Error('expected reuse');
      }
      expect(adaOutcome.acceptance.evidence.formatVersion).toBe(2);
      const accepted = (adaOutcome.acceptance.evidence.content as { readonly calls: readonly { readonly index: number; readonly reference: ICompletedResultReference }[] }).calls;
      expect(accepted.map((call) => call.index)).toEqual([0, 1, 2, 3, 4]);
      expect(accepted.map((call) => call.reference.locator)).toEqual(callsOf(session, cold['person:ada']).map((call) => call.reference.locator));
    });
    expect(world).toMatchObject({ checks: { 'person:ada': 0, 'person:ben': 0 }, initials: { 'person:ada': 0, 'person:ben': 0 }, summaries: { 'person:ada': 0, 'person:ben': 0 }, assessments: {} });
  });
});

describe('validation order', () => {
  test('own evidence is checked first: a changed own fact misses before any child is resolved', async () => {
    const location = freshLocation();
    await coldRun(location);
    resetCounts();
    const variation: IVariation = { summarizer: 'revised', rubricInput: { ...defaultRubric, mergedWeight: 3 } };
    await withNestedSession(location, variation, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(reasons(outcome)).toEqual(['changed']);
      expect(outcome.misses[0]?.observation?.binding.path).toEqual(['callable', 'summarize']);
      // Nothing beneath the parent was touched before the parent was admitted to execute.
      const admitted = firstIndex(session.events, isStep('person:ada', 'summary', 'admit'));
      expect(admitted).toBeGreaterThan(-1);
      expect(session.events.slice(0, admitted).every((event) => event.step.slot === 'summary')).toBe(true);
      expect(summaryPhases(session, 'person:ada').slice(0, 2)).toEqual(['verify', 'admit']);
    });
    // The re-executed parent still reuses children whose own evidence is valid (PR 103 reads only the open weight).
    expect(world.assessments).toEqual({ 101: 1, 102: 1 });
    expect(world.summaries['person:ada']).toBe(1);
  });

  test('calls are validated in recorded order; the first changed consumed output is reported and later calls are not reached', async () => {
    const location = freshLocation();
    await coldRun(location);
    resetCounts();
    // F-05 shape: the merged weight changes a consumed score of calls 2 and 3; call 4 (open PR) is unaffected.
    const variation: IVariation = { rubricInput: { ...defaultRubric, mergedWeight: 3 } };
    await withNestedSession(location, variation, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(reasons(outcome)).toEqual(['changed-child-output']);
      expect(outcome.misses[0]?.observation?.binding.path).toEqual(['call', '2']);
      const execute = firstIndex(session.events, isStep('person:ada', 'summary', 'execute'));
      const before = session.events.slice(0, execute);
      // Calls 0 and 1 were revalidated before call 2, and only call 2's child ran during validation.
      expect(firstIndex(before, isStep('person:ada', 'activity', 'verify'))).toBeLessThan(firstIndex(before, isStep('person:ada', 'initial', 'verify')));
      expect(firstIndex(before, isStep('person:ada', 'initial', 'verify'))).toBeLessThan(firstIndex(before, isAssessor));
      expect(before.filter((event) => isAssessor(event) && event.phase === 'execute')).toHaveLength(1);
      // No duplicate work: the parent's execution reused call 2's result, ran 102, and reused 103.
      expect(session.events.filter((event) => isAssessor(event) && event.phase === 'execute')).toHaveLength(2);
      expect(payloadOf(session.history, referenceOf(outcome))).toEqual({ initial: 'A', total: 7, assessed: 3 });
    });
    expect(world.assessments).toEqual({ 101: 1, 102: 1 });
    expect(world.summaries['person:ada']).toBe(1);
    expect(world.initials['person:ada']).toBe(0);
  });

  test('forwarded arguments are rebuilt from the current output of an earlier call, never from stored values', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    resetCounts();
    // A new activity result whose PR 103 title changed: unread by the summary, read by the assessor.
    world.final['person:ada'] = false;
    world.remote['person:ada'] = adaActivity({ title103: 'Refactor parser' });
    await withNestedSession(location, {}, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome).toMatchObject({ kind: 'reused', basis: 'validated', misses: [] });
      expect(referenceOf(outcome)).toBe(cold['person:ada']);
      if (outcome.kind !== 'reused') {
        throw new Error('expected reuse');
      }
      const accepted = (outcome.acceptance.evidence.content as { readonly calls: readonly { readonly reference: ICompletedResultReference }[] }).calls;
      const historical = callsOf(session, cold['person:ada']);
      // The current activity and PR 103 assessment are new results; the others are the historical ones.
      expect(accepted[0]?.reference.locator).not.toBe(historical[0]?.reference.locator);
      expect(accepted[4]?.reference.locator).not.toBe(historical[4]?.reference.locator);
      expect(accepted.slice(1, 4).map((call) => call.reference.locator)).toEqual(historical.slice(1, 4).map((call) => call.reference.locator));
    });
    expect(world.checks['person:ada']).toBe(1);
    expect(world.assessments).toEqual({ 103: 1 });
    expect(world.summaries['person:ada']).toBe(0);
  });

  test('a forwarded origin whose current output changes a consumed score makes the parent rerun', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    resetCounts();
    world.final['person:ada'] = false;
    world.remote['person:ada'] = adaActivity({ merged103: true });
    await withNestedSession(location, {}, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(reasons(outcome)).toEqual(['changed-child-output']);
      expect(outcome.misses[0]?.observation?.binding.path).toEqual(['call', '4']);
      expect(referenceOf(outcome)).not.toBe(cold['person:ada']);
      expect(payloadOf(session.history, referenceOf(outcome))).toEqual({ initial: 'A', total: 6, assessed: 3 });
    });
    expect(world.assessments).toEqual({ 103: 1 });
    expect(world.summaries['person:ada']).toBe(1);
  });

  test('a sibling memo child that reruns with equal consumed output leaves the parent exact reference', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    resetCounts();
    world.final['person:ada'] = false;
    world.remote['person:ada'] = adaActivity({ name: 'Adeline' });
    await withNestedSession(location, {}, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(referenceOf(outcome)).toBe(cold['person:ada']);
    });
    expect(world.initials['person:ada']).toBe(1);
    expect(world.summaries['person:ada']).toBe(0);
    expect(world.assessments).toEqual({});
  });

  test('a check-only request stops at a supplied child that needs work, executing nothing', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    resetCounts();
    await withNestedSession(location, {}, async (session) => {
      expect(await session.check(session.nested.steps['person:ada'].summary)).toMatchObject({ kind: 'reusable', basis: 'validated', reference: { locator: cold['person:ada'] } });
    });
    await withNestedSession(location, { rubricInput: { ...defaultRubric, mergedWeight: 3 } }, async (session) => {
      expect(await session.check(session.nested.steps['person:ada'].summary)).toMatchObject({ kind: 'uncertain', boundary: assessorSlot });
      expect(session.admissions).toEqual([]);
    });
    expect(world.assessments).toEqual({});
    expect(world.summaries['person:ada']).toBe(0);
  });
});

describe('equal-output cutoff through a supplied child', () => {
  test('F-04: a changed child input with equal consumed score reruns each child once and keeps both exact summary references', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    resetCounts();
    await withNestedSession(location, { rubricInput: { ...defaultRubric, prompt: 'v2' } }, async (session) => {
      const outcomes = await resolveSummaries(session);
      for (const key of ['person:ada', 'person:ben'] as const) {
        expect(outcomes[key]).toMatchObject({ kind: 'reused', basis: 'validated', misses: [] });
        expect(referenceOf(outcomes[key])).toBe(cold[key]);
      }
      const [latest, previous] = session.history.findCandidates(assessmentVersioned(assessmentSubject(101)));
      expect(latest?.reference.locator).not.toBe(previous?.reference.locator);
      expect(payloadOf(session.history, latest?.reference.locator ?? '')).toEqual({ score: 2, explanation: 'A:v2:Parser fix' });
    });
    expect(world.assessments).toEqual({ 101: 1, 102: 1, 103: 1, 201: 1, 202: 1 });
    expect(world.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
  });

  test('a supplied implementation swap A to B with equal scores behaves like F-04', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    resetCounts();
    await withNestedSession(location, { rubric: 'B', order: 'reversed' }, async (session) => {
      const outcomes = await resolveSummaries(session, { order: 'reversed' });
      for (const key of ['person:ada', 'person:ben'] as const) {
        expect(outcomes[key]).toMatchObject({ kind: 'reused', basis: 'validated', misses: [] });
        expect(referenceOf(outcomes[key])).toBe(cold[key]);
      }
      // The swap is a child implementation change: the historical assessment misses on its own implementation.
      const assessorVerifies = session.events.filter((event) => isAssessor(event) && event.phase === 'execute');
      expect(assessorVerifies).toHaveLength(5);
      const [latest] = session.history.findCandidates(assessmentVersioned(assessmentSubject(102)));
      expect(payloadOf(session.history, latest?.reference.locator ?? '')).toEqual({ score: 2, explanation: 'B:v1:Docs' });
    });
    expect(world.assessments).toEqual({ 101: 1, 102: 1, 103: 1, 201: 1, 202: 1 });
    expect(world.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
  });
});

describe('honest misses', () => {
  test('an argument derived after an observed untracked read is unjustified: the parent reruns while its children reuse', async () => {
    const location = freshLocation();
    const variation: IVariation = { adaSummary: 'untracked' };
    const cold = await coldRun(location, variation);
    await withNestedSession(location, variation, async (session) => {
      const observations = observationsOf(session, cold['person:ada']);
      expect(observations.filter((item) => item.kind === 'untracked-read').map((item) => [item.binding.path, item.address])).toEqual([
        [['inputs'], [{ kind: 'property', key: 'rubric' }, { kind: 'property', key: 'prompt' }]],
      ]);
      const calls = callsOf(session, cold['person:ada']);
      expect(calls[2]?.witness.arguments).toEqual([
        { form: 'derived', value: encodeSnapshot(101), justified: false },
        { form: 'forwarded', origin: { binding: 'child', call: 0, path: pullRequestAddress(0) }, justified: false },
      ]);
      // Ben's summary made no untracked read; its derived arguments stay justified.
      expect(callsOf(session, cold['person:ben'])[2]?.witness.arguments).toEqual([
        { form: 'derived', value: encodeSnapshot(201), justified: true },
        { form: 'forwarded', origin: { binding: 'child', call: 0, path: pullRequestAddress(0) }, justified: true },
      ]);
    });
    resetCounts();
    await withNestedSession(location, variation, async (session) => {
      const outcomes = await resolveSummaries(session);
      expect(outcomes['person:ada'].kind).toBe('published');
      expect(reasons(outcomes['person:ada'])).toEqual(['unjustified-argument']);
      expect(outcomes['person:ben']).toMatchObject({ kind: 'reused', misses: [] });
    });
    expect(world.summaries).toEqual({ 'person:ada': 1, 'person:ben': 0 });
    expect(world.assessments).toEqual({});
  });

  test('an unreconstructible argument is an immediate miss before its child is invoked; the parent reruns and children reuse', async () => {
    const location = freshLocation();
    const variation: IVariation = { adaSummary: 'unreconstructible' };
    const cold = await coldRun(location, variation);
    await withNestedSession(location, variation, async (session) => {
      expect(callsOf(session, cold['person:ada'])[2]?.witness.arguments).toEqual([
        { form: 'derived', value: encodeSnapshot(101), justified: true },
        { form: 'forwarded', origin: { binding: 'child', call: 0, path: pullRequestAddress(0) }, justified: true },
        { form: 'unreconstructible', reason: 'function' },
      ]);
    });
    resetCounts();
    await withNestedSession(location, variation, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(reasons(outcome)).toEqual(['unreconstructible-argument']);
      const execute = firstIndex(session.events, isStep('person:ada', 'summary', 'execute'));
      expect(session.events.slice(0, execute).some(isAssessor)).toBe(false);
    });
    expect(world.summaries['person:ada']).toBe(1);
    expect(world.assessments).toEqual({});
  });

  test.each([
    ['none', 'missing-binding', /assessor has no current implementation/u],
    ['twice', 'ambiguous-binding', /assessor has 2 current implementations/u],
  ] as const)('a supplied slot bound %s on restart is a distinct miss and a distinct failure with no child work at all', async (supplied, reason, diagnostic) => {
    const location = freshLocation();
    await coldRun(location);
    resetCounts();
    // The earlier recorded call (call 0, the activity source) would need a check now; it must not run.
    world.final['person:ada'] = false;
    await withNestedSession(location, { supplied, order: 'reversed' }, async (session) => {
      const checked = await session.check(session.nested.steps['person:ada'].summary);
      expect(checked.kind).toBe('execution-required');
      expect(checked.misses.map((item) => item.reason)).toEqual([reason]);
      const failure = await expectFailure(session.resolve(session.nested.steps['person:ada'].summary), 'unbound-step');
      expect(failure.message).toMatch(diagnostic);
      expect(session.admissions).toEqual([]);
      expect(session.events.filter((event) => event.step.slot !== 'summary')).toEqual([]);
    });
    expect(world.checks).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(world.initials).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(world.summaries).toEqual({ 'person:ada': 0, 'person:ben': 0 });
    expect(world.assessments).toEqual({});
  });

  test('an unsupported recorded witness is found before any child work, even when an earlier call would need work', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    await withNestedSession(location, {}, async (session) => {
      const original = session.history.readEnvelope({ kind: 'completed-result', locator: cold['person:ada'] });
      const content = JSON.parse(JSON.stringify(original.provenance.content)) as { readonly calls: IStoredCall[] } & Record<string, unknown>;
      const crafted = { ...content, calls: content.calls.map((call) => call.index === 3 ? { ...call, witness: { ...call.witness, version: 9 } } : call) };
      const attempt = session.history.allocateAttempt(session.lease, { analysis: original.analysis, environment: original.environment, subject: original.subject, version: original.version, attemptKey: 'crafted-late-witness', intentDigest: 'crafted:late-witness' });
      session.history.stageAttempt(session.lease, { attemptId: attempt.attemptId, payload: payloadOf(session.history, cold['person:ada']), provenance: { format: original.provenance.format, formatVersion: 2, content: crafted }, dependencies: original.dependencies });
      session.history.publishAttempt(session.lease, attempt.attemptId);
    });
    resetCounts();
    world.final['person:ada'] = false;
    await withNestedSession(location, {}, async (session) => {
      const checked = await session.check(session.nested.steps['person:ada'].summary);
      // The crafted candidate misses on its call-3 witness before call 0's source is consulted;
      // the older candidate then reaches the activity source, which needs a check.
      expect(checked.misses.map((item) => item.reason)).toEqual(['unsupported-evidence']);
      expect(checked).toMatchObject({ kind: 'uncertain', boundary: session.nested.steps['person:ada'].activity });
    });
    expect(world.checks['person:ada']).toBe(0);
  });

  test('an M3-shaped (version-1) candidate whose recorded witness is not version 1 is unsupported evidence', async () => {
    const location = freshLocation();
    await coldRun(location);
    const crafted = await withNestedSession(location, {}, async (session) => {
      const [initialCandidate] = session.history.findCandidates({ analysis, environment: 'env:nested', subject: 'initial:acme/widget:person:ada', version: 1 });
      if (initialCandidate === undefined) {
        throw new Error('expected the cold initial result');
      }
      const content = JSON.parse(JSON.stringify(initialCandidate.provenance.content)) as { readonly children: { readonly witness: Record<string, unknown> }[] } & Record<string, unknown>;
      const children = content.children.map((child) => ({ ...child, witness: { ...child.witness, version: 2, index: 0 } }));
      const attempt = session.history.allocateAttempt(session.lease, { analysis: initialCandidate.analysis, environment: initialCandidate.environment, subject: initialCandidate.subject, version: initialCandidate.version, attemptKey: 'crafted-v1-witness', intentDigest: 'crafted:v1-witness' });
      session.history.stageAttempt(session.lease, { attemptId: attempt.attemptId, payload: payloadOf(session.history, initialCandidate.reference.locator), provenance: { format: initialCandidate.provenance.format, formatVersion: 1, content: { ...content, children } }, dependencies: initialCandidate.dependencies });
      return { crafted: session.history.publishAttempt(session.lease, attempt.attemptId).locator, original: initialCandidate.reference.locator };
    });
    resetCounts();
    await withNestedSession(location, {}, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].initial);
      expect(outcome.misses.map((item) => [item.candidate.locator, item.reason])).toEqual([[crafted.crafted, 'unsupported-evidence']]);
      expect(outcome).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(referenceOf(outcome)).toBe(crafted.original);
    });
    expect(world.initials['person:ada']).toBe(0);
  });

  test('an older candidate is validated and reused after a newer candidate misses', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    const newer = await withNestedSession(location, { rubricInput: { ...defaultRubric, mergedWeight: 3 } }, async (session) => referenceOf(await session.resolve(session.nested.steps['person:ada'].summary)));
    expect(newer).not.toBe(cold['person:ada']);
    resetCounts();
    await withNestedSession(location, {}, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome.misses.map((item) => [item.candidate.locator, item.reason])).toEqual([[newer, 'changed-child-output']]);
      expect(outcome).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(referenceOf(outcome)).toBe(cold['person:ada']);
    });
    // The assessments' older candidates are reused too: no body runs.
    expect(world.summaries['person:ada']).toBe(0);
    expect(world.assessments).toEqual({});
  });

  test.each([
    ['added', [...adaActivity().pullRequests, { number: 104, merged: true, title: 'New' }], { initial: 'A', total: 7, assessed: 4 }, { 104: 1 }],
    ['removed', adaActivity().pullRequests.slice(0, 2), { initial: 'A', total: 4, assessed: 2 }, {}],
  ] as const)('a changed call count (a pull request %s) is changed call-0 output; only new calls run', async (_label, pullRequests, payload, assessments) => {
    const location = freshLocation();
    await coldRun(location);
    resetCounts();
    world.final['person:ada'] = false;
    world.remote['person:ada'] = { profile: { name: 'Ada' }, pullRequests: [...pullRequests] };
    await withNestedSession(location, {}, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome.kind).toBe('published');
      expect(reasons(outcome)).toEqual(['changed-child-output']);
      expect(outcome.misses[0]?.observation?.binding.path).toEqual(['call', '0']);
      expect(payloadOf(session.history, referenceOf(outcome))).toEqual(payload);
    });
    expect(world.assessments).toEqual(assessments);
    expect(world.summaries['person:ada']).toBe(1);
  });

  test('a child failing while the parent is validated fails the request once, with no parent admission or body', async () => {
    const location = freshLocation();
    await coldRun(location);
    resetCounts();
    world.failAssessment = 101;
    await withNestedSession(location, { rubricInput: { ...defaultRubric, mergedWeight: 3 } }, async (session) => {
      const failure = await expectFailure(session.resolve(session.nested.steps['person:ada'].summary), 'execution-failure');
      expect(failure.message).toMatch(/fixture assessment failure for 101/u);
      expect(session.admissions.filter((request) => request.step.slot === 'summary')).toEqual([]);
    });
    expect(world.assessments).toEqual({ 101: 1 });
    expect(world.summaries['person:ada']).toBe(0);
  });

  test('an unknown provenance version and an unknown recorded witness version are unsupported evidence; the older valid candidate is reused', async () => {
    const location = freshLocation();
    const cold = await coldRun(location);
    const crafted = await withNestedSession(location, {}, async (session) => {
      const original = session.history.readEnvelope({ kind: 'completed-result', locator: cold['person:ada'] });
      const publish = (key: string, provenance: { readonly format: string; readonly formatVersion: number; readonly content: unknown }): string => {
        const attempt = session.history.allocateAttempt(session.lease, { analysis: original.analysis, environment: original.environment, subject: original.subject, version: original.version, attemptKey: key, intentDigest: `crafted:${key}` });
        session.history.stageAttempt(session.lease, { attemptId: attempt.attemptId, payload: payloadOf(session.history, cold['person:ada']), provenance, dependencies: original.dependencies });
        return session.history.publishAttempt(session.lease, attempt.attemptId).locator;
      };
      const content = JSON.parse(JSON.stringify(original.provenance.content)) as { readonly calls: IStoredCall[] } & Record<string, unknown>;
      const unknownWitness = { ...content, calls: content.calls.map((call) => call.index === 2 ? { ...call, witness: { ...call.witness, version: 9 } } : call) };
      const witnessLocator = publish('crafted-witness', { format: original.provenance.format, formatVersion: 2, content: unknownWitness });
      const versionLocator = publish('crafted-version', { format: original.provenance.format, formatVersion: 9, content });
      return { witnessLocator, versionLocator };
    });
    resetCounts();
    await withNestedSession(location, {}, async (session) => {
      const outcome = await session.resolve(session.nested.steps['person:ada'].summary);
      expect(outcome.misses.map((item) => [item.candidate.locator, item.reason])).toEqual([
        [crafted.versionLocator, 'unsupported-evidence'],
        [crafted.witnessLocator, 'unsupported-evidence'],
      ]);
      expect(outcome.misses[0]?.detail).not.toBe(outcome.misses[1]?.detail);
      expect(outcome).toMatchObject({ kind: 'reused', basis: 'validated' });
      expect(referenceOf(outcome)).toBe(cold['person:ada']);
    });
    expect(world.summaries['person:ada']).toBe(0);
  });

  test('every miss kind has a distinct reason and a distinct diagnostic', async () => {
    const collected: ICandidateMiss[] = [];
    /** Cold run under `before`, then the first miss of Ada's summary under `after`. */
    const firstMiss = async (before: IVariation, after: IVariation, mode: 'resolve' | 'check'): Promise<void> => {
      resetWorld();
      const location = freshLocation();
      await coldRun(location, before);
      await withNestedSession(location, after, async (session) => {
        const step = session.nested.steps['person:ada'].summary;
        const misses = mode === 'check' ? (await session.check(step)).misses : (await session.resolve(step)).misses;
        const [first] = misses;
        if (first === undefined) {
          throw new Error('expected a miss');
        }
        collected.push(first);
      });
    };
    await firstMiss({}, { summarizer: 'revised' }, 'resolve');
    await firstMiss({}, { rubricInput: { ...defaultRubric, mergedWeight: 3 } }, 'resolve');
    await firstMiss({}, { supplied: 'none' }, 'check');
    await firstMiss({}, { supplied: 'twice' }, 'check');
    await firstMiss({ adaSummary: 'unreconstructible' }, { adaSummary: 'unreconstructible' }, 'resolve');
    await firstMiss({ adaSummary: 'untracked' }, { adaSummary: 'untracked' }, 'resolve');
    expect(collected.map((item) => item.reason)).toEqual([
      'changed',
      'changed-child-output',
      'missing-binding',
      'ambiguous-binding',
      'unreconstructible-argument',
      'unjustified-argument',
    ]);
    expect(new Set(collected.map((item) => item.detail)).size).toBe(collected.length);
  });
});
