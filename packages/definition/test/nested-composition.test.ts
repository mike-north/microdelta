/**
 * Outcome tests for the nested composition shape: composition-level steps with
 * no member key, memo-to-memo and memo-to-source edges pinned at composition,
 * and supplied callable step slots bound at composition with an author subject
 * function. Missing and ambiguous correspondence stay distinct outcomes and
 * never fall back by name, subject, hash, function identity or ordinal.
 *
 * @see ../../../docs/spec/composition.md (CMP-1, CMP-3, CMP-6, CMP-7, CMP-9, EXP-4 supplied-callable selection)
 * @see ../../../docs/spec/execution.md (RES-001, REUSE-006, REUSE-007)
 * @see ../../../docs/plans/m4-composition.md ("Authoring shape", Definition row of "Owner contracts")
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  DefinitionError,
  declarations,
  isDeclaration,
  type IAuthorInvoker,
  type IBindingDescriptor,
  type IInvocationPort,
  type IStepDeclaration,
} from '../src/index.js';
import { compose, memo, openInvocation, source, type ITestFamily } from './fixtures/contributors.js';
import { argumentSupplier } from './fixtures/port.js';
import {
  assessmentSubject,
  buildNested,
  nestedMember,
  nestedScope,
  rubric,
  stepSlot,
  suppliedStep,
  supply,
  type IAssessment,
  type IAssessorParameters,
} from './fixtures/nested.js';

/** A composition-level step descriptor: no member key at all. */
function levelStep(slot: string): IBindingDescriptor {
  return { scope: nestedScope, role: 'step', slot };
}

/** A member step descriptor. */
function memberStep(memberKey: string, slot: string): IBindingDescriptor {
  return { scope: nestedScope, role: 'step', slot, memberKey };
}

/** A supplied step slot descriptor. */
function slotDescriptor(slot: string): IBindingDescriptor {
  return { scope: nestedScope, role: 'callable', slot };
}

/** Round-trip through JSON as durable evidence would. */
function durable<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** Assert a synchronous failure carries the expected Definition error code. */
function expectDefinitionError(action: () => unknown, code: DefinitionError['code']): void {
  let caught: unknown;
  try {
    action();
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DefinitionError);
  expect(caught instanceof DefinitionError ? caught.code : undefined).toBe(code);
}

/** A port that must never dispatch in these tests. */
const idlePort: IInvocationPort<ITestFamily> = {
  active: () => undefined,
  dispatch: () => Promise.reject(new Error('unexpected dispatch')),
  isTrackedView: () => false,
  argumentsJustified: () => true,
};

/** An invoker that records every callback handed to it. */
function recording(seen: unknown[]): IAuthorInvoker<unknown> {
  return <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): unknown => {
    seen.push(callback);
    return callback(context);
  };
}

describe('composition-level steps (acceptance 1)', () => {
  test('CMP-1: composition-level steps are registered beside members and their descriptors carry no member key', () => {
    const { composition } = buildNested();
    const levelSteps = composition.topology.steps.filter(step => step.memberKey === undefined);
    expect(levelSteps).toEqual([levelStep('discovery'), levelStep('report')]);
    expect(levelSteps.every(step => !Object.hasOwn(step, 'memberKey'))).toBe(true);
    expect(composition.topology.steps).toHaveLength(8);
    expect(composition.topology.edges).toContainEqual({ parent: levelStep('report'), child: levelStep('discovery') });
  });

  test('CMP-6: a composition-level step resolves by slot to its own declaration after a reordered restart', () => {
    const before = buildNested();
    const after = buildNested({ order: 'reversed' });
    for (const build of [before, after]) {
      const resolution = build.composition.resolve(levelStep('discovery'));
      expect(resolution).toMatchObject({ status: 'bound', target: { role: 'step', declaration: build.discovery, scopedSubject: { scope: nestedScope, subject: 'contributors:acme/widget:2026-Q1' } } });
    }
    expect(durable(after.composition.topology)).toEqual(durable(before.composition.topology));
  });

  test('CMP-6: missing composition-level steps are missing, with no fallback to a member step or a subject', () => {
    const { composition } = buildNested();
    const cases: readonly IBindingDescriptor[] = [
      levelStep('summary'),
      levelStep('contributors:acme/widget:2026-Q1'),
      memberStep('person:ada', 'discovery'),
      { scope: 'other-analysis', role: 'step', slot: 'discovery' },
    ];
    for (const descriptor of cases) {
      expect(composition.resolve(descriptor)).toEqual({ status: 'missing', descriptor });
    }
  });

  test('EXP-1: a multiply occupied composition-level slot is ambiguous, distinct from missing, and cannot be opened', () => {
    const first = source({ subject: 'contributors:first', run: () => 1 });
    const second = source({ subject: 'contributors:second', run: () => 2 });
    const composition = compose({ scope: nestedScope, steps: [{ slot: 'discovery', declaration: first }, { slot: 'discovery', declaration: second }] });
    expect(composition.resolve(levelStep('discovery'))).toEqual({ status: 'ambiguous', descriptor: levelStep('discovery'), occupants: 2 });
    expectDefinitionError(() => openInvocation(composition, levelStep('discovery'), idlePort), 'unresolved-parent');
    expectDefinitionError(() => openInvocation(composition, levelStep('absent'), idlePort), 'unresolved-parent');
  });

  test('CMP-1: a composition may declare only composition-level steps', () => {
    const discovery = source({ subject: 'contributors:only', run: () => 1 });
    const composition = compose({ scope: nestedScope, steps: [{ slot: 'discovery', declaration: discovery }] });
    expect(composition.topology.steps).toEqual([levelStep('discovery')]);
    expect(openInvocation(composition, levelStep('discovery'), idlePort).kind).toBe('source');
  });

  test('RES-001: composition-level and member steps share one scoped subject namespace', () => {
    const shared = source({ subject: 'activity:shared', run: () => 1 });
    const impostor = source({ subject: 'activity:shared', run: () => 2 });
    expectDefinitionError(() => compose({
      scope: nestedScope,
      steps: [{ slot: 'discovery', declaration: shared }],
      members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: impostor }] }],
    }), 'conflicting-subject');
  });

  test('CMP-7: a member memo cannot name a composition-level step, and a composition-level memo cannot name a member step', () => {
    const discovery = source({ subject: 'contributors:x', run: () => 1 });
    const summary = memo({ subject: 'summary:x', children: { discovery }, run: () => 1 });
    expectDefinitionError(() => compose({
      scope: nestedScope,
      steps: [{ slot: 'discovery', declaration: discovery }],
      members: [{ key: 'person:ada', steps: [{ slot: 'summary', declaration: summary }] }],
    }), 'illegal-edge');
    const activity = source({ subject: 'activity:x', run: () => 1 });
    const report = memo({ subject: 'report:x', children: { activity }, run: () => 1 });
    expectDefinitionError(() => compose({
      scope: nestedScope,
      steps: [{ slot: 'report', declaration: report }],
      members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }] }],
    }), 'illegal-edge');
  });

  test('CMP-9: composition-level step registrations are captured without running accessors, and later mutation is inert', () => {
    const getter = jest.fn(() => source({ subject: 'contributors:getter', run: () => 1 }));
    const accessor = Object.defineProperty({ slot: 'discovery' }, 'declaration', { get: getter, enumerable: true });
    expectDefinitionError(() => Reflect.apply(compose, undefined, [{ scope: nestedScope, steps: [accessor] }]), 'forged-declaration');
    expect(getter).not.toHaveBeenCalled();
    const discovery = source({ subject: 'contributors:y', run: () => 1 });
    const steps = [{ slot: 'discovery', declaration: discovery }];
    const composition = compose({ scope: nestedScope, steps });
    steps.push({ slot: 'late', declaration: source({ subject: 'late', run: () => 1 }) });
    expect(composition.resolve(levelStep('late')).status).toBe('missing');
  });
});

describe('memo children (acceptance 2)', () => {
  test('CMP-7: a memo names a memo child and a source child; both edges are declared and pinned in the topology', () => {
    const { composition } = buildNested();
    for (const key of ['person:ada', 'person:ben']) {
      expect(composition.topology.edges).toContainEqual({ parent: memberStep(key, 'summary'), child: memberStep(key, 'profile') });
      expect(composition.topology.edges).toContainEqual({ parent: memberStep(key, 'summary'), child: memberStep(key, 'activity') });
      expect(composition.topology.edges).toContainEqual({ parent: memberStep(key, 'profile'), child: memberStep(key, 'activity') });
    }
  });

  test('CMP-7: a memo child with no declared sibling slot is an undeclared edge rejected with illegal-edge', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const profile = memo({ subject: 'profile:a', children: { activity }, run: () => 1 });
    const summary = memo({ subject: 'summary:a', children: { profile }, run: () => 1 });
    expectDefinitionError(() => compose({
      scope: nestedScope,
      members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }, { slot: 'summary', declaration: summary }] }],
    }), 'illegal-edge');
  });

  test('CMP-7: a memo child slot occupied by a different memo declaration is rejected with illegal-edge', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const pinned = memo({ subject: 'profile:a', children: { activity }, run: () => 1 });
    const occupant = memo({ subject: 'profile:b', children: { activity }, run: () => 1 });
    const summary = memo({ subject: 'summary:a', children: { profile: pinned }, run: () => 1 });
    expectDefinitionError(() => compose({
      scope: nestedScope,
      members: [{
        key: 'person:ada',
        steps: [{ slot: 'activity', declaration: activity }, { slot: 'profile', declaration: occupant }, { slot: 'summary', declaration: summary }],
      }],
    }), 'illegal-edge');
  });

  test('CMP-7: a memo child in an ambiguous sibling slot is rejected rather than chosen by order', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const profile = memo({ subject: 'profile:a', children: { activity }, run: () => 1 });
    const summary = memo({ subject: 'summary:a', children: { profile }, run: () => 1 });
    expectDefinitionError(() => compose({
      scope: nestedScope,
      members: [{
        key: 'person:ada',
        steps: [
          { slot: 'activity', declaration: activity },
          { slot: 'profile', declaration: profile },
          { slot: 'profile', declaration: profile },
          { slot: 'summary', declaration: summary },
        ],
      }],
    }), 'illegal-edge');
  });

  test('CMP-1: memo edges cannot form a cycle; a parent occupying its own child slot is rejected', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const profile = memo({ subject: 'profile:a', children: { activity }, run: () => 1 });
    const summary = memo({ subject: 'summary:a', children: { profile }, run: () => 1 });
    expectDefinitionError(() => compose({
      scope: nestedScope,
      members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }, { slot: 'profile', declaration: summary }] }],
    }), 'illegal-edge');
  });

  test('ownership: a supplied step or a forged object cannot be a memo child', () => {
    const implementation = rubric('A');
    expectDefinitionError(() => Reflect.apply(memo, undefined, [{ subject: 'summary:a', children: { assess: implementation }, run: () => 1 }]), 'illegal-edge');
    const forgedSlot: unknown = { kind: 'step-slot', slot: 'assessor' };
    expectDefinitionError(() => Reflect.apply(memo, undefined, [{ subject: 'summary:a', children: { assess: forgedSlot }, run: () => 1 }]), 'forged-declaration');
  });
});

describe('supplied callable step slots (acceptance 3)', () => {
  test('CMP-3: composition binds one supplied step to the slot; the slot resolves to it and parents name only the slot descriptor', () => {
    const build = buildNested();
    const resolution = build.composition.resolve(slotDescriptor('assessor'));
    expect(resolution).toMatchObject({ status: 'bound', target: { role: 'callable', kind: 'supplied-step', declaration: build.rubric } });
    expect(build.composition.topology.slots).toEqual(['assessor']);
    for (const key of ['person:ada', 'person:ben']) {
      expect(build.composition.topology.edges).toContainEqual({ parent: memberStep(key, 'summary'), child: slotDescriptor('assessor') });
    }
    expect(JSON.stringify(build.composition.topology)).not.toContain('rubric');
  });

  test('CMP-3: supplying implementation B instead of A changes the slot target, never the topology', () => {
    const a = buildNested({ rubric: 'A' });
    const b = buildNested({ rubric: 'B', order: 'reversed' });
    expect(durable(b.composition.topology)).toEqual(durable(a.composition.topology));
    expect(b.composition.resolve(slotDescriptor('assessor'))).toMatchObject({ status: 'bound', target: { declaration: b.rubric } });
  });

  test('EXP-4: opening a parent whose declared slot is unsupplied rejects with missing-slot before any callback runs', () => {
    const build = buildNested({ supplied: 'none' });
    expect(build.composition.resolve(slotDescriptor('assessor'))).toEqual({ status: 'missing', descriptor: slotDescriptor('assessor') });
    expectDefinitionError(() => openInvocation(build.composition, memberStep('person:ada', 'summary'), idlePort), 'missing-slot');
    expect(build.members['person:ada'].captured.calls).toBeUndefined();
    // A parent that does not declare the slot still opens.
    expect(openInvocation(build.composition, memberStep('person:ada', 'profile'), idlePort).kind).toBe('memo');
  });

  test('EXP-4: a slot supplied twice rejects with ambiguous-slot, distinct from missing, before any callback runs', () => {
    const build = buildNested({ supplied: 'twice' });
    expect(build.composition.resolve(slotDescriptor('assessor'))).toEqual({ status: 'ambiguous', descriptor: slotDescriptor('assessor'), occupants: 2 });
    expectDefinitionError(() => openInvocation(build.composition, memberStep('person:ada', 'summary'), idlePort), 'ambiguous-slot');
    const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
    const implementation = rubric('A');
    const once = supply({ slot: assessor, declaration: implementation, subject: assessmentSubject });
    const again = supply({ slot: assessor, declaration: implementation, subject: assessmentSubject });
    const composition = compose({ scope: nestedScope, members: [nestedMember('person:ada', assessor).registration], supplied: [once, again] });
    expect(composition.resolve(slotDescriptor('assessor'))).toMatchObject({ status: 'ambiguous', occupants: 2 });
  });

  test('CMP-3: a helper registered under a declared step slot name is rejected rather than treated as a supply', () => {
    const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
    expectDefinitionError(() => compose({
      scope: nestedScope,
      helpers: [{ slot: 'assessor', helper: () => 1 }],
      members: [nestedMember('person:ada', assessor).registration],
      supplied: [supply({ slot: assessor, declaration: rubric('A'), subject: assessmentSubject })],
    }), 'illegal-edge');
  });

  test('ownership: supply registrations and supplied steps must be minted by this family instance', () => {
    const build = buildNested();
    const forged: unknown = { slot: 'assessor', declaration: build.rubric, subject: assessmentSubject };
    expectDefinitionError(() => Reflect.apply(compose, undefined, [{ ...build.options, supplied: [forged] }]), 'forged-declaration');
    const other = declarations<ITestFamily>();
    const foreignSlot = other.stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
    const foreign = other.supply({ slot: foreignSlot, declaration: other.suppliedStep<IAssessorParameters, IAssessment>({ run: () => ({ score: 0, explanation: '' }) }), subject: assessmentSubject });
    expectDefinitionError(() => compose({ ...build.options, supplied: [foreign] }), 'forged-declaration');
  });

  test('declaration: a supplied step is a frozen minted declaration with no subject, children or step-slot occupancy', () => {
    const run = jest.fn(() => ({ score: 1, explanation: '' }));
    const implementation = suppliedStep<IAssessorParameters, IAssessment>({ label: 'rubric', run });
    expect(isDeclaration(implementation)).toBe(true);
    expect(Object.isFrozen(implementation)).toBe(true);
    expect(implementation).toMatchObject({ kind: 'supplied-step', version: 1, label: 'rubric', run });
    expect(run).not.toHaveBeenCalled();
    expectDefinitionError(() => Reflect.apply(suppliedStep, undefined, [{ subject: 'assessment', run }]), 'invalid-subject');
    expectDefinitionError(() => Reflect.apply(suppliedStep, undefined, [{ children: {}, run }]), 'illegal-edge');
    expectDefinitionError(() => Reflect.apply(suppliedStep, undefined, [{ run: 'not a function' }]), 'invalid-callback');
    expectDefinitionError(() => Reflect.apply(suppliedStep, undefined, [{ version: 0, run }]), 'invalid-version');
    const asStep: unknown = implementation;
    expectDefinitionError(() => Reflect.apply(compose, undefined, [{ scope: nestedScope, steps: [{ slot: 'assessor', declaration: asStep }] }]), 'illegal-edge');
  });

  test('declaration: slot tokens need a nonempty slot name, and supply needs a subject function', () => {
    expectDefinitionError(() => stepSlot({ slot: '' }), 'invalid-descriptor');
    const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
    expect(Object.isFrozen(assessor)).toBe(true);
    expect(assessor).toMatchObject({ kind: 'step-slot', slot: 'assessor' });
    expectDefinitionError(() => Reflect.apply(supply, undefined, [{ slot: assessor, declaration: rubric('A'), subject: 'assessment:x' }]), 'invalid-subject');
    expectDefinitionError(() => Reflect.apply(supply, undefined, [{ slot: { kind: 'step-slot', slot: 'assessor' }, declaration: rubric('A'), subject: assessmentSubject }]), 'forged-declaration');
    const summary = memo({ subject: 'summary:z', run: () => 1 });
    expectDefinitionError(() => Reflect.apply(supply, undefined, [{ slot: assessor, declaration: summary, subject: assessmentSubject }]), 'forged-declaration');
  });

  test('CMP-9: composing, binding and resolving slots never runs step callbacks or subject functions', () => {
    const run = jest.fn(() => ({ score: 1, explanation: '' }));
    const subject = jest.fn(assessmentSubject);
    const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
    const implementation = suppliedStep<IAssessorParameters, IAssessment>({ run });
    const composition = compose({
      scope: nestedScope,
      members: [nestedMember('person:ada', assessor).registration],
      supplied: [supply({ slot: assessor, declaration: implementation, subject })],
    });
    composition.resolve(slotDescriptor('assessor'));
    openInvocation(composition, memberStep('person:ada', 'summary'), idlePort);
    expect(run).not.toHaveBeenCalled();
    expect(subject).not.toHaveBeenCalled();
  });

  test('bridge: the supplied invocation hands the actual run and its argument views to the invoker', () => {
    const build = buildNested();
    const invocation = openInvocation(build.composition, slotDescriptor('assessor'), idlePort);
    if (invocation.kind !== 'supplied') {
      throw new Error('expected a supplied invocation');
    }
    const seen: unknown[] = [];
    const views = argumentSupplier(Object.freeze([4, Object.freeze({ number: 4, merged: true })]));
    const result = invocation.apply({}, views, recording(seen));
    expect(seen).toEqual([build.rubric.run]);
    expect(result).toEqual({ score: 2, explanation: 'A: merged work counts double' });
    expectDefinitionError(() => invocation.apply({ args: [] }, views, recording([])), 'invalid-bindings');
    invocation.close();
    expectDefinitionError(() => invocation.apply({}, views, recording([])), 'scope-closed');
  });

  test('M3 compatibility: an absent or helper callable that is not a declared step slot keeps unresolved-parent', () => {
    const build = buildNested();
    const composition = compose({ ...build.options, helpers: [{ slot: 'format', helper: () => 'x' }] });
    expectDefinitionError(() => openInvocation(composition, slotDescriptor('format'), idlePort), 'unresolved-parent');
    expectDefinitionError(() => openInvocation(composition, slotDescriptor('absent'), idlePort), 'unresolved-parent');
  });

  test('CMP-1: two calls naming one slot declare a single topology edge', () => {
    const assessor = stepSlot<IAssessorParameters, IAssessment>({ slot: 'assessor' });
    const summary = memo({ subject: 'summary:twice', children: { first: assessor, second: assessor }, run: () => 1 });
    const composition = compose({
      scope: nestedScope,
      members: [{ key: 'person:ada', steps: [{ slot: 'summary', declaration: summary }] }],
      supplied: [supply({ slot: assessor, declaration: rubric('A'), subject: assessmentSubject })],
    });
    expect(composition.topology.edges).toEqual([{ parent: memberStep('person:ada', 'summary'), child: slotDescriptor('assessor') }]);
  });

  test('CMP-9: a supplied step keeps the run it validated, even from options that answer differently on a later read', () => {
    const validated = (): IAssessment => ({ score: 1, explanation: 'validated' });
    const swapped = (): IAssessment => ({ score: 9, explanation: 'swapped' });
    const options = new Proxy({ run: validated }, {
      get(target, key, receiver): unknown {
        return key === 'run' ? swapped : Reflect.get(target, key, receiver);
      },
    });
    const implementation = suppliedStep<IAssessorParameters, IAssessment>(options);
    expect(implementation.run).toBe(validated);
  });

  test('EXP-4: opening an unsupplied or doubly supplied slot directly reports the same distinct outcomes', () => {
    expectDefinitionError(() => openInvocation(buildNested({ supplied: 'none' }).composition, slotDescriptor('assessor'), idlePort), 'missing-slot');
    expectDefinitionError(() => openInvocation(buildNested({ supplied: 'twice' }).composition, slotDescriptor('assessor'), idlePort), 'ambiguous-slot');
  });

  test('M3 compatibility: a composition without nested declarations keeps its steps, edges and empty slot list', () => {
    const activity = source({ subject: 'activity:m3', run: () => 1 });
    const summary = memo({ subject: 'summary:m3', children: { activity }, run: () => 1 });
    const steps: readonly { readonly slot: string; readonly declaration: IStepDeclaration<ITestFamily> }[] = [
      { slot: 'activity', declaration: activity },
      { slot: 'summary', declaration: summary },
    ];
    const composition = compose({ scope: nestedScope, members: [{ key: 'person:ada', steps }] });
    expect(composition.topology.slots).toEqual([]);
    expect(composition.topology.edges).toEqual([{ parent: memberStep('person:ada', 'summary'), child: memberStep('person:ada', 'activity') }]);
  });
});
