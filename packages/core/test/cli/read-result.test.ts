/** Installed exact-result command acceptance: ordinary History publishes the data; consumers select immutable facts. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, expect, test } from '@jest/globals';
import type { ICompletedResultReference, IDurableHistory, IWriterLease } from '@microdelta/history';
import type { IAddressSegment, IOperation } from '@microdelta/value';

import { cleanup, logicalStore, openHistory, provenance, scope } from '../durable-history/support.js';

/** The installed bin belongs to the package being tested, without a test-only command entry point. */
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** Each suite owns its consumer directory and small ordinary History store. */
const directory = mkdtempSync(join(tmpdir(), 'microdelta-read-result-'));
const location = join(directory, 'history.sqlite');
/** References are returned by actual publication, never manufactured locators or rows. */
let retained: ICompletedResultReference;

/** Literal structured paths keep punctuation, empty strings and reserved-looking keys as data. */
function property(key: string): readonly IAddressSegment[] { return [{ kind: 'property', key }]; }
/** Every object/prototype occurrence is distinct so the ordinary Value tree contract remains meaningful. */
function payload() {
  const sparse = new Array<unknown>(2); sparse[1] = undefined;
  const bare = {}; Object.setPrototypeOf(bare, null);
  Object.defineProperty(bare, '__proto__', { value: 'literal', enumerable: true });
  const inherited = { inherited: 0 }; Object.setPrototypeOf(inherited, null);
  const custom = { own: false }; Object.setPrototypeOf(custom, inherited);
  const grand = { grand: 'two' }; Object.setPrototypeOf(grand, null);
  const parent = { parent: 'one' }; Object.setPrototypeOf(parent, grand);
  const two = { own: 'leaf' }; Object.setPrototypeOf(two, parent);
  const nestedPrototype = { inherited: 'nested' }; Object.setPrototypeOf(nestedPrototype, null);
  const nested = { own: true }; Object.setPrototypeOf(nested, nestedPrototype);
  const outerPrototype = { nested }; Object.setPrototypeOf(outerPrototype, null);
  const accumulated = { own: 'outer' }; Object.setPrototypeOf(accumulated, outerPrototype);
  return { zero: 0, negativeZero: -0, nan: Number.NaN, positiveInfinity: Infinity, negativeInfinity: -Infinity, present: undefined, nothing: null, false: false, empty: '', list: sparse, orderedRecord: { b: 2, a: 1 }, integerKeys: { '10': 'ten', '2': 'two', b: 'last' }, bare, custom, two, accumulated, equalPair: { a: { n: 1 }, b: { n: 1 } }, '': 'empty-key', 'a.b/c': 'punctuation', constructor: 'literal-constructor', unrelated: 'x'.repeat(100_000) };
}
/** Publish under one genuine lease using existing allocation/staging/publication semantics. */
function publish(history: IDurableHistory, lease: IWriterLease, key: string, value: unknown): ICompletedResultReference {
  const attempt = history.allocateAttempt(lease, { ...scope, subject: 'subject:cli-result', version: 1, attemptKey: key, intentDigest: key });
  history.stageAttempt(lease, { attemptId: attempt.attemptId, payload: value, provenance: provenance(key), dependencies: [] });
  return history.publishAttempt(lease, attempt.attemptId);
}
/** Only the package's installed executable receives command authority. */
function invoke(operation: IOperation, address: readonly IAddressSegment[], reference = retained) {
  return spawnSync(join(directory, 'node_modules/.bin/microdelta'), ['read-result', '--location', location, '--logical-store', logicalStore, '--reference', reference.locator, '--operation', operation, '--address', JSON.stringify(address)], { cwd: directory, encoding: 'utf8', timeout: 10_000 });
}
/** Success is a closed fact envelope, independent of author-value truthiness. */
function document(operation: IOperation, address: readonly IAddressSegment[], snapshot: string) {
  return { format: 'microdelta.history-result-read', formatVersion: 1, selection: { location, logicalStore, reference: retained, operation, address }, result: { kind: 'fact', encoding: 'MDS1', snapshot } };
}

beforeAll(() => {
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'exact-result-consumer', private: true, type: 'module' }));
  const installed = spawnSync('npm', ['install', '--prefix', directory, '--ignore-scripts', '--offline', '--package-lock=false', '--no-audit', '--no-fund', packageRoot], { encoding: 'utf8' });
  if (installed.status !== 0) { throw new Error(`Consumer installation failed: ${installed.stderr}`); }
  expect(installed.error).toBeUndefined(); expect(installed.status).toBe(0);
  writeFileSync(join(directory, 'analysis.mjs'), "throw new Error('author module must never load');\n");
  writeFileSync(join(directory, 'accounting.sqlite'), 'unrelated application data');
  // Copy the standard-language recipe into the ordinary consumer directory.
  // Its module has no package imports or private codec/declaration access.
  copyFileSync(new URL('./read-result-consumer.js', import.meta.url), join(directory, 'consumer.mjs'));
  writeFileSync(join(directory, 'consume.mjs'), `import { readFileSync } from 'node:fs';
import { readHistoryResultDocument } from './consumer.mjs';
const expected = JSON.parse(process.argv[2]);
const result = readHistoryResultDocument(readFileSync(0, 'utf8'), expected);
if (result.kind !== 'fact') { throw new Error('Expected successful exact fact'); }
const value = result.value; const mode = process.argv[3];
function check(condition) { if (!condition) { throw new Error('Independent consumer semantic check failed: ' + mode); } }
if (mode === 'undefined') { check(value === undefined); }
else if (mode === 'negative-zero') { check(Object.is(value, -0)); }
else if (mode === 'nan') { check(Number.isNaN(value)); }
else if (mode === 'positive-infinity') { check(value === Infinity); }
else if (mode === 'negative-infinity') { check(value === -Infinity); }
else if (mode === 'sparse') { check(Array.isArray(value) && value.length === 2 && !Object.hasOwn(value, '0') && Object.hasOwn(value, '1') && value[1] === undefined && Object.isFrozen(value)); }
else if (mode === 'ordered') { check(JSON.stringify(Object.keys(value)) === '["b","a"]' && Object.getPrototypeOf(value) === Object.prototype); }
else if (mode === 'integer') { check(JSON.stringify(Object.keys(value)) === '["2","10","b"]'); }
else if (mode === 'bare') { check(Object.getPrototypeOf(value) === null && Object.hasOwn(value, '__proto__') && value.__proto__ === 'literal'); }
else if (mode === 'custom') { check(value.own === false && value.inherited === 0 && !Object.hasOwn(value, 'inherited') && Object.getPrototypeOf(Object.getPrototypeOf(value)) === null); }
else if (mode === 'two') { check(value.own === 'leaf' && value.parent === 'one' && value.grand === 'two' && Object.isFrozen(Object.getPrototypeOf(value)) && Object.isFrozen(Object.getPrototypeOf(Object.getPrototypeOf(value)))); }
else if (mode === 'accumulated') { const parent = Object.getPrototypeOf(value); check(parent.nested.own === true && parent.nested.inherited === 'nested' && Object.isFrozen(parent.nested) && Object.isFrozen(Object.getPrototypeOf(parent.nested))); }
else if (mode === 'distinct') { check(value.a !== value.b && value.a.n === 1 && value.b.n === 1); }
else { throw new Error('Unknown independent check'); }
check(!Object.isFrozen(Object.prototype)); process.stdout.write(JSON.stringify({ kind: result.kind, checked: mode }) + '\\n');
`);
  const history = openHistory({ location });
  const acquired = history.acquireWriter({ holder: 'cli-fixture', leaseMilliseconds: 10_000 });
  if (acquired.kind !== 'acquired') { throw new Error('Fixture writer was not acquired'); }
  retained = publish(history, acquired.lease, 'retained', payload());
  publish(history, acquired.lease, 'later', { zero: 99 });
  history.close();
});
afterAll(() => { cleanup(); rmSync(directory, { recursive: true, force: true }); });

/** Expectations are independent literal wire examples from the selected command contract. */
const scalarCases: readonly (readonly [string, string])[] = [
  ['present', 'MDS1|["u"]'], ['nothing', 'MDS1|["n"]'], ['false', 'MDS1|["f"]'], ['zero', 'MDS1|["d","0"]'], ['negativeZero', 'MDS1|["d","-0"]'], ['nan', 'MDS1|["d","NaN"]'], ['positiveInfinity', 'MDS1|["d","+Infinity"]'], ['negativeInfinity', 'MDS1|["d","-Infinity"]'], ['empty', 'MDS1|["s",""]'], ['', 'MDS1|["s","empty-key"]'], ['a.b/c', 'MDS1|["s","punctuation"]'], ['constructor', 'MDS1|["s","literal-constructor"]'],
];
test.each(scalarCases)('installed exact value %s preserves its literal v1 wire after a later publication', (key, snapshot) => {
  const before = readFileSync(location); const result = invoke('value', property(key));
  expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe('');
  const parsed: unknown = JSON.parse(result.stdout); expect(parsed).toEqual(document('value', property(key), snapshot));
  expect(result.stdout.endsWith('\n')).toBe(true); expect(result.stdout.split('\n')).toHaveLength(2);
  expect(readFileSync(location)).toEqual(before);
  expect(readFileSync(join(directory, 'analysis.mjs'), 'utf8')).toContain('author module must never load');
  expect(readFileSync(join(directory, 'accounting.sqlite'), 'utf8')).toBe('unrelated application data');
});

/** Each operation has its own meaning; absence is not inferred from an undefined value. */
const operationCases: readonly (readonly [IOperation, readonly IAddressSegment[], string])[] = [
  ['own', property('present'), 'MDS1|["t"]'],
  ['own', [...property('custom'), { kind: 'property', key: 'inherited' }], 'MDS1|["f"]'],
  ['membership', [...property('custom'), { kind: 'property', key: 'inherited' }], 'MDS1|["t"]'],
  ['own', [...property('list'), { kind: 'index', index: 0 }], 'MDS1|["f"]'],
  ['own', [...property('list'), { kind: 'index', index: 1 }], 'MDS1|["t"]'],
  ['length', property('list'), 'MDS1|["d","2"]'],
  ['keys', property('orderedRecord'), 'MDS1|["a",[["s","b"],["s","a"]]]'],
  ['keys', property('integerKeys'), 'MDS1|["a",[["s","2"],["s","10"],["s","b"]]]'],
  ['container-kind', [], 'MDS1|["s","record"]'],
  ['container-kind', property('list'), 'MDS1|["s","array"]'],
  ['container-kind', property('zero'), 'MDS1|["s","scalar"]'],
  ['value', property('list'), 'MDS1|["a",[["h"],["u"]]]'],
  ['value', property('orderedRecord'), 'MDS1|["o",[["b",["d","2"]],["a",["d","1"]]],["p-object"]]'],
  ['value', property('bare'), 'MDS1|["o",[["__proto__",["s","literal"]]],["p-null"]]'],
  ['value', property('custom'), 'MDS1|["o",[["own",["f"]]],["p-custom",["o",[["inherited",["d","0"]]],["p-null"]]]]'],
];
test.each(operationCases)('installed operation %s at %j preserves the selected fact', (operation, address, snapshot) => {
  const result = invoke(operation, address); expect(result.status).toBe(0); expect(result.stderr).toBe('');
  const parsed: unknown = JSON.parse(result.stdout); expect(parsed).toEqual(document(operation, address, snapshot));
});

test('bare-root value stays an owner selection failure and a missing file stays missing', () => {
  const invalid = invoke('value', []); expect(invalid.status).toBe(1); expect(invalid.stderr).toBe('');
  const failed: unknown = JSON.parse(invalid.stdout); expect(failed).toEqual({ ...document('value', [], ''), result: { kind: 'failed', code: 'failed' } });
  const absent = join(directory, 'missing.sqlite');
  const result = spawnSync(join(directory, 'node_modules/.bin/microdelta'), ['read-result', '--location', absent, '--logical-store', logicalStore, '--reference', retained.locator, '--operation', 'value', '--address', JSON.stringify(property('zero'))], { cwd: directory, encoding: 'utf8', timeout: 10_000 });
  expect(result.status).toBe(1); expect(result.stderr).toBe(''); expect(existsSync(absent)).toBe(false);
  const missing: unknown = JSON.parse(result.stdout); expect(missing).toEqual({ ...document('value', property('zero'), ''), selection: { location: absent, logicalStore, reference: retained, operation: 'value', address: property('zero') }, result: { kind: 'failed', code: 'absent' } });
});

/** Actual stdout is decoded by another process using no repository package or generated type path. */
const externalCases: readonly (readonly [string, string])[] = [['present', 'undefined'], ['negativeZero', 'negative-zero'], ['nan', 'nan'], ['positiveInfinity', 'positive-infinity'], ['negativeInfinity', 'negative-infinity'], ['list', 'sparse'], ['orderedRecord', 'ordered'], ['integerKeys', 'integer'], ['bare', 'bare'], ['custom', 'custom'], ['two', 'two'], ['accumulated', 'accumulated'], ['equalPair', 'distinct']];
test.each(externalCases)('ordinary external consumer interprets selected %s as %s without private imports', (key, mode) => {
  const result = invoke('value', property(key)); expect(result.status).toBe(0);
  const expected = { location, logicalStore, reference: retained, operation: 'value', address: property(key) };
  const consumed = spawnSync(process.execPath, [join(directory, 'consume.mjs'), JSON.stringify(expected), mode], { cwd: directory, input: result.stdout, encoding: 'utf8', timeout: 10_000 });
  expect(consumed.error).toBeUndefined(); expect(consumed.status).toBe(0); expect(consumed.stderr).toBe(''); expect(consumed.stdout).toBe(`${JSON.stringify({ kind: 'fact', checked: mode })}\n`);
  const recipe = readFileSync(join(directory, 'consumer.mjs'), 'utf8'); expect(recipe).not.toMatch(/\bimport\s/u); expect(recipe).not.toContain('@microdelta');
});

test('installed reading beside an active ordinary WAL writer preserves exactness and permits subsequent publication', () => {
  const activeLocation = join(directory, 'active.sqlite'); const writer = openHistory({ location: activeLocation });
  try {
    const acquired = writer.acquireWriter({ holder: 'active-fixture', leaseMilliseconds: 10_000 }); if (acquired.kind !== 'acquired') { throw new Error('Active writer unavailable'); }
    const original = publish(writer, acquired.lease, 'active-first', { selected: 'first', unrelated: 'large'.repeat(25_000) });
    const later = publish(writer, acquired.lease, 'active-later', { selected: 'later' });
    expect(existsSync(`${activeLocation}-wal`)).toBe(true);
    const before = readFileSync(activeLocation); const walBefore = readFileSync(`${activeLocation}-wal`);
    const result = spawnSync(join(directory, 'node_modules/.bin/microdelta'), ['read-result', '--location', activeLocation, '--logical-store', logicalStore, '--reference', original.locator, '--operation', 'value', '--address', JSON.stringify(property('selected'))], { cwd: directory, encoding: 'utf8', timeout: 10_000 });
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe(''); const parsed: unknown = JSON.parse(result.stdout); expect(parsed).toMatchObject({ selection: { reference: original }, result: { kind: 'fact', snapshot: 'MDS1|["s","first"]' } });
    expect(readFileSync(activeLocation)).toEqual(before); expect(readFileSync(`${activeLocation}-wal`)).toEqual(walBefore);
    const next = publish(writer, acquired.lease, 'after-read', { selected: 'after-read' }); expect(next).not.toEqual(later);
  } finally { writer.close(); }
});

test('installed exact-reference/schema/corrupt refusals do not become successful misses or expose diagnostics', () => {
  const wrong = invoke('value', property('zero'), { kind: 'completed-result', locator: 'not-a-locator' }); expect(wrong.status).toBe(1); const wrongDocument: unknown = JSON.parse(wrong.stdout); expect(wrongDocument).toMatchObject({ result: { kind: 'failed', code: 'integrity' } });
  const base = ['read-result', '--location', location, '--logical-store', 'foreign-store', '--reference', retained.locator, '--operation', 'value', '--address', JSON.stringify(property('zero'))];
  const schema = spawnSync(join(directory, 'node_modules/.bin/microdelta'), base, { cwd: directory, encoding: 'utf8', timeout: 10_000 }); expect(schema.status).toBe(1); const schemaDocument: unknown = JSON.parse(schema.stdout); expect(schemaDocument).toMatchObject({ result: { kind: 'failed', code: 'schema' } });
  const corrupt = join(directory, 'corrupt.sqlite'); writeFileSync(corrupt, 'not sqlite'); const before = readFileSync(corrupt);
  const broken = spawnSync(join(directory, 'node_modules/.bin/microdelta'), base.map(value => value === location ? corrupt : value), { cwd: directory, encoding: 'utf8', timeout: 10_000 }); expect(broken.status).toBe(1); const corruptDocument: unknown = JSON.parse(broken.stdout); expect(corruptDocument).toMatchObject({ result: { kind: 'failed', code: 'corrupt' } }); expect(readFileSync(corrupt)).toEqual(before); expect([wrong, schema, broken].every(result => result.stderr === '')).toBe(true);
});
