/**
 * Owner-level child-validation contracts (ARC-008, CMP-6/7, REUSE-005/006/007).
 * A real parent candidate is published first. On its next request, its child
 * internals deliberately fail if traversed; the isolated current-child result
 * must therefore be supplied at Resolution's child boundary, while Definition
 * correspondence and parent comparison remain real.
 */
import { describe, expect, test } from '@jest/globals';
import { declarations } from '@microdelta/definition';
import type { IBindingDescriptor } from '@microdelta/definition';
import type { IWriterLease } from '@microdelta/history';

import type { IResolutionFamily } from '../src/family.js';
import type { IAdmissionRequest } from '../src/contracts.js';
import { ResolutionError } from '../src/errors.js';
import { _createResolutionWithChildService, createResolution } from '../src/resolution.js';
import type { IChildResolutionService } from '../src/resolution.js';
import { childHistory, host } from './child-history.js';

/** Test-controlled adapters keep external state outside author callbacks. */
interface IHelpers {
  readonly sourceData: () => { readonly score: number; readonly unread: number };
  readonly suppliedData: (score: number) => { readonly score: number; readonly unread: number };
  readonly memoData: () => { readonly score: number; readonly unread: number };
  readonly sourceFinality: () => boolean;
  readonly parentBody: () => void;
}

/** The smallest author family that still reads a selected child output fact. */
interface IFamily extends IResolutionFamily<Record<string, never>, IHelpers> {}
/** Separate family whose untracked input makes a supplied argument unprovable. */
interface IArgumentFamily extends IResolutionFamily<{ readonly config: { readonly score: number } }, Record<string, never>> {}

/** One exact writer lease for the fake History's synchronous mutation contract. */
const lease: IWriterLease = { holder: 'child-validation', fence: 1, expiresAt: 1_000_000 };

/** Parent and child remain structural siblings in one analysis. */
const parentStep: IBindingDescriptor = { scope: 'child-validation', role: 'step', slot: 'parent' };
/** The exact sibling identity the child service must receive after Definition reconnection. */
const childStep: IBindingDescriptor = { scope: 'child-validation', role: 'step', slot: 'child' };
/** A version-2 parent of a supplied callable child. */
const nestedStep: IBindingDescriptor = { scope: 'child-validation', role: 'step', slot: 'nested' };

/** An author source that can be made to detect unwanted recursive resolution. */
let childShouldThrow = false;
/** A positive-control count of genuine child checks. */
let childRuns = 0;
/** Counts entry into authored parent bodies independently of child calls and outcomes. */
let parentRuns = 0;

/** A registered helper observes execution without capturing mutable state in author code. */
function parentBody(): void {
  parentRuns += 1;
}

/** Current source policy and admission are independently observable. */
let childFinalities = 0;
let childAdmissions = 0;
let childFinalityShouldThrow = false;
let childAdmissionShouldThrow = false;

/** A real policy hook that deliberately requires the current source check. */
function sourceFinality(): boolean {
  childFinalities += 1;
  if (childFinalityShouldThrow) {
    throw new Error('CHILD-FINALITY-SENTINEL');
  }
  return false;
}

/** A source adapter whose count and sentinel are test instrumentation. */
function sourceData(): { readonly score: number; readonly unread: number } {
  childRuns += 1;
  if (childShouldThrow) {
    throw new Error('CHILD-RECURSION-SENTINEL');
  }
  return { score: 7, unread: 1 };
}

/** A supplied-step adapter whose argument remains visible to the author. */
function suppliedData(score: number): { readonly score: number; readonly unread: number } {
  childRuns += 1;
  if (childShouldThrow) {
    throw new Error('SUPPLIED-RECURSION-SENTINEL');
  }
  return { score, unread: 1 };
}

/** A nested memo adapter kept distinct from the source and supplied paths. */
function memoData(): { readonly score: number; readonly unread: number } {
  childRuns += 1;
  if (childShouldThrow) {
    throw new Error('MEMO-RECURSION-SENTINEL');
  }
  return { score: 7, unread: 1 };
}

/** Declared helper registrations consumed through Tracking's callable views. */
const helpers = [
  { slot: 'sourceData', helper: sourceData },
  { slot: 'suppliedData', helper: suppliedData },
  { slot: 'memoData', helper: memoData },
  { slot: 'sourceFinality', helper: sourceFinality },
  { slot: 'parentBody', helper: parentBody },
];
/** Only these slots are permitted in the author binding record. */
const helperSlots = ['sourceData', 'suppliedData', 'memoData', 'sourceFinality', 'parentBody'];

/** One current composition and a parent body that consumes only `score`. */
function fixture() {
  const builders = declarations<IFamily>();
  const child = builders.source<{ readonly score: number; readonly unread: number }>({
    subject: 'child',
    finality: ({ helpers: bound }) => bound.sourceFinality(),
    run: ({ outcome, helpers: bound }) => outcome.fresh(bound.sourceData()),
  });
  const parent = builders.memo({
    subject: 'parent',
    children: { child },
    run: async ({ calls, helpers: bound }) => {
      bound.parentBody();
      const { data } = await calls.child();
      return { doubled: data.score * 2 };
    },
  });
  return {
    builders,
    composition: builders.compose({
      scope: 'child-validation', inputs: [], helpers,
      steps: [{ slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }],
    }),
  };
}

/** Resolve through real Definition, Tracking and History-port decisions. */
function harness() {
  childShouldThrow = false;
  childFinalityShouldThrow = false;
  childAdmissionShouldThrow = false;
  const state = childHistory();
  const authored = fixture();
  const options = {
    declarations: authored.builders,
    composition: authored.composition,
    bindings: { inputs: [], helpers: helperSlots },
    environment: 'test', history: state.history, tracking: state.tracking, host,
    admission: { admit: (request: IAdmissionRequest) => {
      if (request.step.slot === 'child') {
        childAdmissions += 1;
        if (childAdmissionShouldThrow) {
          throw new Error('CHILD-ADMISSION-SENTINEL');
        }
      }
      return { kind: 'admitted' as const };
    } },
  };
  return { state, options };
}

/** A supplied child whose subject is derived from one canonical call argument. */
function suppliedHarness(state = childHistory(), bind = true) {
  const builders = declarations<IFamily>();
  const scorer = builders.stepSlot<readonly [number], { readonly score: number; readonly unread: number }>({ slot: 'scorer' });
  const implementation = builders.suppliedStep<readonly [number], { readonly score: number; readonly unread: number }>({
    run: ({ args, helpers: bound }) => bound.suppliedData(args[0]),
  });
  const nested = builders.memo({
    subject: 'nested', children: { scorer },
    run: async ({ calls }) => {
      const { data } = await calls.scorer(7);
      return { doubled: data.score * 2 };
    },
  });
  const composition = builders.compose({
    scope: 'child-validation', inputs: [], helpers,
    steps: [{ slot: 'nested', declaration: nested }],
    supplied: bind ? [builders.supply({ slot: scorer, declaration: implementation, subject: (derived) => `score:${String(derived[0])}` })] : [],
  });
  const options = {
    declarations: builders, composition, bindings: { inputs: [], helpers: helperSlots },
    environment: 'test', history: state.history, tracking: state.tracking, host,
    admission: { admit: () => ({ kind: 'admitted' as const }) },
  };
  return { state, options };
}

/** A nested parent whose derived argument follows an observed untracked read. */
function unjustifiedHarness(state = childHistory()) {
  const builders = declarations<IArgumentFamily>();
  const scorer = builders.stepSlot<readonly [number], { readonly score: number }>({ slot: 'scorer' });
  const implementation = builders.suppliedStep<readonly [number], { readonly score: number }>({
    run: ({ args }) => ({ score: args[0] }),
  });
  const parent = builders.memo({
    subject: 'unjustified', children: { scorer },
    run: async ({ calls, inputs, untracked }) => {
      const score = untracked(inputs.config, 'score');
      const { data } = await calls.scorer(score);
      return { doubled: data.score * 2 };
    },
  });
  const composition = builders.compose({
    scope: 'child-validation', inputs: [{ slot: 'config', value: { score: 7 } }], helpers: [],
    steps: [{ slot: 'nested', declaration: parent }],
    supplied: [builders.supply({ slot: scorer, declaration: implementation, subject: (derived) => `score:${String(derived[0])}` })],
  });
  return {
    state,
    options: {
      declarations: builders, composition, bindings: { inputs: ['config'], helpers: [] },
      environment: 'test', history: state.history, tracking: state.tracking, host,
      admission: { admit: () => ({ kind: 'admitted' as const }) },
    },
  };
}

/** A nested memo-to-memo edge, distinct from direct source and supplied calls. */
function memoHarness() {
  const state = childHistory();
  const builders = declarations<IFamily>();
  const child = builders.memo({
    subject: 'memo-child', children: {},
    run: ({ helpers: bound }) => bound.memoData(),
  });
  const parent = builders.memo({
    subject: 'memo-parent', children: { child },
    run: async ({ calls, helpers: bound }) => {
      bound.parentBody();
      const { data } = await calls.child();
      return { doubled: data.score * 2 };
    },
  });
  const composition = builders.compose({
    scope: 'child-validation', inputs: [], helpers,
    steps: [{ slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }],
  });
  return {
    state,
    options: {
      declarations: builders, composition, bindings: { inputs: [], helpers: helperSlots },
      environment: 'test', history: state.history, tracking: state.tracking, host,
      admission: { admit: () => ({ kind: 'admitted' as const }) },
    },
  };
}

/** Replace one already-reconnected current child with a known exact result. */
function currentChild(reference: ReturnType<ReturnType<typeof childHistory>['seedChild']>, seen: string[]): IChildResolutionService {
  return {
    async resolve(invocation, normal) {
      seen.push(`${invocation.kind}:${invocation.subject}`);
      if (invocation.kind !== 'source' || invocation.subject !== 'child') {
        return normal();
      }
      expect(invocation.step).toEqual(childStep);
      return {
        step: invocation.step,
        result: { kind: 'reused', basis: 'validated', reference, acceptance: undefined },
        evidence: { misses: [], trace: [], diagnostics: [] },
      };
    },
  };
}

describe('child validation isolation', () => {
  test('a retained parent compares only the substituted current child output', async () => {
    childShouldThrow = false;
    const { state, options } = harness();
    const cold = await createResolution(options).resolve({ step: parentStep, requestKey: 'cold', lease });
    expect(cold.kind).toBe('published');
    if (cold.kind !== 'published') {
      return;
    }
    expect(state.payloadOf(cold.reference)).toEqual({ doubled: 14 });
    const parentRunsBefore = parentRuns;
    // Serialize before reuse so a mutation of the original object cannot alter the oracle.
    const originalProvenance = JSON.stringify(state.history.readEnvelope(cold.reference).provenance);
    const originalDependencies = JSON.stringify(state.history.readEnvelope(cold.reference).dependencies);

    childShouldThrow = true;
    childFinalityShouldThrow = true;
    childAdmissionShouldThrow = true;
    state.armChildQuerySentinel();
    const beforeStages = { queries: state.childQueries, finalities: childFinalities, admissions: childAdmissions, bodies: childRuns,
      parentQueries: state.parentQueries, historicalReads: state.childEnvelopeReads, outputReads: state.fingerprintReads };
    const current = state.seedChild({ score: 7, unread: 2 });
    const seen: string[] = [];
    const next = await _createResolutionWithChildService(options, currentChild(current, seen))
      .resolve({ step: parentStep, requestKey: 'next', lease });
    expect(next.kind).toBe('reused');
    if (next.kind !== 'reused') {
      return;
    }
    expect(parentRuns - parentRunsBefore).toBe(0);
    expect(next.reference).toEqual(cold.reference);
    expect(JSON.stringify(state.history.readEnvelope(cold.reference).provenance)).toBe(originalProvenance);
    expect(JSON.stringify(state.history.readEnvelope(cold.reference).dependencies)).toBe(originalDependencies);
    expect(next.acceptance.dependencies).toEqual([current]);
    expect(seen).toEqual(['source:child']);
    expect({ queries: state.childQueries, finalities: childFinalities, admissions: childAdmissions, bodies: childRuns })
      .toEqual({ queries: beforeStages.queries, finalities: beforeStages.finalities, admissions: beforeStages.admissions, bodies: beforeStages.bodies });
    expect(state.parentQueries).toBe(beforeStages.parentQueries + 1);
    expect(state.childEnvelopeReads).toBe(beforeStages.historicalReads + 1);
    expect(state.fingerprintReads).toBeGreaterThan(beforeStages.outputReads);
  });

  test('a changed consumed fact publishes the parent once with current child provenance', async () => {
    childShouldThrow = false;
    const { state, options } = harness();
    const cold = await createResolution(options).resolve({ step: parentStep, requestKey: 'cold-changed', lease });
    expect(cold.kind).toBe('published');
    childShouldThrow = true;
    const parentRunsBefore = parentRuns;
    const current = state.seedChild({ score: 8, unread: 1 });
    const seen: string[] = [];
    const next = await _createResolutionWithChildService(options, currentChild(current, seen))
      .resolve({ step: parentStep, requestKey: 'changed', lease });
    expect(next.kind).toBe('published');
    if (next.kind !== 'published') {
      return;
    }
    expect(parentRuns - parentRunsBefore).toBe(1);
    expect(state.payloadOf(next.reference)).toEqual({ doubled: 16 });
    expect(next.misses.map((miss) => miss.reason)).toContain('changed');
    expect(state.history.readEnvelope(next.reference).dependencies).toEqual([current]);
    expect(seen).toEqual(['source:child', 'source:child']);
  });

  test('check-only reports the child boundary as uncertain and writes no acceptance', async () => {
    childShouldThrow = false;
    const { state, options } = harness();
    await createResolution(options).resolve({ step: parentStep, requestKey: 'cold-check', lease });
    const acceptedBefore = state.acceptances.length;
    const parentRunsBefore = parentRuns;
    childShouldThrow = true;
    const seen: string[] = [];
    const service: IChildResolutionService = {
      async resolve(invocation, normal) {
        seen.push(`${invocation.kind}:${invocation.subject}`);
        if (invocation.kind !== 'source') {
          return normal();
        }
        return { step: invocation.step, result: { kind: 'execution-required' }, evidence: { misses: [], trace: [], diagnostics: [] } };
      },
    };
    const check = await _createResolutionWithChildService(options, service).check({ step: parentStep });
    expect(check).toMatchObject({ kind: 'uncertain', boundary: { role: 'step', slot: 'child' } });
    expect(parentRuns - parentRunsBefore).toBe(0);
    expect(state.acceptances).toHaveLength(acceptedBefore);
    expect(seen).toEqual(['source:child']);
  });

  test('a current child refusal stops the parent without accepting its candidate', async () => {
    childShouldThrow = false;
    const { state, options } = harness();
    await createResolution(options).resolve({ step: parentStep, requestKey: 'cold-refusal', lease });
    const acceptedBefore = state.acceptances.length;
    const parentRunsBefore = parentRuns;
    const service: IChildResolutionService = {
      async resolve(invocation, normal) {
        if (invocation.kind !== 'source') {
          return normal();
        }
        return {
          step: invocation.step,
          result: { kind: 'refused', refused: invocation.step, reason: 'test admission denied', disposition: 'denied' },
          evidence: { misses: [], trace: [], diagnostics: [] },
        };
      },
    };
    const next = await _createResolutionWithChildService(options, service).resolve({ step: parentStep, requestKey: 'refusal', lease });
    expect(next).toMatchObject({ kind: 'refused', refused: { role: 'step', slot: 'child' }, disposition: 'denied' });
    expect(parentRuns - parentRunsBefore).toBe(0);
    expect(state.acceptances).toHaveLength(acceptedBefore);
  });

  test('a failed current child rejects before parent acceptance', async () => {
    childShouldThrow = false;
    const { state, options } = harness();
    await createResolution(options).resolve({ step: parentStep, requestKey: 'cold-failure', lease });
    const acceptedBefore = state.acceptances.length;
    const parentRunsBefore = parentRuns;
    const service: IChildResolutionService = {
      async resolve(invocation, normal) {
        if (invocation.kind !== 'source') {
          return normal();
        }
        throw new ResolutionError('execution-failure', 'fake current child failure');
      },
    };
    await expect(_createResolutionWithChildService(options, service).resolve({ step: parentStep, requestKey: 'failure', lease }))
      .rejects.toMatchObject({ code: 'execution-failure' });
    expect(parentRuns - parentRunsBefore).toBe(0);
    expect(state.acceptances).toHaveLength(acceptedBefore);
  });

  test('historical child integrity is checked before the current-child seam', async () => {
    childShouldThrow = false;
    const { state, options } = harness();
    const cold = await createResolution(options).resolve({ step: parentStep, requestKey: 'cold-integrity', lease });
    expect(cold.kind).toBe('published');
    if (cold.kind !== 'published') {
      return;
    }
    state.dropDependencies(cold.reference);
    const seen: string[] = [];
    const current = state.seedChild({ score: 7, unread: 1 });
    await expect(_createResolutionWithChildService(options, currentChild(current, seen))
      .resolve({ step: parentStep, requestKey: 'integrity', lease }))
      .rejects.toMatchObject({ code: 'integrity' });
    expect(seen).toEqual([]);
  });

  test('the same seam can take the normal child continuation', async () => {
    childShouldThrow = false;
    const { state, options } = harness();
    const cold = await createResolution(options).resolve({ step: parentStep, requestKey: 'cold-normal', lease });
    expect(cold.kind).toBe('published');
    const before = { queries: state.childQueries, finalities: childFinalities, admissions: childAdmissions, bodies: childRuns };
    const seen: string[] = [];
    const service: IChildResolutionService = {
      resolve(invocation, normal) {
        seen.push(`${invocation.kind}:${invocation.subject}`);
        return normal();
      },
    };
    const next = await _createResolutionWithChildService(options, service).resolve({ step: parentStep, requestKey: 'normal', lease });
    expect(next.kind).toBe('reused');
    if (next.kind !== 'reused' || cold.kind !== 'published') {
      return;
    }
    expect(next.reference).toEqual(cold.reference);
    expect({ queries: state.childQueries, finalities: childFinalities, admissions: childAdmissions, bodies: childRuns })
      .toEqual({ queries: before.queries + 1, finalities: before.finalities + 1, admissions: before.admissions + 1, bodies: before.bodies + 1 });
    expect(seen).toEqual(['source:child']);
    expect(next.acceptance.dependencies).toHaveLength(1);
  });

  test.each([
    ['candidate', 'CHILD-CANDIDATE-SENTINEL'],
    ['finality', 'policy-failure'],
    ['admission', 'admission-failure'],
    ['body', 'execution-failure'],
  ] as const)('normal continuation reaches the %s child sentinel', async (stage, code) => {
    const { state, options } = harness();
    await createResolution(options).resolve({ step: parentStep, requestKey: `cold-${stage}`, lease });
    if (stage === 'candidate') { state.armChildQuerySentinel(); }
    if (stage === 'finality') { childFinalityShouldThrow = true; }
    if (stage === 'admission') { childAdmissionShouldThrow = true; }
    if (stage === 'body') { childShouldThrow = true; }
    const reached = { queries: state.childQueries, finalities: childFinalities, admissions: childAdmissions, bodies: childRuns };
    const service: IChildResolutionService = { resolve: (_invocation, normal) => normal() };
    const resolving = _createResolutionWithChildService(options, service).resolve({ step: parentStep, requestKey: `normal-${stage}`, lease });
    if (stage === 'candidate') {
      await expect(resolving).rejects.toThrow(code);
    } else {
      await expect(resolving).rejects.toMatchObject({ code });
    }
    expect(state.childQueries).toBe(reached.queries + 1);
    if (stage !== 'candidate') { expect(childFinalities).toBe(reached.finalities + 1); }
    if (stage === 'admission' || stage === 'body') { expect(childAdmissions).toBe(reached.admissions + 1); }
    if (stage === 'body') { expect(childRuns).toBe(reached.bodies + 1); }
  });

  test('a supplied child is substituted only after its current subject and arguments are rebuilt', async () => {
    childShouldThrow = false;
    const { state, options } = suppliedHarness();
    const cold = await createResolution(options).resolve({ step: nestedStep, requestKey: 'cold-supplied', lease });
    expect(cold.kind).toBe('published');
    childShouldThrow = true;
    const current = state.seedChild({ score: 7, unread: 2 });
    const seen: string[] = [];
    const service: IChildResolutionService = {
      async resolve(invocation, normal) {
        seen.push(`${invocation.kind}:${invocation.step.slot}:${invocation.subject}`);
        if (invocation.kind !== 'supplied') {
          return normal();
        }
        expect(invocation.step).toEqual({ scope: 'child-validation', role: 'callable', slot: 'scorer' });
        return {
          step: invocation.step,
          result: { kind: 'reused', basis: 'validated', reference: current, acceptance: undefined },
          evidence: { misses: [], trace: [], diagnostics: [] },
        };
      },
    };
    const next = await _createResolutionWithChildService(options, service).resolve({ step: nestedStep, requestKey: 'next-supplied', lease });
    expect(next.kind).toBe('reused');
    if (next.kind !== 'reused' || cold.kind !== 'published') {
      return;
    }
    expect(next.reference).toEqual(cold.reference);
    expect(next.acceptance.dependencies).toEqual([current]);
    expect(seen).toEqual(['supplied:scorer:score:7']);
  });

  test('a missing current supplied binding ends check before the child seam', async () => {
    childShouldThrow = false;
    const state = childHistory();
    const cold = suppliedHarness(state);
    await createResolution(cold.options).resolve({ step: nestedStep, requestKey: 'cold-unbound', lease });
    const unbound = suppliedHarness(state, false);
    const seen: string[] = [];
    const current = state.seedChild({ score: 7, unread: 1 });
    const checked = await _createResolutionWithChildService(unbound.options, currentChild(current, seen)).check({ step: nestedStep });
    expect(checked).toMatchObject({ kind: 'execution-required' });
    expect(seen).toEqual([]);
  });

  test('an unjustified supplied argument misses before the child seam', async () => {
    const { state, options } = unjustifiedHarness();
    const cold = await createResolution(options).resolve({ step: nestedStep, requestKey: 'cold-unjustified', lease });
    expect(cold.kind).toBe('published');
    const seen: string[] = [];
    const current = state.seedChild({ score: 7 });
    const checked = await _createResolutionWithChildService(options, currentChild(current, seen)).check({ step: nestedStep });
    expect(checked.kind).toBe('execution-required');
    expect(checked.misses.map((miss) => miss.reason)).toContain('unjustified-argument');
    expect(seen).toEqual([]);
  });

  test('a nested memo child feeds both parent validation and changed-output execution', async () => {
    childShouldThrow = false;
    const { state, options } = memoHarness();
    const cold = await createResolution(options).resolve({ step: parentStep, requestKey: 'cold-memo', lease });
    expect(cold.kind).toBe('published');
    childShouldThrow = true;
    const parentRunsBefore = parentRuns;
    const current = state.seedChild({ score: 8, unread: 2 });
    const seen: string[] = [];
    const service: IChildResolutionService = {
      async resolve(invocation, normal) {
        seen.push(`${invocation.kind}:${invocation.subject}`);
        if (invocation.kind !== 'memo' || invocation.subject !== 'memo-child') {
          return normal();
        }
        expect(invocation.step).toEqual(childStep);
        return {
          step: invocation.step,
          result: { kind: 'reused', basis: 'validated', reference: current, acceptance: undefined },
          evidence: { misses: [], trace: [], diagnostics: [] },
        };
      },
    };
    const next = await _createResolutionWithChildService(options, service).resolve({ step: parentStep, requestKey: 'next-memo', lease });
    expect(next.kind).toBe('published');
    if (next.kind !== 'published') {
      return;
    }
    expect(parentRuns - parentRunsBefore).toBe(1);
    expect(state.payloadOf(next.reference)).toEqual({ doubled: 16 });
    expect(state.history.readEnvelope(next.reference).dependencies).toEqual([current]);
    expect(seen).toEqual(['memo:memo-child', 'memo:memo-child']);
  });
});
