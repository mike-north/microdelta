/**
 * RUN-006/007 and A-16a/b/f: preview derives display status from an addressed
 * native evaluation outcome without becoming an evaluation or mutable head.
 * Real Materialization supplies lazy exact reads over instrumented snapshots.
 */
import { describe, expect, test } from '@jest/globals';
import type { ICompletedNavigationReader, ICompletedResultReader, ICompletedResultReference } from '@microdelta/history';
import { createMaterialization } from '@microdelta/materialization';
import { createNodeMachine } from '@microdelta/machine-node';
import { createTrackingObserver } from '@microdelta/tracking';
import { navigate, observe } from '@microdelta/value';

import { createPreviewProjection } from '../src/index.js';
import type { IPreview, IPreviewEvaluation, IPreviewScope, IResolutionOutcome } from '../src/index.js';

/** One explicitly addressed evaluation; labels never substitute for its scope. */
const scope: IPreviewScope = {
  context: { runId: 'run:a', analysis: 'analysis:a', environment: 'env:a' },
  requestKey: 'request:a',
  step: { scope: 'analysis:a', role: 'step', slot: 'source', memberKey: 'member:a' },
};
/** Two immutable completed results with distinct exact identity. */
const first: ICompletedResultReference = { kind: 'completed-result', locator: 'store:a#first' };
const second: ICompletedResultReference = { kind: 'completed-result', locator: 'store:a#second' };
/** Fields selected by tests sit beside deliberately unread large content. */
interface IData { readonly count: number; readonly optional: undefined; readonly empty: object; readonly rows: readonly number[]; readonly large: string }

/** Native success fixture; the separate owner integration test produces real outcomes. */
function published(reference: ICompletedResultReference = first): IResolutionOutcome {
  return { kind: 'published', step: scope.step, reference, attemptId: 1, misses: [], trace: [], diagnostics: [] };
}
/** A real owner's successful verification names its exact accepted reference/environment. */
function reused(reference: ICompletedResultReference = first): IResolutionOutcome {
  return { kind: 'reused', step: scope.step, reference, basis: 'validated', misses: [], trace: [], diagnostics: [],
    acceptance: { acceptanceId: 1, reference, environment: scope.context.environment, fence: 1,
      evidence: { format: 'fixture', formatVersion: 1, content: {} }, dependencies: [] } };
}
/** Outcome provenance is scoped independently from the target projection request. */
function returned(outcome: IResolutionOutcome = published(), evidenceScope: IPreviewScope = scope): IPreviewEvaluation {
  return { kind: 'returned', scope: evidenceScope, outcome };
}
/** Narrow availability explicitly; a falsy author leaf is never this discriminator. */
function available<T extends object>(preview: IPreview<T>): Extract<IPreview<T>, { readonly availability: 'available' }> {
  if (preview.availability !== 'available') { throw new Error('Expected an available preview'); }
  return preview;
}
/** Instrument a capability that exposes no evaluation or mutation methods. */
function fixture(): {
  readonly projection: ReturnType<typeof createPreviewProjection>;
  readonly tracking: ReturnType<typeof createTrackingObserver>;
  readonly reads: string[];
  readonly snapshots: Map<string, object>;
} {
  const reads: string[] = [];
  const snapshots = new Map<string, object>([
    [first.locator, { count: 0, optional: undefined, empty: {}, rows: [], large: 'unread'.repeat(10000) }],
    [second.locator, { count: 9, optional: undefined, empty: {}, rows: [], large: 'later'.repeat(10000) }],
    ['store:a#empty', {}], ['store:a#array', []],
  ]);
  const exact = (reference: ICompletedResultReference): object => {
    const value = snapshots.get(reference.locator);
    if (value === undefined) { throw new Error('Missing exact result'); }
    return value;
  };
  const reader: ICompletedResultReader & ICompletedNavigationReader = {
    readNode(reference, address) {
      reads.push(`${reference.locator}:${JSON.stringify(address)}`);
      if (address.some(segment => segment.kind === 'property' && segment.key === 'large')) { throw new Error('Unrelated payload read'); }
      return navigate(exact(reference), address);
    },
    readSelected(reference, request) { reads.push(`${reference.locator}:${request.operation}`); return observe(exact(reference), request.address, request.operation); },
    readSubtree() { throw new Error('Unexpected whole-subtree loading'); },
    resolveFingerprint() { return { kind: 'unavailable' }; },
  };
  const tracking = createTrackingObserver(createNodeMachine());
  const materialization = createMaterialization({ reader, navigationReader: reader, tracking });
  return { projection: createPreviewProjection(materialization), reads, snapshots, tracking };
}

describe('read-only preview projection', () => {
  test('distinguishes missing results from available zero, undefined and empty data', () => {
    const { projection, tracking } = fixture();
    expect(projection.project({ scope })).toMatchObject({ availability: 'unavailable', refresh: { kind: 'none' } });
    const preview = available(projection.project<IData>({ scope, reference: first, evaluation: returned() }));
    expect(preview.freshness).toBe('current');
    expect(preview.value.count).toBe(0);
    expect(preview.value.optional).toBeUndefined();
    expect(tracking.keys(preview.value.empty)).toEqual([]);
    expect(preview.value.rows.length).toBe(0);
    for (const locator of ['store:a#empty', 'store:a#array']) {
      expect(projection.project({ scope, reference: { kind: 'completed-result', locator } }).availability).toBe('available');
    }
  });

  test.each([new Error('refresh failed'), undefined, 0])('retains prior value or absence with a current failure: %p', error => {
    const { projection } = fixture();
    const evaluation: IPreviewEvaluation = { kind: 'threw', scope, error };
    for (const reference of [first, undefined]) {
      const preview = projection.project<IData>({ scope, ...(reference === undefined ? {} : { reference }), evaluation });
      expect(preview.refresh.kind).toBe('failed');
      if (preview.refresh.kind === 'failed') { expect(preview.refresh.error).toBe(error); }
      if (preview.availability === 'available') { expect(preview.freshness).toBe('stale'); expect(preview.value.count).toBe(0); }
      else { expect('value' in preview).toBe(false); }
    }
  });

  test('equal-data owner verification clears stale without changing exact data', () => {
    const { projection } = fixture();
    const stale = available(projection.project<IData>({ scope, reference: first }));
    const current = available(projection.project<IData>({ scope, reference: first, evaluation: returned(reused()) }));
    expect(stale.freshness).toBe('stale'); expect(current.freshness).toBe('current');
    expect(current.value.count).toBe(stale.value.count); expect(current.reference).toEqual(stale.reference);
  });

  test('retained reports, different scopes and identity-only evidence do not grant freshness or attach errors', () => {
    const { projection } = fixture();
    const variants: readonly IPreviewScope[] = [
      { ...scope, context: { ...scope.context, runId: 'restarted' } },
      { ...scope, context: { ...scope.context, analysis: 'other' } },
      { ...scope, context: { ...scope.context, environment: 'other' } },
      { ...scope, requestKey: 'later-request' },
      { ...scope, step: { ...scope.step, scope: 'other' } },
      { ...scope, step: { ...scope.step, role: 'callable' } },
      { ...scope, step: { ...scope.step, slot: 'other' } },
      { ...scope, step: { ...scope.step, memberKey: 'other' } },
      { ...scope, step: { ...scope.step, template: 'fanout' } },
      { ...scope, step: { ...scope.step, collection: 'members' } },
    ];
    for (const evidenceScope of variants) {
      for (const evaluation of [returned(published(), evidenceScope), { kind: 'threw', scope: evidenceScope, error: new Error('unrelated') } satisfies IPreviewEvaluation]) {
        const preview = available(projection.project({ scope, reference: first, evaluation }));
        expect(preview.freshness).toBe('stale'); expect(preview.refresh).toEqual({ kind: 'none' });
      }
    }
    const wrongStep = { ...published(), step: { ...scope.step, slot: 'other' } };
    expect(available(projection.project({ scope, reference: first, evaluation: returned(wrongStep) })).freshness).toBe('stale');
  });

  test('refused and skipped evaluations do not verify a retained snapshot or become thrown errors', () => {
    const { projection } = fixture();
    const outcomes: readonly IResolutionOutcome[] = [
      { kind: 'refused', step: scope.step, refused: scope.step, reason: 'not admitted', disposition: 'denied', misses: [], trace: [], diagnostics: [] },
      { kind: 'skipped', step: scope.step, gate: { selected: 'skipped', observations: [] }, misses: [], trace: [], diagnostics: [] },
    ];
    for (const outcome of outcomes) {
      expect(available(projection.project({ scope, reference: first, evaluation: returned(outcome) }))).toMatchObject({ freshness: 'stale', refresh: { kind: 'none' } });
    }
  });

  test('exact-reference and acceptance-environment mismatches cannot establish current status', () => {
    const { projection } = fixture();
    const reusedFirst = reused();
    if (reusedFirst.kind !== 'reused') { throw new Error('Expected verification fixture'); }
    const outcomes: readonly IResolutionOutcome[] = [published(second), reused(second),
      { ...reusedFirst, acceptance: { ...reusedFirst.acceptance, reference: second } },
      { ...reusedFirst, acceptance: { ...reusedFirst.acceptance, environment: 'other' } },
    ];
    for (const outcome of outcomes) { expect(available(projection.project({ scope, reference: first, evaluation: returned(outcome) })).freshness).toBe('stale'); }
  });

  test('selected views keep exact identity despite new publication and do not load unrelated payloads', () => {
    const { projection, reads, snapshots } = fixture();
    const preview = available(projection.project<IData>({ scope, reference: first, evaluation: returned() }));
    snapshots.set('store:a#new-head', { count: 10 });
    for (let index = 0; index < 100; index += 1) { expect(preview.value.count).toBe(0); }
    expect(reads.every(read => read.startsWith(first.locator))).toBe(true);
    expect(reads.some(read => read.includes('large'))).toBe(false);
    expect(() => {
      const missing = available(projection.project<IData>({ scope, reference: { kind: 'completed-result', locator: 'missing' } }));
      return missing.value.count;
    }).toThrow('Missing exact result');
  });

  test('snapshots framework metadata without mutating caller scope/reference or interpreting errors', () => {
    const { projection } = fixture();
    const mutableScope = { context: { ...scope.context }, requestKey: scope.requestKey, step: { ...scope.step } };
    const mutableReference = { ...first };
    const preview = available(projection.project<IData>({ scope: mutableScope, reference: mutableReference, evaluation: returned() }));
    mutableScope.context.runId = 'changed'; mutableScope.step.slot = 'changed'; mutableReference.locator = second.locator;
    expect(preview.scope).toEqual(scope); expect(preview.reference).toEqual(first); expect(preview.value.count).toBe(0);
    expect(Object.isFrozen(preview)).toBe(true); expect(Object.isFrozen(preview.scope)).toBe(true);
  });
});
