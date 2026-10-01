/**
 * Outcome tests for outcome (tolerant) fold declarations (RUN-010): a
 * composition-level memoized step naming `{ template, step }`, distinct from
 * a strict fold, whose context exposes one explicit keyed entry per current
 * member in canonical order with that member's settled status: `succeeded`
 * with its view, or `skipped`, `failed` or `cancelled` with no data. Reading
 * data from any data-free entry throws, so none can be mistaken for a
 * successful empty result. Definition validates and assembles entries from
 * outcomes Resolution supplies; it never decides settlement, completeness or
 * publication.
 *
 * @see ../../../docs/spec/operations.md (RUN-010 and its owner decision)
 * @see ../../../docs/spec/composition.md (CMP-8)
 * @see ../../../docs/spec/glossary.md (Outcome fold, Strict fold, Coverage)
 * @see ../../../docs/plans/m5-operations.md (Folds; outcome-fold-coverage)
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  declarations,
  isDeclaration,
  type IApply,
  type IAuthorInvoker,
  type IOutcomeEntry,
  type IOutcomeFoldDeclaration,
  type IOutcomeFoldInvocation,
  type IOutcomeFoldMemberSupplier,
} from '../src/index.js';
import { callUntyped, expectDefinitionError } from './fixtures/assertions.js';
import type { ITestFamily } from './fixtures/contributors.js';
import { fakePort } from './fixtures/port.js';
import {
  buildKeyed,
  compose,
  compositionStep,
  keyedScope,
  memo,
  openInvocation,
  outcomeFold,
  source,
  template,
  templateStepDescriptor,
  type IContributors,
  type IKeyedBuild,
} from './fixtures/keyed.js';

/** A port that must never dispatch in these tests. */
const idlePort = fakePort().port;

/** The settled statuses an outcome fold entry can carry. */
const settledStatuses: readonly string[] = ['succeeded', 'skipped', 'failed', 'cancelled'];

/** A member supplier that records which outcome fold it served and returns the configured outcomes. */
function outcomes(entries: unknown, served: unknown[] = []): IOutcomeFoldMemberSupplier<ITestFamily> {
  return {
    outcomes: <TMemberResult>(declaration: IOutcomeFoldDeclaration<ITestFamily, TMemberResult, unknown>): readonly IOutcomeEntry<IApply<ITestFamily['views'], TMemberResult>>[] => {
      served.push(declaration);
      // Test-only: the supplier stands in for Resolution's trusted member outcomes and returns what the test configured.
      return entries as readonly IOutcomeEntry<IApply<ITestFamily['views'], TMemberResult>>[];
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

/** Open the fixture's outcome fold invocation, failing the test if it is not one. */
function openTally(built: IKeyedBuild): IOutcomeFoldInvocation<ITestFamily> {
  const invocation = openInvocation(built.composition, compositionStep('tally'), idlePort);
  if (invocation.kind !== 'outcome-fold') {
    throw new Error(`expected an outcome fold invocation, got ${invocation.kind}`);
  }
  return invocation;
}

/** Whether a value has the shape of an outcome fold entry (its `data` is never read here). */
function isOutcomeEntry(value: unknown): value is IOutcomeEntry<unknown> {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'key') === 'string'
    && settledStatuses.includes(String(Reflect.get(value, 'status')));
}

/** The members the author callback received, failing the test unless each is an outcome entry. */
function membersOf(context: unknown): readonly IOutcomeEntry<unknown>[] {
  const members: unknown = typeof context === 'object' && context !== null ? Reflect.get(context, 'members') : undefined;
  const list: readonly unknown[] = Array.isArray(members) ? members : [];
  const entries = list.filter(isOutcomeEntry);
  if (!Array.isArray(members) || entries.length !== list.length) {
    throw new Error('context carries no outcome fold entries');
  }
  return Object.isFrozen(members) ? Object.freeze(entries) : entries;
}

describe('outcome fold declaration (RUN-010)', () => {
  test('RUN-010: an outcome fold is a frozen composition-level step, distinct from a strict fold', () => {
    const built = buildKeyed({ outcome: true });
    expect(built.tally).toMatchObject({ kind: 'outcome-fold', subject: 'tally:acme/widget:2026-Q1', version: 1, label: undefined });
    expect(built.tally.over.template).toBe(built.contributor);
    expect(built.tally.over.step).toBe('summary');
    expect(Object.isFrozen(built.tally)).toBe(true);
    expect(Object.isFrozen(built.tally.over)).toBe(true);
    expect(isDeclaration(built.tally)).toBe(true);
    expect(built.composition.resolve(compositionStep('tally'))).toMatchObject({ status: 'bound', target: { role: 'step', declaration: built.tally } });
  });

  test('RUN-010: the topology lists outcome folds apart from strict folds', () => {
    const built = buildKeyed({ outcome: true });
    expect(built.composition.topology.folds).toEqual([{ fold: compositionStep('report'), over: templateStepDescriptor('summary') }]);
    expect(built.composition.topology.outcomeFolds).toEqual([{ fold: compositionStep('tally'), over: templateStepDescriptor('summary') }]);
    expect(Object.isFrozen(built.composition.topology.outcomeFolds)).toBe(true);
    expect(buildKeyed().composition.topology.outcomeFolds).toEqual([]);
  });

  test('RUN-010: opening an outcome fold yields an outcome-fold invocation over its template step; a strict fold stays a fold', () => {
    const built = buildKeyed({ outcome: true });
    expect(openTally(built).over).toEqual(templateStepDescriptor('summary'));
    expect(openInvocation(built.composition, compositionStep('report'), idlePort).kind).toBe('fold');
    expect(built.calls.bodies).toBe(0);
  });

  test('RUN-010: the outcome fold must name a declared step of a template this family minted', () => {
    const built = buildKeyed();
    const run = (): string => 'r';
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', over: { template: built.contributor, step: 'assessment' }, run }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', over: { template: { ...built.contributor }, step: 'summary' }, run }), 'forged-declaration');
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', over: { template: built.contributors, step: 'summary' }, run }), 'forged-declaration');
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', run }), 'illegal-edge');
    const foreign = declarations<ITestFamily>();
    const collection = foreign.source<IContributors>({ subject: 'c', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    const foreignTemplate = foreign.template({ slot: 't', collection, steps: (member) => ({ p: member.source<string>({ subject: member.subject('p'), run: () => 'p' }) }) });
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', over: { template: foreignTemplate, step: 'p' }, run }), 'forged-declaration');
  });

  test('RUN-010: subject, version, callback and options of other kinds are validated as for a strict fold', () => {
    const built = buildKeyed();
    const over = { template: built.contributor, step: 'summary' };
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: '', over, run: () => 't' }), 'invalid-subject');
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', version: 0, over, run: () => 't' }), 'invalid-version');
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', over, run: 't' }), 'invalid-callback');
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', over, children: {}, run: () => 1 }), 'illegal-edge');
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', over, collection: { identity: 'key' }, run: () => 1 }), 'invalid-collection');
    expectDefinitionError(() => callUntyped(outcomeFold, { subject: 't', over, finality: () => true, run: () => 1 }), 'invalid-callback');
  });

  test('CMP-1: the outcome fold copies its `over` record; later author mutation cannot retarget it', () => {
    const built = buildKeyed();
    const over: { template: typeof built.contributor; step: 'summary' | 'activity' } = { template: built.contributor, step: 'summary' };
    const declared = outcomeFold({ subject: 'tally:copy', over, run: () => 't' });
    over.step = 'activity';
    expect(declared.over.step).toBe('summary');
  });

  test('CMP-9: an outcome fold is never a child, a member step or a template step: a declared edge never nests its fan-out inside a member (RUN-002)', () => {
    const built = buildKeyed();
    expectDefinitionError(() => callUntyped(memo, { subject: 'm', children: { tally: built.tally }, run: () => 1 }), 'illegal-edge');
    expectDefinitionError(() => compose({
      scope: keyedScope,
      steps: [{ slot: 'contributors', declaration: built.contributors }],
      members: [{ key: 'person:ada', steps: [{ slot: 'tally', declaration: built.tally }] }],
      templates: [built.contributor],
    }), 'illegal-edge');
    const collection = source<IContributors>({ subject: 'probe', collection: { identity: 'key' }, run: () => ({ members: [], status: 'complete' }) });
    expectDefinitionError(() => callUntyped(template, { slot: 'with-tally', collection, steps: () => ({ tally: built.tally }) }), 'invalid-template');
  });

  test('RUN-010: an outcome fold cannot be composed over a template missing from the composition', () => {
    const built = buildKeyed();
    expectDefinitionError(() => compose({ scope: keyedScope, steps: [{ slot: 'contributors', declaration: built.contributors }, { slot: 'tally', declaration: built.tally }] }), 'illegal-edge');
  });
});

describe('outcome fold context (RUN-010)', () => {
  test('RUN-010: entries carry every settled status, keyed and in canonical order; the actual author run reaches the invoker', () => {
    const built = buildKeyed({ outcome: true });
    const served: unknown[] = [];
    const seen: { callback?: unknown; context?: unknown } = {};
    const adaSummary = { sentence: 'Ada' };
    const outcome = openTally(built).apply(
      { threshold: 2 },
      outcomes([
        { key: 'person:dee', status: 'cancelled' },
        { key: 'person:cy', status: 'skipped' },
        { key: 'person:ada', status: 'succeeded', data: adaSummary },
        { key: 'person:ben', status: 'failed' },
      ], served),
      recording(seen),
    );
    expect(outcome).toBe('invoked');
    expect(served).toEqual([built.tally]);
    expect(seen.callback).toBe(built.tally.run);
    const members = membersOf(seen.context);
    expect(members.map(entry => [entry.key, entry.status])).toEqual([
      ['person:ada', 'succeeded'],
      ['person:ben', 'failed'],
      ['person:cy', 'skipped'],
      ['person:dee', 'cancelled'],
    ]);
    expect(members[0]?.status === 'succeeded' ? members[0].data : undefined).toBe(adaSummary);
    expect(Reflect.get(seen.context ?? {}, 'threshold')).toBe(2);
    expect(Object.isFrozen(seen.context)).toBe(true);
    expect(Object.isFrozen(members)).toBe(true);
    expect(members.every(entry => Object.isFrozen(entry))).toBe(true);
  });

  test.each([
    ['failed', 'unsuccessful-member'],
    ['cancelled', 'unsuccessful-member'],
    ['skipped', 'skipped-member'],
  ] as const)('RUN-010: a %s entry carries no data, and reading its data throws %s', (status, code) => {
    const seen: { callback?: unknown; context?: unknown } = {};
    openTally(buildKeyed({ outcome: true })).apply({}, outcomes([{ key: 'person:cy', status }]), recording(seen));
    const [entry] = membersOf(seen.context);
    expect(Object.keys(entry ?? {})).toEqual(['key', 'status']);
    expect(JSON.parse(JSON.stringify(entry))).toEqual({ key: 'person:cy', status });
    const error = expectDefinitionError(() => Reflect.get(entry ?? {}, 'data'), code);
    expect(error?.message).toContain('person:cy');
  });

  test('RUN-010: a succeeded member whose result is undefined stays distinct from every data-free status', () => {
    const seen: { callback?: unknown; context?: unknown } = {};
    openTally(buildKeyed({ outcome: true })).apply({}, outcomes([{ key: 'person:ada', status: 'succeeded', data: undefined }]), recording(seen));
    const [entry] = membersOf(seen.context);
    expect(entry).toEqual({ key: 'person:ada', status: 'succeeded', data: undefined });
  });

  test('RUN-010: a closed empty population reaches the outcome fold as no entries', () => {
    const seen: { callback?: unknown; context?: unknown } = {};
    openTally(buildKeyed({ outcome: true })).apply({}, outcomes([]), recording(seen));
    expect(membersOf(seen.context)).toEqual([]);
  });

  test('RUN-010: unsettled statuses and malformed entries reject before the invoker', () => {
    const built = buildKeyed({ outcome: true });
    const getter = jest.fn((): unknown => 'data');
    const cases: readonly unknown[] = [
      undefined,
      [null],
      [{ key: 'person:ada', status: 'succeeded', data: 1 }, { key: 'person:ada', status: 'failed' }],
      [{ key: '', status: 'failed' }],
      // Pending, unknown and other unsettled statuses never reach an outcome fold body.
      [{ key: 'person:ada', status: 'pending' }],
      [{ key: 'person:ada', status: 'unknown' }],
      [{ key: 'person:ada', status: 'waiting' }],
      [{ key: 'person:ada', status: 'failed', data: undefined }],
      [{ key: 'person:ada', status: 'cancelled', data: 'partial' }],
      [{ key: 'person:ada', status: 'succeeded' }],
      [Object.defineProperty({ key: 'person:ada', status: 'succeeded' }, 'data', { get: getter, enumerable: true })],
    ];
    const invoke = jest.fn(recording({}));
    for (const entries of cases) {
      expectDefinitionError(() => openTally(built).apply({}, outcomes(entries), invoke), 'invalid-members');
    }
    expect(invoke).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  test('CMP-8: a strict fold still refuses failed and cancelled entries', () => {
    const built = buildKeyed({ outcome: true });
    const strict = openInvocation(built.composition, compositionStep('report'), idlePort);
    if (strict.kind !== 'fold') {
      throw new Error(`expected a fold invocation, got ${strict.kind}`);
    }
    const invoke = jest.fn(recording({}));
    for (const status of ['failed', 'cancelled']) {
      expectDefinitionError(() => callUntyped(strict.apply, {}, { outcomes: () => [{ key: 'person:ada', status }] }, invoke), 'invalid-members');
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  test('CMP-8: bindings that claim `members` or are not plain records reject before the invoker', () => {
    const built = buildKeyed({ outcome: true });
    const invoke = jest.fn(recording({}));
    for (const bindings of [{ members: [] }, [], new Set()]) {
      expectDefinitionError(() => callUntyped(openTally(built).apply, bindings, outcomes([]), invoke), 'invalid-bindings');
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  test('CMP-9: an outcome fold invocation rejects after close, before the invoker', () => {
    const built = buildKeyed({ outcome: true });
    const invoke = jest.fn(recording({}));
    const closed = openTally(built);
    closed.close();
    expect(closed.open).toBe(false);
    expectDefinitionError(() => closed.apply({}, outcomes([]), invoke), 'scope-closed');
    expect(invoke).not.toHaveBeenCalled();
    expect(built.calls.bodies).toBe(0);
  });
});
