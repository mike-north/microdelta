/** Owned symbolic edges build a frozen bounded graph without admitting computation. */
import { describe, expect, test } from '@jest/globals';
import type { IBinding } from '../src/protocol.js';
import { analysis, graphOf, memo } from '../src/protocol.js';
import { entryFor } from '../authors/entries.js';

/** Fixture input names deliberately differ from the proposed pull-request sketch. */
interface IInputs { readonly document: { readonly title: string }; readonly factor: number; readonly alternate: { readonly title: string } }

describe('bounded numeric authoring graph', () => {
  test('construction executes the graph factory once and never invokes a memo body', () => {
    let factories = 0;
    let bodies = 0;
    const entry = analysis<IInputs>(() => {
      factories += 1;
      // eslint-disable-next-line microdelta/tracked-captures -- Deliberately effectful construction sentinel: the test proves graph construction never invokes an authored body; normal author modules have no suppression.
      return memo({ name: 'first', from: {}, run: () => { bodies += 1; return 1; } });
    });
    expect(factories).toBe(1);
    expect(bodies).toBe(0);
    expect(graphOf(entry).nodes).toHaveLength(1);
  });

  test('from edges are copied and frozen; fixed opaque subjects are kept exactly', () => {
    const entry = analysis<IInputs>((input) => {
      const from = { document: input('document') };
      const result = memo({ name: 'first', subject: 'opaque/subject:complete', from, run: ({ document }) => document.title.length });
      from.document = input('alternate');
      return result;
    });
    const graph = graphOf(entry);
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.nodes)).toBe(true);
    expect(graph.nodes[0]).toMatchObject({ name: 'first', subject: 'opaque/subject:complete', edges: [{ key: 'document', kind: 'input', slot: 'document' }] });
    expect(Object.isFrozen(graph.nodes[0]?.edges)).toBe(true);
  });

  test('duplicate occurrences and more than two nodes are rejected before execution', () => {
    expect(() => analysis<IInputs>(() => {
      memo({ name: 'same', from: {}, run: () => 1 });
      return memo({ name: 'same', from: {}, run: () => 2 });
    })).toThrow(/duplicate/i);
    expect(() => analysis<IInputs>(() => {
      memo({ name: 'one', from: {}, run: () => 1 });
      memo({ name: 'two', from: {}, run: () => 2 });
      return memo({ name: 'three', from: {}, run: () => 3 });
    })).toThrow(/two/i);
  });

  test('forged and cross-analysis origins are rejected rather than treated as ordinary inputs', () => {
    expect((): unknown => Reflect.apply(analysis, undefined, [(): unknown =>
      Reflect.apply(memo, undefined, [{ name: 'forged', from: { value: {} }, run: () => 1 }])])).toThrow(/owned|origin/i);
    const holder: { value?: IBinding<number> } = {};
    analysis<IInputs>(() => {
      const token = memo({ name: 'earlier', from: {}, run: () => 1 });
      holder.value = token;
      return token;
    });
    const earlier = holder.value;
    if (earlier === undefined) { throw new Error('Missing foreign token fixture'); }
    expect(() => analysis<IInputs>(() => memo({ name: 'later', from: { earlier }, run: () => 1 }))).toThrow(/owned|origin/i);
  });
});

/** Occurrence correspondence cannot silently merge distinct histories; aliases retain a single built node. */
test('duplicate complete subjects fail before bodies while two aliases of one node remain valid', () => {
  expect(() => analysis<IInputs>(() => {
    memo({ name: 'first', subject: 'shared', from: {}, run: () => 1 });
    return memo({ name: 'second', subject: 'shared', from: {}, run: () => 2 });
  })).toThrow(/subject/i);
  const entry = analysis<IInputs>(() => {
    const child = memo({ name: 'child', from: {}, run: () => 1 });
    return memo({ name: 'parent', from: { left: child, right: child }, run: ({ left, right }) => left + right });
  });
  expect(graphOf(entry).nodes[1]?.edges).toEqual([{ key: 'left', kind: 'memo', slot: 'child' }, { key: 'right', kind: 'memo', slot: 'child' }]);
});

/** Identity association is evidence, never a reason to rewrite the opaque subject itself. */
test('subject reassignment keeps the literal complete subjects and structural occurrence names', () => {
  expect(graphOf(entryFor('base', 'subjects')).nodes.map(({ name, subject }) => ({ name, subject }))).toEqual([{ name: 'a', subject: 'subject-x' }, { name: 'b', subject: 'subject-y' }]);
  expect(graphOf(entryFor('swapped', 'subjects')).nodes.map(({ name, subject }) => ({ name, subject }))).toEqual([{ name: 'a', subject: 'subject-y' }, { name: 'b', subject: 'subject-x' }]);
});
