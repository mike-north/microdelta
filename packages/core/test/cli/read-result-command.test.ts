/** Injected command-boundary assertions separate grammar/transport failures from real storage evidence. */
import { readFileSync } from 'node:fs';

import { describe, expect, test } from '@jest/globals';
import { HistoryBusyError, HistoryIntegrityError, HistorySchemaError } from '@microdelta/history';
import { SqliteBusyError, SqliteReadError } from '@microdelta/machine';

import { _runHistoryResultRead } from '../../src/cli-read-result.js';

/** These narrow injected ports grant no module, process-control, workspace or writer operations. */
type IHost = Parameters<typeof _runHistoryResultRead>[0];
type IPorts = Parameters<typeof _runHistoryResultRead>[1];
/** One complete valid invocation deliberately retains whitespace and an opaque locator. */
const valid = ['read-result', '--location', 'relative.sqlite', '--logical-store', ' store ', '--reference', 'opaque-reference', '--operation', 'value', '--address', '[{"kind":"property","key":"zero"}]'];
/** Each fixture reports exact call counts without turning instrumentation into owner authority. */
function fixture(arguments_: readonly string[] = valid, faults: { readonly stdout?: boolean; readonly stderr?: boolean; readonly path?: boolean } = {}) {
  const stdout: string[] = []; const stderr: string[] = []; const paths: string[] = []; const events: string[] = [];
  let exit: number | undefined; let reads = 0; let encodes = 0;
  const host: IHost = { arguments: arguments_, writeStdout(value) { events.push('stdout'); if (faults.stdout) { throw undefined; } stdout.push(value); }, writeStderr(value) { events.push('stderr'); if (faults.stderr) { throw undefined; } stderr.push(value); }, resolvePath(value) { paths.push(value); if (faults.path) { throw undefined; } return '/resolved/history.sqlite'; }, setExitCode(value) { exit = value; } };
  const ports: IPorts = { read(location, request) { reads += 1; expect(location).toEqual({ location: '/resolved/history.sqlite', logicalStore: ' store ' }); expect(request).toEqual({ kind: 'fact', reference: { kind: 'completed-result', locator: 'opaque-reference' }, request: { operation: 'value', address: [{ kind: 'property', key: 'zero' }] } }); events.push('released'); return { kind: 'fact', selected: { operation: 'value', address: [{ kind: 'property', key: 'zero' }], fact: 0 } }; }, encode(value) { encodes += 1; expect(events).toEqual(['released']); expect(value).toBe(0); return 'MDS1|["d","0"]'; } };
  return { host, ports, stdout, stderr, paths, events, counts: () => ({ exit, reads, encodes }) };
}
/** Fixed metadata and coded failures never serialize the original thrown value. */
function parsed(text: string | undefined): unknown { if (text === undefined) { throw new Error('Expected one output document'); } const value: unknown = JSON.parse(text); return value; }

test('one fact read is released before encoding and one complete output write', () => {
  const supplied = fixture(); _runHistoryResultRead(supplied.host, supplied.ports);
  expect(supplied.counts()).toEqual({ exit: 0, reads: 1, encodes: 1 }); expect(supplied.paths).toEqual(['relative.sqlite']); expect(supplied.stderr).toEqual([]); expect(supplied.stdout).toHaveLength(1);
  expect(parsed(supplied.stdout[0])).toEqual({ format: 'microdelta.history-result-read', formatVersion: 1, selection: { location: '/resolved/history.sqlite', logicalStore: ' store ', reference: { kind: 'completed-result', locator: 'opaque-reference' }, operation: 'value', address: [{ kind: 'property', key: 'zero' }] }, result: { kind: 'fact', encoding: 'MDS1', snapshot: 'MDS1|["d","0"]' } });
  expect(supplied.events).toEqual(['released', 'stdout']);
});

/** Invalid literal structures must be refused before even resolving the selected path. */
const invalidAddresses = ['{', '{}', 'null', '[null]', '[[]]', '[{"kind":"property"}]', '[{"kind":"property","key":1}]', '[{"kind":"property","key":"x","extra":0}]', '[{"kind":"index","index":"0"}]', '[{"kind":"index","index":-1}]', '[{"kind":"index","index":1.5}]', '[{"kind":"index","index":9007199254740992}]', '[{"kind":"index","index":1e999}]', '[{"kind":"other","key":"x"}]', '[{"kind":"index","index":0,"key":"x"}]'];
describe('closed command grammar', () => {
  test.each(invalidAddresses)('address %s is rejected before resolution/read', address => {
    const supplied = fixture([...valid.slice(0, -1), address]); _runHistoryResultRead(supplied.host, supplied.ports);
    expect(supplied.counts()).toEqual({ exit: 2, reads: 0, encodes: 0 }); expect(supplied.paths).toEqual([]); expect(supplied.stdout).toEqual([]); expect(supplied.stderr).toHaveLength(1); expect(supplied.stderr[0]).toContain('WAL/SHM');
  });
  test.each([[], ['read-result'], valid.slice(0, -1), [...valid, 'extra'], [...valid, '--location', 'second'], [...valid, '--module', 'program.mjs'], [...valid, '--sql', 'SELECT 1'], [...valid, '--follow'], [...valid, '--'], ['read-result', '--location=relative.sqlite', ...valid.slice(3)], valid.map(value => value === '--reference' ? '--current' : value), valid.map(value => value === 'value' ? 'fingerprint' : value), valid.map(value => value === ' store ' ? '' : value)].map(args => ({ args })))('invalid arguments $args never receive read authority', ({ args }) => {
    const supplied = fixture(args); _runHistoryResultRead(supplied.host, supplied.ports); expect(supplied.counts()).toEqual({ exit: 2, reads: 0, encodes: 0 }); expect(supplied.paths).toEqual([]); expect(supplied.stdout).toEqual([]);
  });
  test('flag order, empty/literal property keys and parsed negative-zero indices remain supported', () => {
    const args = ['read-result', '--address', '[{"kind":"property","key":""},{"kind":"property","key":"__proto__"},{"kind":"property","key":"a.b/c"},{"kind":"index","index":-0}]', '--operation', 'own', '--reference', 'opaque', '--logical-store', 'literal', '--location', '--literal-path'];
    const supplied = fixture(args); let calls = 0;
    _runHistoryResultRead(supplied.host, { read(location, query) { calls += 1; expect(location.logicalStore).toBe('literal'); expect(query.request).toEqual({ operation: 'own', address: [{ kind: 'property', key: '' }, { kind: 'property', key: '__proto__' }, { kind: 'property', key: 'a.b/c' }, { kind: 'index', index: -0 }] }); return { kind: 'fact', selected: { operation: 'own', address: [], fact: false } }; }, encode: () => 'MDS1|["f"]' });
    expect(calls).toBe(1); expect(supplied.paths).toEqual(['--literal-path']); expect(supplied.counts().exit).toBe(0); expect(supplied.stdout[0]).toContain('"index":0');
  });
});

/** Class identity is deliberately contrasted with forged diagnostic names and secret-bearing messages. */
const failures: readonly (readonly [unknown, string])[] = [
  ...(['absent', 'unsupported', 'corrupt', 'recovery-required'] satisfies readonly SqliteReadError['code'][]).map(code => [new SqliteReadError(code, 'secret'), code] satisfies readonly [unknown, string]),
  [new HistoryBusyError('secret', new SqliteBusyError('secret', 1)), 'busy'], [new HistorySchemaError('secret'), 'schema'], [new HistoryIntegrityError('secret'), 'integrity'], [new AggregateError([new SqliteReadError('absent', 'secret'), undefined], 'secret'), 'multiple-failures'], [undefined, 'failed'], [new TypeError('secret'), 'failed'], [Object.assign(new Error('secret'), { name: 'HistorySchemaError' }), 'failed'],
];
test.each(failures)('actual thrown value %p has only safe code %s and no retry', (failure, code) => {
  const supplied = fixture(); let calls = 0;
  _runHistoryResultRead(supplied.host, { ...supplied.ports, read() { calls += 1; throw failure; } });
  expect(calls).toBe(1); expect(supplied.counts()).toEqual({ exit: 1, reads: 0, encodes: 0 }); expect(supplied.stderr).toEqual([]); expect(supplied.stdout).toHaveLength(1); expect(parsed(supplied.stdout[0])).toMatchObject({ result: { kind: 'failed', code } }); expect(supplied.stdout[0]).not.toContain('secret');
});

/** Fault names describe transport phase, without widening the finite host's authority. */
const transportFaults: readonly ('path' | 'encoding' | 'stdout' | 'stderr-invalid' | 'stderr-path')[] = ['path', 'encoding', 'stdout', 'stderr-invalid', 'stderr-path'];
test.each(transportFaults)('injected %s failure cannot retry a read or recursively report failure', selected => {
  const supplied = fixture(selected === 'stderr-invalid' ? [] : valid, { path: selected === 'path' || selected === 'stderr-path', stdout: selected === 'stdout', stderr: selected === 'stderr-invalid' || selected === 'stderr-path' });
  let calls = 0;
  _runHistoryResultRead(supplied.host, { read(...args) { calls += 1; return supplied.ports.read(...args); }, encode(value) { if (selected === 'encoding') { throw undefined; } return supplied.ports.encode(value); } });
  expect(supplied.counts().exit).toBe(1); expect(calls).toBe(selected === 'path' || selected === 'stderr-path' || selected === 'stderr-invalid' ? 0 : 1); expect(supplied.stdout).toEqual([]); expect(supplied.events.filter(value => value === 'stdout').length).toBeLessThanOrEqual(1); expect(supplied.events.filter(value => value === 'stderr')).toHaveLength(1);
});

test('the constructor-owning Machine package is a direct runtime dependency at its exact workspace version', () => {
  const core: unknown = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  const machine: unknown = JSON.parse(readFileSync(new URL('../../../../machine/package.json', import.meta.url), 'utf8'));
  if (typeof machine !== 'object' || machine === null || !('version' in machine)) { throw new Error('Machine version missing'); }
  expect(core).toMatchObject({ dependencies: { '@microdelta/machine': machine.version } });
});
