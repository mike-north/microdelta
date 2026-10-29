/** Ordinary-consumer v1 recipe assertions use literal wire fixtures and standard language facilities only. */
import { expect, test } from '@jest/globals';

import { readHistoryResultDocument } from './read-result-consumer.js';

/** The consumer already knows what exact selection it requested. */
const selection = { location: '/history.sqlite', logicalStore: 'store', reference: { kind: 'completed-result', locator: 'opaque' }, operation: 'value', address: [{ kind: 'property', key: 'selected' }] };
/** Only framework metadata is JSON; a selected fact remains its explicit tagged snapshot string. */
function document(snapshot: string): string { return `${JSON.stringify({ format: 'microdelta.history-result-read', formatVersion: 1, selection, result: { kind: 'fact', encoding: 'MDS1', snapshot } })}\n`; }
/** Successful undefined is a tagged result, never a falsy failure convention. */
function fact(snapshot: string): unknown { const result = readHistoryResultDocument(document(snapshot), selection); if (result.kind !== 'fact') { throw new Error('Expected a successful selected fact'); } return result.value; }

const literals: readonly (readonly [string, unknown])[] = [
  ['MDS1|["u"]', undefined], ['MDS1|["n"]', null], ['MDS1|["t"]', true], ['MDS1|["f"]', false], ['MDS1|["s",""]', ''], ['MDS1|["s","literal/__proto__"]', 'literal/__proto__'], ['MDS1|["d","0"]', 0], ['MDS1|["d","-0"]', -0], ['MDS1|["d","NaN"]', Number.NaN], ['MDS1|["d","+Infinity"]', Infinity], ['MDS1|["d","-Infinity"]', -Infinity], ['MDS1|["d","1e+21"]', 1e21], ['MDS1|["d","1e-7"]', 1e-7],
];
test.each(literals)('ordinary consumer independently decodes literal %s', (wire, value) => { expect(Object.is(fact(wire), value)).toBe(true); });

test('holes and own undefined remain distinct and newly decoded arrays are frozen', () => {
  const value = fact('MDS1|["a",[["h"],["u"]]]'); if (!Array.isArray(value)) { throw new Error('Expected array'); }
  expect(value).toHaveLength(2); expect(Object.hasOwn(value, '0')).toBe(false); expect(Object.hasOwn(value, '1')).toBe(true); expect(value[1]).toBeUndefined(); expect(Object.isFrozen(value)).toBe(true);
});
test('record order, literal reserved-looking keys and terminal prototypes retain their exact meaning', () => {
  const value = fact('MDS1|["o",[["b",["d","2"]],["a",["d","1"]],["__proto__",["s","literal"]],["constructor",["s","data"]],["",["n"]]],["p-object"]]');
  if (typeof value !== 'object' || value === null) { throw new Error('Expected record'); }
  expect(Object.keys(value)).toEqual(['b', 'a', '__proto__', 'constructor', '']); expect(Object.getPrototypeOf(value)).toBe(Object.prototype); expect(Object.hasOwn(value, '__proto__')).toBe(true); expect(Object.getOwnPropertyDescriptor(value, '__proto__')?.value).toBe('literal'); expect(Object.isFrozen(value)).toBe(true);
  const bare = fact('MDS1|["o",[["__proto__",["s","literal"]]],["p-null"]]');
  if (typeof bare !== 'object' || bare === null) { throw new Error('Expected null-prototype record'); }
  expect(Object.getPrototypeOf(bare)).toBeNull(); expect(Object.hasOwn(bare, '__proto__')).toBe(true); expect(Object.isFrozen(Object.prototype)).toBe(false);
});
test('custom data prototypes and two custom edges remain frozen without flattening inherited data', () => {
  const value = fact('MDS1|["o",[["own",["f"]]],["p-custom",["o",[["inherited",["d","0"]]],["p-custom",["o",[["grand",["s","two"]]],["p-null"]]]]]]');
  if (typeof value !== 'object' || value === null) { throw new Error('Expected record'); }
  const parent: unknown = Object.getPrototypeOf(value); if (typeof parent !== 'object' || parent === null) { throw new Error('Expected custom prototype'); }
  const grand: unknown = Object.getPrototypeOf(parent); if (typeof grand !== 'object' || grand === null) { throw new Error('Expected second custom prototype'); }
  expect(Object.keys(value)).toEqual(['own']); expect(Object.hasOwn(value, 'inherited')).toBe(false); expect(Reflect.get(value, 'inherited')).toBe(0); expect(Object.getPrototypeOf(grand)).toBeNull(); expect([value, parent, grand].every(item => Object.isFrozen(item))).toBe(true);
});
test('equal distinct subtrees remain separate objects and integer-like own keys use standard order', () => {
  const value = fact('MDS1|["o",[["2",["s","two"]],["10",["s","ten"]],["a",["o",[],["p-null"]]],["b",["o",[],["p-null"]]]],["p-object"]]');
  if (typeof value !== 'object' || value === null) { throw new Error('Expected record'); }
  expect(Object.keys(value)).toEqual(['2', '10', 'a', 'b']); expect(Reflect.get(value, 'a')).not.toBe(Reflect.get(value, 'b'));
});

/** Canonical tree shape is validated independently of the production encoder or decoder. */
const invalidTrees: readonly unknown[] = [
  null, true, 1, {}, [], ['u', 0], ['n', 'extra'], ['t', 'extra'], ['f', 'extra'], ['s'], ['s', 0], ['s', 'x', 'extra'], ['d'], ['d', 0], ['d', '1', 'extra'], ['unknown'], ['h'], ['p-null'], ['p-object'], ['p-custom', ['o', [], ['p-null']]], ['a'], ['a', {}], ['a', [], 0], ['a', [['h', 'extra']]], ['o'], ['o', {}, ['p-null']], ['o', [], ['p-null'], 0], ['o', [['x']], ['p-null']], ['o', [[], ['x', ['n']]], ['p-null']], ['o', [['x', ['n'], 'extra']], ['p-null']], ['o', [[1, ['u']]], ['p-null']], ['o', [['x', ['h']]], ['p-null']], ['o', [['x', ['p-null']]], ['p-null']], ['o', [['x', ['u']], ['x', ['n']]], ['p-null']], ['o', [['__proto__', ['u']], ['__proto__', ['n']]], ['p-null']], ['o', [['10', ['u']], ['2', ['n']]], ['p-null']], ['o', [], []], ['o', [], 'p-null'], ['o', [], ['p-null', 'extra']], ['o', [], ['p-object', 'extra']], ['o', [], ['other']], ['o', [], ['p-custom']], ['o', [], ['p-custom', {}, 'extra']], ['o', [], ['p-custom', {}]], ['o', [], ['p-custom', ['a', []]]], ['o', [], ['p-custom', ['n']]],
];
test.each(invalidTrees.map(tree => ({ tree })))('recipe rejects unsupported exact tagged shape $tree', ({ tree }) => { expect(() => fact(`MDS1|${JSON.stringify(tree)}`)).toThrow(); });
test.each(['01', '+1', '1.0', '1E+21', 'Infinity', '-NaN', ' 1', '', '1e999'])('recipe rejects noncanonical Number token %s', token => { expect(() => fact(`MDS1|${JSON.stringify(['d', token])}`)).toThrow(); });
test.each(['MDS2|["u"]', 'MDV1|["u"]', 'MDS1| ["u"]', 'MDS1|[ "u"]', 'MDS1|["s","\\u0061"]', 'MDS1|["s","\\/"]', 'MDS1|["u"] trailing', 'MDS1|["u"]\n'])('recipe rejects unsupported prefix or noncanonical snapshot %s', snapshot => { expect(() => fact(snapshot)).toThrow(); });
test('custom-depth validation carries through properties and arrays rather than resetting at a nested value', () => {
  const direct = ['o', [], ['p-custom', ['o', [], ['p-custom', ['o', [], ['p-custom', ['o', [], ['p-null']]]]]]]];
  expect(() => fact(`MDS1|${JSON.stringify(direct)}`)).toThrow();
  const root = ['o', [], ['p-custom', ['o', [['nested', ['a', [['o', [], ['p-custom', ['o', [], ['p-custom', ['o', [], ['p-null']]]]]]]]]], ['p-null']]]];
  expect(() => fact(`MDS1|${JSON.stringify(root)}`)).toThrow();
});
test('outer command schema, selection identity and framing are validated before any value is returned', () => {
  const base = { format: 'microdelta.history-result-read', formatVersion: 1, selection, result: { kind: 'fact', encoding: 'MDS1', snapshot: 'MDS1|["u"]' } };
  const bad = [{ ...base, formatVersion: 2 }, { ...base, extra: true }, { ...base, result: { ...base.result, encoding: 'other' } }, { ...base, result: { ...base.result, extra: true } }, { ...base, selection: { ...selection, logicalStore: 'foreign' } }, { ...base, selection: { ...selection, extra: true } }, { ...base, result: { kind: 'failed', code: 'invented' } }];
  for (const value of bad) { expect(() => readHistoryResultDocument(`${JSON.stringify(value)}\n`, selection)).toThrow(); }
  expect(() => readHistoryResultDocument(JSON.stringify(base), selection)).toThrow(); expect(() => readHistoryResultDocument(`${JSON.stringify(base)}\n{}\n`, selection)).toThrow();
  const result = readHistoryResultDocument(`${JSON.stringify({ ...base, result: { kind: 'failed', code: 'integrity' } })}\n`, selection); expect(result).toEqual({ kind: 'failed', code: 'integrity' });
});
