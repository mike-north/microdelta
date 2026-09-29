/**
 * Outcome tests for source and memoized step declarations: complete opaque
 * author subjects, positive-safe-integer compatibility versions, retained actual
 * author callbacks, frozen framework-owned copies and fixed child edges.
 *
 * @see ../../../docs/spec/execution.md (RES-001, REUSE-008)
 * @see ../../../docs/spec/composition.md (CMP-1, CMP-3, CMP-7)
 * @see ../../../docs/plans/m3-contribution-analysis.md
 */
import { describe, expect, jest, test } from '@jest/globals';

import { DefinitionError, declarations, isDeclaration } from '../src/index.js';
import { memo, source, type ITestFamily } from './fixtures/contributors.js';

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

describe('step declarations', () => {
  test('RES-001: the complete author subject is retained exactly, without trimming or prefixes', () => {
    const run = (): number => 1;
    const exact = ' summary:https://example.test/repo/pull/42 ';
    const declaration = memo({ subject: exact, label: 'Retrieve PR', run });
    expect(declaration.subject).toBe(exact);
    expect(declaration.label).toBe('Retrieve PR');
  });

  test('RES-001: subjects must be nonempty strings; no subject is derived from a name', () => {
    function namedRun(): number {
      return 1;
    }
    expectDefinitionError(() => memo({ subject: '', run: namedRun }), 'invalid-subject');
    const untyped: unknown = { run: namedRun };
    expectDefinitionError(() => Reflect.apply(memo, undefined, [untyped]), 'invalid-subject');
    const numeric: unknown = { subject: 42, run: namedRun };
    expectDefinitionError(() => Reflect.apply(source, undefined, [numeric]), 'invalid-subject');
  });

  test('REUSE-008: the compatibility version defaults to 1', () => {
    expect(source({ subject: 'activity:a', run: () => 1 }).version).toBe(1);
    expect(memo({ subject: 'summary:a', run: () => 1 }).version).toBe(1);
    expect(memo({ subject: 'summary:a', version: 2, run: () => 1 }).version).toBe(2);
    expect(memo({ subject: 'summary:a', version: Number.MAX_SAFE_INTEGER, run: () => 1 }).version)
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  test('REUSE-008: invalid versions reject rather than rounding into another compatibility group', () => {
    const invalid: readonly unknown[] = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '1', null];
    for (const version of invalid) {
      const options: unknown = { subject: 'summary:a', version, run: () => 1 };
      expectDefinitionError(() => Reflect.apply(memo, undefined, [options]), 'invalid-version');
      expectDefinitionError(() => Reflect.apply(source, undefined, [options]), 'invalid-version');
    }
  });

  test('TRK-2: the declaration retains the actual author callbacks, never a generic wrapper', () => {
    const run = (): string => 'fetched';
    const finality = (): boolean => true;
    const summaryRun = (): string => 'summary';
    const activity = source({ subject: 'activity:a', run, finality });
    const summary = memo({ subject: 'summary:a', children: { activity }, run: summaryRun });
    expect(activity.run).toBe(run);
    expect(activity.finality).toBe(finality);
    expect(summary.run).toBe(summaryRun);
    expect(source({ subject: 'activity:b', run }).finality).toBeUndefined();
  });

  test('CMP-9: declaring a step never invokes an author callback', () => {
    const run = jest.fn((): number => 1);
    const finality = jest.fn((): boolean => true);
    const activity = source({ subject: 'activity:a', run, finality });
    memo({ subject: 'summary:a', children: { activity }, run });
    expect(run).not.toHaveBeenCalled();
    expect(finality).not.toHaveBeenCalled();
  });

  test('CMP-9: callbacks must be functions; accessors are rejected without being invoked', () => {
    const notCallable: unknown = { subject: 'activity:a', run: 'fetch' };
    expectDefinitionError(() => Reflect.apply(source, undefined, [notCallable]), 'invalid-callback');
    const badFinality: unknown = { subject: 'activity:a', run: () => 1, finality: true };
    expectDefinitionError(() => Reflect.apply(source, undefined, [badFinality]), 'invalid-callback');
    const getter = jest.fn((): (() => number) => () => 1);
    const accessor: unknown = Object.defineProperty({ subject: 'summary:a' }, 'run', { get: getter, enumerable: true });
    expectDefinitionError(() => Reflect.apply(memo, undefined, [accessor]), 'invalid-callback');
    expect(getter).not.toHaveBeenCalled();
  });

  test('CMP-9: inherited option accessors are rejected without being invoked', () => {
    // Regression (independent review of 9500a4b): only own options were inspected,
    // then destructuring read inherited finality/children getters during declaration.
    const run = (): number => 1;
    const activity = source({ subject: 'activity:a', run });
    const finalityGetter = jest.fn((): (() => boolean) => () => true);
    const childrenGetter = jest.fn((): Record<string, typeof activity> => ({ activity }));
    const inheritedFinality: unknown = Object.assign(
      Object.create(Object.defineProperty({}, 'finality', { get: finalityGetter, enumerable: true })),
      { subject: 'activity:b', run },
    );
    const inheritedChildren: unknown = Object.assign(
      Object.create(Object.defineProperty({}, 'children', { get: childrenGetter, enumerable: true })),
      { subject: 'summary:a', run },
    );
    expectDefinitionError(() => Reflect.apply(source, undefined, [inheritedFinality]), 'invalid-callback');
    expectDefinitionError(() => Reflect.apply(memo, undefined, [inheritedChildren]), 'illegal-edge');
    expect(finalityGetter).not.toHaveBeenCalled();
    expect(childrenGetter).not.toHaveBeenCalled();
  });

  test('CMP-9: inherited option data is rejected rather than silently becoming a callback or edge', () => {
    const run = (): number => 1;
    const activity = source({ subject: 'activity:a', run });
    const inheritedFinality: unknown = Object.assign(Object.create({ finality: () => true }), { subject: 'activity:b', run });
    const inheritedChildren: unknown = Object.assign(Object.create({ children: { activity } }), { subject: 'summary:a', run });
    const inheritedRun: unknown = Object.assign(Object.create({ run }), { subject: 'summary:b' });
    expectDefinitionError(() => Reflect.apply(source, undefined, [inheritedFinality]), 'invalid-callback');
    expectDefinitionError(() => Reflect.apply(memo, undefined, [inheritedChildren]), 'illegal-edge');
    expectDefinitionError(() => Reflect.apply(memo, undefined, [inheritedRun]), 'invalid-callback');
  });

  test('CMP-7: child records whose slots would be lost by collection are rejected', () => {
    // Regression (Copilot on 3dc42ff; independent review finding 4): a non-enumerable
    // own slot passed validation but vanished from children and topology.
    const run = (): number => 1;
    const activity = source({ subject: 'activity:a', run });
    class ChildRecord {
      public readonly activity = activity;
    }
    const hidden = Object.defineProperty({}, 'activity', { value: activity, enumerable: false });
    const unsupported: readonly unknown[] = [hidden, new ChildRecord(), [activity], { [Symbol('activity')]: activity }];
    for (const children of unsupported) {
      const options: unknown = { subject: 'summary:a', children, run };
      expectDefinitionError(() => Reflect.apply(memo, undefined, [options]), 'illegal-edge');
    }
  });

  test('CMP-7: a null-prototype child record keeps every declared slot', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const children: Record<string, typeof activity> = Object.assign(Object.create(null) as Record<string, typeof activity>, { activity });
    expect(memo({ subject: 'summary:a', children, run: () => 1 }).children).toEqual(['activity']);
  });

  test('CMP-1: declarations are frozen framework-owned copies of the author options', () => {
    const activity = source({ subject: 'activity:a', run: () => 1 });
    const other = source({ subject: 'activity:b', run: () => 2 });
    const children: Record<string, typeof activity> = { activity };
    const options = { subject: 'summary:a', children, run: (): number => 1 };
    const declaration = memo(options);
    children['other'] = other;
    options.subject = 'summary:changed';
    expect(declaration.subject).toBe('summary:a');
    expect(declaration.children).toEqual(['activity']);
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration.children)).toBe(true);
  });

  test('CMP-7: child edges name nonempty call names holding source or memo declarations; sources declare none', () => {
    expect(memo({ subject: 'summary:a', run: () => 1 }).children).toEqual([]);
    const activity = source({ subject: 'activity:a', run: () => 1 });
    expectDefinitionError(() => memo({ subject: 'summary:a', children: { '': activity }, run: () => 1 }), 'illegal-edge');
    const profile = memo({ subject: 'profile:a', children: { activity }, run: () => 1 });
    expect(memo({ subject: 'summary:a', children: { activity, profile }, run: () => 1 }).children).toEqual(['activity', 'profile']);
    const sourceWithChildren: unknown = { subject: 'activity:a', children: { other: activity }, run: () => 1 };
    expectDefinitionError(() => Reflect.apply(source, undefined, [sourceWithChildren]), 'illegal-edge');
  });

  test('ownership: only Definition-minted declarations are recognized; look-alikes are forged', () => {
    const genuine = memo({ subject: 'summary:a', run: () => 1 });
    const lookalike: unknown = { ...genuine };
    expect(isDeclaration(genuine)).toBe(true);
    expect(isDeclaration(lookalike)).toBe(false);
    expect(isDeclaration({ kind: 'memo', subject: 'summary:a', version: 1, children: [], run: () => 1 })).toBe(false);
  });

  test('ownership: builders from another family instance mint declarations this instance does not own', () => {
    const other = declarations<ITestFamily>();
    const foreign = other.source({ subject: 'activity:a', run: () => 1 });
    expect(isDeclaration(foreign)).toBe(true);
    expectDefinitionError(() => memo({ subject: 'summary:a', children: { activity: foreign }, run: () => 1 }), 'forged-declaration');
  });
});
