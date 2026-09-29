/**
 * Outcome tests for the frozen M3 composition: its exact supported topology,
 * unique current structural correspondence with distinct missing and ambiguous
 * outcomes, scoped subject uniqueness, illegal edges, historical direct-child
 * witness reconnection and immunity to later author builder mutation.
 *
 * Topology covered here (the M3 shape): a composition scope with named input
 * and helper slots and explicitly keyed members. Each member registers step
 * slots holding source or memo declarations, and memos name sibling source
 * slots of the same member. There are no cross-member edges. Composition-level
 * steps, memo-to-memo edges, supplied step slots and argument-bearing calls
 * are covered by the nested-* suites.
 *
 * @see ../../../docs/spec/composition.md (CMP-1, CMP-6, CMP-7, CMP-9, EXP-1 selection)
 * @see ../../../docs/spec/execution.md (RES-001, REUSE-006, REUSE-007)
 * @see ../../../docs/spec/architecture.md (ARC-005)
 * @see ../../../docs/plans/m3-contribution-analysis.md
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  DefinitionError,
  isComposing,
  declarations,
  type IBindingDescriptor,
  type IAuthorInvoker,
  type IBindingResolution,
  type IInvocationPort,
  type IComposition as ICompositionOf,
  type ICompositionOptions as ICompositionOptionsOf,
  type IStepDeclaration as IStepDeclarationOf,
} from '../src/index.js';
import {
  activitySubject,
  buildFixture,
  buildMember,
  compose,
  fixtureScope,
  memberKeys,
  memo,
  openInvocation,
  source,
  summarySubject,
  type IFixtureMemberKey,
  type ITestFamily,
} from './fixtures/contributors.js';

/** The fixture family's composition. */
type IComposition = ICompositionOf<ITestFamily>;
/** The fixture family's composition options. */
type ICompositionOptions = ICompositionOptionsOf<ITestFamily>;
/** The fixture family's erased step declaration. */
type IStepDeclaration = IStepDeclarationOf<ITestFamily>;

/** A step descriptor for one fixture member slot. */
function stepDescriptor(memberKey: string, slot: string, scope: string = fixtureScope): IBindingDescriptor {
  return { scope, role: 'step', slot, memberKey };
}

/** Round-trip through JSON as durable evidence would, dropping every process-local object. */
function durable<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** Resolve a step and return its bound declaration, failing the test otherwise. */
function boundStep(composition: IComposition, descriptor: IBindingDescriptor): IStepDeclaration {
  const resolution = composition.resolve(descriptor);
  if (resolution.status !== 'bound' || resolution.target.role !== 'step') {
    throw new Error(`expected a bound step, got ${JSON.stringify(resolution)}`);
  }
  return resolution.target.declaration;
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

describe('fixed M3 topology', () => {
  test('CMP-1: the composition records exactly two members, four steps and two summary-to-activity edges', () => {
    const { composition } = buildFixture();
    expect(composition.scope).toBe(fixtureScope);
    expect(composition.topology.steps).toEqual([
      stepDescriptor('person:ada', 'activity'),
      stepDescriptor('person:ada', 'summary'),
      stepDescriptor('person:ben', 'activity'),
      stepDescriptor('person:ben', 'summary'),
    ]);
    expect(composition.topology.edges).toEqual([
      { parent: stepDescriptor('person:ada', 'summary'), child: stepDescriptor('person:ada', 'activity') },
      { parent: stepDescriptor('person:ben', 'summary'), child: stepDescriptor('person:ben', 'activity') },
    ]);
  });

  test('CMP-1: the topology names the declared input and callable slots, sorted and frozen', () => {
    // Assembly derives the bindings every callback receives from these slot
    // names, so authors never repeat them beside their composition.
    const { composition } = buildFixture();
    expect(composition.topology.inputs).toEqual(['config']);
    expect(composition.topology.helpers).toEqual(['format', 'summarize']);
    expect(Object.isFrozen(composition.topology.inputs)).toBe(true);
    expect(Object.isFrozen(composition.topology.helpers)).toBe(true);
    const reversed = buildFixture({ order: 'ben-first' });
    expect(reversed.composition.topology.helpers).toEqual(['format', 'summarize']);
  });

  test('CMP-1: a composition without inputs or helpers declares empty slot lists', () => {
    const ada = buildMember('person:ada');
    const composition = compose({ scope: fixtureScope, members: [ada.registration] });
    expect(composition.topology.inputs).toEqual([]);
    expect(composition.topology.helpers).toEqual([]);
  });

  test('CMP-1: topology is ordered by structure, not registration order', () => {
    const adaFirst = buildFixture({ order: 'ada-first' });
    const benFirst = buildFixture({ order: 'ben-first' });
    expect(durable(benFirst.composition.topology)).toEqual(durable(adaFirst.composition.topology));
  });

  test('CMP-1: the composition and its topology are frozen after construction', () => {
    const { composition } = buildFixture();
    expect(Object.isFrozen(composition)).toBe(true);
    expect(Object.isFrozen(composition.topology)).toBe(true);
    expect(Object.isFrozen(composition.topology.steps)).toBe(true);
    expect(Object.isFrozen(composition.topology.edges)).toBe(true);
    expect(composition.topology.edges.every(edge => Object.isFrozen(edge) && Object.isFrozen(edge.parent))).toBe(true);
    expect(() => {
      Reflect.apply(Array.prototype.push, composition.topology.edges, [{}]);
    }).toThrow(TypeError);
  });

  test('CMP-1: later mutation of the author builder arrays and input objects cannot change the frozen graph', () => {
    const built = buildFixture();
    const members = [...(built.options.members ?? [])];
    const inputs = [{ slot: 'config', value: built.config }];
    const options: ICompositionOptions = { ...built.options, members, inputs };
    const composition = compose(options);
    const ada = built.members['person:ada'];

    const intruder = buildMember('person:ada', { labelPrefix: 'Intruder' });
    members.push({ key: 'person:cy', steps: intruder.registration.steps });
    members[0] = { key: 'person:ada', steps: [] };
    inputs[0] = { slot: 'config', value: { window: 'replaced', repository: 'replaced' } };
    built.config.window = 'mutated';

    expect(composition.topology.steps).toHaveLength(4);
    expect(composition.resolve(stepDescriptor('person:cy', 'activity')).status).toBe('missing');
    expect(boundStep(composition, stepDescriptor('person:ada', 'summary'))).toBe(ada.summary);
    const config = composition.resolve({ scope: fixtureScope, role: 'input', slot: 'config' });
    expect(config).toMatchObject({ status: 'bound', target: { role: 'input', value: { window: '[2026-01-01, 2026-04-01)' } } });
    if (config.status === 'bound' && config.target.role === 'input') {
      expect(config.target.value).not.toBe(built.config);
      expect(Object.isFrozen(config.target.value)).toBe(true);
    }
  });

  test('CMP-9: composing and resolving never invokes step callbacks or helpers', () => {
    const run = jest.fn((): number => 1);
    const finality = jest.fn((): boolean => true);
    const helper = jest.fn((): number => 1);
    const activity = source({ subject: 'activity:a', run, finality });
    const composition = compose({
      scope: fixtureScope,
      helpers: [{ slot: 'format', helper }],
      members: [{
        key: 'person:ada',
        steps: [
          { slot: 'activity', declaration: activity },
          { slot: 'summary', declaration: memo({ subject: 'summary:a', children: { activity }, run }) },
        ],
      }],
    });
    composition.resolve(stepDescriptor('person:ada', 'summary'));
    composition.resolve({ scope: fixtureScope, role: 'callable', slot: 'format' });
    expect(run).not.toHaveBeenCalled();
    expect(finality).not.toHaveBeenCalled();
    expect(helper).not.toHaveBeenCalled();
  });

  test('CMP-9: input accessors are rejected without invoking them', () => {
    const getter = jest.fn((): string => 'window');
    const value = Object.defineProperty({}, 'window', { get: getter, enumerable: true });
    expectDefinitionError(() => compose({ scope: fixtureScope, inputs: [{ slot: 'config', value }], members: [] }), 'invalid-input');
    expect(getter).not.toHaveBeenCalled();
  });

  test('ownership: a look-alike declaration object cannot be registered', () => {
    const genuine = memo({ subject: 'summary:a', run: () => 1 });
    const forged: unknown = { ...genuine };
    const options: unknown = { scope: fixtureScope, members: [{ key: 'person:ada', steps: [{ slot: 'summary', declaration: forged }] }] };
    expectDefinitionError(() => Reflect.apply(compose, undefined, [options]), 'forged-declaration');
  });

  test('CMP-6: scope, member keys and slots must be nonempty strings', () => {
    const declaration = memo({ subject: 'summary:a', run: () => 1 });
    expectDefinitionError(() => compose({ scope: '', members: [] }), 'invalid-descriptor');
    expectDefinitionError(() => compose({ scope: fixtureScope, members: [{ key: '', steps: [] }] }), 'invalid-descriptor');
    expectDefinitionError(() => compose({ scope: fixtureScope, members: [{ key: 'person:ada', steps: [{ slot: '', declaration }] }] }), 'invalid-descriptor');
    expectDefinitionError(() => compose({ scope: fixtureScope, inputs: [{ slot: '', value: {} }], members: [] }), 'invalid-descriptor');
  });
});

describe('composition phase', () => {
  test('CMP-9/RUN-001: isComposing reports true only while author code runs during composition', () => {
    // Author code can run during composition through Proxy traps on the
    // author's builder arrays. Run Supervision consults this query so runtime
    // context lookup fails there; it never enables framework work.
    const ben = buildMember('person:ben');
    const observed: boolean[] = [];
    const members = new Proxy([ben.registration], {
      get(target, key, receiver): unknown {
        if (key === '0') {
          observed.push(isComposing());
        }
        return Reflect.get(target, key, receiver);
      },
    });
    expect(isComposing()).toBe(false);
    compose({ scope: fixtureScope, members });
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(value => value)).toBe(true);
    expect(isComposing()).toBe(false);
  });

  test('CMP-9: a composition that fails still ends the composition phase', () => {
    const invalid: unknown = { scope: fixtureScope, members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: {} }] }] };
    expectDefinitionError(() => Reflect.apply(compose, undefined, [invalid]), 'forged-declaration');
    expect(isComposing()).toBe(false);
  });
});

describe('registration capture consistency', () => {
  /** A port that is never expected to dispatch in these tests. */
  const idlePort: IInvocationPort<ITestFamily> = {
    active: () => undefined,
    dispatch: () => Promise.reject(new Error('unexpected dispatch')),
    isTrackedView: () => false,
    argumentsJustified: () => true,
  };

  /** An invoker that records which callback it was handed and returns its result. */
  function capturing(seen: unknown[]): IAuthorInvoker<unknown> {
    return <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): unknown => {
      seen.push(callback);
      return callback(context);
    };
  }

  test('registration: a step declaration that changes between reads cannot split lookup from invocation', () => {
    // Regression (supervisor reproduction on 3b3f782): a declaration getter
    // returning A first and B afterwards was read six times during compose;
    // resolve reported B while openInvocation.apply executed A's record.
    const runA = (): string => 'A';
    const runB = (): string => 'B';
    const sourceA = source({ subject: 'activity:a', run: runA });
    const sourceB = source({ subject: 'activity:b', run: runB });
    let reads = 0;
    const getter = jest.fn(() => (reads++ === 0 ? sourceA : sourceB));
    const flipping = Object.defineProperty({ slot: 'activity' }, 'declaration', { get: getter, enumerable: true });
    const options: unknown = { scope: fixtureScope, members: [{ key: 'person:ada', steps: [flipping] }] };
    expectDefinitionError(() => Reflect.apply(compose, undefined, [options]), 'forged-declaration');
    expect(getter).not.toHaveBeenCalled();

    // A registration whose descriptor itself varies between inspections is
    // captured once: lookup and invocation agree on that single declaration.
    let inspections = 0;
    const varying = new Proxy({ slot: 'activity', declaration: sourceA }, {
      getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
        if (key === 'declaration') {
          return { value: inspections++ === 0 ? sourceA : sourceB, writable: true, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const composition = compose({ scope: fixtureScope, members: [{ key: 'person:ada', steps: [varying] }] });
    const resolution = composition.resolve(stepDescriptor('person:ada', 'activity'));
    const invocation = openInvocation(composition, stepDescriptor('person:ada', 'activity'), idlePort);
    const seen: unknown[] = [];
    const outcome = invocation.kind === 'source' ? invocation.apply({}, undefined, capturing(seen)) : undefined;
    const bound = resolution.status === 'bound' && resolution.target.role === 'step' ? resolution.target.declaration : undefined;
    expect(bound === sourceA || bound === sourceB).toBe(true);
    expect(seen).toEqual([bound?.run]);
    expect(outcome).toBe(bound === sourceA ? 'A' : 'B');
  });

  test('registration: a helper that changes between reads cannot bind a non-function', () => {
    // Regression (supervisor reproduction on 3b3f782): a helper getter returning
    // a function first and 17 afterwards passed validation and bound 17.
    const helper = (): string => 'help';
    let reads = 0;
    const getter = jest.fn(() => (reads++ === 0 ? helper : 17));
    const flipping = Object.defineProperty({ slot: 'format' }, 'helper', { get: getter, enumerable: true });
    const options: unknown = { scope: fixtureScope, helpers: [flipping], members: [] };
    expectDefinitionError(() => Reflect.apply(compose, undefined, [options]), 'invalid-callback');
    expect(getter).not.toHaveBeenCalled();

    let inspections = 0;
    const varying = new Proxy({ slot: 'format', helper }, {
      getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
        if (key === 'helper') {
          return { value: inspections++ === 0 ? helper : 17, writable: true, enumerable: true, configurable: true };
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const composition = compose({ scope: fixtureScope, helpers: [varying], members: [] });
    expect(composition.resolve({ scope: fixtureScope, role: 'callable', slot: 'format' }))
      .toMatchObject({ status: 'bound', target: { role: 'callable', callable: helper } });
  });

  test('registration: accessor or inherited registration fields reject before any work, without running getters', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const getter = jest.fn((): unknown => 'person:ada');
    /** Build an object whose named field is an accessor backed by the spy. */
    const accessor = (base: object, key: string): object => Object.defineProperty({ ...base }, key, { get: getter, enumerable: true });
    const cases: readonly [unknown, DefinitionError['code']][] = [
      [accessor({ members: [] }, 'scope'), 'invalid-descriptor'],
      [accessor({ scope: fixtureScope }, 'members'), 'invalid-descriptor'],
      [accessor({ scope: fixtureScope, members: [] }, 'inputs'), 'invalid-descriptor'],
      [accessor({ scope: fixtureScope, members: [] }, 'helpers'), 'invalid-descriptor'],
      [{ scope: fixtureScope, members: [accessor({ steps: [] }, 'key')] }, 'invalid-descriptor'],
      [{ scope: fixtureScope, members: [accessor({ key: 'person:ada' }, 'steps')] }, 'invalid-descriptor'],
      [{ scope: fixtureScope, members: [{ key: 'person:ada', steps: [accessor({ declaration: activity }, 'slot')] }] }, 'invalid-descriptor'],
      [{ scope: fixtureScope, inputs: [accessor({ value: {} }, 'slot')], members: [] }, 'invalid-descriptor'],
      [{ scope: fixtureScope, inputs: [accessor({ slot: 'config' }, 'value')], members: [] }, 'invalid-input'],
      [{ scope: fixtureScope, helpers: [accessor({ helper: () => 1 }, 'slot')], members: [] }, 'invalid-descriptor'],
      [{ scope: fixtureScope, members: [Object.assign(Object.create({ key: 'person:ada' }), { steps: [] })] }, 'invalid-descriptor'],
      [{ scope: fixtureScope, members: [{ key: 'person:ada', steps: [Object.assign(Object.create({ declaration: activity }), { slot: 'activity' })] }] }, 'forged-declaration'],
    ];
    for (const [options, code] of cases) {
      expectDefinitionError(() => Reflect.apply(compose, undefined, [options]), code);
    }
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('illegal edges', () => {
  /** Compose one member from the supplied step registrations. */
  function composeMember(steps: readonly { readonly slot: string; readonly declaration: IStepDeclaration }[]): IComposition {
    return compose({ scope: fixtureScope, members: [{ key: 'person:ada', steps }] });
  }

  test('CMP-7: a memo edge must name an existing sibling slot', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const summary = memo({ subject: 'summary:a', children: { activity }, run: () => 1 });
    expectDefinitionError(() => composeMember([{ slot: 'summary', declaration: summary }]), 'illegal-edge');
  });

  test('CMP-7: a memo cannot name its own slot as a child', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const summary = memo({ subject: 'summary:a', children: { summary: activity }, run: () => 1 });
    expectDefinitionError(() => composeMember([{ slot: 'activity', declaration: activity }, { slot: 'summary', declaration: summary }]), 'illegal-edge');
  });

  test('CMP-7: a sibling slot holding a memo is not a permitted child, so memo-to-memo cycles cannot form', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const summary = memo({ subject: 'summary:a', children: { second: activity }, run: () => 1 });
    const second = memo({ subject: 'summary:second', children: { summary: activity }, run: () => 1 });
    expectDefinitionError(() => composeMember([
      { slot: 'summary', declaration: summary },
      { slot: 'second', declaration: second },
    ]), 'illegal-edge');
  });

  test('bridge: each typed child must be the exact declaration occupying its current sibling slot', () => {
    const ada = buildMember('person:ada');
    const ben = buildMember('person:ben');
    const mismatched = memo({ subject: 'summary:mismatched', children: { activity: ben.activity }, run: () => 1 });
    expectDefinitionError(() => composeMember([
      { slot: 'activity', declaration: ada.activity },
      { slot: 'summary', declaration: mismatched },
    ]), 'illegal-edge');
    const equalButDistinct = source({ subject: activitySubject('person:ada'), run: ada.callbacks.activityRun, finality: ada.callbacks.activityFinality });
    const pinned = memo({ subject: 'summary:pinned', children: { activity: equalButDistinct }, run: () => 1 });
    expectDefinitionError(() => composeMember([
      { slot: 'activity', declaration: ada.activity },
      { slot: 'summary', declaration: pinned },
    ]), 'illegal-edge');
  });

  test('bridge: a typed child in an ambiguous sibling slot is rejected rather than chosen by order', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const summary = memo({ subject: 'summary:a', children: { activity }, run: () => 1 });
    expectDefinitionError(() => composeMember([
      { slot: 'activity', declaration: activity },
      { slot: 'activity', declaration: activity },
      { slot: 'summary', declaration: summary },
    ]), 'illegal-edge');
  });
});

describe('scoped subjects', () => {
  test('RES-001: distinct definitions cannot silently share one scoped subject', () => {
    const ada = buildMember('person:ada');
    const impostor = source({ subject: activitySubject('person:ada'), run: () => 'other' });
    expectDefinitionError(() => compose({
      scope: fixtureScope,
      members: [ada.registration, { key: 'person:ben', steps: [{ slot: 'activity', declaration: impostor }] }],
    }), 'conflicting-subject');
  });

  test('RES-001: a source and a memo cannot share one scoped subject', () => {
    const shared = 'shared:subject';
    const activity = source({ subject: shared, run: () => 1 });
    const summary = memo({ subject: shared, children: { activity }, run: () => 1 });
    expectDefinitionError(() => compose({
      scope: fixtureScope,
      members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }, { slot: 'summary', declaration: summary }] }],
    }), 'conflicting-subject');
  });

  test('RES-001: one reused declaration may participate in several branches under one scoped subject', () => {
    const repositoryActivity = source({ subject: 'activity:acme/widget', run: () => 'repository' });
    const adaSummary = memo({ subject: summarySubject('person:ada'), children: { activity: repositoryActivity }, run: () => 1 });
    const benSummary = memo({ subject: summarySubject('person:ben'), children: { activity: repositoryActivity }, run: () => 1 });
    const composition = compose({
      scope: fixtureScope,
      members: [
        { key: 'person:ada', steps: [{ slot: 'activity', declaration: repositoryActivity }, { slot: 'summary', declaration: adaSummary }] },
        { key: 'person:ben', steps: [{ slot: 'activity', declaration: repositoryActivity }, { slot: 'summary', declaration: benSummary }] },
      ],
    });
    const adaActivity = composition.resolve(stepDescriptor('person:ada', 'activity'));
    const benActivity = composition.resolve(stepDescriptor('person:ben', 'activity'));
    expect(adaActivity).toMatchObject({ status: 'bound', target: { scopedSubject: { scope: fixtureScope, subject: 'activity:acme/widget' } } });
    expect(benActivity).toMatchObject({ status: 'bound', target: { scopedSubject: { scope: fixtureScope, subject: 'activity:acme/widget' } } });
  });

  test('RES-001: a reused memo cannot silently reconnect to a different child in another branch', () => {
    // With typed child records the reused memo pins its child declaration, so the
    // branch whose sibling differs is rejected by the sibling-identity check.
    const ada = buildMember('person:ada');
    const ben = buildMember('person:ben');
    const sharedSummary = memo({ subject: 'summary:shared', children: { activity: ada.activity }, run: () => 1 });
    expectDefinitionError(() => compose({
      scope: fixtureScope,
      members: [
        { key: 'person:ada', steps: [{ slot: 'activity', declaration: ada.activity }, { slot: 'summary', declaration: sharedSummary }] },
        { key: 'person:ben', steps: [{ slot: 'activity', declaration: ben.activity }, { slot: 'summary', declaration: sharedSummary }] },
      ],
    }), 'illegal-edge');
  });

  test('RES-001: distinct memo declarations sharing a subject conflict even with identical callbacks', () => {
    const ada = buildMember('person:ada');
    const run = (): number => 1;
    const first = memo({ subject: 'summary:shared', children: { activity: ada.activity }, run });
    const second = memo({ subject: 'summary:shared', version: 2, children: { activity: ada.activity }, run });
    expectDefinitionError(() => compose({
      scope: fixtureScope,
      members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: ada.activity }, { slot: 'summary', declaration: first }, { slot: 'other', declaration: second }] }],
    }), 'conflicting-subject');
  });

  test('ownership: a declaration minted by another family instance cannot be registered', () => {
    const foreign = declarations<ITestFamily>().source({ subject: 'activity:foreign', run: () => 1 });
    expectDefinitionError(() => compose({
      scope: fixtureScope,
      members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: foreign }] }],
    }), 'forged-declaration');
  });

  test('RES-001: the same subject text in another analysis scope is a different scoped subject', () => {
    const inFixture = buildFixture().composition.resolve(stepDescriptor('person:ada', 'summary'));
    const other = compose({ scope: 'other-analysis', members: [buildMember('person:ada').registration] });
    const inOther = other.resolve(stepDescriptor('person:ada', 'summary', 'other-analysis'));
    expect(inFixture).toMatchObject({ status: 'bound', target: { scopedSubject: { scope: fixtureScope, subject: summarySubject('person:ada') } } });
    expect(inOther).toMatchObject({ status: 'bound', target: { scopedSubject: { scope: 'other-analysis', subject: summarySubject('person:ada') } } });
  });
});

describe('current structural correspondence', () => {
  test('EXP-1/CMP-6: after restart with fresh allocations and reversed registration, each member reconnects to its own declarations', () => {
    const before = buildFixture({ order: 'ada-first' });
    const after = buildFixture({ order: 'ben-first' });
    for (const key of memberKeys) {
      for (const slot of ['activity', 'summary'] as const) {
        const historical = durable(stepDescriptor(key, slot));
        if (!isStepDescriptor(historical)) {
          throw new Error('durable descriptor lost its structure');
        }
        const current = boundStep(after.composition, historical);
        expect(current).toBe(after.members[key][slot]);
        expect(current).not.toBe(before.members[key][slot]);
        expect(current.subject).toBe(slot === 'activity' ? activitySubject(key) : summarySubject(key));
        expect(current.run).toBe(slot === 'activity' ? after.members[key].callbacks.activityRun : after.members[key].callbacks.summaryRun);
      }
    }
  });

  test('RES-001/CMP-6: display label and function renames do not change correspondence or subjects', () => {
    const before = buildFixture({ labelPrefix: 'Retrieve' });
    const after = buildFixture({ labelPrefix: 'Read' });
    const descriptor = stepDescriptor('person:ada', 'summary');
    expect(boundStep(after.composition, descriptor).subject).toBe(boundStep(before.composition, descriptor).subject);
    expect(boundStep(after.composition, descriptor).label).toBe('Read summary for person:ada');
  });

  test('CMP-6: inputs and helpers resolve by role and slot to current values', () => {
    const { composition, format } = buildFixture({ order: 'ben-first' });
    expect(composition.resolve({ scope: fixtureScope, role: 'callable', slot: 'format' }))
      .toMatchObject({ status: 'bound', target: { role: 'callable', callable: format } });
    expect(composition.resolve({ scope: fixtureScope, role: 'input', slot: 'config' }))
      .toMatchObject({ status: 'bound', target: { role: 'input', value: { repository: 'acme/widget' } } });
  });

  test('CMP-6: absent slots are missing, with no name, subject, role or ordinal fallback', () => {
    const { composition } = buildFixture();
    const cases: readonly IBindingDescriptor[] = [
      stepDescriptor('person:cy', 'summary'),
      stepDescriptor('person:ada', 'assessment'),
      stepDescriptor('0', 'summary'),
      stepDescriptor('person:ada', 'Read summary for person:ada'),
      stepDescriptor('person:ada', summarySubject('person:ada')),
      stepDescriptor('person:ada', 'summary', 'other-analysis'),
      { scope: fixtureScope, role: 'callable', slot: 'config' },
      { scope: fixtureScope, role: 'input', slot: 'format' },
      { scope: fixtureScope, role: 'step', slot: 'summary' },
      { scope: fixtureScope, role: 'callable', slot: 'format', memberKey: 'person:ada' },
    ];
    for (const descriptor of cases) {
      expect(composition.resolve(descriptor)).toEqual({ status: 'missing', descriptor });
    }
  });

  test('CMP-6: a renamed member key is missing even when its subjects are unchanged', () => {
    const ada = buildMember('person:ada');
    const renamed = compose({ scope: fixtureScope, members: [{ key: 'contributor:ada', steps: ada.registration.steps }] });
    expect(renamed.resolve(stepDescriptor('person:ada', 'summary')).status).toBe('missing');
  });

  test('EXP-1: multiply occupied slots are ambiguous, distinct from missing, and never resolved by order', () => {
    const ada = buildMember('person:ada');
    const ben = buildMember('person:ben');
    const format = (): string => 'a';
    const otherFormat = (): string => 'b';
    const composition = compose({
      scope: fixtureScope,
      inputs: [{ slot: 'config', value: { a: 1 } }, { slot: 'config', value: { a: 2 } }],
      helpers: [{ slot: 'format', helper: format }, { slot: 'format', helper: otherFormat }],
      members: [ada.registration, ben.registration, ada.registration],
    });
    const ambiguous: readonly IBindingDescriptor[] = [
      stepDescriptor('person:ada', 'summary'),
      stepDescriptor('person:ada', 'activity'),
      { scope: fixtureScope, role: 'callable', slot: 'format' },
      { scope: fixtureScope, role: 'input', slot: 'config' },
    ];
    for (const descriptor of ambiguous) {
      const expected: IBindingResolution = { status: 'ambiguous', descriptor, occupants: 2 };
      expect(composition.resolve(descriptor)).toEqual(expected);
    }
    expect(boundStep(composition, stepDescriptor('person:ben', 'summary'))).toBe(ben.summary);
  });

  test('EXP-1: duplicate step slots within one member are ambiguous', () => {
    const first = source({ subject: 'activity:first', run: () => 1 });
    const second = source({ subject: 'activity:second', run: () => 2 });
    const composition = compose({
      scope: fixtureScope,
      members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: first }, { slot: 'activity', declaration: second }] }],
    });
    expect(composition.resolve(stepDescriptor('person:ada', 'activity')))
      .toEqual({ status: 'ambiguous', descriptor: stepDescriptor('person:ada', 'activity'), occupants: 2 });
  });
});

describe('historical direct-child witnesses', () => {
  /** The durable witness form for one member's summary-to-activity call. */
  function witness(parentKey: IFixtureMemberKey, childKey: IFixtureMemberKey = parentKey): unknown {
    return durable({
      version: 1,
      parent: stepDescriptor(parentKey, 'summary'),
      child: stepDescriptor(childKey, 'activity'),
      arguments: { form: 'empty' },
    });
  }

  test('REUSE-006: a restarted, reordered composition reconnects each empty-argument witness to its own member', () => {
    const after = buildFixture({ order: 'ben-first' });
    for (const key of memberKeys) {
      const resolution = after.composition.resolveWitness(witness(key));
      expect(resolution).toMatchObject({
        status: 'bound',
        parent: { role: 'step', declaration: after.members[key].summary },
        child: { role: 'step', declaration: after.members[key].activity },
      });
    }
  });

  test('CMP-7: a witness for an undeclared relationship is not reconnected', () => {
    const { composition } = buildFixture();
    expect(composition.resolveWitness(witness('person:ada', 'person:ben'))).toEqual({ status: 'undeclared-edge' });
    const reversed = durable({ version: 1, parent: stepDescriptor('person:ada', 'activity'), child: stepDescriptor('person:ada', 'summary'), arguments: { form: 'empty' } });
    expect(composition.resolveWitness(reversed)).toEqual({ status: 'undeclared-edge' });
  });

  test('REUSE-007: unknown witness versions and argument forms are unsupported, not guessed', () => {
    const { composition } = buildFixture();
    const base = { parent: stepDescriptor('person:ada', 'summary'), child: stepDescriptor('person:ada', 'activity') };
    expect(composition.resolveWitness(durable({ ...base, version: 3, index: 0, arguments: { form: 'empty' } })))
      .toEqual({ status: 'unsupported', reason: 'witness-version' });
    expect(composition.resolveWitness(durable({ ...base, version: 1, arguments: { form: 'positional', values: ['person:ada'] } })))
      .toEqual({ status: 'unsupported', reason: 'argument-form' });
    expect(composition.resolveWitness(durable({ ...base, version: 1, arguments: { form: 'empty', values: [] } })))
      .toEqual({ status: 'unsupported', reason: 'argument-form' });
    expect(composition.resolveWitness(durable({ ...base, version: 1 })))
      .toEqual({ status: 'unsupported', reason: 'argument-form' });
    // The version is read first, so a record without one is an unsupported version.
    expect(composition.resolveWitness('summary->activity')).toEqual({ status: 'unsupported', reason: 'witness-version' });
    expect(composition.resolveWitness(durable({ version: 1, parent: { slot: 'summary' }, child: base.child, arguments: { form: 'empty' } })))
      .toEqual({ status: 'unsupported', reason: 'malformed' });
  });

  test('REUSE-007: missing and ambiguous witness endpoints produce distinct outcomes', () => {
    const ada = buildMember('person:ada');
    const withoutAda = compose({ scope: fixtureScope, members: [buildMember('person:ben').registration] });
    expect(withoutAda.resolveWitness(witness('person:ada')))
      .toEqual({ status: 'missing', descriptor: stepDescriptor('person:ada', 'summary') });
    const duplicated = compose({ scope: fixtureScope, members: [ada.registration, ada.registration] });
    expect(duplicated.resolveWitness(witness('person:ada')))
      .toEqual({ status: 'ambiguous', descriptor: stepDescriptor('person:ada', 'summary'), occupants: 2 });
  });
});

/** Narrow a JSON-decoded value to the step descriptor shape used by these tests. */
function isStepDescriptor(value: unknown): value is IBindingDescriptor {
  return typeof value === 'object' && value !== null &&
    'scope' in value && typeof value.scope === 'string' &&
    'role' in value && value.role === 'step' &&
    'slot' in value && typeof value.slot === 'string' &&
    'memberKey' in value && typeof value.memberKey === 'string';
}
