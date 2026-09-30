import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';

import { SqliteBusyError } from '../dist/src/index.js';
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

// A union with any Promise or thenable constituent is refused, even when its
// other constituents are ordinary synchronous values.
declare const mixedNumber: () => number | Promise<number>;
declare const mixedVoid: () => void | Promise<void>;
declare const mixedThenable: () => string | { then(onFulfilled: (value: string) => void): void };
expectError(connection.transaction(mixedNumber));
expectError(connection.transaction(mixedVoid));
expectError(connection.transaction(mixedThenable));
expectError(connection.transaction(() => (Math.random() > 0.5 ? 1 : Promise.resolve(2))));

// Purely synchronous unions and ordinary data keep their inferred result type.
declare const synchronousUnion: () => number | string | null;
declare const optionalRow: () => ISqliteRow | undefined;
declare const unknownResult: () => unknown;
declare const untypedResult: () => ReturnType<typeof JSON.parse>;
expectType<number | string | null>(connection.transaction(synchronousUnion));
expectType<ISqliteRow | undefined>(connection.transaction(optionalRow));
expectType<readonly ISqliteRow[]>(connection.transaction(() => statement.all()));
expectType<'a' | 'b'>(connection.transaction((): 'a' | 'b' => 'a'));
expectType<{ readonly id: number; readonly tags: readonly string[] }>(
  connection.transaction((): { readonly id: number; readonly tags: readonly string[] } => ({ id: 1, tags: [] })),
);
expectType<{ readonly then: string }>(connection.transaction((): { readonly then: string } => ({ then: 'data' })));
// Values the compiler cannot classify remain the runtime check's responsibility.
expectType<unknown>(connection.transaction(unknownResult));
connection.transaction(untypedResult);

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

// Busy exhaustion is a typed Error that records the wait that was spent.
declare const busy: SqliteBusyError;
expectAssignable<Error>(busy);
expectType<number>(busy.waitedMilliseconds);
expectType<SqliteBusyError>(new SqliteBusyError('busy', 500, { cause: new Error('driver') }));
expectError(new SqliteBusyError('busy'));
expectError(new SqliteBusyError('busy', '500'));
expectError((busy.waitedMilliseconds = 1));
