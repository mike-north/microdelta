/**
 * Outcome tests for argument-bearing declared calls and the nested invocation
 * witness they dispatch.
 *
 * A nested parent (one that declares a memo child or a supplied step slot)
 * dispatches version-2 witnesses carrying its call order and one argument
 * recipe per argument: `forwarded` origins minted by `forward`, `derived`
 * canonical MDS1 values with the port-supplied justification, or
 * `unreconstructible` reasons. A raw tracked view is rejected before dispatch.
 * A slot call's history subject comes only from the slot's subject function
 * and the call's derived values. Parents whose children are all sources keep
 * the M3 version-1 witness.
 *
 * @see ../../../docs/spec/composition.md (CMP-3, CMP-5, CMP-7, CMP-9, EXP-4 argument recipe)
 * @see ../../../docs/spec/execution.md (RES-001, REUSE-006, REUSE-007)
 * @see ../../../docs/spec/tracking.md (EXP-2 encoding selection: MDS1 snapshot transport)
 * @see ../../../docs/plans/m4-composition.md ("Nested invocation evidence")
 */
import { describe, expect, jest, test } from '@jest/globals';
import { decodeSnapshot, encodeSnapshot } from '@microdelta/value';

import {
  describeHandle,
  type IBindingDescriptor,
  type ICalls,
  type IChildResult,
  type IDeclaredInvocationRequest,
  type IDerivedArguments,
  type IMemoInvocation,
} from '../src/index.js';
import { compose, memo, openInvocation, source, type ITestFamily } from './fixtures/contributors.js';
import {
  assessmentSubject,
  buildNested,
  forward,
  nestedScope,
  rubric,
  stepSlot,
  supply,
  type IAssessment,
  type IAssessorParameters,
  type INestedBuild,
  type INestedMemberKey,
  type IPullRequest,
  type ISummaryChildren,
} from './fixtures/nested.js';
import {
  callUntyped,
  directInvoker,
  expectDefinitionError,
  expectRejection,
  fakePort,
  rejectionOf,
  type IFakePort,
} from './fixtures/port.js';

/** A member step descriptor. */
function memberStep(memberKey: string, slot: string): IBindingDescriptor {
  return { scope: nestedScope, role: 'step', slot, memberKey };
}

/** A composition-level step descriptor. */
function levelStep(slot: string): IBindingDescriptor {
  return { scope: nestedScope, role: 'step', slot };
}

/** The assessor slot descriptor. */
const assessorSlot: IBindingDescriptor = { scope: nestedScope, role: 'callable', slot: 'assessor' };

/** A PR record as plain author data. */
const merged: IPullRequest = { number: 7, merged: true };

/** Narrow an open invocation to a memo. */
function asMemo(invocation: ReturnType<typeof openInvocation>): IMemoInvocation<ITestFamily> {
  if (invocation.kind !== 'memo') {
    throw new Error('expected a memo invocation');
  }
  return invocation;
}

/** Open a member's summary, make it active, run its body and return its calls. */
function openSummary(build: INestedBuild, key: INestedMemberKey, fake: IFakePort): {
  readonly invocation: IMemoInvocation<ITestFamily>;
  readonly calls: ICalls<ITestFamily, ISummaryChildren>;
} {
  const invocation = asMemo(openInvocation(build.composition, memberStep(key, 'summary'), fake.port));
  fake.active = invocation;
  invocation.apply({}, directInvoker());
  const calls = build.members[key].captured.calls;
  if (calls === undefined) {
    throw new Error('the summary did not receive its calls');
  }
  return { invocation, calls };
}

/** The request dispatched at one position, failing the test otherwise. */
function requestAt(fake: IFakePort, position: number): IDeclaredInvocationRequest<ITestFamily, unknown> {
  const request = fake.requests[position];
  if (request === undefined) {
    throw new Error(`no request at ${String(position)}`);
  }
  return request;
}

/** The first activity result a summary receives, as a genuine carrier. */
async function activityResult(calls: ICalls<ITestFamily, ISummaryChildren>, fake: IFakePort): Promise<IChildResult<unknown>> {
  fake.result = { data: { pullRequests: [merged] } };
  const result = await calls.activity();
  fake.result = { data: { score: 2, explanation: 'x' } };
  return result;
}

/** A subject function that breaks its type contract at runtime, as untyped author code could. */
function returnsNonString(): (derived: IDerivedArguments<IAssessorParameters>) => string {
  const value: unknown = 42;
  // Test-only: deliberately violates the subject contract to exercise runtime validation.
  return () => value as string;
}

describe('version-2 witnesses in call order (acceptance 5)', () => {
  test('REUSE-006: a nested parent dispatches version-2 witnesses in its call order, including repeated calls to one slot', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { invocation, calls } = openSummary(build, 'person:ada', fake);
    const activity = await activityResult(calls, fake);
    await calls.profile();
    await calls.assess(7, forward.child<IPullRequest>(activity, ['pullRequests', 0]));
    await calls.assess(8, { number: 8, merged: false });
    expect(fake.requests.map(request => request.kind)).toEqual(['source', 'memo', 'supplied', 'supplied']);
    expect(fake.requests.map(request => request.scope)).toEqual([invocation, invocation, invocation, invocation]);
    expect(requestAt(fake, 0).witness).toEqual({
      version: 2, parent: memberStep('person:ada', 'summary'), child: memberStep('person:ada', 'activity'), index: 0, arguments: { form: 'empty' },
    });
    expect(requestAt(fake, 1).witness).toEqual({
      version: 2, parent: memberStep('person:ada', 'summary'), child: memberStep('person:ada', 'profile'), index: 1, arguments: { form: 'empty' },
    });
    expect(requestAt(fake, 2).witness).toEqual({
      version: 2,
      parent: memberStep('person:ada', 'summary'),
      child: assessorSlot,
      index: 2,
      arguments: [
        { form: 'derived', value: encodeSnapshot(7), justified: true },
        { form: 'forwarded', origin: { binding: 'child', call: 0, path: [{ kind: 'property', key: 'pullRequests' }, { kind: 'index', index: 0 }] } },
      ],
    });
    expect(requestAt(fake, 3).witness).toEqual({
      version: 2,
      parent: memberStep('person:ada', 'summary'),
      child: assessorSlot,
      index: 3,
      arguments: [
        { form: 'derived', value: encodeSnapshot(8), justified: true },
        { form: 'derived', value: encodeSnapshot({ number: 8, merged: false }), justified: true },
      ],
    });
    expect(requestAt(fake, 0).child).toBe(build.members['person:ada'].activity);
    expect(requestAt(fake, 1).child).toBe(build.members['person:ada'].profile);
    expect(requestAt(fake, 2).child).toBe(build.rubric);
    expect(fake.requests.every(request => Object.isFrozen(request) && Object.isFrozen(request.witness))).toBe(true);
  });

  test('REUSE-006: derived values are canonical MDS1 snapshots that decode to the author value, preserving key order', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    await calls.assess(9, { merged: true, number: 9 });
    const recipes = requestAt(fake, 0).witness.arguments;
    expect(Array.isArray(recipes)).toBe(true);
    const second: unknown = Array.isArray(recipes) ? recipes[1] : undefined;
    expect(second).toEqual({ form: 'derived', value: encodeSnapshot({ merged: true, number: 9 }), justified: true });
    const value = typeof second === 'object' && second !== null && 'value' in second && typeof second.value === 'string' ? second.value : '';
    expect(decodeSnapshot(value)).toEqual({ merged: true, number: 9 });
    expect(Object.keys(decodeSnapshot(value) as object)).toEqual(['merged', 'number']);
  });

  test('REUSE-006: justified is carried from the port at call time for derived arguments only; Definition never computes it', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const activity = await activityResult(calls, fake);
    fake.justified = false;
    await calls.assess(7, forward.child<IPullRequest>(activity, ['pullRequests', 0]));
    fake.justified = true;
    const queriesBeforeForwardedOnly = fake.justifiedQueries;
    await calls.assess(forward.input<number>('config', ['minimumAuthored']), forward.child<IPullRequest>(activity, ['pullRequests', 0]));
    expect(fake.justifiedQueries).toBe(queriesBeforeForwardedOnly);
    await calls.assess(7, merged);
    expect(requestAt(fake, 1).witness.arguments).toEqual([
      { form: 'derived', value: encodeSnapshot(7), justified: false },
      { form: 'forwarded', origin: { binding: 'child', call: 0, path: [{ kind: 'property', key: 'pullRequests' }, { kind: 'index', index: 0 }] } },
    ]);
    expect(requestAt(fake, 3).witness.arguments).toEqual([
      { form: 'derived', value: encodeSnapshot(7), justified: true },
      { form: 'derived', value: encodeSnapshot(merged), justified: true },
    ]);
    expect(fake.justifiedQueries).toBe(2);
  });

  test('M3 compatibility: parents whose children are all sources dispatch the version-1 witness, including composition-level parents', async () => {
    const fake = fakePort();
    let calls: { readonly discovery: () => Promise<IChildResult<unknown>> } | undefined;
    const discovery = source({ subject: 'contributors:v1', run: () => 1 });
    const parent = memo({ subject: 'report:v1', children: { discovery }, run: context => {
      calls = context.calls;
      return 1;
    } });
    const composition = compose({ scope: nestedScope, steps: [{ slot: 'discovery', declaration: discovery }, { slot: 'report', declaration: parent }] });
    const opened = asMemo(openInvocation(composition, levelStep('report'), fake.port));
    fake.active = opened;
    opened.apply({}, directInvoker());
    await calls?.discovery();
    expect(requestAt(fake, 0).kind).toBe('source');
    expect(requestAt(fake, 0).witness).toEqual({ version: 1, parent: levelStep('report'), child: levelStep('discovery'), arguments: { form: 'empty' } });
  });
});

describe('argument-bearing handles (acceptance 4)', () => {
  test('CMP-7: forward records an input path and an earlier call of the same invocation', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const activity = await activityResult(calls, fake);
    await calls.assess(forward.input<number>('config', ['minimumAuthored']), forward.child<IPullRequest>(activity, ['pullRequests', 0]));
    await calls.assess(1, forward.child<IPullRequest>(activity));
    await calls.assess(forward.input<number>('config', ['0']), forward.child<IPullRequest>(activity, [0]));
    expect(requestAt(fake, 1).witness.arguments).toEqual([
      { form: 'forwarded', origin: { binding: 'input', slot: 'config', path: [{ kind: 'property', key: 'minimumAuthored' }] } },
      { form: 'forwarded', origin: { binding: 'child', call: 0, path: [{ kind: 'property', key: 'pullRequests' }, { kind: 'index', index: 0 }] } },
    ]);
    expect(requestAt(fake, 2).witness.arguments).toEqual([
      { form: 'derived', value: encodeSnapshot(1), justified: true },
      { form: 'forwarded', origin: { binding: 'child', call: 0, path: [] } },
    ]);
    // A string "0" is a property key, a number 0 an array index; they are never normalized.
    expect(requestAt(fake, 3).witness.arguments).toEqual([
      { form: 'forwarded', origin: { binding: 'input', slot: 'config', path: [{ kind: 'property', key: '0' }] } },
      { form: 'forwarded', origin: { binding: 'child', call: 0, path: [{ kind: 'index', index: 0 }] } },
    ]);
  });

  test('CMP-9: member origins require a template instance; an explicit member rejects them at record time', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const error = await rejectionOf(calls.assess(7, forward.member<IPullRequest>(['pullRequests', 0])));
    expect(error?.code).toBe('invalid-argument');
    expect(error?.message).toContain('template instance');
    expect(fake.requests).toHaveLength(0);
    expect(fake.justifiedQueries).toBe(0);
    // The rejected call consumed no call position.
    await calls.assess(7, merged);
    expect(requestAt(fake, 0).witness).toMatchObject({ index: 0 });
  });

  test('CMP-9: a rejected call is classified before any encoding and never queries argumentsJustified', async () => {
    const build = buildNested();
    const fake = fakePort();
    const ben = openSummary(build, 'person:ben', fake);
    const benActivity = await activityResult(ben.calls, fake);
    const { calls } = openSummary(build, 'person:ada', fake);
    const view = { number: 7, merged: true };
    fake.tracked.add(view);
    const before = fake.requests.length;
    await expectRejection(callUntyped(calls.assess, 7, forward.input('undeclared')), 'invalid-argument');
    await expectRejection(callUntyped(calls.assess, 7, forward.child(benActivity)), 'invalid-argument');
    await expectRejection(callUntyped(calls.assess, 7, forward.member()), 'invalid-argument');
    await expectRejection(callUntyped(calls.assess, 7, view), 'invalid-argument');
    expect(fake.justifiedQueries).toBe(0);
    expect(fake.requests).toHaveLength(before);
  });

  test('CMP-9: a tracked view reached through a prototype chain is rejected without being read', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const traps: string[] = [];
    const view = new Proxy({ number: 7, merged: true }, {
      get(target, key, receiver): unknown {
        traps.push(`get:${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
    });
    fake.tracked.add(view);
    const inheriting: unknown = Object.create(view);
    await expectRejection(callUntyped(calls.assess, 7, inheriting), 'invalid-argument');
    await expectRejection(callUntyped(calls.assess, 7, { nested: inheriting }), 'invalid-argument');
    expect(traps).toEqual([]);
    expect(fake.requests).toHaveLength(0);
  });

  test('CMP-7: unsupported values are recorded unreconstructible, never rejected and never read', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const getter = jest.fn(() => 1);
    class Custom {
      public readonly number = 1;
    }
    const unsupported: readonly unknown[] = [
      () => 'callback',
      Symbol('token'),
      Object.defineProperty({ number: 1 }, 'merged', { get: getter, enumerable: true }),
      10n,
      new Custom(),
      { number: 1, merged: () => true },
    ];
    for (const value of unsupported) {
      await callUntyped(calls.assess, 7, value);
    }
    expect(fake.requests).toHaveLength(unsupported.length);
    for (const request of fake.requests) {
      const recipes = request.witness.arguments;
      expect(Array.isArray(recipes) ? recipes[1] : undefined).toMatchObject({ form: 'unreconstructible', reason: expect.any(String) });
      expect(Object.keys(request).sort()).toEqual(['child', 'kind', 'scope', 'subject', 'witness']);
      expect(JSON.stringify(request.witness)).not.toContain('callback');
    }
    expect(getter).not.toHaveBeenCalled();
    // The reason is durable evidence: a small stable vocabulary, never an encoder's message text.
    expect(fake.requests.map(request => {
      const recipes = request.witness.arguments;
      const second = 'form' in recipes ? undefined : recipes[1];
      return second?.form === 'unreconstructible' ? second.reason : undefined;
    })).toEqual(['function', 'symbol', 'accessor', 'bigint', 'unsupported-value', 'function']);
  });

  test('CMP-9: a raw tracked view is rejected before dispatch with a diagnostic pointing to forward, without being read', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const traps: string[] = [];
    const view = new Proxy({ number: 7, merged: true }, {
      get(target, key, receiver): unknown {
        traps.push(`get:${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target): (string | symbol)[] {
        traps.push('ownKeys');
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
        traps.push(`own:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    fake.tracked.add(view);
    for (const argument of [view, { nested: view }, [1, view]]) {
      const error = await rejectionOf(callUntyped(calls.assess, 7, argument));
      expect(error?.code).toBe('invalid-argument');
      expect(error?.message).toContain('forward');
    }
    expect(fake.requests).toHaveLength(0);
    expect(traps).toEqual([]);
  });

  test('CMP-7: a forward origin nested inside data is rejected rather than retained as derived data', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const error = await rejectionOf(callUntyped(calls.assess, 7, { pullRequest: forward.input('config') }));
    expect(error?.code).toBe('invalid-argument');
    expect(error?.message).toContain('whole arguments');
    expect(fake.requests).toHaveLength(0);
  });

  test('CMP-9: forward origins that do not belong to the calling invocation reject before dispatch', async () => {
    const build = buildNested();
    const fake = fakePort();
    const ben = openSummary(build, 'person:ben', fake);
    const benActivity = await activityResult(ben.calls, fake);
    const ada = openSummary(build, 'person:ada', fake);
    const before = fake.requests.length;
    await expectRejection(ada.calls.assess(7, forward.child<IPullRequest>(benActivity)), 'invalid-argument');
    await expectRejection(ada.calls.assess(forward.input<number>('undeclared'), merged), 'invalid-argument');
    expect(fake.requests).toHaveLength(before);
  });

  test('CMP-9: a composition-level parent has no member binding to forward', async () => {
    const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
    let calls: { readonly assess: ICalls<ITestFamily, { readonly assess: typeof assessor }>['assess'] } | undefined;
    const report = memo({ subject: 'report:slot', children: { assess: assessor }, run: context => {
      calls = context.calls;
      return 1;
    } });
    const composition = compose({
      scope: nestedScope,
      steps: [{ slot: 'report', declaration: report }],
      supplied: [supply({ slot: assessor, declaration: rubric('A'), subject: assessmentSubject })],
    });
    const fake = fakePort();
    const invocation = asMemo(openInvocation(composition, levelStep('report'), fake.port));
    fake.active = invocation;
    invocation.apply({}, directInvoker());
    await expectRejection(calls?.assess(7, forward.member<IPullRequest>()) ?? Promise.resolve(), 'invalid-argument');
    await calls?.assess(7, merged);
    expect(requestAt(fake, 0).witness).toMatchObject({ parent: levelStep('report'), child: assessorSlot, index: 0 });
  });

  test('declaration: forward rejects malformed origins when minted', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const activity = await activityResult(calls, fake);
    expectDefinitionError(() => forward.input(''), 'invalid-argument');
    expectDefinitionError(() => forward.input('config', [-1]), 'invalid-argument');
    expectDefinitionError(() => forward.input('config', [1.5]), 'invalid-argument');
    expectDefinitionError(() => Reflect.apply(forward.input, undefined, ['config', [{}]]), 'invalid-argument');
    expectDefinitionError(() => Reflect.apply(forward.member, undefined, ['pullRequests']), 'invalid-argument');
    expectDefinitionError(() => forward.child({ data: 1 }), 'invalid-argument');
    expectDefinitionError(() => forward.child({ ...activity }), 'invalid-argument');
    const token = forward.input('config');
    expect(Object.isFrozen(token)).toBe(true);
    expect(Object.isFrozen(token.origin)).toBe(true);
  });

  test('ownership: a forward look-alike is ordinary derived data, never a forwarded origin', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const lookalike = { origin: { binding: 'input', slot: 'config', path: [] } };
    await callUntyped(calls.assess, 7, lookalike);
    const recipes = requestAt(fake, 0).witness.arguments;
    expect(Array.isArray(recipes) ? recipes[1] : undefined).toEqual({ form: 'derived', value: encodeSnapshot(lookalike), justified: true });
  });

  test('CMP-9: slot handles reject while composing, after close and from an inactive scope, before dispatch', async () => {
    const build = buildNested();
    const fake = fakePort();
    const ben = openSummary(build, 'person:ben', fake);
    const ada = openSummary(build, 'person:ada', fake);
    await expectRejection(ben.calls.assess(7, merged), 'scope-inactive');
    let attempted: Promise<unknown> | undefined;
    const members = new Proxy([...(build.options.members ?? [])], {
      get(target, key, receiver): unknown {
        if (key === '0' && attempted === undefined) {
          attempted = ada.calls.assess(7, merged);
        }
        return Reflect.get(target, key, receiver);
      },
    });
    compose({ ...build.options, members });
    await expectRejection(attempted ?? Promise.resolve(), 'composition-phase');
    ada.invocation.close();
    await expectRejection(ada.calls.assess(7, merged), 'scope-closed');
    expect(fake.requests).toHaveLength(0);
  });

  test('CMP-7: sibling memo and source handles in a nested parent still take no runtime arguments', async () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    await expectRejection(callUntyped(calls.profile, 1), 'unsupported-arguments');
    await expectRejection(callUntyped(calls.activity, forward.input('config')), 'unsupported-arguments');
    expect(fake.requests).toHaveLength(0);
  });

  test('identity: nested handles are described by parent and child only; wrappers and look-alikes are not handles', () => {
    const build = buildNested();
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    expect(describeHandle(calls.assess)).toEqual({ version: 2, parent: memberStep('person:ada', 'summary'), child: assessorSlot });
    expect(describeHandle(calls.profile)).toEqual({ version: 2, parent: memberStep('person:ada', 'summary'), child: memberStep('person:ada', 'profile') });
    expect(describeHandle((...values: unknown[]) => callUntyped(calls.assess, ...values))).toBeUndefined();
    expect(Object.isFrozen(calls.assess)).toBe(true);
  });
});

describe('slot call subjects (acceptance 6)', () => {
  test('RES-001: a slot call subject comes from the slot subject function over derived values only', async () => {
    const seen: IDerivedArguments<IAssessorParameters>[] = [];
    const subject = jest.fn((derived: IDerivedArguments<IAssessorParameters>): string => {
      seen.push(derived);
      return assessmentSubject(derived);
    });
    const build = buildNested({ subject });
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const activity = await activityResult(calls, fake);
    await calls.assess(7, forward.child<IPullRequest>(activity, ['pullRequests', 0]));
    const request = requestAt(fake, 1);
    expect(request.kind === 'supplied' ? request.subject : undefined).toEqual({ scope: nestedScope, subject: 'assessment:acme/widget:7' });
    expect(subject).toHaveBeenCalledTimes(1);
    const [derived] = seen;
    expect(derived?.length).toBe(2);
    expect(derived === undefined ? undefined : 0 in derived).toBe(true);
    expect(derived === undefined ? undefined : 1 in derived).toBe(false);
    expect(derived?.[0]).toBe(7);
    expect(Object.isFrozen(derived)).toBe(true);
  });

  test('RES-001: derived values reach the subject function as frozen decoded copies, never the author objects', async () => {
    const seen: IDerivedArguments<IAssessorParameters>[] = [];
    const build = buildNested({ subject: derived => {
      seen.push(derived);
      return `assessment:acme/widget:${String(derived[1]?.number)}`;
    } });
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const author = { number: 11, merged: false };
    await calls.assess(11, author);
    const copy = seen[0]?.[1];
    expect(copy).toEqual(author);
    expect(copy).not.toBe(author);
    expect(Object.isFrozen(copy)).toBe(true);
    const request = requestAt(fake, 0);
    expect(request.kind === 'supplied' ? request.subject.subject : undefined).toBe('assessment:acme/widget:11');
  });

  test('CMP-3: the subject is identical across supplied implementations A and B', async () => {
    const subjects: unknown[] = [];
    const children: unknown[] = [];
    for (const which of ['A', 'B'] as const) {
      const build = buildNested({ rubric: which });
      const fake = fakePort();
      const { calls } = openSummary(build, 'person:ada', fake);
      await calls.assess(7, merged);
      const request = requestAt(fake, 0);
      subjects.push(request.kind === 'supplied' ? request.subject : undefined);
      children.push(request.child);
      expect(request.witness.child).toEqual(assessorSlot);
    }
    expect(subjects[0]).toEqual({ scope: nestedScope, subject: 'assessment:acme/widget:7' });
    expect(subjects[1]).toEqual(subjects[0]);
    expect(children[1]).not.toBe(children[0]);
  });

  test('RES-001: forwarded and unreconstructible arguments never enter the subject', async () => {
    const keys: string[] = [];
    const build = buildNested({ subject: derived => {
      keys.push(Object.keys(derived).join(','));
      return 'assessment:acme/widget:constant';
    } });
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    const activity = await activityResult(calls, fake);
    await calls.assess(7, forward.child<IPullRequest>(activity, ['pullRequests', 0]));
    await callUntyped(calls.assess, 7, () => merged);
    await calls.assess(forward.input<number>('config', ['minimumAuthored']), merged);
    expect(keys).toEqual(['0', '0', '1']);
  });

  test('RES-001: a slot call subject equal to a declared step subject is a conflicting subject, rejected before dispatch', async () => {
    const build = buildNested({ subject: () => 'summary:acme/widget:2026-Q1:person:ben' });
    const fake = fakePort();
    const { calls } = openSummary(build, 'person:ada', fake);
    await expectRejection(calls.assess(7, merged), 'conflicting-subject');
    expect(fake.requests).toHaveLength(0);
  });

  test('RES-001: a subject function that throws or returns an incomplete subject rejects before dispatch', async () => {
    const outcomes: readonly ((derived: IDerivedArguments<IAssessorParameters>) => string)[] = [
      () => '',
      () => {
        throw new Error('subject failed');
      },
      returnsNonString(),
    ];
    for (const subject of outcomes) {
      const build = buildNested({ subject });
      const fake = fakePort();
      const { calls } = openSummary(build, 'person:ada', fake);
      await expectRejection(calls.assess(7, merged), 'invalid-subject');
      expect(fake.requests).toHaveLength(0);
    }
  });
});
