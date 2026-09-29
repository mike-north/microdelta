/**
 * The observed untracked-read operation. An author may deliberately read a
 * tracked member without consuming its fact; Tracking then records an
 * `untracked-read` observation (naming what was read, never its value) so the
 * capture's reliance on untracked content is itself evidence. Resolution asks
 * whether the active capture has made such a read to decide whether a derived
 * nested-call argument is justified (CMP-7, EXP-4: the unjustified-argument
 * miss is reachable only through an observed untracked read; unobserved
 * influence remains CX-1).
 *
 * @see ../../../docs/spec/composition.md (CMP-7, EXP-4 argument recipe)
 * @see ../../../docs/spec/tracking.md (TRK-3 scoped collection, TRK-5 observation table)
 * @see ../../../docs/plans/m4-composition.md ("Nested invocation evidence")
 * @see ../../../experiments/exp-4/decision.md (Findings: the unjustified-argument diagnostic)
 */
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { describe, expect, test } from '@jest/globals';
import type { IMachine } from '@microdelta/machine';
import { decodeSnapshot, encodeSnapshot, navigate, observe } from '@microdelta/value';
import type { ISelectedFact, ISelectedNode } from '@microdelta/value';

import { createTrackingObserver } from '../src/index.js';
import type { ICurrentFactProvider, ITrackedNodeSource, ITrackingObservation } from '../src/index.js';

/** Host hashing and async context only. */
const machine: IMachine = {
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  snapshot<T>(value: T): T { return structuredClone(value); },
  sha256(input: string): string { return createHash('sha256').update(input, 'utf8').digest('hex'); },
};

/** A provider that has no current fact for anything: comparing a real fact against it is never equal. */
const nothingCurrent: ICurrentFactProvider = { resolve: () => ({ kind: 'unavailable' }) };

/** An in-memory lazy source over Value's own navigation, with a request log. */
function lazySource(root: unknown): { readonly source: ITrackedNodeSource; readonly requests: string[] } {
  const requests: string[] = [];
  return {
    requests,
    source: {
      node(address): ISelectedNode {
        requests.push(`node:${JSON.stringify(address)}`);
        return navigate(root, address);
      },
      select(address, operation): ISelectedFact {
        requests.push(`select:${operation}:${JSON.stringify(address)}`);
        return observe(root, address, operation);
      },
      subtree(address): unknown {
        requests.push(`subtree:${JSON.stringify(address)}`);
        return decodeSnapshot(encodeSnapshot(address.length === 0 ? root : observe(root, address, 'value').fact));
      },
    },
  };
}

/** The observation kinds a capture recorded, in order. */
function kinds(observations: readonly ITrackingObservation[]): string[] {
  return observations.map((item) => item.kind);
}

describe('observed untracked reads', () => {
  const observer = createTrackingObserver(machine);
  const binding = { path: ['inputs'] };
  const config = { rubric: { prompt: 'v1', weights: [2, 1] }, label: 'acme' };

  test('an untracked read returns the scalar and records only an untracked-read observation naming binding and address', () => {
    const inputs = observer.tracked(config, binding);
    const captured = observer.capture(() => observer.untracked(inputs.rubric, 'prompt'));
    expect(captured.value).toBe('v1');
    expect(kinds(captured.observations)).toEqual(['untracked-read']);
    const [read] = captured.observations;
    expect(read?.binding.path).toEqual(['inputs']);
    expect(read?.address).toEqual([{ kind: 'property', key: 'rubric' }, { kind: 'property', key: 'prompt' }]);
    expect(read?.selection).toEqual({ kind: 'untracked-read', address: read?.address, encodingVersion: 'MDU1' });
    expect(read?.operation).toBe('untracked-read');
    expect(read?.encodingVersion).toBe('MDU1');
    expect(read?.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    // The value read is never retained as evidence: the record names the read, not what it returned.
    expect(JSON.stringify(read)).not.toContain('v1');
  });

  test('array positions and an array length can be read untracked', () => {
    const inputs = observer.tracked(config, binding);
    const captured = observer.capture(() => [observer.untracked(inputs.rubric.weights, 0), observer.untracked(inputs.rubric.weights, 'length')]);
    expect(captured.value).toEqual([2, 2]);
    expect(kinds(captured.observations)).toEqual(['untracked-read', 'untracked-read']);
    expect(captured.observations.map((item) => item.address)).toEqual([
      [{ kind: 'property', key: 'rubric' }, { kind: 'property', key: 'weights' }, { kind: 'index', index: 0 }],
      [{ kind: 'property', key: 'rubric' }, { kind: 'property', key: 'weights' }, { kind: 'property', key: 'length' }],
    ]);
  });

  test('the same untracked read twice is recorded once; a tracked read of the same member stays a separate fact', () => {
    const inputs = observer.tracked(config, binding);
    const captured = observer.capture(() => {
      observer.untracked(inputs.rubric, 'prompt');
      observer.untracked(inputs.rubric, 'prompt');
      return inputs.rubric.prompt;
    });
    expect(kinds(captured.observations)).toEqual(['untracked-read', 'fact']);
  });

  test('untrackedReadObserved reports reads made so far in the active capture only', async () => {
    const inputs = observer.tracked(config, binding);
    expect(observer.untrackedReadObserved()).toBe(false);
    const captured = observer.capture(() => {
      const initially = observer.untrackedReadObserved();
      const tracked = inputs.label;
      const afterTrackedRead = observer.untrackedReadObserved();
      observer.untracked(inputs.rubric, 'prompt');
      return { tracked, states: [initially, afterTrackedRead, observer.untrackedReadObserved()] };
    });
    expect(captured.value).toEqual({ tracked: 'acme', states: [false, false, true] });
    // A sibling capture made afterwards starts clean.
    expect(observer.capture(() => observer.untrackedReadObserved()).value).toBe(false);
    // An asynchronous capture keeps its own state across awaits and is isolated from a concurrent one.
    const [tainted, clean] = await Promise.all([
      observer.captureAsync(async () => {
        observer.untracked(inputs.rubric, 'prompt');
        await Promise.resolve();
        return observer.untrackedReadObserved();
      }),
      observer.captureAsync(async () => {
        await Promise.resolve();
        return observer.untrackedReadObserved();
      }),
    ]);
    expect(tainted.value).toBe(true);
    expect(clean.value).toBe(false);
  });

  test('a nested capture does not taint its caller, and its own reads stay its own', () => {
    const inputs = observer.tracked(config, binding);
    const outer = observer.capture(() => {
      const inner = observer.capture(() => observer.untracked(inputs.rubric, 'prompt'));
      return { inner: inner.observations.length, outerTainted: observer.untrackedReadObserved() };
    });
    expect(outer.value).toEqual({ inner: 1, outerTainted: false });
    expect(outer.observations).toEqual([]);
  });

  test('a replayed derivation carries its untracked read into the consuming capture', () => {
    const inputs = observer.tracked(config, binding);
    const derived = observer.derived(() => observer.untracked(inputs.rubric, 'prompt'));
    derived.get();
    const captured = observer.capture(() => {
      const value = derived.get();
      return { value, tainted: observer.untrackedReadObserved() };
    });
    expect(captured.value).toEqual({ value: 'v1', tainted: true });
    expect(kinds(captured.observations)).toEqual(['untracked-read']);
  });

  test('outside any capture an untracked read returns the value and records nothing', () => {
    const inputs = observer.tracked(config, binding);
    expect(observer.untracked(inputs.rubric, 'prompt')).toBe('v1');
    expect(observer.untrackedReadObserved()).toBe(false);
  });

  test('comparison skips untracked-read observations: they carry no fact to compare and never ask the provider', () => {
    const inputs = observer.tracked(config, binding);
    const captured = observer.capture(() => observer.untracked(inputs.rubric, 'prompt'));
    let asked = 0;
    const counting: ICurrentFactProvider = { resolve: (...request) => { asked += 1; return nothingCurrent.resolve(...request); } };
    expect(observer.compareCurrent(captured, counting)).toEqual({ kind: 'equal' });
    expect(asked).toBe(0);
  });

  test('lazy views support untracked scalar reads that request exactly one node', () => {
    const { source, requests } = lazySource({ profile: { name: 'Ada', id: 'gh:1' }, notes: 'unread' });
    const captured = observer.capture(() => {
      const view = observer.materialization.lazyView<{ readonly profile: { readonly name: string; readonly id: string }; readonly notes: string }>({ path: ['child'] }, source);
      return observer.untracked(view.profile, 'name');
    });
    expect(captured.value).toBe('Ada');
    expect(kinds(captured.observations)).toEqual(['untracked-read']);
    expect(captured.observations[0]?.binding.path).toEqual(['child']);
    expect(requests.some((request) => request.includes('notes'))).toBe(false);
    expect(requests.some((request) => request.startsWith('subtree'))).toBe(false);
  });

  test('a nested container member is rejected rather than detached untracked, and records nothing', () => {
    const inputs = observer.tracked(config, binding);
    const captured = observer.capture(() => {
      let rejection = '';
      try {
        // @ts-expect-error: a nested tracked container is not an untracked-readable key; this negative case proves the runtime rejects it too.
        observer.untracked(inputs, 'rubric');
      } catch (error: unknown) {
        rejection = error instanceof Error ? error.message : 'non-error';
      }
      return { rejection, tainted: observer.untrackedReadObserved() };
    });
    expect(captured.value.rejection).toMatch(/scalar/u);
    expect(captured.value.tainted).toBe(false);
    expect(captured.observations).toEqual([]);
  });

  test('values the observer does not own are rejected', () => {
    const foreign = createTrackingObserver(machine).tracked(config, binding);
    const plain = { prompt: 'v1' };
    // @ts-expect-error: a plain record is not a tracked view; this negative case proves the runtime rejects it too.
    expect(() => observer.untracked(plain, 'prompt')).toThrow(/observer-owned/u);
    expect(() => observer.untracked(foreign.rubric, 'prompt')).toThrow(/observer-owned/u);
  });

  test('a capture that has closed rejects later untracked reads and justification questions from its context', async () => {
    const inputs = observer.tracked(config, binding);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let detached: Promise<readonly unknown[]> = Promise.resolve([]);
    await observer.captureAsync(async () => {
      detached = (async () => {
        // eslint-disable-next-line microdelta/tracked-captures -- This deferred test barrier runs the late calls only after the owning capture closes.
        await gate;
        const attempts = [
          Promise.resolve().then(() => observer.untracked(inputs.rubric, 'prompt')),
          Promise.resolve().then(() => observer.untrackedReadObserved()),
        ];
        // eslint-disable-next-line microdelta/tracked-captures -- Native promise aggregation is only test scheduling for the late rejections.
        return Promise.all(attempts.map((attempt) => attempt.catch((error: unknown) => error)));
      })();
    });
    release();
    const errors = await detached;
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error instanceof Error && /closed/iu.test(error.message))).toBe(true);
  });
});
