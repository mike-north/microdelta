/**
 * Outcome tests for keyed collection sources, fanout templates built once
 * against a symbolic member, template instance correspondence and the
 * frozen-topology boundary.
 *
 * Template contract (EXP-4 selection): the factory runs exactly once against a
 * symbolic member while composing; its returned declarations and every author
 * array are copied and frozen; every builder call after freeze rejects with
 * `frozen`. A member instance is addressed by the template step descriptor
 * (template slot, step slot and collection binding) plus the member key, and
 * its subject is the member subject prefix applied to the key only. Renaming a
 * template or moving it to another collection is a miss, never a remap.
 *
 * @see ../../../docs/spec/composition.md (CMP-1, CMP-4, CMP-6, CMP-9, EXP-4 template selection)
 * @see ../../../docs/spec/tracking.md (COL-1)
 * @see ../../../docs/plans/m4-composition.md (Templates, keys and gates; Authoring shape)
 * @see ../../../docs/spec/acceptance.md (A-07, A-08)
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  declarations,
  isComposing,
  type DefinitionError,
  type IAnyTemplateDeclaration,
  isDeclaration,
  type IBindingDescriptor,
  type IMemberBuilder,
} from '../src/index.js';
import { callUntyped, durable, expectDefinitionError } from './fixtures/assertions.js';
import type { ITestFamily } from './fixtures/contributors.js';
import { fakePort } from './fixtures/port.js';
import {
  activityPrefix,
  buildKeyed,
  compose,
  compositionStep,
  fold,
  gateOf,
  instanceDescriptor,
  keyedScope,
  memo,
  openInvocation,
  source,
  summaryPrefix,
  template,
  templateStepDescriptor,
  type IContributors,
} from './fixtures/keyed.js';

/** A port that must never dispatch in these tests. */
const idlePort = fakePort().port;

/** A fresh keyed collection source. */
function contributorsSource(subject = 'contributors:acme/widget:2026-Q1') {
  return source<IContributors>({ subject, collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
}

/** A one-step template over a collection, with its own subject prefix. */
function singleStepTemplate(slot: string, collection: ReturnType<typeof contributorsSource>, prefix: string) {
  return template({
    slot,
    collection,
    steps: (member) => ({ profile: member.source<string>({ subject: member.subject(prefix), run: () => 'profile' }) }),
  });
}

/** Resolve a descriptor and return its bound step target, failing the test otherwise. */
function boundTarget(resolution: ReturnType<ReturnType<typeof buildKeyed>['composition']['resolve']>) {
  if (resolution.status !== 'bound' || resolution.target.role !== 'step') {
    throw new Error(`expected a bound step, got ${JSON.stringify(resolution)}`);
  }
  return resolution.target;
}

describe('keyed collection sources (COL-1)', () => {
  test('COL-1: a source declares itself a keyed collection with a frozen designated identity field', () => {
    const { contributors } = buildKeyed();
    expect(contributors.collection).toEqual({ identity: 'key' });
    expect(Object.isFrozen(contributors.collection)).toBe(true);
    expect(source<string>({ subject: 'plain', run: () => 'x' }).collection).toBeUndefined();
  });

  test('COL-1: the identity option is copied, so later author mutation cannot change it', () => {
    const option: { identity: 'key' | 'id' } = { identity: 'key' };
    const declared = source<IContributors>({ subject: 'contributors:copy', collection: option, run: () => ({ members: [], status: 'open' }) });
    option.identity = 'id';
    expect(declared.collection).toEqual({ identity: 'key' });
  });

  test('COL-1: an unsupported collection option rejects with invalid-collection, without running getters', () => {
    const getter = jest.fn((): string => 'key');
    const run = (): unknown => ({ members: [], status: 'complete' });
    const cases: readonly unknown[] = [
      { identity: '' },
      { identity: 17 },
      {},
      'key',
      null,
      ['key'],
      Object.defineProperty({}, 'identity', { get: getter, enumerable: true }),
      Object.create({ identity: 'key' }),
    ];
    for (const collection of cases) {
      expectDefinitionError(() => callUntyped(source, { subject: 'contributors:bad', collection, run }), 'invalid-collection');
    }
    expect(getter).not.toHaveBeenCalled();
  });

  test('COL-1: only sources may declare a keyed collection', () => {
    expectDefinitionError(() => callUntyped(memo, { subject: 'memo:bad', collection: { identity: 'key' }, run: () => 1 }), 'invalid-collection');
  });
});

describe('fanout template factory (CMP-1, CMP-4)', () => {
  test('CMP-4: the factory runs exactly once, and never again at composition, reuse in another composition, resolution or keying', () => {
    const built = buildKeyed();
    expect(built.factoryCalls()).toBe(1);
    compose({ scope: 'another-analysis', steps: [{ slot: 'contributors', declaration: built.contributors }], templates: [built.contributor] });
    for (const key of ['person:ada', 'person:ben', 'person:cy', 'person:dee']) {
      built.composition.resolve(instanceDescriptor('summary', key));
      built.composition.resolve(instanceDescriptor('activity', key));
    }
    built.composition.keyMembers('contributor', { members: [{ key: 'person:ada' }], status: 'complete' });
    expect(built.factoryCalls()).toBe(1);
    expect(built.calls).toEqual({ gate: 0, key: 0, bodies: 0 });
  });

  test('CMP-9: the factory runs inside the composition phase, which ends when it returns', () => {
    const observed: boolean[] = [];
    template({
      slot: 'probe',
      collection: contributorsSource(),
      steps: (member) => {
        observed.push(isComposing());
        return { profile: member.source<string>({ subject: member.subject('probe'), run: () => 'p' }) };
      },
    });
    expect(observed).toEqual([true]);
    expect(isComposing()).toBe(false);
  });

  test('CMP-4: the symbolic member exposes subject and step builders only, never a key or member data', () => {
    const member = buildKeyed().capturedMember();
    expect(member).toBeDefined();
    expect(Object.keys(member ?? {}).sort()).toEqual(['memo', 'source', 'subject']);
    expect(Object.isFrozen(member)).toBe(true);
  });

  test('CMP-1/9: every member builder call after the factory returns is rejected with frozen and changes nothing', () => {
    const built = buildKeyed();
    const before = durable(built.composition.topology);
    const member = built.capturedMember();
    if (member === undefined) {
      throw new Error('factory did not run');
    }
    expectDefinitionError(() => member.subject('late'), 'frozen');
    expectDefinitionError(() => callUntyped(member.source, { subject: 'late', run: () => 'late' }), 'frozen');
    expectDefinitionError(() => callUntyped(member.memo, { subject: 'late', run: () => 'late' }), 'frozen');
    expect(durable(built.composition.topology)).toEqual(before);
    expect(Object.keys(built.contributor.steps).sort()).toEqual(['activity', 'summary']);
  });

  test('CMP-1: the returned step record is copied and frozen; later author mutation has no effect', () => {
    const built = buildKeyed();
    const returned = built.returnedSteps();
    if (returned === undefined) {
      throw new Error('factory did not run');
    }
    const originalActivity = built.contributor.steps.activity;
    returned['activity'] = source<string>({ subject: 'intruder', run: () => 'intruder' });
    returned['extra'] = source<string>({ subject: 'extra', run: () => 'extra' });
    expect(built.contributor.steps.activity).toBe(originalActivity);
    expect(Object.keys(built.contributor.steps).sort()).toEqual(['activity', 'summary']);
    expect(Object.isFrozen(built.contributor)).toBe(true);
    expect(Object.isFrozen(built.contributor.steps)).toBe(true);
    expect(isDeclaration(built.contributor.steps.summary)).toBe(true);
  });

  test('CMP-1: later mutation of the composition step and template arrays cannot change the frozen graph', () => {
    const built = buildKeyed();
    const steps = [{ slot: 'contributors', declaration: built.contributors }];
    const templates: IAnyTemplateDeclaration<ITestFamily>[] = [built.contributor];
    const composition = compose({ scope: keyedScope, steps, templates });
    const before = durable(composition.topology);
    const other = singleStepTemplate('intruder', built.contributors, 'intruder-prefix');
    templates.push(other);
    steps.push({ slot: 'extra', declaration: contributorsSource('extra') });
    expect(durable(composition.topology)).toEqual(before);
    expect(composition.resolve(instanceDescriptor('profile', 'person:ada', { template: 'intruder' })).status).toBe('missing');
  });

  test('CMP-4: a failing factory rejects the template, ends the composition phase and freezes its member builder', () => {
    let captured: IMemberBuilder<ITestFamily> | undefined;
    const failure = new Error('author factory failed');
    expect(() => template({
      slot: 'failing',
      collection: contributorsSource(),
      steps: (member) => {
        captured = member;
        throw failure;
      },
    })).toThrow(failure);
    expect(isComposing()).toBe(false);
    expectDefinitionError(() => captured?.subject('late'), 'frozen');
  });
});

describe('template topology and instance correspondence (CMP-4, CMP-6)', () => {
  test('CMP-1: the topology records the collection and fold as composition-level steps and the template structurally', () => {
    const { composition } = buildKeyed();
    expect(composition.topology.steps).toEqual([compositionStep('contributors'), compositionStep('report')]);
    expect(composition.topology.edges).toEqual([]);
    expect(composition.topology.templates).toEqual([{
      slot: 'contributor',
      collection: compositionStep('contributors'),
      steps: [templateStepDescriptor('activity'), templateStepDescriptor('summary')],
      edges: [{ parent: templateStepDescriptor('summary'), child: templateStepDescriptor('activity') }],
      gated: false,
      customKey: false,
    }]);
    expect(composition.topology.folds).toEqual([{ fold: compositionStep('report'), over: templateStepDescriptor('summary') }]);
    expect(Object.isFrozen(composition.topology.templates)).toBe(true);
    expect(Object.isFrozen(composition.topology.folds)).toBe(true);
    expect(composition.topology.templates.every(entry => Object.isFrozen(entry) && Object.isFrozen(entry.steps) && Object.isFrozen(entry.edges))).toBe(true);
  });

  test('CMP-1: gated and custom-key templates say so; registration order never changes the topology', () => {
    const gated = buildKeyed({ gate: true, customKey: true });
    expect(gated.composition.topology.templates[0]).toMatchObject({ gated: true, customKey: true });
    expect(durable(buildKeyed({ reversed: true }).composition.topology)).toEqual(durable(buildKeyed().composition.topology));
  });

  test('CMP-4: a member instance descriptor is exactly the template step descriptor plus the member key', () => {
    const { composition } = buildKeyed();
    const resolution = composition.resolve(instanceDescriptor('summary', 'person:ada'));
    expect(resolution.status).toBe('bound');
    expect(resolution.descriptor).toEqual({ ...templateStepDescriptor('summary'), memberKey: 'person:ada' });
    const target = boundTarget(resolution);
    expect(target.declaration.kind).toBe('memo');
    expect(target.scopedSubject).toEqual({ scope: keyedScope, subject: `${summaryPrefix}:person:ada` });
  });

  test('CMP-4: a template step without a member key addresses no instance', () => {
    const { composition } = buildKeyed();
    expect(composition.resolve(templateStepDescriptor('summary'))).toEqual({ status: 'missing', descriptor: templateStepDescriptor('summary') });
  });

  test('RES-001: member subjects are the subject prefix applied to the key only, identical across independent builds', () => {
    const first = buildKeyed();
    const second = buildKeyed({ reversed: true, gate: true });
    for (const key of ['person:ada', '__proto__', 'constructor', 'a:b', ' spaced ']) {
      for (const [step, prefix] of [['activity', activityPrefix], ['summary', summaryPrefix]] as const) {
        const subject = boundTarget(first.composition.resolve(instanceDescriptor(step, key))).scopedSubject.subject;
        expect(subject).toBe(`${prefix}:${key}`);
        expect(boundTarget(second.composition.resolve(instanceDescriptor(step, key))).scopedSubject.subject).toBe(subject);
      }
    }
  });

  test('CMP-4: a member subject is a symbolic, frozen value carrying only its prefix', () => {
    let subject: unknown;
    template({
      slot: 'probe',
      collection: contributorsSource(),
      steps: (member) => {
        const minted = member.subject('probe-prefix');
        subject = minted;
        return { profile: member.source<string>({ subject: minted, run: () => 'p' }) };
      },
    });
    expect(typeof subject).toBe('object');
    expect(subject).toEqual({ prefix: 'probe-prefix' });
    expect(Object.isFrozen(subject)).toBe(true);
  });

  test('CMP-4: instances are stable per keyed member, keep the author callbacks and pin their own member siblings', () => {
    const built = buildKeyed();
    built.composition.keyMembers('contributor', { members: [{ key: 'person:ada' }, { key: 'person:ben' }], status: 'complete' });
    const summary = boundTarget(built.composition.resolve(instanceDescriptor('summary', 'person:ada'))).declaration;
    expect(boundTarget(built.composition.resolve(instanceDescriptor('summary', 'person:ada'))).declaration).toBe(summary);
    expect(summary).not.toBe(built.contributor.steps.summary);
    expect(summary.run).toBe(built.contributor.steps.summary.run);
    expect(summary.kind === 'memo' ? summary.children : undefined).toEqual(['activity']);
    const benSummary = boundTarget(built.composition.resolve(instanceDescriptor('summary', 'person:ben'))).declaration;
    expect(benSummary).not.toBe(summary);
    expect(isDeclaration(summary)).toBe(true);
    expect(Object.isFrozen(summary)).toBe(true);
  });
});

describe('rejected topology (A-08, CMP-1, CMP-9)', () => {
  test('A-08: a renamed template slot is a miss, never a remap', () => {
    const before = buildKeyed();
    const renamed = buildKeyed({ templateSlot: 'profile' });
    for (const step of ['activity', 'summary']) {
      const historical = durable(before.composition.resolve(instanceDescriptor(step, 'person:ada')).descriptor);
      expect(callUntyped(renamed.composition.resolve, historical)).toEqual({ status: 'missing', descriptor: instanceDescriptor(step, 'person:ada') });
      expect(renamed.composition.resolve(instanceDescriptor(step, 'person:ada', { template: 'profile' })).status).toBe('bound');
    }
    const witness = durable({ version: 2, parent: instanceDescriptor('summary', 'person:ada'), child: instanceDescriptor('activity', 'person:ada'), index: 0, arguments: { form: 'empty' } });
    expect(renamed.composition.resolveWitness(witness)).toEqual({ status: 'missing', descriptor: instanceDescriptor('summary', 'person:ada') });
  });

  test('A-08: a template moved to a different collection is a miss, never a remap', () => {
    const moved = buildKeyed({ collectionSlot: 'roster' });
    expect(moved.composition.resolve(instanceDescriptor('summary', 'person:ada')).status).toBe('missing');
    expect(moved.composition.resolve(instanceDescriptor('summary', 'person:ada', { collection: 'roster' })).status).toBe('bound');
    expect(moved.composition.topology.templates[0]?.collection).toEqual(compositionStep('roster'));
  });

  test('CMP-6: every descriptor field must match exactly; there is no partial template match', () => {
    const { composition } = buildKeyed();
    const cases: readonly IBindingDescriptor[] = [
      instanceDescriptor('summary', 'person:ada', { scope: 'other-analysis' }),
      instanceDescriptor('assessment', 'person:ada'),
      instanceDescriptor('summary', 'person:ada', { template: 'Contributor' }),
      { scope: keyedScope, role: 'step', slot: 'summary', memberKey: 'person:ada' },
      { scope: keyedScope, role: 'step', slot: 'contributors', memberKey: 'person:ada' },
    ];
    for (const descriptor of cases) {
      expect(composition.resolve(descriptor).status).toBe('missing');
    }
    expectDefinitionError(() => composition.resolve({ scope: keyedScope, role: 'step', slot: 'summary', template: 'contributor', memberKey: 'person:ada' }), 'invalid-descriptor');
    expectDefinitionError(() => composition.resolve({ scope: keyedScope, role: 'input', slot: 'summary', template: 'contributor', collection: 'contributors' }), 'invalid-descriptor');
    expectDefinitionError(() => composition.resolve(instanceDescriptor('summary', '')), 'invalid-descriptor');
  });

  test('CMP-9: a builder smuggled out through a result cannot add an operation', () => {
    const built = buildKeyed();
    const result = { next: built.capturedMember()?.memo, subject: built.capturedMember()?.subject };
    expectDefinitionError(() => callUntyped(result.next ?? ((): void => undefined), { subject: 'x', run: () => 1 }), 'frozen');
    expectDefinitionError(() => callUntyped(result.subject ?? ((): void => undefined), 'x'), 'frozen');
    expect(built.composition.topology.templates[0]?.steps).toHaveLength(2);
  });

  test('CMP-9: a callable or look-alike derived from a result cannot occupy a template or step slot', () => {
    const built = buildKeyed();
    const derived = { run: () => 'derived' };
    const lookAlike: unknown = { ...built.contributor };
    expectDefinitionError(() => callUntyped(compose, { scope: keyedScope, steps: [{ slot: 'x', declaration: derived.run }] }), 'forged-declaration');
    expectDefinitionError(() => callUntyped(compose, { scope: keyedScope, steps: [{ slot: 'contributors', declaration: built.contributors }], templates: [lookAlike] }), 'forged-declaration');
    expectDefinitionError(() => callUntyped(compose, { scope: keyedScope, steps: [{ slot: 'contributors', declaration: built.contributors }], templates: [derived.run] }), 'forged-declaration');
    const foreign = declarations<ITestFamily>();
    const foreignCollection = foreign.source<IContributors>({ subject: 'c', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    const foreignTemplate = foreign.template({ slot: 'contributor', collection: foreignCollection, steps: (member) => ({ p: member.source<string>({ subject: member.subject('p'), run: () => 'p' }) }) });
    expectDefinitionError(() => callUntyped(compose, { scope: keyedScope, steps: [{ slot: 'contributors', declaration: built.contributors }], templates: [foreignTemplate] }), 'forged-declaration');
  });

  test('CMP-9: undeclared targets reject before any dispatch or evaluation, while the declared ones open', () => {
    const built = buildKeyed({ gate: true });
    const undeclaredStep = instanceDescriptor('assessment', 'person:ada');
    const renamedTemplate = instanceDescriptor('summary', 'person:ada', { template: 'profile' });
    // Positive controls: the declared instance resolves, opens and exposes its gate.
    expect(built.composition.resolve(instanceDescriptor('summary', 'person:ada')).status).toBe('bound');
    expect(openInvocation(built.composition, instanceDescriptor('summary', 'person:ada'), idlePort).kind).toBe('memo');
    expect(gateOf(built.composition, instanceDescriptor('summary', 'person:ada'))).toBeDefined();
    // The undeclared targets are misses, and every framework entry point rejects them.
    expect(built.composition.resolve(undeclaredStep)).toEqual({ status: 'missing', descriptor: undeclaredStep });
    expect(built.composition.resolve(renamedTemplate)).toEqual({ status: 'missing', descriptor: renamedTemplate });
    expectDefinitionError(() => openInvocation(built.composition, undeclaredStep, idlePort), 'unresolved-parent');
    expectDefinitionError(() => openInvocation(built.composition, renamedTemplate, idlePort), 'unresolved-parent');
    expectDefinitionError(() => built.composition.keyMembers('profile', { members: [], status: 'complete' }), 'invalid-template');
    expectDefinitionError(() => gateOf(built.composition, renamedTemplate), 'unresolved-parent');
    expect(built.calls).toEqual({ gate: 0, key: 0, bodies: 0 });
  });
});

describe('template declaration negatives', () => {
  test('RES-001: member steps must use a subject minted by their own member builder', () => {
    let foreignSubject: unknown;
    template({
      slot: 'first',
      collection: contributorsSource(),
      steps: (member) => {
        foreignSubject = member.subject('first');
        return { profile: member.source<string>({ subject: member.subject('first-profile'), run: () => 'p' }) };
      },
    });
    const cases: readonly unknown[] = ['plain:subject', foreignSubject, { prefix: 'forged' }, undefined];
    for (const subject of cases) {
      expectDefinitionError(() => callUntyped(template, {
        slot: 'second',
        collection: contributorsSource(),
        steps: (member: IMemberBuilder<ITestFamily>) => ({ profile: callUntyped(member.source, { subject, run: () => 'p' }) }),
      }), 'invalid-subject');
    }
    expectDefinitionError(() => template({
      slot: 'second',
      collection: contributorsSource(),
      steps: (member) => ({ profile: member.source<string>({ subject: member.subject(''), run: () => 'p' }) }),
    }), 'invalid-subject');
  });

  test('CMP-4: the factory must return a nonempty plain record of its own member step declarations', () => {
    const ordinary = source<string>({ subject: 'ordinary', run: () => 'o' });
    const results: readonly ((member: IMemberBuilder<ITestFamily>) => unknown)[] = [
      () => ({ profile: ordinary }),
      () => [],
      () => ({}),
      () => null,
      () => Promise.resolve({}),
      () => new Map(),
      (member) => [member.source<string>({ subject: member.subject('array'), run: () => 'a' })],
      (member) => {
        const profile = member.source<string>({ subject: member.subject('twice'), run: () => 't' });
        return { first: profile, second: profile };
      },
      (member) => Object.defineProperty({}, 'profile', {
        get: () => member.source<string>({ subject: member.subject('getter'), run: () => 'g' }),
        enumerable: true,
      }),
    ];
    for (const steps of results) {
      expectDefinitionError(() => callUntyped(template, { slot: 'bad', collection: contributorsSource(), steps }), 'invalid-template');
    }
  });

  test('CMP-4: member memo children must be sibling member sources occupying the named slot', () => {
    const ordinary = source<string>({ subject: 'ordinary', run: () => 'o' });
    let otherTemplateSource: unknown;
    template({
      slot: 'other',
      collection: contributorsSource(),
      steps: (member) => {
        const profile = member.source<string>({ subject: member.subject('other-profile'), run: () => 'p' });
        otherTemplateSource = profile;
        return { profile };
      },
    });
    const factories: readonly ((member: IMemberBuilder<ITestFamily>) => unknown)[] = [
      (member) => ({ summary: member.memo({ subject: member.subject('s'), children: { activity: ordinary }, run: () => 1 }) }),
      (member) => ({ summary: callUntyped(member.memo, { subject: member.subject('s'), children: { activity: otherTemplateSource }, run: () => 1 }) }),
      (member) => {
        const activity = member.source<string>({ subject: member.subject('a'), run: () => 'a' });
        return { activity, summary: member.memo({ subject: member.subject('s'), children: { feed: activity }, run: () => 1 }) };
      },
      (member) => {
        const activity = member.source<string>({ subject: member.subject('a'), run: () => 'a' });
        return { summary: member.memo({ subject: member.subject('s'), children: { activity }, run: () => 1 }) };
      },
    ];
    for (const steps of factories) {
      expectDefinitionError(() => callUntyped(template, { slot: 'bad', collection: contributorsSource(), steps }), 'illegal-edge');
    }
  });

  test('RES-001: member subject prefixes within one template must not overlap', () => {
    for (const [first, second] of [['same', 'same'], ['nested', 'nested:inner']] as const) {
      expectDefinitionError(() => template({
        slot: 'overlap',
        collection: contributorsSource(),
        steps: (member) => ({
          a: member.source<string>({ subject: member.subject(first), run: () => 'a' }),
          b: member.source<string>({ subject: member.subject(second), run: () => 'b' }),
        }),
      }), 'conflicting-subject');
    }
  });

  test('COL-1: a template requires a keyed collection source this family minted', () => {
    const plain = source<string>({ subject: 'plain', run: () => 'x' });
    const steps = (member: IMemberBuilder<ITestFamily>): unknown => ({ p: member.source<string>({ subject: member.subject('p'), run: () => 'p' }) });
    expectDefinitionError(() => callUntyped(template, { slot: 't', collection: plain, steps }), 'invalid-collection');
    expectDefinitionError(() => callUntyped(template, { slot: 't', collection: memo({ subject: 'm', run: () => 1 }), steps }), 'invalid-collection');
    expectDefinitionError(() => callUntyped(template, { slot: 't', collection: { ...contributorsSource() }, steps }), 'forged-declaration');
    const foreign = declarations<ITestFamily>().source<IContributors>({ subject: 'c', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    expectDefinitionError(() => callUntyped(template, { slot: 't', collection: foreign, steps }), 'forged-declaration');
  });

  test('CMP-4: slots, callbacks and option shapes are validated before the factory runs, without running getters', () => {
    const factory = jest.fn((member: IMemberBuilder<ITestFamily>) => ({ p: member.source<string>({ subject: member.subject('p'), run: () => 'p' }) }));
    const getter = jest.fn((): string => 'contributor');
    const collection = contributorsSource();
    const cases: readonly [unknown, DefinitionError['code']][] = [
      [{ slot: '', collection, steps: factory }, 'invalid-descriptor'],
      [{ slot: 7, collection, steps: factory }, 'invalid-descriptor'],
      [{ slot: 't', collection, steps: 'factory' }, 'invalid-callback'],
      [{ slot: 't', collection, steps: factory, key: 'id' }, 'invalid-callback'],
      [{ slot: 't', collection, steps: factory, gate: true }, 'invalid-callback'],
      [Object.defineProperty({ collection, steps: factory }, 'slot', { get: getter, enumerable: true }), 'invalid-template'],
      [Object.assign(Object.create({ slot: 't' }), { collection, steps: factory }), 'invalid-template'],
      [null, 'invalid-template'],
    ];
    for (const [options, code] of cases) {
      expectDefinitionError(() => callUntyped(template, options), code);
    }
    expect(factory).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  test('CMP-4: templates do not nest and member sources are not collections', () => {
    const collection = contributorsSource();
    expectDefinitionError(() => template({
      slot: 'outer',
      collection,
      steps: (member) => {
        template({ slot: 'inner', collection, steps: (inner) => ({ p: inner.source<string>({ subject: inner.subject('inner'), run: () => 'p' }) }) });
        return { p: member.source<string>({ subject: member.subject('outer'), run: () => 'p' }) };
      },
    }), 'invalid-template');
    expectDefinitionError(() => callUntyped(template, {
      slot: 'keyed-member',
      collection,
      steps: (member: IMemberBuilder<ITestFamily>) => ({
        p: callUntyped(member.source, { subject: member.subject('k'), collection: { identity: 'key' }, run: () => ({ members: [], status: 'open' }) }),
      }),
    }), 'invalid-template');
  });
});

describe('composing templates and composition-level steps', () => {
  test('CMP-4: composition-level steps carry no member key; missing and ambiguous behave as for member steps', () => {
    const { composition, contributors } = buildKeyed();
    expect(boundTarget(composition.resolve(compositionStep('contributors'))).declaration).toBe(contributors);
    expect(composition.resolve(compositionStep('absent'))).toEqual({ status: 'missing', descriptor: compositionStep('absent') });
    const ambiguous = compose({
      scope: keyedScope,
      steps: [{ slot: 'feed', declaration: contributorsSource('a') }, { slot: 'feed', declaration: contributorsSource('b') }],
    });
    expect(ambiguous.resolve(compositionStep('feed'))).toEqual({ status: 'ambiguous', descriptor: compositionStep('feed'), occupants: 2 });
  });

  test('CMP-4: a template must bind to exactly one composition-level slot holding its collection', () => {
    const collection = contributorsSource();
    const bound = singleStepTemplate('t', collection, 'p');
    const cases: readonly unknown[] = [
      { scope: keyedScope, templates: [bound] },
      { scope: keyedScope, members: [{ key: 'k', steps: [{ slot: 'contributors', declaration: collection }] }], templates: [bound] },
      { scope: keyedScope, steps: [{ slot: 'a', declaration: collection }, { slot: 'b', declaration: collection }], templates: [bound] },
    ];
    for (const options of cases) {
      expectDefinitionError(() => callUntyped(compose, options), 'invalid-collection');
    }
  });

  test('CMP-4: template slots are unique within a composition', () => {
    const collection = contributorsSource();
    const first = singleStepTemplate('t', collection, 'first');
    const second = singleStepTemplate('t', collection, 'second');
    for (const templates of [[first, second], [first, first]]) {
      expectDefinitionError(() => compose({ scope: keyedScope, steps: [{ slot: 'contributors', declaration: collection }], templates }), 'invalid-template');
    }
  });

  test('CMP-4: member step declarations cannot be registered outside their template', () => {
    const built = buildKeyed();
    expectDefinitionError(() => compose({ scope: keyedScope, steps: [{ slot: 'activity', declaration: built.contributor.steps.activity }] }), 'invalid-template');
    expectDefinitionError(() => compose({ scope: keyedScope, members: [{ key: 'person:ada', steps: [{ slot: 'summary', declaration: built.contributor.steps.summary }] }] }), 'invalid-template');
  });

  test('CMP-4: an instance declaration obtained by resolution cannot be re-registered as an ordinary step', () => {
    const built = buildKeyed();
    const instance = boundTarget(built.composition.resolve(instanceDescriptor('activity', 'person:ada'))).declaration;
    expectDefinitionError(() => compose({ scope: 'another-analysis', steps: [{ slot: 'activity', declaration: instance }] }), 'invalid-template');
  });

  test('RES-001: instance subjects may not collide with another template or an ordinary subject', () => {
    const collection = contributorsSource();
    const first = singleStepTemplate('first', collection, 'shared');
    const second = singleStepTemplate('second', collection, 'shared');
    const nested = singleStepTemplate('nested', collection, 'shared:deeper');
    expectDefinitionError(() => compose({ scope: keyedScope, steps: [{ slot: 'c', declaration: collection }], templates: [first, second] }), 'conflicting-subject');
    expectDefinitionError(() => compose({ scope: keyedScope, steps: [{ slot: 'c', declaration: collection }], templates: [first, nested] }), 'conflicting-subject');
    const ordinary = source<string>({ subject: 'shared:person:ada', run: () => 'x' });
    expectDefinitionError(() => compose({ scope: keyedScope, steps: [{ slot: 'c', declaration: collection }, { slot: 'o', declaration: ordinary }], templates: [first] }), 'conflicting-subject');
    // `prefix:` alone cannot collide, since every member key is nonempty.
    const separatorOnly = source<string>({ subject: 'shared:', run: () => 'x' });
    expect(compose({ scope: keyedScope, steps: [{ slot: 'c', declaration: collection }, { slot: 'o', declaration: separatorOnly }], templates: [first] }).topology.templates).toHaveLength(1);
  });

  test('CMP-1: options of another declaration kind are rejected explicitly', () => {
    const built = buildKeyed();
    const over = { template: built.contributor, step: 'summary' };
    expectDefinitionError(() => callUntyped(source, { subject: 's', over, run: () => 1 }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(memo, { subject: 'm', over, run: () => 1 }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(template, {
      slot: 'with-over',
      collection: contributorsSource(),
      steps: (member: IMemberBuilder<ITestFamily>) => ({ p: callUntyped(member.source, { subject: member.subject('over-source'), over, run: () => 'p' }) }),
    }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(template, {
      slot: 'with-over-memo',
      collection: contributorsSource(),
      steps: (member: IMemberBuilder<ITestFamily>) => ({ p: callUntyped(member.memo, { subject: member.subject('over-memo'), over, run: () => 'p' }) }),
    }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(fold, { subject: 'f', over, children: {}, run: () => 1 }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(fold, { subject: 'f', over, collection: { identity: 'key' }, run: () => 1 }), 'invalid-collection');
    expectDefinitionError(() => callUntyped(fold, { subject: 'f', over, finality: () => true, run: () => 1 }), 'invalid-callback');
    expectDefinitionError(() => callUntyped(memo, { subject: 'm', children: { report: built.report }, run: () => 1 }), 'illegal-edge');
  });

  test('CMP-4: an M3 composition declares no templates or folds, and template fields never match its member steps', () => {
    const activity = source<string>({ subject: 'activity:m3', run: () => 'a' });
    const composition = compose({ scope: keyedScope, members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }] }] });
    expect(composition.topology.templates).toEqual([]);
    expect(composition.topology.folds).toEqual([]);
    expect(composition.resolve({ scope: keyedScope, role: 'step', slot: 'activity', memberKey: 'person:ada' }).status).toBe('bound');
    expect(composition.resolve({ scope: keyedScope, role: 'step', slot: 'activity', memberKey: 'person:ada', template: 't', collection: 'c' }).status).toBe('missing');
  });

  test('CMP-9: composing templates and resolving instances never invokes any author callback', () => {
    const built = buildKeyed({ gate: true, customKey: true });
    built.composition.resolve(instanceDescriptor('summary', 'gh:1001', { }));
    built.composition.resolve(compositionStep('report'));
    expect(built.calls).toEqual({ gate: 0, key: 0, bodies: 0 });
  });

  test('CMP-9: a fold cannot be declared over a template missing from the composition, nor inside a member', () => {
    const built = buildKeyed();
    expectDefinitionError(() => compose({ scope: keyedScope, steps: [{ slot: 'contributors', declaration: built.contributors }, { slot: 'report', declaration: built.report }] }), 'illegal-edge');
    expectDefinitionError(() => compose({
      scope: keyedScope,
      steps: [{ slot: 'contributors', declaration: built.contributors }],
      members: [{ key: 'person:ada', steps: [{ slot: 'report', declaration: built.report }] }],
      templates: [built.contributor],
    }), 'illegal-edge');
    const other = fold({ subject: 'report:other', over: { template: built.contributor, step: 'activity' }, run: () => 'r' });
    expect(compose({
      scope: keyedScope,
      steps: [{ slot: 'contributors', declaration: built.contributors }, { slot: 'other', declaration: other }],
      templates: [built.contributor],
    }).topology.folds).toEqual([{ fold: compositionStep('other'), over: templateStepDescriptor('activity') }]);
  });
});
