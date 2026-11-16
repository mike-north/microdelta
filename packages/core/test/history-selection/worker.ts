/** Separate-process finite History reader; file barriers coordinate real WAL activity. @packageDocumentation */
import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { readHistorySelection } from '@microdelta/history';
import type { ICompletedResultReference, ISqliteCoordinatedReadCapability, ISqliteCoordinatedReadScope } from '@microdelta/history';
import { createNodeMachine, createNodeSqliteCoordinatedReader } from '@microdelta/machine-node';

/** Read-only statement shape reached through History's declared host port. */
type ISqliteReadStatement = ReturnType<ISqliteCoordinatedReadScope['prepare']>;

/** A test-only bounded synchronous barrier, needed because History reads synchronously. */
function waitFor(file: string): void {
  const limit = Date.now() + 15_000;
  while (!existsSync(file)) {
    if (Date.now() > limit) {
      throw new Error(`timed out waiting for ${file}`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

const [location, locator, barrier, resultFile, stopFile, pause] = process.argv.slice(2);
if (location === undefined || locator === undefined || barrier === undefined || resultFile === undefined || stopFile === undefined || pause === undefined) {
  throw new Error('missing worker arguments');
}
const reference: ICompletedResultReference = { kind: 'completed-result', locator };
const real = createNodeSqliteCoordinatedReader();
const events: { readonly sql: string; readonly rows: readonly Record<string, unknown>[] }[] = [];
let paused = false;
const snapshotCounts: unknown[] = [];
/** Observe real read statements without substituting a storage implementation. */
const sqlite: ISqliteCoordinatedReadCapability = {
  openSqliteCoordinatedRead(file): ISqliteCoordinatedReadScope {
    const scope = real.openSqliteCoordinatedRead(file);
    return {
      begin: () => scope.begin(),
      end: () => scope.end(),
      close: () => scope.close(),
      prepare(sql): ISqliteReadStatement {
        const statement = scope.prepare(sql);
        const before = (): void => {
          if (pause === 'yes' && !paused && sql.includes('/* node-metadata */')) {
            paused = true;
            const count = scope.prepare('SELECT count(*) AS n FROM history_results');
            snapshotCounts.push(count.get()?.n);
            writeFileSync(barrier, 'anchored');
            waitFor(`${barrier}.continue`);
            snapshotCounts.push(count.get()?.n);
          }
        };
        return {
          get(...values) { before(); const row = statement.get(...values); events.push({ sql, rows: row === undefined ? [] : [row] }); return row; },
          all(...values) { before(); const rows = statement.all(...values); events.push({ sql, rows }); return rows; },
        };
      },
    };
  },
};
try {
  const options = { location, logicalStore: 'store:contributors', sqlite, sha256: createNodeMachine() };
  const address = [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'name' }] as const;
  const fact = readHistorySelection(options, { kind: 'fact', reference, request: { operation: 'value', address } });
  const factEvents = events.splice(0);
  const fingerprint = readHistorySelection(options, { kind: 'fingerprint', reference, request: { kind: 'selected', operation: 'value', address, encoding: 'MDO1' } });
  writeFileSync(resultFile, JSON.stringify({ fact, fingerprint, factEvents, fingerprintEvents: events, snapshotCounts }));
  // Remain alive after return so process death cannot explain released locks.
  while (!existsSync(stopFile)) {
    await delay(10);
  }
} catch (error: unknown) {
  writeFileSync(resultFile, JSON.stringify({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }));
  process.exitCode = 1;
}
