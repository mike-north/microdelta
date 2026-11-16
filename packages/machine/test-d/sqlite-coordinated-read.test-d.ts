/** Coordinated scopes expose finite read authority, never mutation or transaction SQL. */
import { expectError, expectType } from 'tsd';
import type { ISqliteCoordinatedReadCapability, ISqliteCoordinatedReadScope, ISqliteReadStatement, ISqliteRow } from '../dist/src/index.js';
declare const capability: ISqliteCoordinatedReadCapability;
const scope = capability.openSqliteCoordinatedRead('/existing.sqlite');
expectType<ISqliteCoordinatedReadScope>(scope);
scope.begin();
const statement = scope.prepare('SELECT 1');
expectType<ISqliteReadStatement>(statement);
expectType<readonly ISqliteRow[]>(statement.all());
expectError(scope.exec);
expectError(scope.transaction);
expectError(statement.run);
expectError(statement.iterate);
scope.end();
scope.close();
