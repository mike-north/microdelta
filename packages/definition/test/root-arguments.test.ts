/**
 * Root recipes retain Definition's ordinary derived-value encoding while
 * requiring its genuine composition-local witness. Resolution, not this
 * encoder, supplies currentness and the argument-justification decision.
 */
import { describe, expect, test } from '@jest/globals';

import { declarations, derivedArguments, type ICollectionResult } from '../src/index.js';
import type { ITestFamily } from './fixtures/contributors.js';

/** Fixed query identity is independent of the frontier or run ordinal. */
interface IQuery { readonly person: string }

/** Real supplied-subject evaluation tests the same encoded values a normal call uses. */
function fixture() {
  const builders = declarations<ITestFamily>();
  let subjectCalls = 0;
  const page = builders.sourceSlot<readonly [IQuery, string | undefined], object>({ slot: 'page' });
  const source = builders.suppliedSource<readonly [IQuery, string | undefined], object>({ run: () => ({}) });
  const collection = builders.source<ICollectionResult<{ readonly id: string }>>({ subject: 'frontier', collection: { identity: 'id' }, run: () => ({ members: [], status: 'open' }) });
  const template = builders.template({ slot: 'prs', collection, steps: member => ({ assess: member.memo({ subject: member.subject('assessment'), run: () => ({}) }) }) });
  const fold = builders.fold({ subject: 'summary', over: { template, step: 'assess' }, run: () => ({}) });
  const traversal = builders.traversal({ slot: 'person-prs', query: 'query', page, collection, template, fold });
  const options = {
    scope: 'test', inputs: [{ slot: 'query', value: { person: 'A' } }], templates: [template], traversals: [traversal],
    steps: [{ slot: 'frontier', declaration: collection }, { slot: 'summary', declaration: fold }],
    supplied: [builders.supplySource({ slot: page, declaration: source, subject: ([query, cursor]) => {
      subjectCalls += 1;
      if (query === undefined) { throw new Error('Expected the current query'); }
      return `page:${query.person}:${cursor ?? 'root'}`;
    } })],
  };
  const composition = builders.compose(options);
  const witness = builders.rootAcquisition(composition, traversal);
  return { builders, composition, witness, options, subjectCalls: () => subjectCalls };
}

describe('root query/continuation argument recipes', () => {
  test('encodes current query/cursor values and uses ordinary supplied-subject semantics', () => {
    const graph = fixture();
    const query = { person: 'A' };
    const recipes = graph.builders.rootArgumentRecipes(graph.composition, graph.witness, [query, 'next'], true);
    query.person = 'mutated-after-capture';
    expect(derivedArguments(recipes)).toEqual([{ person: 'A' }, 'next']);
    const binding = graph.builders.resolveRootAcquisition(graph.composition, graph.witness);
    const target = graph.composition.resolve(binding.page);
    if (target.status !== 'bound' || target.target.role !== 'callable' || target.target.kind !== 'supplied-source') { throw new Error('Expected declared source target'); }
    expect(target.target.subjectFor(recipes)).toEqual({ scope: 'test', subject: 'page:A:next' });
    expect(graph.subjectCalls()).toBe(1);
  });

  test('refuses a forged or wrong-composition witness without evaluating a subject', () => {
    const graph = fixture();
    const other = graph.builders.compose(graph.options);
    expect(() => graph.builders.rootArgumentRecipes(graph.composition, { ...graph.witness }, [{ person: 'A' }, undefined], true)).toThrow();
    expect(() => graph.builders.rootArgumentRecipes(other, graph.witness, [{ person: 'A' }, undefined], true)).toThrow();
    expect(graph.subjectCalls()).toBe(0);
  });

  test('carries an unjustified owner decision without upgrading it', () => {
    const graph = fixture();
    const recipes = graph.builders.rootArgumentRecipes(graph.composition, graph.witness, [{ person: 'A' }, undefined], false);
    if ('form' in recipes) { throw new Error('Expected two argument recipes'); }
    expect(recipes).toHaveLength(2);
    expect(recipes.every(recipe => recipe.form === 'derived' && recipe.justified === false)).toBe(true);
    expect(graph.subjectCalls()).toBe(0);
  });

  test('unsupported current values refuse without invoking accessors or author subjects', () => {
    const graph = fixture();
    let reads = 0;
    const query = { get person() { reads += 1; return 'A'; } };
    expect(() => graph.builders.rootArgumentRecipes(graph.composition, graph.witness, [query, undefined], true)).toThrow();
    expect(reads).toBe(0);
    expect(graph.subjectCalls()).toBe(0);
  });
});
