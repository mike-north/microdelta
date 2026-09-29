/**
 * Outcome tests for tracked gate declarations. Definition exposes a template's
 * gate with its declared bindings (inputs and helpers through the facade's
 * memo bindings, plus the member binding) to Resolution's invoker and
 * classifies the settled result; it never evaluates a gate itself. Only an
 * explicit `false` skips an instance; a non-boolean result and a throw fail it,
 * distinctly.
 *
 * @see ../../../docs/spec/composition.md (CMP-8, EXP-4 strict-fold selection)
 * @see ../../../docs/plans/m4-composition.md (Templates, keys and gates)
 * @see ../../../docs/spec/glossary.md (Gate, Required population)
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  declarations,
  gateOutcome,
  type IAnySourceDeclaration,
  type IApply,
  type IBindingDescriptor,
  type IAuthorInvoker,
  type IGateOutcome,
  type IMemberOf,
  type IMemberSupplier,
} from '../src/index.js';
import { callUntyped, expectDefinitionError } from './fixtures/assertions.js';
import type { ITestFamily } from './fixtures/contributors.js';
import { ada, buildKeyed, compositionStep, gateOf, instanceDescriptor, source, template, templateStepDescriptor, type IContributors } from './fixtures/keyed.js';

/** Ada's summary instance, the descriptor gates are opened for. */
const adaSummary = instanceDescriptor('summary', 'person:ada');

/** A member supplier that records which collection and instance it was asked for and returns one member view. */
function supplying(member: unknown, asked: unknown[]): IMemberSupplier<ITestFamily> {
  return {
    view: <TCollection extends IAnySourceDeclaration<ITestFamily>>(collection: TCollection, instance: IBindingDescriptor): IApply<ITestFamily['views'], IMemberOf<ITestFamily, TCollection>> => {
      asked.push(collection, instance);
      // Test-only: the supplier stands in for Resolution's trusted member view and returns the configured record.
      return member as IApply<ITestFamily['views'], IMemberOf<ITestFamily, TCollection>>;
    },
  };
}

/** An invoker that records the callback and context it was handed, then calls it. */
function recording(seen: { callback?: unknown; context?: unknown }): IAuthorInvoker<unknown> {
  return <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): unknown => {
    seen.callback = callback;
    seen.context = context;
    return callback(context);
  };
}

describe('gate exposure (CMP-8)', () => {
  test('CMP-8: the actual author gate reaches the invoker with bindings plus the member binding', () => {
    const built = buildKeyed({ gate: true });
    const gate = gateOf(built.composition, adaSummary);
    expect(gate?.parent).toEqual(adaSummary);
    expect(gate?.memberKey).toBe('person:ada');
    expect(Object.isFrozen(gate)).toBe(true);
    const asked: unknown[] = [];
    const seen: { callback?: unknown; context?: unknown } = {};
    const result = gate?.apply({ minimumAuthored: 2 }, supplying(ada, asked), recording(seen));
    expect(result).toBe(true);
    expect(seen.callback).toBe(built.contributor.gate);
    expect(seen.context).toEqual({ minimumAuthored: 2, member: ada });
    expect(Object.isFrozen(seen.context)).toBe(true);
    expect(asked).toEqual([built.contributors, adaSummary]);
    expect(built.calls.gate).toBe(1);
  });

  test('CMP-8: a template without a gate exposes none', () => {
    expect(gateOf(buildKeyed().composition, adaSummary)).toBeUndefined();
  });

  test('CMP-8: Definition never evaluates a gate by itself', () => {
    const built = buildKeyed({ gate: true });
    built.composition.keyMembers('contributor', { members: [ada], status: 'complete' });
    const gate = gateOf(built.composition, adaSummary);
    expect(gate).toBeDefined();
    expect(built.calls.gate).toBe(0);
  });

  test('CMP-8: bindings that claim `member` or are not plain records reject before the invoker', () => {
    const built = buildKeyed({ gate: true });
    const gate = gateOf(built.composition, adaSummary);
    const invoke = jest.fn(recording({}));
    for (const bindings of [{ member: 'forged' }, [], new Map(), Object.defineProperty({}, 'x', { get: () => 1, enumerable: true })]) {
      expectDefinitionError(() => gate?.apply(bindings, supplying(ada, []), invoke), 'invalid-bindings');
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(built.calls.gate).toBe(0);
  });

  test('CMP-9: a gate cannot be applied while a composition is being built', () => {
    const built = buildKeyed({ gate: true });
    const gate = gateOf(built.composition, adaSummary);
    const invoke = jest.fn(recording({}));
    const collection = source<IContributors>({ subject: 'probe', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    expectDefinitionError(() => template({
      slot: 'probe',
      collection,
      steps: (member) => {
        gate?.apply({}, supplying(ada, []), invoke);
        return { p: member.source<string>({ subject: member.subject('probe'), run: () => 'p' }) };
      },
    }), 'composition-phase');
    expect(invoke).not.toHaveBeenCalled();
  });

  test('CMP-8: a gate is opened per instance, like an invocation, and each instance keeps its own member key', () => {
    const built = buildKeyed({ gate: true });
    const ben = gateOf(built.composition, instanceDescriptor('activity', 'person:ben'));
    expect(ben?.memberKey).toBe('person:ben');
    const asked: unknown[] = [];
    ben?.apply({ minimumAuthored: 3 }, supplying({ ...ada, key: 'person:ben', authored: 2 }, asked), recording({}));
    expect(asked[1]).toEqual(instanceDescriptor('activity', 'person:ben'));
  });

  test('CMP-9: gates are reachable only for instances of composed templates of compositions this family minted', () => {
    const built = buildKeyed({ gate: true });
    const cases: readonly IBindingDescriptor[] = [
      instanceDescriptor('summary', 'person:ada', { template: 'profile' }),
      instanceDescriptor('summary', 'person:ada', { collection: 'roster' }),
      instanceDescriptor('assessment', 'person:ada'),
      templateStepDescriptor('summary'),
      compositionStep('contributors'),
      { scope: 'contribution-report:acme/widget:m4', role: 'step', slot: 'summary', memberKey: 'person:ada' },
    ];
    for (const descriptor of cases) {
      expectDefinitionError(() => gateOf(built.composition, descriptor), 'unresolved-parent');
    }
    expectDefinitionError(() => declarations<ITestFamily>().gateOf(built.composition, adaSummary), 'forged-composition');
    expectDefinitionError(() => callUntyped(gateOf, { ...built.composition }, adaSummary), 'forged-composition');
    expectDefinitionError(() => callUntyped(gateOf, built.composition, 'contributor'), 'invalid-descriptor');
  });
});

describe('gate outcome classification (CMP-8)', () => {
  test('CMP-8: explicit true requires and explicit false skips', () => {
    expect(gateOutcome({ kind: 'returned', value: true })).toEqual({ status: 'required' });
    expect(gateOutcome({ kind: 'returned', value: false })).toEqual({ status: 'skipped' });
  });

  test('CMP-8: any non-boolean result fails the instance and is never a skip', () => {
    const cases: readonly [unknown, string][] = [
      [undefined, 'undefined'],
      [null, 'null'],
      [0, 'number'],
      [1, 'number'],
      ['false', 'string'],
      [{}, 'object'],
      [Promise.resolve(false), 'object'],
      [Object(false), 'object'],
    ];
    for (const [value, received] of cases) {
      const expected: IGateOutcome = { status: 'failed', reason: 'non-boolean', received };
      expect(gateOutcome({ kind: 'returned', value })).toEqual(expected);
    }
  });

  test('CMP-8: a throw fails the instance distinctly and preserves the thrown value', () => {
    const failure = new Error('absent evidence');
    const outcome = gateOutcome({ kind: 'threw', error: failure });
    expect(outcome).toEqual({ status: 'failed', reason: 'threw', error: failure });
    expect(outcome.status === 'failed' && outcome.reason === 'threw' ? outcome.error : undefined).toBe(failure);
    expect(gateOutcome({ kind: 'threw', error: false })).toEqual({ status: 'failed', reason: 'threw', error: false });
  });

  test('CMP-8: outcomes are frozen, and a malformed settlement is rejected', () => {
    expect(Object.isFrozen(gateOutcome({ kind: 'returned', value: false }))).toBe(true);
    for (const settlement of [undefined, {}, { kind: 'resolved', value: true }, { value: false }]) {
      expectDefinitionError(() => callUntyped(gateOutcome, settlement), 'invalid-result');
    }
  });
});
