/** Compile-time authority contracts exclude arbitrary SQL and writable/native escape surfaces. */
import { expectType, expectError } from 'tsd';
import { pairMatches } from '../src/evidence.js';
import type { Snapshot } from '../node/adapter.js';
declare const snapshot: Snapshot;
expectType<boolean>(pairMatches({ revision: 2, currentRevision: 2, value: 'B' }, 'B'));
expectError(snapshot.exec('UPDATE snapshot_current SET revision=0'));
expectError(snapshot.prepare('SELECT 1'));
expectError(snapshot.transaction(() => undefined));
expectError(snapshot.read('SELECT 1'));
