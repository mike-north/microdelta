/**
 * Runs the portable SQLite conformance suite against the Node Machine adapter,
 * then checks the Node-specific process outcome that an in-process test cannot
 * observe: a rejected async transaction callback must not surface as an
 * unhandled rejection that terminates a strict Node process.
 *
 * @see https://nodejs.org/api/cli.html#--unhandled-rejectionsmode
 */
import { describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createNodeSqlite } from '../src/index.js';
import { describeSqliteCapabilityConformance } from './sqlite-conformance.js';

/** The emitted adapter entry that a separate Node process imports. */
const adapterEntry = fileURLToPath(new URL('../src/index.js', import.meta.url));

/**
 * A consumer process whose transaction callbacks return native Promises that
 * later reject or write: two async callbacks, and two rejected native Promises
 * whose own `then` is shadowed by `undefined` or by a throwing getter. It
 * reports whether each call failed synchronously with TypeError, how many late
 * writes reached the database, and how often a shadowing getter ran.
 */
const strictConsumer = `
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { createNodeSqlite } = await import(pathToFileURL(process.env.MICRODELTA_ADAPTER_ENTRY).href);
const directory = mkdtempSync(join(tmpdir(), 'microdelta-sqlite-strict-'));
const connection = createNodeSqlite().openSqlite(join(directory, 'strict.sqlite'));
connection.exec('CREATE TABLE entries (value TEXT NOT NULL)');
const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
const rejectedWithTypeError = [];
let thenGetterReads = 0;
for (const operation of [
  async () => { await null; insert.run('late write'); },
  async () => { await null; throw new Error('late failure'); },
  () => {
    insert.run('shadowed undefined then');
    return Object.defineProperty(Promise.reject(new Error('shadowed rejection')), 'then', { value: undefined });
  },
  () => {
    insert.run('throwing then getter');
    return Object.defineProperty(Promise.reject(new Error('getter rejection')), 'then', {
      get() { thenGetterReads += 1; throw new Error('then getter ran'); },
    });
  },
]) {
  try {
    connection.transaction(operation);
    rejectedWithTypeError.push(false);
  } catch (error) {
    rejectedWithTypeError.push(error instanceof TypeError);
  }
}
await new Promise((resolve) => { setTimeout(resolve, 20); });
const { total } = connection.prepare('SELECT count(*) AS total FROM entries').get();
connection.close();
rmSync(directory, { recursive: true, force: true });
process.stdout.write(JSON.stringify({ rejectedWithTypeError, total, thenGetterReads }));
`;

describeSqliteCapabilityConformance('Node Machine', createNodeSqlite);

describe('Node SQLite process boundary', () => {
  test('rejected async callbacks are contained under --unhandled-rejections=strict', () => {
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '--eval', strictConsumer], {
      encoding: 'utf8',
      env: { ...process.env, MICRODELTA_ADAPTER_ENTRY: adapterEntry },
      timeout: 30_000,
    });

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toEqual({ rejectedWithTypeError: [true, true, true, true], total: 0, thenGetterReads: 0 });
  });
});
