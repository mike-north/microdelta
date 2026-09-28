/**
 * Outcome tests for the invocation bridge and declared child handles.
 *
 * A reconnected step is invoked only through `openInvocation(...).apply`, which
 * pairs the actual author callback with the context Definition assembles from
 * facade bindings plus either Definition-minted calls (memo) or the selected
 * previous-result carrier (source), and hands that pair to a Resolution-owned
 * rank-2 invoker. Handles take no arguments, route an empty-argument witness
 * and the declared sibling declaration through the injected port, return an
 * immutable `{ data }` carrier that never probes child data, and reject forged,
 * substituted, out-of-scope, closed, composition-phase and argument-bearing
 * calls before dispatch.
 *
 * @see ../../../docs/spec/composition.md (CMP-5, CMP-7, CMP-9)
 * @see ../../../docs/spec/execution.md (REUSE-006)
 * @see ../../../docs/spec/architecture.md (ARC-003)
 * @see ../../../docs/plans/m3-contribution-analysis.md (direct invocation evidence; source policy carrier)
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  DefinitionError,
  declarations,
  describeHandle,
  type IAuthorInvoker,
  type IBindingDescriptor,
  type IChildResult,
  type IComposition,
  type IDeclaredCallHandle,
  type IDeclaredInvocationRequest,
  type IInvocation,
  type IInvocationPort,
  type IInvocationScope,
  type IMemoInvocation,
  type IPreviousSupplier,
  type ISourceDeclaration,
  type ISourceInvocation,
  type IStepRegistration,
} from '../src/index.js';
import {
  activitySubject,
  buildFixture,
  buildMember,
  compose,
  fixtureScope,
  memo,
  openInvocation,
  source,
  summarySubject,
  type IFixtureMemberKey,
  type ITestFamily,
} from './fixtures/contributors.js';

/** A step descriptor for one fixture member slot. */
function stepDescriptor(memberKey: string, slot: string): IBindingDescriptor {
  return { scope: fixtureScope, role: 'step', slot, memberKey };
}

/** A fake Resolution/run-context port recording every dispatch it receives. */
interface IFakePort {
  readonly port: IInvocationPort<ITestFamily>;
  readonly requests: IDeclaredInvocationRequest<ITestFamily, unknown>[];
  /** The scope the fake run context reports as currently executing. */
  active: IInvocationScope | undefined;
  /** What the next dispatch resolves to. */
  result: unknown;
}

/**
 * The fake forwards whatever the test configured, including malformed results,
 * so the handle's own carrier validation is exercised.
 */
function forwarded<TResult>(value: unknown): IChildResult<TResult> {
  // A single documented assertion: the port contract is typed, but this fake
  // must be able to violate it at runtime to exercise the handle's validation.
  return value as IChildResult<TResult>;
}

/** Build a port whose active scope and dispatch result are controlled by the test. */
function fakePort(): IFakePort {
  const state: IFakePort = {
    requests: [],
    active: undefined,
    result: { data: { kind: 'activity' } },
    port: {
      active: () => state.active,
      dispatch: <TResult>(request: IDeclaredInvocationRequest<ITestFamily, TResult>): Promise<IChildResult<TResult>> => {
        state.requests.push(request);
        return Promise.resolve(state.result).then(result => forwarded<TResult>(result));
      },
    },
  };
  return state;
}

/** One pair a recording invoker received. */
interface IInvokedPair {
  readonly callback: unknown;
  readonly context: unknown;
}

/** An honest rank-2 invoker that records the exact callback/context pair and calls it. */
function recordingInvoker(pairs: IInvokedPair[]): IAuthorInvoker<unknown> {
  return <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): unknown => {
    pairs.push({ callback, context });
    return callback(context);
  };
}

/** A member whose summary records the calls record Definition supplied. */
interface ICapturingMember {
  readonly activity: ISourceDeclaration<ITestFamily, string>;
  readonly activityRun: () => string;
  readonly summaryRun: (context: { readonly calls: { readonly activity: IDeclaredCallHandle<string> } }) => string;
  readonly captured: { calls?: { readonly activity: IDeclaredCallHandle<string> } };
  readonly steps: readonly IStepRegistration<ITestFamily>[];
}

/** Build one member whose summary run captures its calls. */
function capturingMember(key: IFixtureMemberKey): ICapturingMember {
  const captured: ICapturingMember['captured'] = {};
  const activityRun = (): string => `fetch ${key}`;
  const activity = source<string>({ subject: activitySubject(key), run: activityRun });
  const summaryRun: ICapturingMember['summaryRun'] = context => {
    captured.calls = context.calls;
    return key;
  };
  const summary = memo({ subject: summarySubject(key), children: { activity }, run: summaryRun });
  return { activity, activityRun, summaryRun, captured, steps: [{ slot: 'activity', declaration: activity }, { slot: 'summary', declaration: summary }] };
}

/** Compose capturing members in the given order. */
function capturingComposition(keys: readonly IFixtureMemberKey[]): { composition: IComposition<ITestFamily>; members: Map<IFixtureMemberKey, ICapturingMember> } {
  const members = new Map(keys.map(key => [key, capturingMember(key)] as const));
  const composition = compose({ scope: fixtureScope, members: keys.map(key => ({ key, steps: members.get(key)?.steps ?? [] })) });
  return { composition, members };
}

/** Narrow an invocation to its memo form, failing the test otherwise. */
function asMemo(invocation: IInvocation<ITestFamily>): IMemoInvocation<ITestFamily> {
  if (invocation.kind !== 'memo') {
    throw new Error('expected a memo invocation');
  }
  return invocation;
}

/** Narrow an invocation to its source form, failing the test otherwise. */
function asSource(invocation: IInvocation<ITestFamily>): ISourceInvocation<ITestFamily> {
  if (invocation.kind !== 'source') {
    throw new Error('expected a source invocation');
  }
  return invocation;
}

/** Open a member's summary, make it active, apply it honestly and return its captured handle. */
function openSummary(
  key: IFixtureMemberKey,
  fake: IFakePort,
  built = capturingComposition([key]),
): { readonly invocation: IMemoInvocation<ITestFamily>; readonly handle: IDeclaredCallHandle<string>; readonly member: ICapturingMember } {
  const member = built.members.get(key);
  if (member === undefined) {
    throw new Error(`missing member ${key}`);
  }
  const invocation = asMemo(openInvocation(built.composition, stepDescriptor(key, 'summary'), fake.port));
  fake.active = invocation;
  invocation.apply({}, recordingInvoker([]));
  const handle = member.captured.calls?.activity;
  if (handle === undefined) {
    throw new Error('the summary did not receive its declared handle');
  }
  return { invocation, handle, member };
}

/** Call a handle with runtime arguments its type forbids, as untyped author code could. */
function callWithArguments(handle: () => Promise<unknown>, ...values: unknown[]): Promise<unknown> {
  const result: unknown = Reflect.apply(handle, undefined, values);
  return Promise.resolve(result);
}

/** Assert a promise rejects with a Definition error carrying the expected code. */
async function expectRejection(promise: Promise<unknown>, code: DefinitionError['code']): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DefinitionError);
  expect(caught instanceof DefinitionError ? caught.code : undefined).toBe(code);
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

/** A frozen previous-result carrier, as a facade supplies it. */
function carrierOf<TData>(data: TData): { readonly data: TData } {
  return Object.freeze({ data });
}

/** A previous supplier that records which declaration it served and returns a fixed carrier. */
function supplierOf(carrier: unknown, served: unknown[]): IPreviousSupplier<ITestFamily> {
  return {
    carrier: <TResult>(declaration: ISourceDeclaration<ITestFamily, TResult>): { readonly data: TResult } => {
      served.push(declaration);
      // Test-only: the supplier deliberately returns whatever the test configured.
      return carrier as { readonly data: TResult };
    },
  };
}

describe('invocation bridge', () => {
  test('bridge: memo apply hands the ACTUAL author run and its assembled context to the invoker', () => {
    const fake = fakePort();
    const { composition, members } = capturingComposition(['person:ada']);
    const member = members.get('person:ada');
    const invocation = asMemo(openInvocation(composition, stepDescriptor('person:ada', 'summary'), fake.port));
    fake.active = invocation;
    const pairs: IInvokedPair[] = [];
    const bindings = { inputs: 'current-inputs', helpers: 'current-helpers' };
    const outcome = invocation.apply(bindings, recordingInvoker(pairs));
    expect(outcome).toBe('person:ada');
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.callback).toBe(member?.summaryRun);
    expect(pairs[0]?.context).toEqual({ inputs: 'current-inputs', helpers: 'current-helpers', calls: member?.captured.calls });
    expect(Object.isFrozen(pairs[0]?.context)).toBe(true);
    expect(bindings).toEqual({ inputs: 'current-inputs', helpers: 'current-helpers' });
  });

  test('bridge: source run and finality reach the invoker as the author\'s original functions', () => {
    const fake = fakePort();
    const built = buildFixture();
    const ada = built.members['person:ada'];
    const invocation = asSource(openInvocation(built.composition, stepDescriptor('person:ada', 'activity'), fake.port));
    const pairs: IInvokedPair[] = [];
    const carrier = carrierOf('previous activity');
    const supplier = supplierOf(carrier, []);
    expect(invocation.apply({}, supplier, recordingInvoker(pairs))).toBe('fetch person:ada');
    expect(invocation.hasFinality).toBe(true);
    expect(invocation.applyFinality({}, supplier, recordingInvoker(pairs))).toBe(true);
    expect(pairs.map(pair => pair.callback)).toEqual([ada.callbacks.activityRun, ada.callbacks.activityFinality]);
    expect(pairs[0]?.callback).toBe(ada.callbacks.activityRun);
    expect(pairs[1]?.callback).toBe(ada.callbacks.activityFinality);
  });

  test('bridge: an absent finality is reported and never reaches the invoker', () => {
    const fake = fakePort();
    const { composition } = capturingComposition(['person:ada']);
    const invocation = asSource(openInvocation(composition, stepDescriptor('person:ada', 'activity'), fake.port));
    const invoke = jest.fn(recordingInvoker([]));
    expect(invocation.hasFinality).toBe(false);
    expectDefinitionError(() => invocation.applyFinality({}, supplierOf(carrierOf('x'), []), invoke), 'invalid-callback');
    expect(invoke).not.toHaveBeenCalled();
  });

  test('carrier: source run receives absence, or the supplier\'s carrier itself for its own declaration', () => {
    const fake = fakePort();
    const built = buildFixture();
    const ada = built.members['person:ada'];
    const invocation = asSource(openInvocation(built.composition, stepDescriptor('person:ada', 'activity'), fake.port));
    const pairs: IInvokedPair[] = [];
    invocation.apply({ config: 'current' }, undefined, recordingInvoker(pairs));
    expect(pairs[0]?.context).toEqual({ config: 'current', previous: undefined });

    const traps: string[] = [];
    const data = new Proxy({}, { get(target, key, receiver): unknown { traps.push(String(key)); return Reflect.get(target, key, receiver); } });
    const carrier = carrierOf(data);
    const served: unknown[] = [];
    const supplier = supplierOf(carrier, served);
    invocation.apply({ config: 'current' }, supplier, recordingInvoker(pairs));
    invocation.applyFinality({ config: 'current' }, supplier, recordingInvoker(pairs));
    expect(served).toEqual([ada.activity, ada.activity]);
    expect(served[0]).toBe(ada.activity);
    for (const pair of pairs.slice(1)) {
      expect(pair.context).toEqual({ config: 'current', previous: carrier });
      expect(Reflect.get(Object(pair.context), 'previous')).toBe(carrier);
      expect(Object.isFrozen(pair.context)).toBe(true);
    }
    expect(traps).toEqual([]);
  });

  test('carrier: a malformed or mutable previous carrier rejects before the author callback runs', () => {
    const fake = fakePort();
    const { composition } = buildFixture();
    const invocation = asSource(openInvocation(composition, stepDescriptor('person:ada', 'activity'), fake.port));
    const invoke = jest.fn(recordingInvoker([]));
    const getter = jest.fn((): string => 'data');
    const malformed: readonly unknown[] = [
      undefined,
      'payload',
      Object.freeze({ value: 1 }),
      { data: 'mutable carrier' },
      Object.freeze(Object.defineProperty({}, 'data', { get: getter, enumerable: true })),
    ];
    for (const carrier of malformed) {
      expectDefinitionError(() => invocation.apply({}, supplierOf(carrier, []), invoke), 'invalid-previous');
      expectDefinitionError(() => invocation.applyFinality({}, supplierOf(carrier, []), invoke), 'invalid-previous');
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  test('bindings: reserved context names and accessors reject without invoking anything', () => {
    const fake = fakePort();
    const built = buildFixture();
    const summary = asMemo(openInvocation(built.composition, stepDescriptor('person:ada', 'summary'), fake.port));
    const activity = asSource(openInvocation(built.composition, stepDescriptor('person:ada', 'activity'), fake.port));
    fake.active = summary;
    const invoke = jest.fn(recordingInvoker([]));
    const getter = jest.fn((): string => 'inputs');
    expectDefinitionError(() => summary.apply({ calls: 'forged' }, invoke), 'invalid-bindings');
    expectDefinitionError(() => activity.apply({ previous: 'forged' }, undefined, invoke), 'invalid-bindings');
    expectDefinitionError(() => summary.apply(Object.defineProperty({}, 'inputs', { get: getter, enumerable: true }), invoke), 'invalid-bindings');
    expect(invoke).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  test('bindings: symbol-keyed accessors reject without being invoked by the context spread', () => {
    // Regression: symbol-keyed descriptors were skipped, so the spread ran the getter.
    const fake = fakePort();
    const built = buildFixture();
    const summary = asMemo(openInvocation(built.composition, stepDescriptor('person:ada', 'summary'), fake.port));
    const activity = asSource(openInvocation(built.composition, stepDescriptor('person:ada', 'activity'), fake.port));
    fake.active = summary;
    const invoke = jest.fn(recordingInvoker([]));
    const getter = jest.fn((): string => 'hidden');
    const bindings = Object.defineProperty({}, Symbol('hidden'), { get: getter, enumerable: true });
    expectDefinitionError(() => summary.apply(bindings, invoke), 'invalid-bindings');
    expectDefinitionError(() => activity.apply(bindings, undefined, invoke), 'invalid-bindings');
    expectDefinitionError(() => activity.applyFinality(bindings, supplierOf(carrierOf('previous'), []), invoke), 'invalid-bindings');
    expect(getter).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  test('bindings: shapes whose fields would be lost from the context reject on every path before invocation', () => {
    // Regression (Copilot thread 4118026118; independent review findings 5 and 6):
    // arrays, class instances and non-enumerable fields passed validation, then the
    // context spread dropped length, prototype methods or the hidden field.
    const fake = fakePort();
    const built = buildFixture();
    const summary = asMemo(openInvocation(built.composition, stepDescriptor('person:ada', 'summary'), fake.port));
    const activity = asSource(openInvocation(built.composition, stepDescriptor('person:ada', 'activity'), fake.port));
    fake.active = summary;
    const invoke = jest.fn(recordingInvoker([]));
    class Bindings {
      public readonly config = 'current';
      public format(): string {
        return this.config;
      }
    }
    const unsupported: readonly unknown[] = [
      ['config'],
      new Bindings(),
      Object.defineProperty({}, 'config', { value: 'current', enumerable: false }),
      { [Symbol('config')]: 'current' },
    ];
    // Supplied the way untyped facade code could, bypassing the binding record type.
    for (const bindings of unsupported) {
      expectDefinitionError(() => Reflect.apply(summary.apply, summary, [bindings, invoke]), 'invalid-bindings');
      expectDefinitionError(() => Reflect.apply(activity.apply, activity, [bindings, undefined, invoke]), 'invalid-bindings');
      expectDefinitionError(() => Reflect.apply(activity.applyFinality, activity, [bindings, supplierOf(carrierOf('previous'), []), invoke]), 'invalid-bindings');
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  test('bindings: a null-prototype plain record keeps every field in the callback context', () => {
    const fake = fakePort();
    const built = buildFixture();
    const activity = asSource(openInvocation(built.composition, stepDescriptor('person:ada', 'activity'), fake.port));
    const pairs: IInvokedPair[] = [];
    const bindings: Record<string, unknown> = Object.assign(Object.create(null) as Record<string, unknown>, { config: 'current' });
    activity.apply(bindings, undefined, recordingInvoker(pairs));
    expect(pairs[0]?.context).toEqual({ config: 'current', previous: undefined });
  });

  test('bridge: prototype-looking child slot names mint own declared handles', async () => {
    // Regression (independent review of 9500a4b): assigning `__proto__` into an
    // ordinary calls object hit the inherited setter, so a valid slot failed at apply.
    const fake = fakePort();
    for (const slot of ['__proto__', 'constructor']) {
      const child = source<string>({ subject: `activity:${slot}`, run: () => slot });
      const captured: { calls?: Readonly<Record<string, IDeclaredCallHandle<string>>> } = {};
      const summary = memo({
        subject: `summary:${slot}`,
        children: Object.fromEntries([[slot, child]]),
        run: (context: { readonly calls: Readonly<Record<string, IDeclaredCallHandle<string>>> }) => {
          captured.calls = context.calls;
          return slot;
        },
      });
      const composition = compose({
        scope: fixtureScope,
        members: [{ key: 'person:ada', steps: [{ slot, declaration: child }, { slot: 'summary', declaration: summary }] }],
      });
      const invocation = asMemo(openInvocation(composition, stepDescriptor('person:ada', 'summary'), fake.port));
      fake.active = invocation;
      expect(invocation.apply({}, recordingInvoker([]))).toBe(slot);
      const calls = captured.calls;
      expect(calls === undefined ? [] : Object.keys(calls)).toEqual([slot]);
      const handle: unknown = calls === undefined ? undefined : Object.getOwnPropertyDescriptor(calls, slot)?.value;
      expect(typeof handle).toBe('function');
      if (typeof handle === 'function') {
        const result: unknown = Reflect.apply(handle, undefined, []);
        await Promise.resolve(result);
      }
      expect(fake.requests.at(-1)?.witness.child).toEqual(stepDescriptor('person:ada', slot));
      expect(fake.requests.at(-1)?.child).toBe(child);
    }
  });

  test('CMP-9: composing, resolving and opening invocations never run callbacks or the invoker', () => {
    const fake = fakePort();
    const run = jest.fn((): string => 'x');
    const finality = jest.fn((): boolean => true);
    const summaryRun = jest.fn((): string => 'y');
    const activity = source<string>({ subject: 'activity:a', run, finality });
    const summary = memo({ subject: 'summary:a', children: { activity }, run: summaryRun });
    const composition = compose({ scope: fixtureScope, members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: activity }, { slot: 'summary', declaration: summary }] }] });
    composition.resolve(stepDescriptor('person:ada', 'summary'));
    openInvocation(composition, stepDescriptor('person:ada', 'summary'), fake.port);
    openInvocation(composition, stepDescriptor('person:ada', 'activity'), fake.port);
    expect(run).not.toHaveBeenCalled();
    expect(finality).not.toHaveBeenCalled();
    expect(summaryRun).not.toHaveBeenCalled();
  });

  test('CMP-9: apply after the invocation scope closes rejects before the invoker', () => {
    const fake = fakePort();
    const { composition } = buildFixture();
    const invocation = asMemo(openInvocation(composition, stepDescriptor('person:ada', 'summary'), fake.port));
    const invoke = jest.fn(recordingInvoker([]));
    invocation.close();
    expect(invocation.open).toBe(false);
    expectDefinitionError(() => invocation.apply({}, invoke), 'scope-closed');
    expect(invoke).not.toHaveBeenCalled();
  });

  test('CMP-9: opening requires a uniquely bound step parent in a composition this family owns', () => {
    const fake = fakePort();
    const built = buildFixture();
    const ada = buildMember('person:ada');
    const duplicated = compose({ scope: fixtureScope, members: [ada.registration, ada.registration] });
    expectDefinitionError(() => openInvocation(built.composition, stepDescriptor('person:cy', 'summary'), fake.port), 'unresolved-parent');
    expectDefinitionError(() => openInvocation(duplicated, stepDescriptor('person:ada', 'summary'), fake.port), 'unresolved-parent');
    expectDefinitionError(() => openInvocation(built.composition, { scope: fixtureScope, role: 'input', slot: 'config' }, fake.port), 'unresolved-parent');
    const other = declarations<ITestFamily>();
    const foreignActivity = other.source({ subject: 'activity:f', run: () => 1 });
    const foreign = other.compose({ scope: fixtureScope, members: [{ key: 'person:ada', steps: [{ slot: 'activity', declaration: foreignActivity }] }] });
    expectDefinitionError(() => openInvocation(foreign, stepDescriptor('person:ada', 'activity'), fake.port), 'forged-composition');
  });
});

describe('declared child handles', () => {
  test('CMP-5/REUSE-006: a declared call dispatches its witness and the pinned sibling declaration through the port', async () => {
    const fake = fakePort();
    const { invocation, handle, member } = openSummary('person:ada', fake);
    await handle();
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.scope).toBe(invocation);
    expect(fake.requests[0]?.child).toBe(member.activity);
    expect(fake.requests[0]?.witness).toEqual({
      version: 1,
      parent: stepDescriptor('person:ada', 'summary'),
      child: stepDescriptor('person:ada', 'activity'),
      arguments: { form: 'empty' },
    });
    expect(Object.isFrozen(fake.requests[0])).toBe(true);
    expect(Object.isFrozen(fake.requests[0]?.witness)).toBe(true);
  });

  test('bridge: the calls record holds exactly the declared child keys and is frozen', () => {
    const fake = fakePort();
    const { member } = openSummary('person:ada', fake);
    const calls = member.captured.calls;
    expect(calls === undefined ? [] : Object.keys(calls)).toEqual(['activity']);
    expect(Object.isFrozen(calls)).toBe(true);
    expect(calls === undefined ? true : Reflect.set(calls, 'summary', calls.activity)).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  test('carrier: the child result is an immutable null-prototype `{ data }` that never probes the child data', async () => {
    const fake = fakePort();
    const traps: string[] = [];
    const data = new Proxy({}, {
      get(target, key, receiver): unknown {
        traps.push(`get:${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      has(target, key): boolean {
        traps.push(`has:${String(key)}`);
        return Reflect.has(target, key);
      },
      getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
        traps.push(`own:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    fake.result = { data };
    const { handle } = openSummary('person:ada', fake);
    const carrier = await handle();
    expect(carrier.data).toBe(data);
    expect(Object.isFrozen(carrier)).toBe(true);
    expect(Object.getPrototypeOf(carrier)).toBeNull();
    expect(Object.keys(carrier)).toEqual(['data']);
    expect(traps).toEqual([]);
  });

  test('carrier: a malformed port result rejects instead of being handed to author code', async () => {
    const fake = fakePort();
    const { handle } = openSummary('person:ada', fake);
    for (const malformed of [undefined, 42, {}, { value: 1 }]) {
      fake.result = malformed;
      await expectRejection(handle(), 'invalid-result');
    }
  });

  test('CMP-7: M3 handles reject runtime arguments before dispatch', async () => {
    const fake = fakePort();
    const { handle } = openSummary('person:ada', fake);
    await expectRejection(callWithArguments(handle, 'person:ben'), 'unsupported-arguments');
    await expectRejection(callWithArguments(handle, undefined), 'unsupported-arguments');
    expect(fake.requests).toHaveLength(0);
  });

  test('CMP-9: a handle used after its invocation scope closes rejects before dispatch', async () => {
    const fake = fakePort();
    const { invocation, handle } = openSummary('person:ada', fake);
    invocation.close();
    await expectRejection(handle(), 'scope-closed');
    expect(fake.requests).toHaveLength(0);
  });

  test('CMP-9: a handle called outside its active run context rejects before dispatch', async () => {
    const fake = fakePort();
    const { handle } = openSummary('person:ada', fake);
    fake.active = undefined;
    await expectRejection(handle(), 'scope-inactive');
    expect(fake.requests).toHaveLength(0);
  });

  test('CMP-9: a substituted handle from another member rejects inside the active parent', async () => {
    const fake = fakePort();
    const built = capturingComposition(['person:ada', 'person:ben']);
    const ben = openSummary('person:ben', fake, built);
    const ada = openSummary('person:ada', fake, built);
    expect(fake.active).toBe(ada.invocation);
    await expectRejection(ben.handle(), 'scope-inactive');
    expect(fake.requests).toHaveLength(0);
  });

  test('CMP-9: framework result resolution during composition rejects before dispatch', async () => {
    const fake = fakePort();
    const { handle } = openSummary('person:ada', fake);
    const ben = buildMember('person:ben');
    let attempted: Promise<unknown> | undefined;
    const members = new Proxy([ben.registration], {
      get(target, key, receiver): unknown {
        if (key === '0' && attempted === undefined) {
          attempted = handle();
        }
        return Reflect.get(target, key, receiver);
      },
    });
    compose({ scope: fixtureScope, members });
    expect(attempted).toBeDefined();
    if (attempted !== undefined) {
      await expectRejection(attempted, 'composition-phase');
    }
    expect(fake.requests).toHaveLength(0);
  });

  test('ARC-005: reversed member invocation order dispatches each member to its own child', async () => {
    const fake = fakePort();
    const built = capturingComposition(['person:ben', 'person:ada']);
    for (const key of ['person:ben', 'person:ada'] as const) {
      await openSummary(key, fake, built).handle();
    }
    expect(fake.requests.map(request => request.witness.child.memberKey)).toEqual(['person:ben', 'person:ada']);
    expect(fake.requests.map(request => request.child)).toEqual([built.members.get('person:ben')?.activity, built.members.get('person:ada')?.activity]);
  });
});

describe('handle ownership', () => {
  test('identity: Definition describes the witness of its own minted handles', () => {
    const fake = fakePort();
    const { handle } = openSummary('person:ada', fake);
    expect(describeHandle(handle)).toEqual({
      version: 1,
      parent: stepDescriptor('person:ada', 'summary'),
      child: stepDescriptor('person:ada', 'activity'),
      arguments: { form: 'empty' },
    });
    expect(Object.isFrozen(handle)).toBe(true);
  });

  test('identity: forged look-alikes and wrappers around genuine handles are not declared handles', () => {
    const fake = fakePort();
    const { handle: genuine } = openSummary('person:ada', fake);
    // The forgery carries the brand spelling and a genuine witness value.
    const forged = Object.assign(() => Promise.resolve({ data: 1 }), { __microdeltaDeclaredCall: describeHandle(genuine) });
    const wrapper = (): Promise<IChildResult<string>> => genuine();
    expect(describeHandle(forged)).toBeUndefined();
    expect(describeHandle(wrapper)).toBeUndefined();
    expect(describeHandle(genuine.bind(undefined))).toBeUndefined();
    expect(describeHandle({ version: 1 })).toBeUndefined();
  });
});
