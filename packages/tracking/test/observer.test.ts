import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, test } from '@jest/globals';
import type { IMachine } from '@microdelta/machine';
import { observe } from '@microdelta/value';
import { createTrackingObserver } from '../src/index.js';
import type { ICurrentFactRequest, ICurrentFactResolution, ITrackingBinding } from '../src/index.js';
import type { IValueProjectionFact } from '@microdelta/value';

/** Supply only host facilities; this test adapter has no Tracking policy. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** A caller-owned binding catalog supplies the current source fact by structural binding. */
function createProvider(): {
  readonly provider: {
      resolve(binding: ITrackingBinding, request: ICurrentFactRequest): ICurrentFactResolution;
  };
  readonly set: (binding: string, root: unknown) => void;
} {
  const roots = new Map<string, unknown>();
  return {
    provider: {
      resolve(binding, request): ICurrentFactResolution {
        const key = binding.path.join('/');
        const root = roots.get(key);
        if (root === undefined) {
          return { kind: 'unavailable' };
        }
        if (request.kind === 'implementation') {
          return { kind: 'available', fact: root };
        }
        if (request.kind === 'selected') {
          return { kind: 'available', fact: observe(root, request.address, request.operation) };
        }
        return { kind: 'unavailable' };
      },
    },
    set(binding, root) {
      roots.set(binding, root);
    },
  };
}

describe('semantic tracking observer', () => {
  const observer = createTrackingObserver(machine);
  const binding = { path: ['analysis', 'author'] };

  test('tracked containers navigate without whole-tree reads; pass-through is observed only by the callee', () => {
    const tracked = observer.tracked({ author: { name: 'Ada', unread: 'v1' } }, binding);
    const capture = observer.capture(() => {
      function assess(input: typeof tracked): string { return input.author.name; }
      return assess(tracked);
    });

    expect(capture.value).toBe('Ada');
    expect(capture.observations).toHaveLength(1);
    expect(capture.observations[0]?.address).toEqual([
      { kind: 'property', key: 'author' },
      { kind: 'property', key: 'name' },
    ]);
    expect(capture.observations[0]?.kind).toBe('fact');
  });

  test('returning a tracked input preserves the same wrapper and does not imply materialization', () => {
    const tracked = observer.tracked({ name: 'Ada', unread: { detail: 'not consumed' } }, binding);
    const capture = observer.capture(() => tracked);
    expect(capture.value).toBe(tracked);
    expect(capture.observations).toHaveLength(0);
    expect(observer.materialization.owns(capture.value)).toBe(true);
    const output = observer.capture(() => observer.materialization.read(capture.value, 'name'));
    expect(output.value).toBe('Ada');
    expect(output.observations).toHaveLength(1);
  });

  test('materialization reads reject unowned and foreign-observer values', () => {
    const untracked = { name: 'untracked' };
    const otherObserver = createTrackingObserver(machine);
    const foreign = otherObserver.tracked({ name: 'foreign' }, binding);
    expect(() => { Reflect.apply(observer.materialization.read, observer.materialization, [untracked, 'name']); })
      .toThrow(/observer-owned|owned/i);
    expect(() => { Reflect.apply(observer.materialization.read, observer.materialization, [foreign, 'name']); })
      .toThrow(/observer-owned|owned/i);
  });

  test('synchronous capture rejects promises and ordinary thenable results', () => {
    expect(() => observer.capture(() => Promise.resolve('later'))).toThrow(/captureAsync/i);
    expect(() => observer.capture(() => ({ then: () => undefined }))).toThrow(/captureAsync/i);
  });

  test('async wrapper pass-through preserves Promise assimilation reads as actual observations', async () => {
    const tracked = observer.tracked({ name: 'Ada' }, binding);
    const capture = await observer.captureAsync(async () => tracked);
    expect(capture.value).toBe(tracked);
    expect(capture.observations.map(item => item.address)).toEqual([[{ kind: 'property', key: 'then' }]]);
  });

  test('copies registration bindings and retained facts so later source mutation cannot retarget evidence', () => {
    const suppliedBinding = { path: ['analysis', 'author'] };
    const supplied = { name: 'Ada' };
    const tracked = observer.tracked(supplied, suppliedBinding);
    suppliedBinding.path[1] = 'different';
    supplied.name = 'Grace';

    const capture = observer.capture(() => tracked.name);
    expect(capture.value).toBe('Ada');
    expect(capture.observations[0]?.binding).toEqual({ path: ['analysis', 'author'] });
    expect(Object.isFrozen(capture.observations)).toBe(true);
    expect(Object.isFrozen(capture.observations[0]?.binding)).toBe(true);
  });

  test('rejects binding accessors and sparse correspondence paths instead of executing or guessing them', () => {
    const accessor = Object.defineProperty({}, 'path', { get: () => ['analysis', 'author'] });
    const sparsePath: string[] = new Array<string>(1);
    expect(() => { Reflect.apply(observer.tracked, observer, [{ name: 'Ada' }, accessor]); }).toThrow(/binding|path/i);
    expect(() => { Reflect.apply(observer.tracked, observer, [{ name: 'Ada' }, { path: sparsePath }]); }).toThrow(/binding|path/i);
  });

  test('compares selected facts through current bindings while preserving original evidence', () => {
    const source = createProvider();
    const captured = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    source.set('analysis/author', { name: 'Ada' });
    expect(observer.compareCurrent(captured, source.provider)).toMatchObject({ kind: 'equal' });

    source.set('analysis/author', { name: 'Grace' });
    expect(observer.compareCurrent(captured, source.provider)).toMatchObject({ kind: 'changed' });
    expect(captured.observations[0]?.encoded).toContain('Ada');
    expect(observer.compareCurrent(captured, { resolve: () => ({ kind: 'unavailable' }) }).kind).toBe('unavailable');
    expect(observer.compareCurrent(captured, { resolve: () => ({ kind: 'ambiguous' }) }).kind).toBe('ambiguous');
  });

  test('compares an exact compatible fingerprint request without asking for payload and rejects mismatched metadata descriptors', () => {
    const captured = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    const expected = captured.observations[0];
    if (expected === undefined) { throw new Error('Expected selected evidence'); }
    let resolutions = 0;
    const sameSelection: ICurrentFactResolution = {
      kind: 'compatible-fingerprint',
      selection: expected.selection,
      encodingVersion: 'MDO1',
      fingerprint: expected.fingerprint,
    };
    const equal = observer.compareCurrent(captured, {
      resolve(_binding, request) {
        resolutions += 1;
        expect(request).toEqual(expected.selection);
        return sameSelection;
      },
    });
    expect(equal.kind).toBe('equal');
    expect(resolutions).toBe(1);

    const differentFingerprint = `${expected.fingerprint.startsWith('0') ? '1' : '0'}${expected.fingerprint.slice(1)}`;
    expect(observer.compareCurrent(captured, {
      resolve(_binding, request) {
        return { kind: 'compatible-fingerprint', selection: request, encodingVersion: 'MDO1', fingerprint: differentFingerprint };
      },
    }).kind).toBe('changed');
    expect(observer.compareCurrent(captured, {
      resolve(_binding, request) {
        return {
          kind: 'compatible-fingerprint',
          selection: { ...request, address: [{ kind: 'property', key: 'other' }] },
          encodingVersion: 'MDO1',
          fingerprint: expected.fingerprint,
        };
      },
    }).kind).toBe('incompatible');
  });

  test('rejects accessor-backed current fact envelopes without invoking provider getters', () => {
    const captured = observer.capture(() => observer.tracked({ name: 'Ada' }, binding).name);
    let getterCalls = 0;
    const badOperation = Object.defineProperties({}, {
      operation: { enumerable: true, get() { getterCalls += 1; return 'value'; } },
      address: { enumerable: true, value: [{ kind: 'property', key: 'name' }] },
      fact: { enumerable: true, value: 'Ada' },
    });
    const badSegment = {
      operation: 'value',
      address: [{
        get kind(): 'property' { getterCalls += 1; return 'property'; },
        key: 'name',
      }],
      fact: 'Ada',
    };

    for (const fact of [badOperation, badSegment]) {
      expect(observer.compareCurrent(captured, {
        resolve: () => ({ kind: 'available', fact }),
      }).kind).toBe('incompatible');
    }
    expect(getterCalls).toBe(0);
  });

  test('rebinding an intermediate object keeps equal consumed values and compares later changes at the new path', () => {
    const source = createProvider();
    const captured = observer.capture(() => observer.tracked({ author: { id: 'a', name: 'Ada' } }, binding).author.name);
    const original = captured.observations[0];
    source.set('analysis/author', { author: { id: 'b', name: 'Ada' } });
    expect(observer.compareCurrent(captured, source.provider)).toMatchObject({ kind: 'equal' });

    source.set('analysis/author', { author: { id: 'b', name: 'Grace' } });
    expect(observer.compareCurrent(captured, source.provider)).toMatchObject({ kind: 'changed' });
    expect(captured.observations[0]).toBe(original);
    expect(original?.encoded).toContain('Ada');
  });

  test('compares absent and present undefined as the same value read, preserving falsey values literally', () => {
    const absentInput: { flag?: undefined } = {};
    const absent = observer.capture(() => observer.tracked(absentInput, binding).flag);
    const present = observer.capture(() => observer.tracked({ flag: undefined }, binding).flag);
    expect(absent.observations[0]?.fingerprint).toBe(present.observations[0]?.fingerprint);

    const zero = observer.capture(() => observer.tracked({ flag: 0 }, binding).flag);
    const empty = observer.capture(() => observer.tracked({ flag: '' }, binding).flag);
    expect(zero.observations[0]?.fingerprint).not.toBe(empty.observations[0]?.fingerprint);
  });

  test('retains distinct consumed facts when wrappers share one structural address', () => {
    const zero = observer.tracked({ flag: 0 }, binding);
    const empty = observer.tracked({ flag: '' }, binding);
    const capture = observer.capture(() => [zero.flag, empty.flag]);
    const source = createProvider();
    source.set('analysis/author', { flag: 0 });

    expect(capture.observations).toHaveLength(2);
    expect(observer.compareCurrent(capture, source.provider).kind).toBe('changed');
  });

  test('array length and positional reads remain separate; native reflection rejects the non-enumerable length case', () => {
    const tracked = observer.tracked(['a', 'b'], binding);
    const length = observer.capture(() => tracked.length);
    const position = observer.capture(() => tracked[0]);
    expect(length.observations[0]?.operation).toBe('length');
    expect(position.observations[0]?.address).toEqual([{ kind: 'index', index: 0 }]);
    expect(() => observer.capture(() => Object.keys(tracked))).toThrow(/unsupported|reflection/i);
    expect(() => observer.capture(() => Object.hasOwn(tracked, 'length'))).toThrow(/unsupported|reflection/i);
    expect(() => observer.hasOwn(tracked, '01')).toThrow(/index|unsupported/i);
    expect(() => observer.hasOwn(tracked, '-0')).toThrow(/index|unsupported/i);
    expect(() => observer.hasOwn(tracked, '')).toThrow(/index|unsupported/i);
  });

  test('explicit keys, own-property checks, and inherited membership keep their operation meanings', () => {
    const inherited = Object.create({ inherited: undefined }) as { readonly own?: number; readonly inherited?: undefined };
    Object.assign(inherited, { own: 1 });
    const tracked = observer.tracked(inherited, binding);
    const capture = observer.capture(() => ({ keys: observer.keys(tracked), own: observer.hasOwn(tracked, 'own'), inherited: 'inherited' in tracked }));
    expect(capture.value).toEqual({ keys: ['own'], own: true, inherited: true });
    expect(capture.observations.map(item => item.operation)).toEqual(['keys', 'own', 'membership']);
  });

  test('called functions record implementation evidence; uncalled functions do not and calls are not memoized', () => {
    let calls = 0;
    const unused = observer.tracked(() => 'unused', binding);
    const implementation = (value: number): number => { calls++; return value + 1; };
    const fn = observer.tracked(implementation, binding);
    const noCall = observer.capture(() => unused);
    expect(noCall.observations).toHaveLength(0);
    const capture = observer.capture(() => [fn(1), fn(1)]);
    expect(capture.value).toEqual([2, 2]);
    expect(calls).toBe(2);
    expect(capture.observations.filter(item => item.kind === 'implementation')).toHaveLength(1);
    const source = createProvider();
    source.set('analysis/author', implementation);
    expect(observer.compareCurrent(capture, source.provider).kind).toBe('equal');
    source.set('analysis/author', (value: number) => value + 2);
    expect(observer.compareCurrent(capture, source.provider).kind).toBe('changed');
  });

  test('function-source fingerprints preserve distinct unpaired UTF-16 surrogate code units', () => {
    const highSurrogate = String.fromCharCode(0xd800);
    const lowSurrogate = String.fromCharCode(0xd801);
    // Dynamic construction is necessary because UTF-8 source files cannot contain lone surrogates directly.
    const high = new Function(`return '${highSurrogate}'`) as () => string;
    const low = new Function(`return '${lowSurrogate}'`) as () => string;
    expect(Function.prototype.toString.call(high)).not.toBe(Function.prototype.toString.call(low));
    expect(machine.sha256(Function.prototype.toString.call(high))).toBe(machine.sha256(Function.prototype.toString.call(low)));

    const capture = observer.capture(() => {
      const first = observer.tracked(high, binding);
      const second = observer.tracked(low, binding);
      return [first(), second()];
    });
    const implementations = capture.observations.filter(item => item.kind === 'implementation');
    expect(implementations).toHaveLength(2);
    expect(implementations[0]?.fingerprint).not.toBe(implementations[1]?.fingerprint);
  });

  test('rejects callable forms without source evidence and unsupported function metadata or construction', () => {
    const original = function add(value: number): number { return value + 1; };
    const bound = original.bind(undefined);
    expect(() => observer.tracked(Math.max, binding)).toThrow(/source|native/i);
    expect(() => observer.tracked(bound, binding)).toThrow(/source|native/i);

    let constructed = false;
    function ConstructorLike(): void { constructed = true; }
    const tracked = observer.tracked(ConstructorLike, binding);
    expect(() => { Reflect.construct(tracked, []); }).toThrow(/construct|ordinary call/i);
    expect(constructed).toBe(false);
    expect(() => { Reflect.get(tracked, 'name'); }).toThrow(/function|metadata|property/i);
    expect(() => Reflect.set(tracked, 'extra', true)).toThrow(/immutable|property|function/i);
  });

  test('inspectable function text containing native-code wording remains supported', () => {
    const literal = observer.tracked(() => '[native code]', binding);
    const block = observer.tracked(() => { return '[native code]'; }, binding);
    expect(literal()).toBe('[native code]');
    expect(block()).toBe('[native code]');
  });

  test('cached derivations replay successful and failed semantic observations, including nested derivations', () => {
    const source = observer.tracked({ enabled: true, left: 'yes', right: 'no' }, binding);
    const input = observer.local.cell(source);
    let calls = 0;
    const child = observer.derived(() => { calls++; return input.get().enabled ? input.get().left : input.get().right; });
    const parent = observer.derived(() => child.get());
    const first = observer.capture(() => parent.get());
    const cached = observer.capture(() => parent.get());
    expect(first.observations.map(item => item.fingerprint)).toEqual(cached.observations.map(item => item.fingerprint));
    expect(calls).toBe(1);

    const failure = new Error('selected branch failed');
    const throws = observer.derived(() => { input.get().enabled; throw failure; });
    const catching = observer.derived(() => {
      try {
        throws.get();
      } catch (error: unknown) {
        if (error !== failure) { throw error; }
      }
      return 'caught';
    });
    const firstFailure = observer.capture(() => catching.get());
    const cachedFailure = observer.capture(() => catching.get());
    expect(firstFailure.value).toBe('caught');
    expect(firstFailure.observations.map(item => item.fingerprint)).toEqual(cachedFailure.observations.map(item => item.fingerprint));
  });

  test('cached derivations replay materialized output, projection, and order facts on both success and failure', () => {
    const source = observer.tracked({ profile: { name: 'Ada' } }, binding);
    const projection = {
      descriptor: {
        address: [{ kind: 'property' as const, key: 'name' }],
        operation: 'value' as const,
        traversal: { kind: 'exhaustive' as const, complete: true as const },
      },
      members: [['user-a', 'Ada']] as const,
    };
    const keys = ['user-a', 'user-b'];
    let successCalls = 0;
    const success = observer.derived(() => {
      successCalls += 1;
      observer.snapshotOutput(source.profile);
      observer.materialization.recordProjection(binding, projection);
      observer.materialization.recordCollectionOrder(binding, keys);
      return 'complete';
    });
    const firstSuccess = observer.capture(() => success.get());
    const cachedSuccess = observer.capture(() => success.get());

    expect(firstSuccess.value).toBe('complete');
    expect(firstSuccess.observations.map(item => item.kind).sort())
      .toEqual(['collection-order', 'materialized-output', 'projection']);
    expect(cachedSuccess.observations.map(item => item.fingerprint))
      .toEqual(firstSuccess.observations.map(item => item.fingerprint));
    expect(successCalls).toBe(1);

    const failure = new Error('cached selected projection failed');
    let failureCalls = 0;
    const failed = observer.derived(() => {
      failureCalls += 1;
      observer.snapshotOutput(source.profile);
      observer.materialization.recordProjection(binding, projection);
      observer.materialization.recordCollectionOrder(binding, keys);
      throw failure;
    });
    const captureFailure = () => observer.capture(() => {
      try {
        failed.get();
      } catch (error: unknown) {
        if (error !== failure) { throw error; }
      }
      return 'caught';
    });
    const firstFailure = captureFailure();
    const cachedFailure = captureFailure();

    expect(firstFailure.value).toBe('caught');
    expect(firstFailure.observations.map(item => item.kind).sort())
      .toEqual(['collection-order', 'materialized-output', 'projection']);
    expect(cachedFailure.observations.map(item => item.fingerprint))
      .toEqual(firstFailure.observations.map(item => item.fingerprint));
    expect(failureCalls).toBe(1);
  });

  test('retains only projection descriptor and digest while keeping visited coverage explicit', () => {
    const selectedPayload = 'SELECTED-MEMBER-PAYLOAD-'.concat('x'.repeat(256));
    const exhaustive: IValueProjectionFact = {
      descriptor: {
        address: [{ kind: 'property' as const, key: 'name' }],
        operation: 'value',
        traversal: { kind: 'exhaustive', complete: true },
      },
      members: Array.from({ length: 64 }, (_unused, index) => [`member-${index}`, `${selectedPayload}-${index}`] as const),
    };
    const captured = observer.capture(() => observer.materialization.recordProjection(binding, exhaustive));
    expect(captured.observations).toHaveLength(1);
    const projection = captured.observations[0];
    expect(projection?.kind).toBe('projection');
    expect(projection?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(projection && 'encoded' in projection).toBe(false);
    expect(JSON.stringify(projection)).not.toContain(selectedPayload);

    const small: IValueProjectionFact = { ...exhaustive, members: exhaustive.members.slice(0, 1) };
    const capturedSmall = observer.capture(() => observer.materialization.recordProjection(binding, small));
    expect(JSON.stringify(capturedSmall.observations[0])).toHaveLength(JSON.stringify(projection).length);
    const current = (fact: IValueProjectionFact): { resolve: (_binding: ITrackingBinding, request: ICurrentFactRequest) => ICurrentFactResolution } => ({
      resolve(_binding, request) {
        return request.kind === 'projection' ? { kind: 'available', fact } : { kind: 'unavailable' };
      },
    });
    expect(observer.compareCurrent(captured, current(exhaustive)).kind).toBe('equal');
    expect(observer.compareCurrent(captured, current({ ...exhaustive, members: [...exhaustive.members, ['new-member', 'new value']] })).kind)
      .toBe('changed');

    const visited: IValueProjectionFact = {
      descriptor: {
        ...exhaustive.descriptor,
        traversal: { kind: 'visited', complete: false, keys: ['member-7', 'member-2'] },
      },
      members: [['member-7', selectedPayload], ['member-2', `${selectedPayload}-2`]],
    };
    const capturedVisited = observer.capture(() => observer.materialization.recordProjection(binding, visited));
    expect(capturedVisited.observations).toHaveLength(1);
    expect(capturedVisited.observations[0]?.selection).toMatchObject({
      kind: 'projection',
      descriptor: { traversal: { kind: 'visited', complete: false, keys: ['member-7', 'member-2'] } },
    });
    expect(JSON.stringify(capturedVisited.observations[0])).not.toContain(selectedPayload);
  });

  test('local replacement invalidates tags and replaces the semantic branch observations', () => {
    const input = observer.local.cell(observer.tracked({ enabled: true, left: 'yes', right: 'no' }, binding));
    const output = observer.derived(() => input.get().enabled ? input.get().left : input.get().right);
    const first = observer.capture(() => output.get());
    input.set(observer.tracked({ enabled: false, left: 'yes', right: 'no' }, binding));
    const second = observer.capture(() => output.get());
    expect(second.value).toBe('no');
    expect(first.observations.map(item => item.address)).not.toEqual(second.observations.map(item => item.address));
  });

  test('closed inherited frames reject first and dirty derived evaluation before callbacks run', async () => {
    let firstCalls = 0;
    const first = observer.derived(() => { firstCalls += 1; return firstCalls; });
    const state = observer.local.cell('initial');
    let dirtyCalls = 0;
    const dirty = observer.derived(() => { dirtyCalls += 1; return state.get(); });
    expect(dirty.get()).toBe('initial');
    state.set('updated');

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const detached: Promise<void>[] = [];
    const errors: unknown[] = [];
    await observer.captureAsync(async () => {
      detached.push((async () => {
        await gate;
        try { first.get(); } catch (error: unknown) { errors.push(error); }
      })());
      detached.push((async () => {
        await gate;
        try { dirty.get(); } catch (error: unknown) { errors.push(error); }
      })());
    });

    release();
    await Promise.all(detached);
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error instanceof Error && /closed/i.test(error.message))).toBe(true);
    expect(firstCalls).toBe(0);
    expect(dirtyCalls).toBe(1);
  });

  test('async capture isolates concurrent frames and rejects detached reads after closure', async () => {
    const a = observer.tracked({ value: 'a' }, { path: ['a'] });
    const b = observer.tracked({ value: 'b' }, { path: ['b'] });
    let resume: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    let detached: Promise<string> | undefined;
    const first = observer.captureAsync(async () => { detached = (async () => { await gate; return a.value; })(); await Promise.resolve(); return a.value; });
    const second = observer.captureAsync(async () => { await Promise.resolve(); return b.value; });
    const [aResult, bResult] = await Promise.all([first, second]);
    resume?.();
    await expect(detached).rejects.toThrow(/closed|late/i);
    expect(aResult.observations.map(item => item.binding)).toEqual([{ path: ['a'] }]);
    expect(bResult.observations).toHaveLength(1);
  });

  test('async tracked calls preserve post-await reads and nested failure restores the parent capture', async () => {
    const input = observer.tracked({ value: 'after await' }, { path: ['async'] });
    const asyncCall = observer.tracked(async () => {
      await Promise.resolve();
      return input.value;
    }, { path: ['async-call'] });
    const failure = new Error('nested capture failed');
    const postFailure = observer.tracked({ parentOnly: 'parent after inner failure' }, { path: ['async-parent'] });
    const capture = await observer.captureAsync(async () => {
      const value = await asyncCall();
      const nestedFailure = observer.captureAsync(async () => {
        await Promise.resolve();
        void input.value;
        throw failure;
      });
      await expect(nestedFailure).rejects.toBe(failure);
      await Promise.resolve();
      void postFailure.parentOnly;
      return value;
    });
    expect(capture.value).toBe('after await');
    expect(capture.observations.map(item => item.kind)).toEqual(['implementation', 'fact', 'fact']);
    expect(capture.observations[2]?.address).toEqual([{ kind: 'property', key: 'parentOnly' }]);
  });

  test('primitive and class inputs fail at runtime', () => {
    expect(() => { Reflect.apply(observer.tracked, observer, [3, binding]); }).toThrow(/object|function/i);
    expect(() => { Reflect.apply(observer.tracked, observer, [null, binding]); }).toThrow(/object|function/i);
    class Unsupported { readonly value = 1; }
    expect(() => observer.tracked(new Unsupported(), binding)).toThrow(/plain|unsupported/i);
    expect(() => observer.tracked(Unsupported, binding)).toThrow(/class|unsupported/i);
    // Keep the comment spelling intact; the TypeScript compiler inserts spaces into inline class syntax.
    const createCommentedClass = new Function('return class/**/C {}') as () => new () => object;
    expect(Function.prototype.toString.call(createCommentedClass())).toContain('class/**/C');
    expect(() => observer.tracked(createCommentedClass(), binding)).toThrow(/class|unsupported/i);
  });
});
