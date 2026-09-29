/**
 * Outcome tests for template instances as invocation parents: member memos
 * naming sibling member sources and memos and composition-wide supplied step
 * slots, instance declarations minted per composition, and the invocation
 * witnesses instances emit. A template instance parent always records the
 * version-2 witness with template-bearing descriptors; the version-1 parser
 * keeps its exact M3 meaning and rejects template-bearing descriptors.
 *
 * @see ../../../docs/spec/composition.md (CMP-4, CMP-6, CMP-7, EXP-4 template selection and argument recipe)
 * @see ../../../docs/spec/execution.md (REUSE-006, REUSE-007)
 * @see ../../../docs/plans/m4-composition.md (Templates, keys and gates; Nested invocation evidence)
 */
import { describe, expect, test } from '@jest/globals';

import { describeHandle, type IBindingDescriptor, type IDerivedArguments, type IMemoInvocation } from '../src/index.js';
import { durable, expectDefinitionError } from './fixtures/assertions.js';
import type { ITestFamily } from './fixtures/contributors.js';
import { ada, ben, buildKeyed, compose, instanceDescriptor, openInvocation, source, template, type IContributors } from './fixtures/keyed.js';
import { assessmentSubject, forward, rubric, stepSlot, supply, type IActivity, type IAssessment, type IAssessorParameters } from './fixtures/nested.js';
import { callUntyped, directInvoker, fakePort, type IFakePort } from './fixtures/port.js';

/** The scope of the nested template fixture. */
const scope = 'contribution-report:acme/widget:instances';

/** A step descriptor of the nested template fixture's `contributor` template. */
function nestedInstance(step: string, memberKey: string): IBindingDescriptor {
  return { scope, role: 'step', slot: step, template: 'contributor', collection: 'contributors', memberKey };
}

/** A template step descriptor (no member key) of the nested template fixture. */
function nestedStep(step: string): IBindingDescriptor {
  return { scope, role: 'step', slot: step, template: 'contributor', collection: 'contributors' };
}

/** The assessor slot descriptor in the nested template fixture. */
const assessorSlot: IBindingDescriptor = { scope, role: 'callable', slot: 'assessor' };

/**
 * A template whose summary memo names a sibling member source, a sibling
 * member memo and the composition-wide supplied assessor slot. The summary's
 * body only captures its calls, so a test drives each call explicitly.
 */
function buildNestedTemplate(subject: (derived: IDerivedArguments<IAssessorParameters>) => string = assessmentSubject) {
  const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
  const collection = source<IContributors>({ subject: 'contributors:acme/widget', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
  const captured: { calls?: object } = {};
  const contributor = template({
    slot: 'contributor',
    collection,
    steps: (member) => {
      const activity = member.source<IActivity>({ subject: member.subject('activity:acme/widget'), run: () => ({ pullRequests: [] }) });
      const profile = member.memo({ subject: member.subject('profile:acme/widget'), children: { activity }, run: () => 'profile' });
      const summary = member.memo({
        subject: member.subject('summary:acme/widget'),
        children: { activity, profile, assess: assessor },
        run: (context) => {
          captured.calls = context.calls;
          return 'summary';
        },
      });
      return { activity, profile, summary };
    },
  });
  const composition = compose({
    scope,
    steps: [{ slot: 'contributors', declaration: collection }],
    templates: [contributor],
    supplied: [supply({ slot: assessor, declaration: rubric('A'), subject })],
  });
  return { composition, contributor, captured };
}

/** Narrow an open invocation to a memo. */
function asMemo(invocation: ReturnType<typeof openInvocation>): IMemoInvocation<ITestFamily> {
  if (invocation.kind !== 'memo') {
    throw new Error(`expected a memo invocation, got ${invocation.kind}`);
  }
  return invocation;
}

/** Open and run one instance summary of the nested template fixture, returning its captured call handles. */
function openNestedSummary(build: ReturnType<typeof buildNestedTemplate>, memberKey: string, fake: IFakePort) {
  const invocation = asMemo(openInvocation(build.composition, nestedInstance('summary', memberKey), fake.port));
  fake.active = invocation;
  invocation.apply({}, directInvoker());
  const calls = build.captured.calls;
  if (calls === undefined) {
    throw new Error('the summary did not receive its calls');
  }
  return { invocation, handle: (call: string): unknown => Reflect.get(calls, call) };
}

/** The request dispatched at one position, failing the test otherwise. */
function requestAt(fake: IFakePort, position: number) {
  const request = fake.requests[position];
  if (request === undefined) {
    throw new Error(`no request at ${String(position)}`);
  }
  return request;
}

describe('template member memos (CMP-4 with CMP-3)', () => {
  test('CMP-4: a member memo may name sibling member sources and memos and a supplied step slot', () => {
    const { composition } = buildNestedTemplate();
    expect(composition.topology.slots).toEqual(['assessor']);
    expect(composition.topology.templates[0]?.edges).toEqual([
      { parent: nestedStep('profile'), child: nestedStep('activity') },
      { parent: nestedStep('summary'), child: assessorSlot },
      { parent: nestedStep('summary'), child: nestedStep('activity') },
      { parent: nestedStep('summary'), child: nestedStep('profile') },
    ]);
  });

  test('CMP-4: an instance remaps only sibling declaration edges to its own member; the supplied slot stays composition-wide', async () => {
    const build = buildNestedTemplate();
    // Keying precedes instance work and retains the keyed member's instances, so identities are stable.
    build.composition.keyMembers('contributor', { members: [{ key: 'person:ada' }], status: 'complete' });
    const fake = fakePort();
    const { invocation, handle } = openNestedSummary(build, 'person:ada', fake);
    await callUntyped(handle('activity'));
    await callUntyped(handle('profile'));
    fake.result = { data: { score: 2, explanation: 'x' } };
    await callUntyped(handle('assess'), 7, forward.member(['pullRequests', 0]));
    expect(fake.requests.map(request => request.kind)).toEqual(['source', 'memo', 'supplied']);
    const profile = build.composition.resolve(nestedInstance('profile', 'person:ada'));
    const activity = build.composition.resolve(nestedInstance('activity', 'person:ada'));
    expect(requestAt(fake, 0).child).toBe(activity.status === 'bound' && activity.target.role === 'step' ? activity.target.declaration : undefined);
    expect(requestAt(fake, 1).child).toBe(profile.status === 'bound' && profile.target.role === 'step' ? profile.target.declaration : undefined);
    expect(requestAt(fake, 2).witness).toEqual({
      version: 2,
      parent: nestedInstance('summary', 'person:ada'),
      child: assessorSlot,
      index: 2,
      arguments: [
        { form: 'derived', value: expect.any(String), justified: true },
        { form: 'forwarded', origin: { binding: 'member', path: [{ kind: 'property', key: 'pullRequests' }, { kind: 'index', index: 0 }] }, justified: true },
      ],
    });
    expect(fake.requests.every(request => request.scope === invocation)).toBe(true);
  });
});

describe('template instance witnesses (CMP-6, REUSE-007)', () => {
  test('CMP-6: an instance parent always emits version 2, even when its only child is a sibling source', async () => {
    const built = buildKeyed();
    const fake = fakePort();
    const invocation = asMemo(openInvocation(built.composition, instanceDescriptor('summary', 'person:ada'), fake.port));
    fake.active = invocation;
    fake.result = { data: 'activity' };
    await invocation.apply({}, directInvoker());
    expect(fake.requests).toHaveLength(1);
    expect(requestAt(fake, 0).witness).toEqual({
      version: 2,
      parent: instanceDescriptor('summary', 'person:ada'),
      child: instanceDescriptor('activity', 'person:ada'),
      index: 0,
      arguments: { form: 'empty' },
    });
  });

  test('CMP-6: an instance handle is described by its version-2 parent and child', () => {
    const build = buildNestedTemplate();
    const { handle } = openNestedSummary(build, 'person:ben', fakePort());
    expect(describeHandle(handle('activity'))).toEqual({ version: 2, parent: nestedInstance('summary', 'person:ben'), child: nestedInstance('activity', 'person:ben') });
  });

  test('REUSE-007: every witness an instance recorded reconnects through the version-2 parser', async () => {
    const build = buildNestedTemplate();
    const fake = fakePort();
    const { handle } = openNestedSummary(build, 'person:ada', fake);
    await callUntyped(handle('activity'));
    await callUntyped(handle('profile'));
    fake.result = { data: { score: 2, explanation: 'x' } };
    await callUntyped(handle('assess'), 7, forward.member(['pullRequests', 0]));
    for (const request of fake.requests) {
      const resolution = build.composition.resolveWitness(durable(request.witness));
      expect(resolution.status).toBe('bound');
      if (resolution.status === 'bound') {
        expect(resolution.witness).toEqual(request.witness);
        expect(resolution.parent.scopedSubject.subject).toBe('summary:acme/widget:person:ada');
      }
    }
  });

  test('REUSE-007: the version-1 parser rejects template-bearing descriptors, so version 1 keeps its M3 meaning', () => {
    const build = buildNestedTemplate();
    const parent = nestedInstance('summary', 'person:ada');
    const child = nestedInstance('activity', 'person:ada');
    const cases: readonly unknown[] = [
      { version: 1, parent, child, arguments: { form: 'empty' } },
      { version: 1, parent: { scope, role: 'step', slot: 'summary', memberKey: 'person:ada' }, child, arguments: { form: 'empty' } },
      { version: 1, parent, child: { scope, role: 'step', slot: 'activity', memberKey: 'person:ada' }, arguments: { form: 'empty' } },
    ];
    for (const witness of cases) {
      expect(build.composition.resolveWitness(durable(witness))).toEqual({ status: 'unsupported', reason: 'malformed' });
    }
    expect(build.composition.resolveWitness(durable({ version: 2, parent, child, index: 0, arguments: { form: 'empty' } })).status).toBe('bound');
  });

  test('CMP-6: a cross-member or malformed template witness never reconnects', () => {
    const build = buildNestedTemplate();
    const parent = nestedInstance('summary', 'person:ada');
    expect(build.composition.resolveWitness(durable({ version: 2, parent, child: nestedInstance('activity', 'person:ben'), index: 0, arguments: { form: 'empty' } })))
      .toEqual({ status: 'undeclared-edge' });
    expect(build.composition.resolveWitness(durable({ version: 2, parent, child: nestedInstance('summary', 'person:ada'), index: 0, arguments: { form: 'empty' } })))
      .toEqual({ status: 'undeclared-edge' });
    const templateWithoutCollection = { scope, role: 'step', slot: 'summary', template: 'contributor', memberKey: 'person:ada' };
    expect(build.composition.resolveWitness(durable({ version: 2, parent: templateWithoutCollection, child: nestedInstance('activity', 'person:ada'), index: 0, arguments: { form: 'empty' } })))
      .toEqual({ status: 'unsupported', reason: 'malformed' });
  });
});

describe('supplied slot subjects and template instances (RES-001)', () => {
  /** The scoped subject the assessor slot computes for one derived-argument call. */
  function slotSubjectOf(build: ReturnType<typeof buildNestedTemplate>): () => unknown {
    const resolution = build.composition.resolve(assessorSlot);
    if (resolution.status !== 'bound' || resolution.target.role !== 'callable' || resolution.target.kind !== 'supplied-step') {
      throw new Error('expected the supplied assessor slot');
    }
    const target = resolution.target;
    return () => target.subjectFor({ form: 'empty' });
  }

  test('RES-001: a slot subject equal to a template instance subject is a conflicting subject', () => {
    const colliding = buildNestedTemplate(() => 'activity:acme/widget:person:ada');
    expectDefinitionError(slotSubjectOf(colliding), 'conflicting-subject');
    const otherStep = buildNestedTemplate(() => 'summary:acme/widget:someone');
    expectDefinitionError(slotSubjectOf(otherStep), 'conflicting-subject');
  });

  test('CMP-3: a slot subject function that throws a value with no string form is an invalid subject, never an escape', () => {
    const thrown: unknown[] = [Object.create(null), Symbol('bad'), { toString: () => { throw new Error('toString failed'); } }, new Error('plain failure')];
    for (const value of thrown) {
      const build = buildNestedTemplate(() => {
        throw value;
      });
      expectDefinitionError(slotSubjectOf(build), 'invalid-subject');
    }
  });

  test('RES-001: a slot subject outside every member prefix, or the bare prefix separator, still computes', () => {
    expect(slotSubjectOf(buildNestedTemplate(() => 'assessment:acme/widget:7'))()).toEqual({ scope, subject: 'assessment:acme/widget:7' });
    expect(slotSubjectOf(buildNestedTemplate(() => 'activity:acme/widget:'))()).toEqual({ scope, subject: 'activity:acme/widget:' });
    expect(slotSubjectOf(buildNestedTemplate(() => 'activity:acme/widgets:ada'))()).toEqual({ scope, subject: 'activity:acme/widgets:ada' });
  });
});

describe('instance declarations are minted per composition', () => {
  test('CMP-4: one template composed twice mints distinct instances per composition, each stable within it', () => {
    const built = buildKeyed();
    const other = compose({ scope: 'contribution-report:acme/widget:m4', steps: [{ slot: 'contributors', declaration: built.contributors }], templates: [built.contributor] });
    for (const composition of [built.composition, other]) {
      composition.keyMembers('contributor', { members: [ada, ben], status: 'complete' });
    }
    const first = built.composition.resolve(instanceDescriptor('summary', 'person:ada'));
    const again = built.composition.resolve(instanceDescriptor('summary', 'person:ada'));
    const elsewhere = other.resolve(instanceDescriptor('summary', 'person:ada'));
    const declarationOf = (resolution: typeof first): unknown => resolution.status === 'bound' && resolution.target.role === 'step' ? resolution.target.declaration : undefined;
    expect(declarationOf(first)).toBeDefined();
    expect(declarationOf(again)).toBe(declarationOf(first));
    expect(declarationOf(elsewhere)).toBeDefined();
    expect(declarationOf(elsewhere)).not.toBe(declarationOf(first));
    expect(built.factoryCalls()).toBe(1);
  });

  test('CMP-4: lookups for member keys the composition never keyed mint fresh instances and retain nothing', () => {
    const built = buildKeyed();
    const declarationOf = (key: string): unknown => {
      const resolution = built.composition.resolve(instanceDescriptor('summary', key));
      return resolution.status === 'bound' && resolution.target.role === 'step' ? resolution.target.declaration : undefined;
    };
    // An untrusted historical key resolves structurally, but is not retained.
    const lookup = declarationOf('person:zed');
    expect(lookup).toBeDefined();
    expect(declarationOf('person:zed')).not.toBe(lookup);
    // Once keying discovers the member, its instances are cached and stable.
    built.composition.keyMembers('contributor', { members: [{ key: 'person:zed' }], status: 'open' });
    const keyed = declarationOf('person:zed');
    expect(declarationOf('person:zed')).toBe(keyed);
    // A rejected snapshot retains nothing.
    built.composition.keyMembers('contributor', { members: [{ key: 'person:yan' }, { key: 'person:yan' }], status: 'complete' });
    expect(declarationOf('person:yan')).not.toBe(declarationOf('person:yan'));
  });
});
