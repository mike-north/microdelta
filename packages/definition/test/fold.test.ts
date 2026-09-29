/**
 * Outcome tests for strict fold declarations: a composition-level memo step
 * naming `{ template, step }`, whose context exposes one explicit keyed entry
 * per current member in canonical order: `succeeded` with its view, or
 * `skipped` with no data. Reading data from a skipped entry throws. Definition
 * validates and assembles entries from outcomes Resolution supplies; it never
 * decides fold readiness.
 *
 * @see ../../../docs/spec/composition.md (CMP-8, EXP-4 strict-fold selection)
 * @see ../../../docs/spec/glossary.md (Strict fold, Required population)
 * @see ../../../docs/plans/m4-composition.md (Strict fold; Authoring shape)
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  declarations,
  isDeclaration,
  type IApply,
  type IAuthorInvoker,
  type IFoldDeclaration,
  type IFoldEntry,
  type IFoldInvocation,
  type IFoldMemberSupplier,
} from '../src/index.js';
import { callUntyped, expectDefinitionError } from './fixtures/assertions.js';
import type { ITestFamily } from './fixtures/contributors.js';
import { fakePort } from './fixtures/port.js';
import {
  buildKeyed,
  compositionStep,
  fold,
  openInvocation,
  source,
  template,
  templateStepDescriptor,
  type IContributors,
  type IKeyedBuild,
} from './fixtures/keyed.js';

/** A port that must never dispatch in these tests. */
const idlePort = fakePort().port;

/** A member supplier that records which fold it served and returns the configured outcomes. */
function outcomes(entries: unknown, served: unknown[] = []): IFoldMemberSupplier<ITestFamily> {
  return {
    outcomes: <TMemberResult>(declaration: IFoldDeclaration<ITestFamily, TMemberResult, unknown>): readonly IFoldEntry<IApply<ITestFamily['views'], TMemberResult>>[] => {
      served.push(declaration);
      // Test-only: the supplier stands in for Resolution's trusted member outcomes and returns what the test configured.
      return entries as readonly IFoldEntry<IApply<ITestFamily['views'], TMemberResult>>[];
    },
  };
}

/** An invoker that records the callback and context it was handed without running the callback. */
function recording(seen: { callback?: unknown; context?: unknown }): IAuthorInvoker<string> {
  return <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): string => {
    seen.callback = callback;
    seen.context = context;
    return 'invoked';
  };
}

/** Open the fixture's fold invocation, failing the test if it is not a fold. */
function openFold(built: IKeyedBuild): IFoldInvocation<ITestFamily> {
  const invocation = openInvocation(built.composition, compositionStep('report'), idlePort);
  if (invocation.kind !== 'fold') {
    throw new Error(`expected a fold invocation, got ${invocation.kind}`);
  }
  return invocation;
}

/** Whether a value has the shape of a fold entry (its `data` is never read here). */
function isFoldEntry(value: unknown): value is IFoldEntry<unknown> {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'key') === 'string'
    && ['succeeded', 'skipped'].includes(String(Reflect.get(value, 'status')));
}

/** The members the author callback received, failing the test unless each is a fold entry. */
function membersOf(context: unknown): readonly IFoldEntry<unknown>[] {
  const members: unknown = typeof context === 'object' && context !== null ? Reflect.get(context, 'members') : undefined;
  const list: readonly unknown[] = Array.isArray(members) ? members : [];
  const entries = list.filter(isFoldEntry);
  if (!Array.isArray(members) || entries.length !== list.length) {
    throw new Error('context carries no fold entries');
  }
  return Object.isFrozen(members) ? Object.freeze(entries) : entries;
}

describe('strict fold declaration (CMP-8)', () => {
  test('CMP-8: a fold is a frozen composition-level step naming its template and step', () => {
    const built = buildKeyed();
    expect(built.report).toMatchObject({ kind: 'fold', subject: 'report:acme/widget:2026-Q1', version: 1, label: undefined });
    expect(built.report.over.template).toBe(built.contributor);
    expect(built.report.over.step).toBe('summary');
    expect(Object.isFrozen(built.report)).toBe(true);
    expect(Object.isFrozen(built.report.over)).toBe(true);
    expect(isDeclaration(built.report)).toBe(true);
    const resolution = built.composition.resolve(compositionStep('report'));
    expect(resolution).toMatchObject({ status: 'bound', descriptor: compositionStep('report'), target: { role: 'step', declaration: built.report } });
  });

  test('CMP-8: the fold must name a declared step of a template this family minted', () => {
    const built = buildKeyed();
    const run = (): string => 'r';
    expectDefinitionError(() => callUntyped(fold, { subject: 'r', over: { template: built.contributor, step: 'assessment' }, run }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(fold, { subject: 'r', over: { template: built.contributor, step: '__proto__' }, run }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(fold, { subject: 'r', over: { template: { ...built.contributor }, step: 'summary' }, run }), 'forged-declaration');
    expectDefinitionError(() => callUntyped(fold, { subject: 'r', over: { template: built.contributors, step: 'summary' }, run }), 'forged-declaration');
    expectDefinitionError(() => callUntyped(fold, { subject: 'r', run }), 'illegal-edge');
    const foreign = declarations<ITestFamily>();
    const collection = foreign.source<IContributors>({ subject: 'c', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    const foreignTemplate = foreign.template({ slot: 't', collection, steps: (member) => ({ p: member.source<string>({ subject: member.subject('p'), run: () => 'p' }) }) });
    expectDefinitionError(() => callUntyped(fold, { subject: 'r', over: { template: foreignTemplate, step: 'p' }, run }), 'forged-declaration');
  });

  test('CMP-8: fold subject, version and callback are validated like any step', () => {
    const built = buildKeyed();
    const over = { template: built.contributor, step: 'summary' };
    expectDefinitionError(() => callUntyped(fold, { subject: '', over, run: () => 'r' }), 'invalid-subject');
    expectDefinitionError(() => callUntyped(fold, { subject: 'r', version: 0, over, run: () => 'r' }), 'invalid-version');
    expectDefinitionError(() => callUntyped(fold, { subject: 'r', over, run: 'r' }), 'invalid-callback');
  });

  test('CMP-1: the fold copies its `over` record; later author mutation cannot retarget it', () => {
    const built = buildKeyed();
    const over: { template: typeof built.contributor; step: 'summary' | 'activity' } = { template: built.contributor, step: 'summary' };
    const declared = fold({ subject: 'report:copy', over, run: () => 'r' });
    over.step = 'activity';
    expect(declared.over.step).toBe('summary');
  });
});

describe('strict fold context (CMP-8)', () => {
  test('CMP-8: entries are explicit, keyed and in canonical order; the actual author run reaches the invoker', () => {
    const built = buildKeyed();
    const invocation = openFold(built);
    expect(invocation.over).toEqual(templateStepDescriptor('summary'));
    const served: unknown[] = [];
    const seen: { callback?: unknown; context?: unknown } = {};
    const adaSummary = { sentence: 'Ada' };
    const outcome = invocation.apply(
      { threshold: 2 },
      outcomes([
        { key: 'person:cy', status: 'skipped' },
        { key: 'person:ada', status: 'succeeded', data: adaSummary },
        { key: 'person:ben', status: 'succeeded', data: 'Ben' },
      ], served),
      recording(seen),
    );
    expect(outcome).toBe('invoked');
    expect(served).toEqual([built.report]);
    expect(seen.callback).toBe(built.report.run);
    const members = membersOf(seen.context);
    expect(members.map(entry => [entry.key, entry.status])).toEqual([['person:ada', 'succeeded'], ['person:ben', 'succeeded'], ['person:cy', 'skipped']]);
    expect(members[0]?.status === 'succeeded' ? members[0].data : undefined).toBe(adaSummary);
    expect(Reflect.get(seen.context ?? {}, 'threshold')).toBe(2);
    expect(Object.isFrozen(seen.context)).toBe(true);
    expect(Object.isFrozen(members)).toBe(true);
    expect(members.every(entry => Object.isFrozen(entry))).toBe(true);
  });

  test('CMP-8: a skipped entry carries no data, and reading its data throws', () => {
    const built = buildKeyed();
    const seen: { callback?: unknown; context?: unknown } = {};
    openFold(built).apply({}, outcomes([{ key: 'person:cy', status: 'skipped' }]), recording(seen));
    const [skipped] = membersOf(seen.context);
    expect(Object.keys(skipped ?? {})).toEqual(['key', 'status']);
    expect(JSON.parse(JSON.stringify(skipped))).toEqual({ key: 'person:cy', status: 'skipped' });
    const error = expectDefinitionError(() => Reflect.get(skipped ?? {}, 'data'), 'skipped-member');
    expect(error?.message).toContain('person:cy');
  });

  test('CMP-8: a succeeded member whose result is undefined stays distinct from a skip', () => {
    const built = buildKeyed();
    const seen: { callback?: unknown; context?: unknown } = {};
    openFold(built).apply({}, outcomes([{ key: 'person:ada', status: 'succeeded', data: undefined }]), recording(seen));
    const [entry] = membersOf(seen.context);
    expect(entry).toEqual({ key: 'person:ada', status: 'succeeded', data: undefined });
    expect(entry?.status === 'succeeded' ? entry.data : 'unreadable').toBeUndefined();
  });

  test('RUN-010: a closed empty population reaches the fold as no entries', () => {
    const seen: { callback?: unknown; context?: unknown } = {};
    openFold(buildKeyed()).apply({}, outcomes([]), recording(seen));
    expect(membersOf(seen.context)).toEqual([]);
  });

  test('CMP-8: member outcomes that are not explicit, uniquely keyed entries reject before the invoker', () => {
    const built = buildKeyed();
    const getter = jest.fn((): unknown => 'data');
    const cases: readonly unknown[] = [
      undefined,
      { key: 'person:ada', status: 'succeeded', data: 1 },
      [null],
      ['person:ada'],
      [{ key: 'person:ada', status: 'succeeded', data: 1 }, { key: 'person:ada', status: 'skipped' }],
      [{ status: 'skipped' }],
      [{ key: '', status: 'skipped' }],
      [{ key: 7, status: 'skipped' }],
      [{ key: 'person:ada', status: 'pending' }],
      [{ key: 'person:ada', status: 'failed' }],
      [{ key: 'person:ada', status: 'skipped', data: undefined }],
      [{ key: 'person:ada', status: 'succeeded' }],
      [Object.defineProperty({ key: 'person:ada', status: 'succeeded' }, 'data', { get: getter, enumerable: true })],
      [Object.assign(Object.create({ data: 1 }), { key: 'person:ada', status: 'succeeded' })],
    ];
    const invoke = jest.fn(recording({}));
    for (const entries of cases) {
      expectDefinitionError(() => openFold(built).apply({}, outcomes(entries), invoke), 'invalid-members');
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  test('CMP-8: bindings that claim `members` or are not plain records reject before the invoker', () => {
    const built = buildKeyed();
    const invoke = jest.fn(recording({}));
    for (const bindings of [{ members: [] }, [], new Set()]) {
      expectDefinitionError(() => callUntyped(openFold(built).apply, bindings, outcomes([]), invoke), 'invalid-bindings');
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  test('CMP-9: a fold invocation rejects after close and while composing, before the invoker', () => {
    const built = buildKeyed();
    const invoke = jest.fn(recording({}));
    const closed = openFold(built);
    closed.close();
    expect(closed.open).toBe(false);
    expectDefinitionError(() => closed.apply({}, outcomes([]), invoke), 'scope-closed');
    const live = openFold(built);
    const collection = source<IContributors>({ subject: 'probe', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    expectDefinitionError(() => template({
      slot: 'probe',
      collection,
      steps: (member) => {
        live.apply({}, outcomes([]), invoke);
        return { p: member.source<string>({ subject: member.subject('probe'), run: () => 'p' }) };
      },
    }), 'composition-phase');
    expect(invoke).not.toHaveBeenCalled();
    expect(built.calls.bodies).toBe(0);
  });

  test('CMP-8: fold resolution and opening never invoke the fold body', () => {
    const built = buildKeyed();
    built.composition.resolve(compositionStep('report'));
    openFold(built);
    expect(built.calls.bodies).toBe(0);
  });
});
