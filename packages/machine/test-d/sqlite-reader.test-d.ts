/** Inspection capabilities do not carry creation, execution, transaction or mutation authority. */
import { expectError, expectType } from 'tsd';
import type { ISqliteReadCapability, ISqliteReader, ISqliteReadStatement, ISqliteRow } from '../dist/src/index.js';
declare const sqlite: ISqliteReadCapability;
const reader = sqlite.openSqliteReader('/existing.sqlite');
expectType<ISqliteReader>(reader);
const statement = reader.prepare('SELECT 1');
expectType<ISqliteReadStatement>(statement);
expectType<readonly ISqliteRow[]>(statement.all());
expectError(sqlite.openSqlite);
expectError(reader.exec);
expectError(reader.transaction);
expectError(statement.run);
