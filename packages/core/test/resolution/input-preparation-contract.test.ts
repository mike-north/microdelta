/**
 * Complete invocation identity and author provenance are different contracts.
 * These assembly witnesses observe real History requests and committed evidence;
 * their identity vectors use explicit protocol tuples, public MDS1 encoding and
 * host SHA rather than Resolution's private intent helpers or candidate output.
 */
import { inspectProvenanceObservations } from '../provenance-wire-inspection.js';
import { afterEach, describe, expect, test } from '@jest/globals';
import type { IComposition, IDeclarations } from '@microdelta/definition';
import type { IAttemptRequest, IDurableHistory, IWriterLease } from '@microdelta/history';
import { createNodeMachine } from '@microdelta/machine-node';
import { createResolution } from '@microdelta/resolution';
import type { IResolutionFamily } from '@microdelta/resolution';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ITracked, ITrackingBinding, ITrackingObserver } from '@microdelta/tracking';
import { encodeSnapshot } from '@microdelta/value';
import { authoring } from 'microdelta';

import { cleanup, freshLocation, openHistory } from '../durable-history/support.js';

afterEach(cleanup);

/** Empty declarations still have a deliberate absence of input/helper slots. */
type IEmpty = Record<never, never>;

/**
 * Assemble real owners while recording only their boundary traffic. Each call
 * owns a distinct durable store, so equal vectors cannot come from a cache hit.
 */
function openProof<TInputs extends object, THelpers extends object>(
  builders: IDeclarations<IResolutionFamily<TInputs, THelpers>>,
  composition: IComposition<IResolutionFamily<TInputs, THelpers>>,
  bindings: { readonly inputs: readonly string[]; readonly helpers: readonly string[] },
) {
  const history = openHistory({ location: freshLocation() });
  const acquired = history.acquireWriter({ holder: 'input-preparation-proof', leaseMilliseconds: 60_000 });
  if (acquired.kind !== 'acquired') { throw new Error('Expected proof writer lease'); }
  const attempts: IAttemptRequest[] = [];
  const authority: IDurableHistory = {
    ...history,
    allocateAttempt(lease: IWriterLease, request: IAttemptRequest) {
      attempts.push({ ...request });
      return history.allocateAttempt(lease, request);
    },
  };
  const host = createNodeMachine();
  const hashes: string[] = [];
  const machine = { ...host, sha256(input: string): string { hashes.push(input); return host.sha256(input); } };
  const owner = createTrackingObserver(machine);
  const inputPreparations: object[] = [];
  const tracking: ITrackingObserver = {
    ...owner,
    tracked<T extends object>(value: T, binding: ITrackingBinding): ITracked<T> {
      if (binding.path.length === 1 && binding.path[0] === 'inputs') { inputPreparations.push(value); }
      return owner.tracked(value, binding);
    },
  };
  const admissions: string[] = [];
  const resolution = createResolution({
    declarations: builders, composition, bindings, environment: 'identity-proof', history: authority, tracking, host: machine,
    admission: { admit(request) { admissions.push(request.step.slot); return { kind: 'admitted' }; } },
  });
  return {
    history, attempts, hashes, inputPreparations, admissions, resolution, owner, lease: acquired.lease,
    close(): void { history.releaseWriter(acquired.lease); history.close(); },
  };
}

/** Narrow opaque retained evidence before asserting its observable facts. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { throw new Error('Expected evidence record'); }
  return Object.fromEntries(Object.entries(value));
}

/** Return only this body's declared-input facts; other facts retain their own bindings. */
function inputFacts(history: IDurableHistory, reference: { readonly kind: 'completed-result'; readonly locator: string }): readonly unknown[] {
  const content = record(history.readEnvelope(reference).provenance.content);
  return inspectProvenanceObservations(content).filter((observation) => JSON.stringify(observation.binding.path) === JSON.stringify(['inputs']))
    .map((observation) => ({ kind: observation.kind, operation: observation.operation, address: observation.address }));
}

describe('complete input preparation contracts', () => {
  test('ordinary History requests match independent full-intent vectors with sorted slots and order-preserving input data', async () => {
    /** Both slots participate in complete intent even though this body reads neither. */
    interface IInputs { readonly alpha: object; readonly zeta: object }
    /** Declared helper implementations belong in complete intent without needing to be called. */
    interface IHelpers { readonly beta: () => string; readonly omega: () => string }
    /** A constant body keeps complete intent broader than consumed data. */
    function run(): { readonly value: number } { return { value: 7 }; }
    const beta = () => 'beta';
    const omega = () => 'omega';
    const host = createNodeMachine();
    const baseline = { first: 'a', second: 'b' };
    const orderedDifferently = { second: 'b', first: 'a' };
    const withUndefined = { first: 'a', second: 'b', extra: undefined };
    // VAL-2 selects MDS1 transport, not MDV1 unordered equality. Only the
    // declared outer slot record is sorted; nested insertion/own shape survives.
    expect(encodeSnapshot(baseline)).not.toBe(encodeSnapshot(orderedDifferently));
    expect(encodeSnapshot(baseline)).not.toBe(encodeSnapshot(withUndefined));
    const observed: IAttemptRequest[] = [];
    for (const variation of [
      { reverse: false, zeta: baseline },
      { reverse: true, zeta: baseline },
      { reverse: false, zeta: orderedDifferently },
      { reverse: false, zeta: withUndefined },
    ]) {
      const builders = authoring<IInputs, IHelpers>();
      const work = builders.memo({ subject: 'ordinary', version: 2, run: run });
      const alpha = { marker: 'unread' };
      const registrations = [{ slot: 'zeta', value: variation.zeta }, { slot: 'alpha', value: alpha }];
      const helpers = [{ slot: 'omega', helper: omega }, { slot: 'beta', helper: beta }];
      const composition = builders.compose({
        scope: 'input-vector', inputs: variation.reverse ? [...registrations].reverse() : registrations,
        helpers: variation.reverse ? [...helpers].reverse() : helpers, steps: [{ slot: 'work', declaration: work }],
      });
      const proof = openProof(builders, composition, { inputs: variation.reverse ? ['alpha', 'zeta'] : ['zeta', 'alpha'], helpers: variation.reverse ? ['beta', 'omega'] : ['omega', 'beta'] });
      try {
        const outcome = await proof.resolution.resolve({ step: { scope: 'input-vector', role: 'step', slot: 'work' }, requestKey: 'ordinary-vector', lease: proof.lease });
        expect(outcome.kind).toBe('published');
        expect(proof.attempts).toHaveLength(1);
        // These are explicit wire vectors for this known invocation, authored
        // independently of Resolution. The full input hash uses public Value.
        const inputFact = host.sha256(encodeSnapshot({ alpha, zeta: variation.zeta }));
        const expected: IAttemptRequest = {
          analysis: 'input-vector', environment: 'identity-proof', subject: 'ordinary', version: 2,
          attemptKey: `mdr1:${host.sha256(JSON.stringify(['microdelta.resolution.attempt-key', 1, 'ordinary-vector', ['input-vector', 'step', 'work', null]]))}`,
          intentDigest: `mdi1:${host.sha256(JSON.stringify([
            'microdelta.resolution.intent', 1, 'input-vector', 'identity-proof', ['input-vector', 'step', 'work', null],
            'memo', 'ordinary', 2, { form: 'empty' }, Function.prototype.toString.call(run), null, [],
            [['alpha', 'bound'], ['zeta', 'bound']], inputFact,
            [['beta', 'bound', Function.prototype.toString.call(beta)], ['omega', 'bound', Function.prototype.toString.call(omega)]],
          ]))}`,
        };
        const actual = proof.attempts[0];
        if (actual === undefined) { throw new Error('Expected ordinary History request'); }
        expect(actual).toEqual(expected);
        observed.push(actual);
      } finally { proof.close(); }
    }
    expect(observed[1]).toEqual(observed[0]);
    expect(observed[2]?.attemptKey).toBe(observed[0]?.attemptKey);
    expect(observed[2]?.intentDigest).not.toBe(observed[0]?.intentDigest);
    expect(observed[3]?.intentDigest).not.toBe(observed[0]?.intentDigest);
  });

  test('supplied History requests match independent argument, code and full-input identity vectors', async () => {
    /** The argument is consumed; the marker is deliberately unread complete input. */
    interface IInputs { readonly argument: number; readonly marker: string }
    const host = createNodeMachine();
    for (const argument of [3, 4]) {
      const builders = authoring<IInputs, IEmpty>();
      const slot = builders.stepSlot<readonly [number], { readonly score: number }>({ slot: 'score' });
      const implementation = builders.suppliedStep<readonly [number], { readonly score: number }>({ version: 2, run: ({ args }) => ({ score: args[0] }) });
      const parent = builders.memo({ subject: 'parent', children: { score: slot }, run: async ({ inputs, calls }) => ({ score: (await calls.score(inputs.argument)).data.score }) });
      const composition = builders.compose({
        scope: 'supplied-vector', inputs: [{ slot: 'marker', value: 'unread' }, { slot: 'argument', value: argument }], helpers: [],
        steps: [{ slot: 'parent', declaration: parent }], supplied: [builders.supply({ slot, declaration: implementation, subject: () => 'supplied-score' })],
      });
      const proof = openProof(builders, composition, { inputs: ['marker', 'argument'], helpers: [] });
      try {
        const outcome = await proof.resolution.resolve({ step: { scope: 'supplied-vector', role: 'step', slot: 'parent' }, requestKey: 'supplied-vector', lease: proof.lease });
        expect(outcome.kind).toBe('published');
        const supplied = proof.attempts.filter((request) => request.subject === 'supplied-score');
        expect(supplied).toHaveLength(1);
        // Supported argument data uses its MDS1 fact plus an explicit empty
        // opaque-position list. The supplied call retains its own identity.
        const argumentsFact = JSON.stringify([host.sha256(encodeSnapshot([argument])), []]);
        const expected: IAttemptRequest = {
          analysis: 'supplied-vector', environment: 'identity-proof', subject: 'supplied-score', version: 2,
          attemptKey: `mdr1:${host.sha256(JSON.stringify([
            'microdelta.resolution.attempt-key', 1, 'supplied-vector', ['supplied-vector', 'callable', 'score', null], 'supplied-score', argumentsFact,
          ]))}`,
          intentDigest: `mdi1:${host.sha256(JSON.stringify([
            'microdelta.resolution.intent', 1, 'supplied-vector', 'identity-proof', ['supplied-vector', 'callable', 'score', null],
            'supplied', 'supplied-score', 2, argumentsFact, Function.prototype.toString.call(implementation.run),
            [['argument', 'bound'], ['marker', 'bound']], host.sha256(encodeSnapshot({ argument, marker: 'unread' })), [],
          ]))}`,
        };
        expect(supplied[0]).toEqual(expected);
      } finally { proof.close(); }
    }
  });

  test('one shared declared-input view keeps body facts separate and leaks no framework fact into an ambient author capture', async () => {
    /** Distinct leaves make accidental parent, sibling and whole-input evidence visible. */
    interface IInputs { readonly shared: { readonly parent: number; readonly first: number; readonly second: number } }
    const builders = authoring<IInputs, IEmpty>();
    const first = builders.memo({ subject: 'first', run: ({ inputs }) => ({ value: inputs.shared.first }) });
    const second = builders.memo({ subject: 'second', run: ({ inputs }) => ({ value: inputs.shared.second }) });
    const parent = builders.memo({ subject: 'parent', children: { first, second }, run: async ({ inputs, calls }) => {
      const own = inputs.shared.parent;
      const a = await calls.first();
      const b = await calls.second();
      return { total: own + a.data.value + b.data.value };
    } });
    const composition = builders.compose({ scope: 'shared-input-captures', inputs: [{ slot: 'shared', value: { parent: 1, first: 2, second: 3 } }], helpers: [], steps: [{ slot: 'parent', declaration: parent }, { slot: 'first', declaration: first }, { slot: 'second', declaration: second }] });
    const proof = openProof(builders, composition, { inputs: ['shared'], helpers: [] });
    try {
      // eslint-disable-next-line microdelta/tracked-captures -- This diagnostic framework capture deliberately runs Resolution beneath the author observer to detect leaked preparation facts; it is not an authored memo callback.
      const ambient = await proof.owner.captureAsync(() => proof.resolution.resolve({ step: { scope: 'shared-input-captures', role: 'step', slot: 'parent' }, requestKey: 'shared-input-captures', lease: proof.lease }));
      expect(ambient.observations).toEqual([]);
      expect(ambient.value.kind).toBe('published');
      if (ambient.value.kind !== 'published') { throw new Error('Expected parent publication'); }
      expect(proof.history.reader.readSubtree(ambient.value.reference, [])).toEqual({ total: 6 });
      expect(proof.inputPreparations).toHaveLength(1);
      for (const subject of ['parent', 'first', 'second']) {
        const candidates = proof.history.findCandidates({ analysis: 'shared-input-captures', environment: 'identity-proof', subject, version: 1 });
        expect(candidates).toHaveLength(1);
        const [envelope] = candidates;
        if (envelope === undefined) { throw new Error(`Missing committed ${subject} result`); }
        expect(inputFacts(proof.history, envelope.reference)).toEqual([
          { kind: 'fact', operation: 'container-kind', address: [{ kind: 'property', key: 'shared' }] },
          { kind: 'fact', operation: 'value', address: [{ kind: 'property', key: 'shared' }, { kind: 'property', key: subject }] },
        ]);
      }
    } finally { proof.close(); }
  });

  test.each(['missing-input', 'ambiguous-input', 'missing-helper', 'ambiguous-helper'] as const)('%s fails before input preparation, identity hashing or admission', async (fault) => {
    /** Slot occupancy is part of Resolution's declared binding contract. */
    interface IInputs { readonly config: { readonly value: number } }
    /** A missing helper must not be hidden behind a previously prepared input view. */
    interface IHelpers { readonly helper: () => string }
    const builders = authoring<IInputs, IHelpers>();
    const work = builders.memo({ subject: 'work', run: () => ({ value: 1 }) });
    const inputs = fault === 'missing-input' ? [] : [{ slot: 'config', value: { value: 1 } }];
    const helpers = fault === 'missing-helper' ? [] : [{ slot: 'helper', helper: () => 'helper' }];
    const composition = builders.compose({
      scope: 'slot-order', steps: [{ slot: 'work', declaration: work }],
      inputs: fault === 'ambiguous-input' ? [...inputs, ...inputs] : inputs,
      helpers: fault === 'ambiguous-helper' ? [...helpers, ...helpers] : helpers,
    });
    const proof = openProof(builders, composition, { inputs: ['config'], helpers: ['helper'] });
    try {
      await expect(proof.resolution.resolve({ step: { scope: 'slot-order', role: 'step', slot: 'work' }, requestKey: 'slot-order', lease: proof.lease })).rejects.toMatchObject({ code: 'unbound-step' });
      expect(proof.inputPreparations).toEqual([]);
      expect(proof.hashes).toEqual([]);
      expect(proof.admissions).toEqual([]);
      expect(proof.attempts).toEqual([]);
    } finally { proof.close(); }
  });
});
