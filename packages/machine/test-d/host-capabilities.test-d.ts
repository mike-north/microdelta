import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import type {
  IClockCapability,
  IMachine,
  ISqliteCapability,
  ISqliteConnection,
  ISqliteRow,
  ISqliteRunResult,
  ISqliteStatement,
  ISqliteValue,
} from '../dist/src/index.js';

declare const sqlite: ISqliteCapability;
declare const connection: ISqliteConnection;
declare const statement: ISqliteStatement;
declare const row: ISqliteRow;
declare const clock: IClockCapability;
declare const machine: IMachine;

// Opening and statement transport use only portable ECMAScript value types.
expectType<ISqliteConnection>(sqlite.openSqlite('/var/data/store.sqlite'));
expectType<ISqliteStatement>(connection.prepare('SELECT 1'));
expectType<ISqliteRunResult>(statement.run('text', 1, 1.5, null, new Uint8Array([1])));
expectType<number>(statement.run().changes);
expectType<ISqliteRow | undefined>(statement.get('key'));
expectType<readonly ISqliteRow[]>(statement.all());
expectType<ISqliteValue | undefined>(row['column']);
expectType<void>(connection.exec('CREATE TABLE probe (value TEXT)'));
expectType<void>(connection.close());

// Values outside the SQLite transport domain are rejected before runtime.
expectError(statement.run(true));
expectError(statement.run(1n));
expectError(statement.run(undefined));
expectError(statement.run({ value: 'x' }));
expectError(statement.get(new Date()));
expectNotAssignable<ISqliteValue>(1n);
expectNotAssignable<ISqliteRow>({ column: 1n });

// Transactions are synchronous: the callback result is returned unchanged,
// while Promise and other thenable results are compile-time errors.
expectType<number>(connection.transaction(() => 42));
expectType<ISqliteRunResult>(connection.transaction(() => statement.run('x')));
expectType<void>(connection.transaction(() => { statement.run('x'); }));
expectError(connection.transaction(async () => 42));
expectError(connection.transaction(() => Promise.resolve(42)));
expectError(connection.transaction(() => ({ then(): void { /* thenable */ } })));

// A clock reading is a number of epoch milliseconds; policy is not part of the port.
expectType<number>(clock.currentEpochMilliseconds());

// Existing IMachine consumers are unchanged: SQLite and clock remain separate capabilities.
expectAssignable<IMachine>({
  createAsyncContext: machine.createAsyncContext.bind(machine),
  snapshot: machine.snapshot.bind(machine),
  sha256: machine.sha256.bind(machine),
});
expectNotAssignable<ISqliteCapability>(machine);
expectNotAssignable<IClockCapability>(machine);
