import { serialize } from 'node:v8';

import { describe, expect, test } from '@jest/globals';
import { signal } from '@preact/signals-core';

import { cell, consume, createTag, derived, dirty, isValid, snapshot, withFrame, withFrameAsync } from '../src/index.js';

/** Coordinate interleaving with explicit events instead of timing assumptions. */
function deferred(): { promise: Promise<void>; release(): void } {
  let release: () => void = (): never => { throw new Error('Promise executor has not run'); };
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe('track', () => {
  test('TK-1: tags are distinct frozen opaque tokens with no signal state', () => {
    const first = createTag();
    const second = createTag();
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(typeof first.__tag).toBe('symbol');
    expect('value' in first).toBe(false);
    expect('revision' in first).toBe(false);
    expect('subscribers' in first).toBe(false);
    expect(() => JSON.stringify(first)).toThrow('process-local');
    expect(() => JSON.stringify({ tag: first })).toThrow('process-local');
    expect(() => structuredClone(first)).toThrow();
    expect(() => serialize(first)).toThrow();
  });

  test('TK-3: consuming a tag entangles on read and deduplicates repeated reads', () => {
    const first = createTag();
    const unused = createTag();
    const result = withFrame(() => { consume(first); consume(first); return 'result'; });
    expect(result.value).toBe('result');
    expect(result.consumed).toEqual(new Set([first]));
    expect(result.consumed.has(unused)).toBe(false);
    expect(() => consume(first)).not.toThrow();
  });

  test('TK-3: only a dirty consumed tag invalidates the previous snapshot', () => {
    const first = createTag();
    const second = createTag();
    const unrelated = createTag();
    dirty(first);
    const before = snapshot([first, second]);
    expect(before).toBe(Math.max(snapshot([first]), snapshot([second])));
    expect(isValid([first, second], before)).toBe(true);
    dirty(unrelated);
    expect(isValid([first, second], before)).toBe(true);
    dirty(second);
    expect(snapshot([first, second])).toBeGreaterThan(before);
    expect(isValid([first, second], before)).toBe(false);
    const after = snapshot([first, second]);
    dirty(second);
    expect(snapshot([second])).toBeGreaterThan(after);
  });

  test('TK-3: revision order is global when a previously quiet dependency changes', () => {
    const noisy = createTag();
    const quiet = createTag();
    for (let iteration = 0; iteration < 20; iteration++) { dirty(noisy); }
    const before = snapshot([noisy, quiet]);
    dirty(quiet);
    expect(isValid([noisy, quiet], before)).toBe(false);
    expect(snapshot([quiet])).toBeGreaterThan(snapshot([noisy]));
  });

  test('TK-3: snapshot, validation, and dirty do not record dependencies', () => {
    const tag = createTag();
    const result = withFrame(() => {
      const revision = snapshot([tag]);
      expect(isValid([tag], revision)).toBe(true);
      dirty(tag);
    });
    expect(result.consumed.size).toBe(0);
    expect(snapshot([])).toBe(0);
    expect(isValid([], 0)).toBe(true);
  });

  test('TK-3: snapshot and validation accept single-pass iterables', () => {
    const first = createTag();
    const second = createTag();
    dirty(second);
    function* tags(): Generator<typeof first> { yield first; yield second; }
    const revision = snapshot(tags());
    expect(revision).toBe(snapshot([second]));
    expect(isValid(tags(), revision)).toBe(true);
    dirty(first);
    expect(isValid(tags(), revision)).toBe(false);
  });

  test('TK-2: nested synchronous frames collect independently and restore the parent', () => {
    const parent = createTag();
    const child = createTag();
    const afterChild = createTag();
    const outer = withFrame(() => {
      consume(parent);
      const inner = withFrame(() => { consume(child); return 7; });
      expect(inner).toEqual({ value: 7, consumed: new Set([child]) });
      consume(afterChild);
      return 'parent';
    });
    expect(outer).toEqual({ value: 'parent', consumed: new Set([parent, afterChild]) });
    expect(withFrame(() => {}).consumed.size).toBe(0);
  });

  test('TK-2: a synchronous throw preserves the error and restores the parent', () => {
    const parent = createTag();
    const child = createTag();
    const failure = new Error('body failed');
    const outer = withFrame(() => {
      expect(() => withFrame(() => { consume(child); throw failure; })).toThrow(failure);
      consume(parent);
    });
    expect(outer.consumed).toEqual(new Set([parent]));
    expect(withFrame(() => {}).consumed.size).toBe(0);
  });

  test('TK-2: asynchronous frames include reads after await and support empty bodies', async () => {
    const first = createTag();
    const second = createTag();
    const result = await withFrameAsync(async () => {
      consume(first);
      await Promise.resolve();
      consume(second);
      return 'resolved';
    });
    expect(result).toEqual({ value: 'resolved', consumed: new Set([first, second]) });
    expect(await withFrameAsync(async () => 7)).toEqual({ value: 7, consumed: new Set() });
  });

  test('TK-2: interleaved asynchronous executions have disjoint post-await read sets', async () => {
    const first = createTag();
    const second = createTag();
    const firstCanFinish = deferred();
    const secondCanRead = deferred();
    const firstRun = withFrameAsync(async () => {
      consume(first);
      secondCanRead.release();
      await firstCanFinish.promise;
      consume(first);
      return 'first';
    });
    const secondRun = withFrameAsync(async () => {
      await secondCanRead.promise;
      consume(second);
      firstCanFinish.release();
      await Promise.resolve();
      consume(second);
      return 'second';
    });
    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
    expect(firstResult).toEqual({ value: 'first', consumed: new Set([first]) });
    expect(secondResult).toEqual({ value: 'second', consumed: new Set([second]) });
  });

  test('TK-2: nested asynchronous failure restores its parent across await', async () => {
    const parent = createTag();
    const child = createTag();
    const failure = new Error('async body failed');
    const result = await withFrameAsync(async () => {
      await expect(withFrameAsync(async () => {
        consume(child);
        await Promise.resolve();
        throw failure;
      })).rejects.toBe(failure);
      await Promise.resolve();
      consume(parent);
    });
    expect(result.consumed).toEqual(new Set([parent]));
    expect((await withFrameAsync(async () => {})).consumed.size).toBe(0);
  });

  test('TK-2: completed frame results cannot acquire reads from detached work', async () => {
    const tag = createTag();
    const continueDetached = deferred();
    let detached: Promise<void> = Promise.resolve();
    const result = await withFrameAsync(async () => {
      detached = (async (): Promise<void> => {
        await continueDetached.promise;
        consume(tag);
      })();
    });
    continueDetached.release();
    await detached;
    expect(result.consumed.size).toBe(0);
  });

  test('TK-3: cells expose values and derive only on reads after a consumed set', () => {
    const input = cell(2);
    const unrelated = cell(5);
    let calls = 0;
    const output = derived(() => { calls++; return input.get() * 3; });
    expect(calls).toBe(0);
    expect(output.get()).toBe(6);
    expect(output.get()).toBe(6);
    expect(calls).toBe(1);
    unrelated.set(6);
    expect(output.get()).toBe(6);
    expect(calls).toBe(1);
    input.set(4);
    expect(calls).toBe(1);
    expect(output.get()).toBe(12);
    expect(calls).toBe(2);
  });

  test('TK-3: explicit equal-value sets invalidate and multiple sets remain lazy', () => {
    const input = cell('same');
    let calls = 0;
    const output = derived(() => { calls++; return input.get(); });
    expect(output.get()).toBe('same');
    input.set('same');
    expect(output.get()).toBe('same');
    expect(calls).toBe(2);
    input.set('next');
    input.set('last');
    expect(calls).toBe(2);
    expect(output.get()).toBe('last');
    expect(calls).toBe(3);
  });

  test('TK-3: branches consume only the selected branch and replace old dependencies', () => {
    const selected = cell(true);
    const first = cell(1);
    const second = cell(10);
    let calls = 0;
    const output = derived(() => { calls++; return selected.get() ? first.get() : second.get(); });
    expect(output.get()).toBe(1);
    second.set(11);
    expect(output.get()).toBe(1);
    expect(calls).toBe(1);
    selected.set(false);
    expect(output.get()).toBe(11);
    expect(calls).toBe(2);
    first.set(2);
    expect(output.get()).toBe(11);
    expect(calls).toBe(2);
    second.set(12);
    expect(output.get()).toBe(12);
    expect(calls).toBe(3);
  });

  test('TK-3: cached and nested derivations replay concrete tags into each caller frame', () => {
    const input = cell(4);
    const extra = cell(1);
    const direct = withFrame(() => { input.get(); extra.get(); });
    const inner = derived(() => input.get() * 2);
    const outer = derived(() => inner.get() + extra.get());
    expect(outer.get()).toBe(9);
    const first = withFrame(() => outer.get());
    const cached = withFrame(() => outer.get());
    expect(first.consumed).toEqual(direct.consumed);
    expect(cached.consumed).toEqual(direct.consumed);
    expect(first.consumed).not.toBe(cached.consumed);
    const revision = snapshot(cached.consumed);
    input.set(5);
    expect(isValid(cached.consumed, revision)).toBe(false);
    expect(outer.get()).toBe(11);
  });

  test('TK-3: cached branch derivations replay only their current concrete tags', () => {
    const selected = cell(true);
    const first = cell(1);
    const second = cell(2);
    const output = derived(() => selected.get() ? first.get() : second.get());
    output.get();
    expect(withFrame(() => output.get()).consumed).toEqual(withFrame(() => { selected.get(); first.get(); }).consumed);
    selected.set(false);
    output.get();
    expect(withFrame(() => output.get()).consumed).toEqual(withFrame(() => { selected.get(); second.get(); }).consumed);
  });

  test('TK-3: validation-only and dependency-free derivations compute once', () => {
    const tag = createTag();
    let emptyCalls = 0;
    let validationCalls = 0;
    const empty = derived(() => { emptyCalls++; return undefined; });
    const validation = derived(() => { validationCalls++; return isValid([tag], snapshot([tag])); });
    expect(empty.get()).toBeUndefined();
    expect(validation.get()).toBe(true);
    dirty(tag);
    expect(empty.get()).toBeUndefined();
    expect(validation.get()).toBe(true);
    expect(emptyCalls).toBe(1);
    expect(validationCalls).toBe(1);
    expect(withFrame(() => empty.get()).consumed.size).toBe(0);
  });

  test('TK-2: an isolated nested frame cannot add hidden derivation dependencies', () => {
    const input = cell(0);
    let calls = 0;
    const output = derived(() => {
      calls++;
      withFrame(() => input.get());
      return 'unchanged';
    });
    const before = withFrame(() => output.get());
    expect(before.consumed.size).toBe(0);
    input.set(1);
    expect(withFrame(() => output.get()).consumed.size).toBe(0);
    expect(calls).toBe(1);
  });

  test('TK-2: the synchronous start of a nested async frame is also isolated', async () => {
    const input = cell(0);
    let calls = 0;
    let nested: Promise<unknown> = Promise.resolve();
    const output = derived(() => {
      calls++;
      nested = withFrameAsync(async () => {
        input.get();
        await Promise.resolve();
        input.get();
      });
      return 'unchanged';
    });
    expect(withFrame(() => output.get()).consumed.size).toBe(0);
    await nested;
    input.set(1);
    expect(withFrame(() => output.get()).consumed.size).toBe(0);
    await nested;
    expect(calls).toBe(1);
  });

  test('TK-3: adopted-library reads cannot add dependencies absent from the facade frame', () => {
    const external = signal(0);
    const explicit = createTag();
    let calls = 0;
    const output = derived(() => { calls++; consume(explicit); return external.value; });
    expect(withFrame(() => output.get()).consumed).toEqual(new Set([explicit]));
    external.value = 1;
    expect(output.get()).toBe(0);
    expect(calls).toBe(1);
    dirty(explicit);
    expect(output.get()).toBe(1);
    expect(calls).toBe(2);
  });

  test('TK-3: a failing derivation restores the parent and can recover after its input changes', () => {
    const input = cell(false);
    const parent = createTag();
    const failure = new Error('derived failure');
    const output = derived(() => {
      if (!input.get()) { throw failure; }
      return 'recovered';
    });
    const result = withFrame(() => {
      expect(() => output.get()).toThrow(failure);
      consume(parent);
    });
    expect(result.consumed).toEqual(withFrame(() => { input.get(); consume(parent); }).consumed);
    input.set(true);
    expect(output.get()).toBe('recovered');
  });

  test('TK-3: cold and cached caught failures replay dependencies and outer derivations recover', () => {
    const input = cell(0);
    const failure = new Error('zero input');
    let calls = 0;
    const failed = derived(() => {
      calls++;
      const value = input.get();
      if (value === 0) { throw failure; }
      return value;
    });
    const expected = withFrame(() => input.get()).consumed;
    const cold = withFrame(() => { expect(() => failed.get()).toThrow(failure); });
    const warm = withFrame(() => { expect(() => failed.get()).toThrow(failure); });
    expect(cold.consumed).toEqual(expected);
    expect(warm.consumed).toEqual(expected);
    expect(calls).toBe(1);
    const recovering = derived(() => {
      try { return failed.get(); } catch { return -1; }
    });
    expect(recovering.get()).toBe(-1);
    expect(withFrame(() => recovering.get()).consumed).toEqual(expected);
    input.set(3);
    expect(recovering.get()).toBe(3);
    expect(calls).toBe(2);
  });
});
