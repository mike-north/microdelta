/**
 * Restricted traversal correspondence (WPD-11): one frozen relationship binds
 * acquisition, its query, collection, template and strict consumer. These owner
 * tests inspect authority without running a page traversal or author body.
 */
import { describe, expect, jest, test } from '@jest/globals';

import { declarations, type ICollectionResult } from '../src/index.js';
import type { ITestFamily } from './fixtures/contributors.js';

/** A fresh graph separates builder ownership from matching structural names. */
function fixture() {
  const builders = declarations<ITestFamily>();
  const run = jest.fn(() => ({}));
  const page = builders.sourceSlot<readonly [object, string | undefined], object>({ slot: 'page' });
  const implementation = builders.suppliedSource<readonly [object, string | undefined], object>({ run });
  const registration = builders.supplySource({ slot: page, declaration: implementation, subject: () => 'page:fixed-query' });
  const collection = builders.source<ICollectionResult<{ readonly id: string }>>({
    subject: 'frontier', collection: { identity: 'id' }, run: () => ({ members: [], status: 'open' }),
  });
  const template = builders.template({
    slot: 'prs', collection,
    steps: (member) => ({ assess: member.memo({ subject: member.subject('assessment'), run }) }),
  });
  const fold = builders.fold({ subject: 'strict-summary', over: { template, step: 'assess' }, run });
  const relationship = builders.traversal({ slot: 'person-prs', query: 'query', page, collection, template, fold });
  const options = {
    scope: 'within-person', inputs: [{ slot: 'query', value: { person: 'fixture/person', query: 'fixed' } }],
    supplied: [registration], steps: [{ slot: 'frontier', declaration: collection }, { slot: 'summary', declaration: fold }],
    templates: [template], traversals: [relationship],
  };
  return { builders, page, implementation, registration, collection, template, fold, relationship, options, run };
}

describe('restricted root acquisition correspondence', () => {
  test('freezes exactly the declared query/page/collection/template/fold relationship without author work', () => {
    const graph = fixture();
    const composition = graph.builders.compose(graph.options);
    const witness = graph.builders.rootAcquisition(composition, graph.relationship);
    const bound = graph.builders.resolveRootAcquisition(composition, witness);
    expect(bound.query).toEqual({ scope: 'within-person', role: 'input', slot: 'query' });
    expect(bound.page).toEqual({ scope: 'within-person', role: 'callable', slot: 'page' });
    expect(bound.collection).toEqual({ scope: 'within-person', role: 'step', slot: 'frontier' });
    expect(bound.template).toBe('prs');
    expect(bound.fold).toEqual({ scope: 'within-person', role: 'step', slot: 'summary' });
    expect(composition.topology.traversals).toEqual([bound]);
    expect(composition.topology.slots).toContain('page');
    expect(Object.isFrozen(witness)).toBe(true);
    expect(Object.isFrozen(bound)).toBe(true);
    expect(graph.run).not.toHaveBeenCalled();
  });

  test('rejects absent or foreign relationships and same-shaped witness copies before author work', () => {
    const graph = fixture();
    const foreign = fixture();
    const composition = graph.builders.compose(graph.options);
    const omitted = graph.builders.compose({ ...graph.options, traversals: [] });
    const witness = graph.builders.rootAcquisition(composition, graph.relationship);
    const other = graph.builders.compose(graph.options);
    expect(() => graph.builders.rootAcquisition(composition, foreign.relationship)).toThrow();
    expect(() => graph.builders.rootAcquisition(omitted, graph.relationship)).toThrow();
    expect(() => graph.builders.resolveRootAcquisition(composition, { ...witness })).toThrow();
    expect(() => graph.builders.resolveRootAcquisition(other, witness)).toThrow();
    expect(() => foreign.builders.resolveRootAcquisition(composition, witness)).toThrow();
    expect(() => graph.builders.resolveRootAcquisition(composition, undefined)).toThrow();
    expect(graph.run).not.toHaveBeenCalled();
    expect(foreign.run).not.toHaveBeenCalled();
  });

  test('requires a unique current input and source-kind page binding at composition', () => {
    const graph = fixture();
    const memoSlot = graph.builders.stepSlot<readonly [object, string | undefined], object>({ slot: 'page' });
    const memo = graph.builders.suppliedStep<readonly [object, string | undefined], object>({ run: graph.run });
    const wrongKind = graph.builders.supply({ slot: memoSlot, declaration: memo, subject: () => 'wrong-kind' });
    expect(() => graph.builders.compose({ ...graph.options, inputs: [] })).toThrow();
    expect(() => graph.builders.compose({ ...graph.options, inputs: [...graph.options.inputs, ...graph.options.inputs] })).toThrow();
    expect(() => graph.builders.compose({ ...graph.options, supplied: [] })).toThrow();
    expect(() => graph.builders.compose({ ...graph.options, supplied: [graph.registration, graph.registration] })).toThrow();
    expect(() => graph.builders.compose({ ...graph.options, supplied: [wrongKind] })).toThrow();
    expect(graph.run).not.toHaveBeenCalled();
  });

  test('refuses disconnected or multiply registered targets rather than guessing correspondence', () => {
    const graph = fixture();
    const otherCollection = graph.builders.source<ICollectionResult<{ readonly id: string }>>({
      subject: 'other-frontier', collection: { identity: 'id' }, run: () => ({ members: [], status: 'open' }),
    });
    const disconnected = graph.builders.traversal({
      slot: 'disconnected', query: 'query', page: graph.page,
      collection: otherCollection, template: graph.template, fold: graph.fold,
    });
    expect(() => graph.builders.compose({ ...graph.options, traversals: [disconnected] })).toThrow();
    expect(() => graph.builders.compose({ ...graph.options, traversals: [graph.relationship, graph.relationship] })).toThrow();
    expect(() => graph.builders.compose({ ...graph.options, steps: [...graph.options.steps, { slot: 'also-frontier', declaration: graph.collection }] })).toThrow();
    expect(() => graph.builders.compose({ ...graph.options, steps: [{ slot: 'frontier', declaration: graph.collection }] })).toThrow();
    expect(graph.run).not.toHaveBeenCalled();
  });

  test('rejects a distinct genuine collection occupying the same selected step descriptor', () => {
    const graph = fixture();
    const other = graph.builders.source<ICollectionResult<{ readonly id: string }>>({
      subject: 'other-frontier', collection: { identity: 'id' }, run: () => ({ members: [], status: 'open' }),
    });
    const ambiguous = { ...graph.options, steps: [...graph.options.steps, { slot: 'frontier', declaration: other }] };
    expect(() => graph.builders.compose(ambiguous)).toThrow();
    const ordinary = graph.builders.compose({ ...ambiguous, traversals: [] });
    expect(ordinary.resolve({ scope: 'within-person', role: 'step', slot: 'frontier' }).status).toBe('ambiguous');
    expect(graph.run).not.toHaveBeenCalled();
  });

  test('rejects a distinct genuine strict fold occupying the same selected step descriptor', () => {
    const graph = fixture();
    const other = graph.builders.fold({ subject: 'other-summary', over: { template: graph.template, step: 'assess' }, run: graph.run });
    const ambiguous = { ...graph.options, steps: [...graph.options.steps, { slot: 'summary', declaration: other }] };
    expect(() => graph.builders.compose(ambiguous)).toThrow();
    const ordinary = graph.builders.compose({ ...ambiguous, traversals: [] });
    expect(ordinary.resolve({ scope: 'within-person', role: 'step', slot: 'summary' }).status).toBe('ambiguous');
    expect(graph.run).not.toHaveBeenCalled();
  });

  test('rejects forged declaration fields and accessors without invoking them', () => {
    const graph = fixture();
    const getter = jest.fn(() => graph.page);
    const invalid = { slot: 'forged', query: 'query', get page() { return getter(); }, collection: graph.collection, template: graph.template, fold: graph.fold };
    expect(() => graph.builders.traversal(invalid)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const composition = graph.builders.compose(graph.options);
    expect(() => Reflect.apply(graph.builders.rootAcquisition, graph.builders, [composition, { ...graph.relationship }])).toThrow();
    expect(graph.run).not.toHaveBeenCalled();
  });
});
