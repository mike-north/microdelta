/** Finite selection outcomes and refusal boundaries over real History files. @packageDocumentation */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from '@jest/globals';
import { HistoryBusyError, HistoryIntegrityError, HistorySchemaError, readHistorySelection } from '@microdelta/history';
import type { ICompletedResultReference, IHistorySelectionRequest, ISqliteCoordinatedReadCapability, ISqliteCoordinatedReadScope } from '@microdelta/history';
import { createNodeSqliteCoordinatedReader } from '@microdelta/machine-node';
import { encodeSelectedFact, fingerprint, observe } from '@microdelta/value';
import type { IAddressSegment, IOperation } from '@microdelta/value';
import { cleanup, domainRecord, freshLocation, logicalStore, machine, openHistory, openRaw, provenance, scope } from '../durable-history/support.js';

afterEach(cleanup);
/** Read-only statement shape reached through History's declared host port. */
type ISqliteReadStatement = ReturnType<ISqliteCoordinatedReadScope['prepare']>;
/** A property path addresses Value data without interpreting its keys. */
function path(...keys: readonly string[]): readonly IAddressSegment[] {
  return keys.map((key) => ({ kind: 'property', key }));
}
/** Publish one completed immutable result using the ordinary History authority. */
function fixture(location: string, payload: unknown): ICompletedResultReference {
  const writer = openHistory({ location });
  const acquired = writer.acquireWriter({ holder: 'writer', leaseMilliseconds: 10_000 });
  if (acquired.kind !== 'acquired') {
    throw new Error('writer lease unavailable');
  }
  const attempt = writer.allocateAttempt(acquired.lease, { ...scope, subject: 'subject:selection', version: 1, attemptKey: 'one', intentDigest: 'intent:one' });
  writer.stageAttempt(acquired.lease, { attemptId: attempt.attemptId, payload, provenance: provenance('one'), dependencies: [] });
  const reference = writer.publishAttempt(acquired.lease, attempt.attemptId);
  writer.close();
  return reference;
}
/** The operation owns and releases the injected host scope. */
function select(location: string, selection: IHistorySelectionRequest, sqlite: ISqliteCoordinatedReadCapability = createNodeSqliteCoordinatedReader()): ReturnType<typeof readHistorySelection> {
  return readHistorySelection({ location, logicalStore, sqlite, sha256: machine }, selection);
}
/** A fixture mutation bypasses immutability only while constructing damaged input. */
function tamper(location: string, sql: string): void {
  const raw = openRaw(location);
  const triggers = raw.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all();
  raw.exec('PRAGMA foreign_keys = OFF');
  for (const trigger of triggers) {
    raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
  }
  raw.exec(`PRAGMA ignore_check_constraints = ON; ${sql}; PRAGMA ignore_check_constraints = OFF`);
  for (const trigger of triggers) {
    raw.exec(String(trigger.sql));
  }
  raw.exec('PRAGMA foreign_keys = ON');
  raw.close();
}
/** Observe the exact error without changing its identity or inferring a diagnosis. */
function thrown(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected failure');
}
/** Inject a query failure at a real scope while leaving all other native reads intact. */
function failingQuery(match: (sql: string) => boolean, failure: Error): ISqliteCoordinatedReadCapability {
  const real = createNodeSqliteCoordinatedReader();
  return {
    openSqliteCoordinatedRead(location): ISqliteCoordinatedReadScope {
      const scope = real.openSqliteCoordinatedRead(location);
      return {
        begin: () => scope.begin(), end: () => scope.end(), close: () => scope.close(),
        prepare(sql): ISqliteReadStatement {
          const statement = scope.prepare(sql);
          return {
            get(...values) {
              if (match(sql)) {
                throw failure;
              }
              return statement.get(...values);
            },
            all(...values) {
              if (match(sql)) {
                throw failure;
              }
              return statement.all(...values);
            },
          };
        },
      };
    },
  };
}

const data = { zero: 0, missingValue: undefined, empty: '', emptyArray: [], nested: { text: 'answer', list: [1, 2] } };

test('scalar and structural answers retain Value meaning', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const cases: readonly (readonly [IOperation, readonly IAddressSegment[]])[] = [
    ['value', path('zero')], ['value', path('missingValue')], ['value', path('empty')],
    ['value', path('emptyArray')], ['value', path('nested')], ['keys', path('nested')],
    ['length', path('emptyArray')], ['membership', path('unknown')],
  ];
  for (const [operation, address] of cases) {
    const result = select(location, { kind: 'fact', reference, request: { operation, address } });
    expect(result).toEqual({ kind: 'fact', selected: observe(data, address, operation) });
    expect('reader' in result).toBe(false);
    if (result.kind === 'fact' && operation === 'value' && address[0]?.kind === 'property' && address[0].key === 'nested') {
      expect(result.selected.fact).toEqual({ text: 'answer', list: [1, 2] });
      expect(Object.isFrozen(result.selected.fact)).toBe(true);
    }
  }
});

test('nested containers are traversable after real end and close complete without further storage calls', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const real = createNodeSqliteCoordinatedReader();
  const calls = { prepare: 0, get: 0, all: 0 };
  const completed: string[] = [];
  const sqlite: ISqliteCoordinatedReadCapability = {
    openSqliteCoordinatedRead(file): ISqliteCoordinatedReadScope {
      const scope = real.openSqliteCoordinatedRead(file);
      return {
        begin: () => scope.begin(),
        end() { scope.end(); completed.push('end'); },
        close() { scope.close(); completed.push('close'); },
        prepare(sql): ISqliteReadStatement {
          calls.prepare += 1;
          const statement = scope.prepare(sql);
          return {
            get(...values) { calls.get += 1; return statement.get(...values); },
            all(...values) { calls.all += 1; return statement.all(...values); },
          };
        },
      };
    },
  };
  const result = select(location, { kind: 'fact', reference, request: { operation: 'value', address: path('nested') } }, sqlite);
  // Completion is recorded only after the underlying native operation returns.
  // No selected container is traversed until both release actions have completed.
  expect(completed).toEqual(['end', 'close']);
  const releasedCalls = { ...calls };
  expect(releasedCalls.prepare).toBeGreaterThan(0);
  expect(releasedCalls.get).toBeGreaterThan(0);
  expect(releasedCalls.all).toBeGreaterThan(0);
  if (result.kind !== 'fact') { throw new Error('Expected a selected fact'); }
  const nested = result.selected.fact;
  if (typeof nested !== 'object' || nested === null || !('text' in nested) || !('list' in nested) || !Array.isArray(nested.list)) {
    throw new Error('Expected the selected nested container');
  }
  expect(nested.text).toBe('answer');
  const list: readonly unknown[] = nested.list;
  expect(list[0]).toBe(1);
  expect([...list]).toEqual([1, 2]);
  expect(Object.isFrozen(nested)).toBe(true);
  expect(Object.isFrozen(nested.list)).toBe(true);
  expect(calls).toEqual(releasedCalls);
});

test('missing and empty files are refused without creating or changing directory entries', () => {
  const location = freshLocation();
  const reference: ICompletedResultReference = { kind: 'completed-result', locator: 'invalid' };
  const request: IHistorySelectionRequest = { kind: 'fact', reference, request: { operation: 'value', address: path('x') } };
  const before = readdirSync(dirname(location));
  const missing = thrown(() => select(location, request));
  expect(missing).toMatchObject({ name: 'SqliteReadError' });
  expect(missing).toMatchObject({ code: 'absent' });
  expect(existsSync(location)).toBe(false);
  expect(readdirSync(dirname(location))).toEqual(before);
  writeFileSync(location, '');
  const emptyEntries = readdirSync(dirname(location));
  expect(() => select(location, request)).toThrow(HistorySchemaError);
  expect(readFileSync(location)).toHaveLength(0);
  expect(readdirSync(dirname(location))).toEqual(emptyEntries);
});

test('wrong identity and foreign or unsupported schemas preserve the main file and committed WAL', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const request: IHistorySelectionRequest = { kind: 'fact', reference, request: { operation: 'value', address: path('zero') } };
  const eligibleWriter = openRaw(location);
  eligibleWriter.exec('PRAGMA journal_mode = WAL');
  eligibleWriter.exec('BEGIN IMMEDIATE; UPDATE history_writer SET time_high_water = time_high_water + 1; COMMIT');
  const identityMain = readFileSync(location);
  const identityWal = readFileSync(`${location}-wal`);
  const identityDomain = eligibleWriter.prepare('SELECT * FROM history_identity').all();
  const resultDomain = eligibleWriter.prepare('SELECT * FROM history_results').all();
  // Nonempty committed WAL is present while the real writer connection remains open.
  expect(identityWal.length).toBeGreaterThan(32);
  const wrongIdentity = thrown(() => readHistorySelection({ location, logicalStore: 'other', sqlite: createNodeSqliteCoordinatedReader(), sha256: machine }, request));
  expect(wrongIdentity).toBeInstanceOf(HistorySchemaError);
  expect(wrongIdentity).toMatchObject({ message: 'The SQLite file holds a different logical History store' });
  expect(readFileSync(location)).toEqual(identityMain);
  expect(readFileSync(`${location}-wal`)).toEqual(identityWal);
  expect(eligibleWriter.prepare('SELECT * FROM history_identity').all()).toEqual(identityDomain);
  expect(eligibleWriter.prepare('SELECT * FROM history_results').all()).toEqual(resultDomain);
  tamper(location, 'UPDATE history_identity SET schema_version = 999');
  const raw = openRaw(location);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('CREATE TABLE extra_fixture (value TEXT)');
  const main = readFileSync(location);
  const wal = readFileSync(`${location}-wal`);
  expect(() => select(location, request)).toThrow(HistorySchemaError);
  expect(readFileSync(location)).toEqual(main);
  expect(readFileSync(`${location}-wal`)).toEqual(wal);
  expect(raw.prepare('SELECT schema_version FROM history_identity').get()).toEqual({ schema_version: 999 });
  const foreignLocation = freshLocation();
  const foreign = openRaw(foreignLocation);
  foreign.exec('PRAGMA journal_mode = WAL');
  foreign.exec("CREATE TABLE foreign_data (value TEXT); INSERT INTO foreign_data VALUES ('preserved')");
  const foreignMain = readFileSync(foreignLocation);
  const foreignWal = readFileSync(`${foreignLocation}-wal`);
  expect(() => select(foreignLocation, request)).toThrow(HistorySchemaError);
  expect(readFileSync(foreignLocation)).toEqual(foreignMain);
  expect(readFileSync(`${foreignLocation}-wal`)).toEqual(foreignWal);
  expect(foreign.prepare('SELECT value FROM foreign_data').get()).toEqual({ value: 'preserved' });
});

test('exact reference and stored encoding/index are required even for fingerprint requests', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const projection = { kind: 'projection', descriptor: { operation: 'value', address: [], traversal: { kind: 'exhaustive', complete: true } }, encoding: 'MDP1' } as const;
  expect(select(location, { kind: 'fingerprint', reference, request: projection })).toEqual({ kind: 'fingerprint', resolution: { kind: 'unavailable' } });
  for (const locator of ['invalid', `${reference.locator}extra`, `mdh1|${JSON.stringify(['other', scope.analysis, scope.environment, 1])}`, `mdh1|${JSON.stringify([logicalStore, scope.analysis, scope.environment, 999999])}`]) {
    expect(() => select(location, { kind: 'fingerprint', reference: { kind: 'completed-result', locator }, request: projection })).toThrow(HistoryIntegrityError);
  }
  tamper(location, "UPDATE history_results SET encoding = 'unsupported'");
  expect(() => select(location, { kind: 'fingerprint', reference, request: projection })).toThrow(HistoryIntegrityError);
  tamper(location, "UPDATE history_results SET encoding = 'MDS1', index_version = 999");
  expect(() => select(location, { kind: 'fingerprint', reference, request: projection })).toThrow(HistoryIntegrityError);
});

test('fingerprint semantics distinguish incompatibility, proved absence and damaged metadata', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const root = { kind: 'selected', operation: 'value', address: [], encoding: 'MDO1' } as const;
  expect(select(location, { kind: 'fingerprint', reference, request: root })).toEqual({ kind: 'fingerprint', resolution: { kind: 'incompatible' } });
  // Deliberately model a future nonprojection encoding at the runtime boundary.
  // @ts-expect-error: Runtime rejection of a future encoding is part of this contract.
  const wrongEncoding: IHistorySelectionRequest = { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'value', address: path('zero'),
    encoding: 'MDO2' } };
  expect(select(location, wrongEncoding)).toEqual({ kind: 'fingerprint', resolution: { kind: 'incompatible' } });
  const absent = path('absent');
  expect(select(location, { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'value', address: absent, encoding: 'MDO1' } })).toEqual({ kind: 'fingerprint', resolution: { kind: 'compatible', fingerprint: fingerprint(encodeSelectedFact(observe(data, absent, 'value')), machine) } });
  tamper(location, "UPDATE history_addresses SET value_fingerprint = NULL WHERE address <> '[]'");
  expect(() => select(location, { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'value', address: path('zero'), encoding: 'MDO1' } })).toThrow(HistoryIntegrityError);
});

test('schema probe and fingerprint query preserve real-port busy and storage failures', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const fact: IHistorySelectionRequest = { kind: 'fact', reference, request: { operation: 'value', address: path('zero') } };
  const digest: IHistorySelectionRequest = { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'value', address: path('zero'), encoding: 'MDO1' } };
  for (const [request, match] of [
    [fact, (sql: string) => sql.includes('SELECT schema_name, schema_version FROM history_identity')],
    [digest, (sql: string) => sql.includes('/* fingerprint */')],
  ] as const) {
    const owner = openRaw(location);
    owner.exec('PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE');
    let nativeContention: unknown;
    try { nativeContention = thrown(() => select(location, fact)); } finally { owner.exec('ROLLBACK'); }
    if (!(nativeContention instanceof HistoryBusyError)) { throw new Error('Expected real History contention'); }
    const busy = nativeContention.cause;
    expect(busy.name).toBe('SqliteBusyError');
    expect(busy.cause).toMatchObject({ code: 'SQLITE_BUSY' });
    const translated = thrown(() => select(location, request, failingQuery(match, busy)));
    expect(translated).toBeInstanceOf(HistoryBusyError);
    expect(translated).toMatchObject({ cause: busy });
    const io = new Error('fixture storage failure');
    expect(thrown(() => select(location, request, failingQuery(match, io)))).toBe(io);
  }
});

test('structural fingerprint propagates the exact metadata query TypeError', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const failure = new TypeError('metadata query failed');
  const request: IHistorySelectionRequest = { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'keys', address: path('nested'), encoding: 'MDO1' } };
  let outcome: unknown;
  try {
    outcome = select(location, request, failingQuery((sql) => sql.includes('/* node-metadata */'), failure));
  } catch (error: unknown) {
    outcome = error;
  }
  expect(outcome).toBe(failure);
});

test('structural fingerprint propagates the exact host hashing TypeError', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const failure = new TypeError('host hashing failed');
  const request: IHistorySelectionRequest = { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'keys', address: path('nested'), encoding: 'MDO1' } };
  const sha256 = { sha256(): never { throw failure; } };
  expect(thrown(() => readHistorySelection({ location, logicalStore, sqlite: createNodeSqliteCoordinatedReader(), sha256 }, request))).toBe(failure);
});

test('wrong analysis/environment references and missing present-index data remain integrity failures', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  for (const [analysis, environment] of [[`${scope.analysis}:other`, scope.environment], [scope.analysis, `${scope.environment}:other`]]) {
    const wrong = { kind: 'completed-result', locator: `mdh1|${JSON.stringify([logicalStore, analysis, environment, 1])}` } as const;
    expect(() => select(location, { kind: 'fact', reference: wrong, request: { operation: 'value', address: path('zero') } })).toThrow(HistoryIntegrityError);
  }
  tamper(location, `DELETE FROM history_addresses WHERE address = '[["p","zero"]]'`);
  expect(() => select(location, { kind: 'fact', reference, request: { operation: 'value', address: path('zero') } })).toThrow(HistoryIntegrityError);
  expect(() => select(location, { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'value', address: path('zero'), encoding: 'MDO1' } })).toThrow(HistoryIntegrityError);
});

test.each(['fact', 'fingerprint'] as const)('invalid stored own marker fails the %s selection', (kind) => {
  const location = freshLocation();
  const reference = fixture(location, data);
  tamper(location, `UPDATE history_addresses SET own = 2 WHERE address = '[["p","zero"]]'`);
  const request: IHistorySelectionRequest = kind === 'fact'
    ? { kind, reference, request: { operation: 'own', address: path('zero') } }
    : { kind, reference, request: { kind: 'selected', operation: 'own', address: path('zero'), encoding: 'MDO1' } };
  expect(() => select(location, request)).toThrow(HistoryIntegrityError);
});

test('valid own markers preserve own and inherited observations', () => {
  const location = freshLocation();
  const payload = domainRecord();
  const reference = fixture(location, payload);
  for (const [address, own] of [[path('child', 'own'), true], [path('child', 'inherited'), false]] as const) {
    const selected = observe(payload, address, 'own');
    expect(selected.fact).toBe(own);
    expect(select(location, { kind: 'fact', reference, request: { operation: 'own', address } })).toEqual({ kind: 'fact', selected });
    expect(select(location, { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'own', address, encoding: 'MDO1' } })).toEqual({ kind: 'fingerprint', resolution: { kind: 'compatible', fingerprint: fingerprint(encodeSelectedFact(selected), machine) } });
  }
});

test('direct invalid Value selection throws while the matching fingerprint selection is incompatible', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  expect(() => select(location, { kind: 'fact', reference, request: { operation: 'length', address: path('zero') } })).toThrow(TypeError);
  expect(select(location, { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'length', address: path('zero'), encoding: 'MDO1' } })).toEqual({ kind: 'fingerprint', resolution: { kind: 'incompatible' } });
});

test('native corruption has host evidence and never becomes a schema miss or initializes input', () => {
  const location = freshLocation();
  const bytes = Buffer.from('Not a SQLite database; preserve these bytes');
  writeFileSync(location, bytes);
  const reference = { kind: 'completed-result', locator: `mdh1|${JSON.stringify([logicalStore, scope.analysis, scope.environment, 1])}` } as const;
  const error = thrown(() => select(location, { kind: 'fact', reference, request: { operation: 'value', address: path('zero') } }));
  expect(error).toMatchObject({ name: 'SqliteReadError' });
  expect(error).toMatchObject({ code: 'corrupt' });
  expect(readFileSync(location)).toEqual(bytes);
});

test('real rollback contention retains Machine cause through History and recovers only after owner release', () => {
  const location = freshLocation();
  const reference = fixture(location, data);
  const owner = openRaw(location);
  owner.exec('PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE');
  try {
    const error = thrown(() => select(location, { kind: 'fact', reference, request: { operation: 'value', address: path('zero') } }));
    expect(error).toBeInstanceOf(HistoryBusyError);
    if (!(error instanceof HistoryBusyError)) { throw new Error('Expected bounded History contention'); }
    expect(error.cause.name).toBe('SqliteBusyError');
    expect(error.cause.cause).toMatchObject({ code: 'SQLITE_BUSY' });
  } finally { owner.exec('ROLLBACK'); }
  expect(select(location, { kind: 'fact', reference, request: { operation: 'value', address: path('zero') } })).toMatchObject({ kind: 'fact', selected: { fact: 0 } });
});

test('a genuinely spilled hot rollback input is refused without native recovery or source alteration', () => {
  const location = freshLocation();
  const worker = spawnSync(process.execPath, [fileURLToPath(new URL('./hot-writer.js', import.meta.url)), location], { encoding: 'utf8', timeout: 15_000 });
  expect({ status: worker.status, signal: worker.signal, stderr: worker.stderr }).toEqual({ status: null, signal: 'SIGKILL', stderr: '' });
  const witness: unknown = JSON.parse(worker.stdout);
  if (typeof witness !== 'object' || witness === null || !('before' in witness) || !('after' in witness)) {
    throw new Error('Hot fixture did not retain its spill witness');
  }
  const main = readFileSync(location);
  const journal = readFileSync(`${location}-journal`);
  expect(witness.before).not.toBe(witness.after);
  expect(createHash('sha256').update(main).digest('hex')).toBe(witness.after);
  expect(journal.length).toBeGreaterThan(28);
  expect(journal.subarray(0, 8).some((byte) => byte !== 0)).toBe(true);
  const reference = { kind: 'completed-result', locator: `mdh1|${JSON.stringify([logicalStore, scope.analysis, scope.environment, 1])}` } as const;
  const error = thrown(() => select(location, { kind: 'fact', reference, request: { operation: 'value', address: path('zero') } }));
  expect(error).toMatchObject({ name: 'SqliteReadError' });
  expect(error).toMatchObject({ code: 'recovery-required' });
  expect(readFileSync(location)).toEqual(main);
  expect(readFileSync(`${location}-journal`)).toEqual(journal);
});
