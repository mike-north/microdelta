/**
 * The durable authority's options and returned connections surface Machine
 * host contracts. History re-exports each of them intentionally, following the
 * Value and Tracking convention, so consumers of the generated alpha rollup
 * name the exact Machine types without importing Machine or a deep path.
 */
import { expectAssignable, expectError, expectType } from 'tsd';

import type {
  IClockCapability,
  IDurableHistoryOptions,
  ISha256Capability,
  ISqliteCapability,
  ISqliteConnection,
  ISqliteRow,
  ISqliteRunResult,
  ISqliteStatement,
  ISqliteSynchronousResult,
  ISqliteValue,
} from '../dist/api/history.alpha.js';
import type * as Machine from '@microdelta/machine';
import * as publicTier from '../dist/api/history.public.js';

declare const options: IDurableHistoryOptions;

// Each re-export is Machine's own contract, identical in both directions.
expectType<ISha256Capability>(options.sha256);
expectType<IClockCapability>(options.clock);
expectType<ISqliteCapability>(options.sqlite);
expectType<ISqliteConnection>(options.sqlite.openSqlite('file'));
declare const connection: ISqliteConnection;
expectType<ISqliteStatement>(connection.prepare('SELECT 1'));
declare const statement: ISqliteStatement;
expectType<ISqliteRunResult>(statement.run(1, 'a', null));
expectType<ISqliteRow | undefined>(statement.get());
expectAssignable<ISqliteValue>(new Uint8Array());
expectError(statement.run(true));
declare const machineConnection: Machine.ISqliteConnection;
expectAssignable<ISqliteConnection>(machineConnection);
expectAssignable<Machine.ISqliteConnection>(connection);
declare const machineHash: Machine.ISha256Capability;
expectAssignable<ISha256Capability>(machineHash);
// The synchronous-transaction guard keeps rejecting Promise results through the re-export.
declare const promiseGuard: ISqliteSynchronousResult<Promise<number>>;
expectType<never>(promiseGuard);
expectError(connection.transaction(async () => 1));

// Host contracts stay project-private: the public tier re-exports none of them.
expectError(publicTier.openDurableHistory);
