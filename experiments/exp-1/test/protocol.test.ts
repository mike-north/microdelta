/** EXP-1 assertions for semantic binding evidence within the declared scalar fixture. */
import { describe, expect, test } from '@jest/globals';

import {
  capture,
  compatibilityVersion,
  createRegistry,
  tracked,
  validate,
} from '../src/protocol.js';
import type { IBindingDescriptor, ICandidate } from '../src/protocol.js';

/** Stable slots identify current roles; fresh object allocation has no durable role. */
const scope = 'roster-fixture';
const configSlot: IBindingDescriptor = { scope, role: 'input', slot: 'config' };
const helperSlot: IBindingDescriptor = { scope, role: 'callable', slot: 'helper' };
const assessorSlot: IBindingDescriptor = { scope, role: 'callable', slot: 'assessor' };
const consumerSlot: IBindingDescriptor = { scope, role: 'step', slot: 'assessment' };
const memberSlot: IBindingDescriptor = { scope, role: 'input', slot: 'member', memberKey: 'pr-a' };

/** A new process can construct a logically equal set in a different order. */
function fixture(
  options: { readonly score?: number; readonly unread?: string; readonly factor?: number; readonly changedHelper?: boolean } = {},
) {
  const config = tracked({ factor: options.factor ?? 2, unread: options.unread ?? 'first' });
  const member = tracked({ score: options.score ?? 7, unread: options.unread ?? 'first' });
  const firstHelper = tracked((score: number): number => score * config.factor);
  const changedHelper = tracked((score: number): number => score * config.factor + 1);
  const assessor = tracked((score: number): number => score + 3);
  const consumer = tracked((): number => assessor((options.changedHelper ? changedHelper : firstHelper)(member.score)));
  const registry = createRegistry();
  registry.register(consumerSlot, consumer);
  registry.register(assessorSlot, assessor);
  registry.register(helperSlot, options.changedHelper ? changedHelper : firstHelper);
  registry.register(memberSlot, member);
  registry.register(configSlot, config);
  return { registry, consumer };
}

/** A retained result is fixture history; validation must not edit its provenance. */
function firstCandidate(): ICandidate {
  const current = fixture();
  const executed = capture(current.registry, current.consumer);
  expect(executed.value).toBe(17);
  return {
    subject: 'assessment:pr-a',
    version: 1,
    reference: 'exact-result-1',
    observations: executed.observations,
  };
}

describe('EXP-1 structural correspondence and actual observations', () => {
  test('fresh bindings retain the exact reference; unread scalar and labels are irrelevant', () => {
    const saved = firstCandidate();
    const next = fixture({ unread: 'second' });
    expect(validate(next.registry, saved)).toEqual({ status: 'hit', reference: 'exact-result-1' });
    expect(saved.observations).not.toContainEqual(expect.objectContaining({ field: 'unread' }));
  });

  test('consumed fields, called helper text, and same-text tracked capture invalidate', () => {
    const saved = firstCandidate();
    expect(validate(fixture({ score: 8 }).registry, saved)).toMatchObject({ status: 'miss', reason: 'changed-evidence' });
    expect(validate(fixture({ changedHelper: true }).registry, saved)).toMatchObject({
      status: 'miss', reason: 'changed-evidence', descriptor: helperSlot,
    });
    expect(validate(fixture({ factor: 3 }).registry, saved)).toMatchObject({
      status: 'miss', reason: 'changed-evidence', descriptor: configSlot,
    });
    const kinds = saved.observations.map(observation => observation.kind);
    expect(kinds).toContain('implementation');
    expect(kinds).toContain('field');
  });

  test('uncalled helper code is absent from evidence and never invalidates', () => {
    const saved = firstCandidate();
    expect(saved.observations.filter(observation => observation.kind === 'implementation')).toHaveLength(3);
    const next = fixture();
    const unusedSlot: IBindingDescriptor = { scope, role: 'callable', slot: 'unused' };
    next.registry.register(unusedSlot, tracked((score: number): number => score + 100));
    expect(validate(next.registry, saved)).toEqual({ status: 'hit', reference: saved.reference });
  });

  test('missing or ambiguous required correspondence is an honest miss', () => {
    const saved = firstCandidate();
    const missing = createRegistry();
    expect(validate(missing, saved)).toMatchObject({ status: 'miss', reason: 'missing-binding' });
    const duplicated = fixture();
    duplicated.registry.register(helperSlot, tracked((score: number): number => score));
    expect(validate(duplicated.registry, saved)).toMatchObject({ status: 'miss', reason: 'ambiguous-binding' });
  });

  test('durable observations contain descriptors and facts, never live tags or closures', () => {
    const saved = firstCandidate();
    const serialized = JSON.stringify(saved);
    expect(serialized).toContain('assessment:pr-a');
    expect(serialized).not.toMatch(/"(__tag|revision|closure|function)"/u);
    expect(JSON.parse(serialized)).toEqual(saved);
  });

  test('unsupported accessor input is rejected before it can masquerade as a stored scalar', () => {
    const object = Object.defineProperty({}, 'score', { enumerable: true, get: (): number => 7 });
    expect(() => tracked(object)).toThrow(TypeError);
  });

  test('default compatibility version is one and invalid numeric versions fail', () => {
    expect(compatibilityVersion()).toBe(1);
    expect(compatibilityVersion(2)).toBe(2);
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => compatibilityVersion(invalid)).toThrow(TypeError);
    }
    for (const invalid of [null, '1', true]) {
      expect((): void => { Reflect.apply(compatibilityVersion, undefined, [invalid]); }).toThrow(TypeError);
    }
  });

  test('version match does not bypass changed implementation or input evidence', () => {
    const saved = firstCandidate();
    expect(validate(fixture().registry, saved, 2)).toMatchObject({ status: 'miss', reason: 'version' });
    expect(validate(fixture({ changedHelper: true }).registry, saved, 1)).toMatchObject({ status: 'miss', reason: 'changed-evidence' });
    expect(validate(fixture({ score: 8 }).registry, saved, 1)).toMatchObject({ status: 'miss', reason: 'changed-evidence' });
  });

  test('counterexample: an untracked captured scalar can change behind equal function text', () => {
    let untrackedFactor = 2;
    const helper = tracked((score: number): number => score * untrackedFactor);
    const consumer = tracked((): number => helper(7));
    const registry = createRegistry();
    registry.register(helperSlot, helper);
    registry.register(consumerSlot, consumer);
    const first = capture(registry, consumer);
    expect(first.value).toBe(14);
    const saved: ICandidate = {
      subject: 'assessment:pr-a',
      version: 1,
      reference: 'unsafe-false-hit',
      observations: first.observations,
    };
    untrackedFactor = 3;
    expect(consumer()).toBe(21);
    expect(validate(registry, saved)).toEqual({ status: 'hit', reference: 'unsafe-false-hit' });
  });
});
