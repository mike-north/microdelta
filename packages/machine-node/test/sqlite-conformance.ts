/**
 * Reusable outcome conformance for any host that implements Machine's portable
 * SQLite capability. The suite states what History may rely on: bound values,
 * transport-safe rows, persistent WAL/full-synchronous/foreign-key storage with
 * a bounded busy wait, synchronous IMMEDIATE transactions that roll back on
 * failure, rejected nesting and Promise results, and explicit close ownership.
 * It deliberately contains no History schema, lease, attempt or publication
 * policy; its tables are throwaway probes.
 *
 * @see https://www.sqlite.org/lang_transaction.html
 * @see https://www.sqlite.org/pragma.html#pragma_journal_mode
 * @see https://www.sqlite.org/pragma.html#pragma_synchronous
 * @see https://www.sqlite.org/pragma.html#pragma_foreign_keys
 * @see https://www.sqlite.org/pragma.html#pragma_busy_timeout
 * @see https://www.sqlite.org/datatype3.html
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ISqliteCapability, ISqliteConnection, ISqliteRow } from '@microdelta/machine';

/** A throwaway table whose single text column makes committed effects countable. */
const entriesTable = 'CREATE TABLE entries (value TEXT NOT NULL)';

/** Waits until queued microtasks and one later host turn have run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 2; turn += 1) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }
}

/** Reads the committed probe values in a stable order. */
function values(connection: ISqliteConnection): readonly (string | number | null | Uint8Array | undefined)[] {
  return connection.prepare('SELECT value FROM entries ORDER BY value').all().map((row: ISqliteRow) => row['value']);
}

/**
 * Calls `transaction` with an operation the portable type deliberately forbids,
 * so runtime rejection can be tested independently of the compile-time guard.
 */
function transactionUnchecked(connection: ISqliteConnection, operation: () => unknown): unknown {
  const result: unknown = Reflect.apply(connection.transaction, connection, [operation]);
  return result;
}

/**
 * Asserts that `operation` throws an error of the named standard kind. Errors
 * raised by a native addon or another module realm are not `instanceof` the
 * test realm's constructors, so the kind is compared by its standard name.
 */
function expectFailureKind(operation: () => unknown, kind: 'TypeError' | 'RangeError'): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(typeof thrown === 'object' && thrown !== null && 'name' in thrown ? thrown.name : thrown).toBe(kind);
}

/** Calls a statement method with values outside the portable parameter type. */
function runUnchecked(connection: ISqliteConnection, sql: string, parameters: readonly unknown[]): void {
  const statement = connection.prepare(sql);
  Reflect.apply(statement.run, statement, parameters);
}

/**
 * Registers the conformance suite for one host factory. Each test owns private
 * temporary directories and closes every connection it opened before cleanup.
 */
export function describeSqliteCapabilityConformance(hostName: string, createCapability: () => ISqliteCapability): void {
  describe(`${hostName} SQLite capability conformance`, () => {
    /** Directories removed after their connections close. */
    const directories: string[] = [];
    /** Connections closed after each test, even when assertions fail early. */
    const connections: ISqliteConnection[] = [];

    afterEach(() => {
      for (const connection of connections.splice(0)) {
        connection.close();
      }
      for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
      }
    });

    /** Allocates a private directory for one test. */
    function directory(): string {
      const created = mkdtempSync(join(tmpdir(), 'microdelta-sqlite-capability-'));
      directories.push(created);
      return created;
    }

    /** Opens a tracked connection to a durable file path. */
    function open(path: string): ISqliteConnection {
      const connection = createCapability().openSqlite(path);
      connections.push(connection);
      return connection;
    }

    /** Opens a tracked connection to a fresh durable file with the probe table. */
    function openEntries(): { connection: ISqliteConnection; path: string } {
      const path = join(directory(), 'probe.sqlite');
      const connection = open(path);
      connection.exec(entriesTable);
      return { connection, path };
    }

    describe('durability and configuration', () => {
      test('a committed transaction survives close and a fresh open of the same file', () => {
        const { connection, path } = openEntries();
        expect(connection.transaction(() => connection.prepare('INSERT INTO entries (value) VALUES (?)').run('committed'))).toEqual({ changes: 1 });
        connection.close();

        const reopened = open(path);
        expect(values(reopened)).toEqual(['committed']);
      });

      test('an opened file reads back WAL, FULL synchronous commits, foreign keys and a 500 ms busy timeout', () => {
        const path = join(directory(), 'pragmas.sqlite');
        for (const connection of [open(path), open(path)]) {
          expect({
            journal: connection.prepare('PRAGMA journal_mode').get(),
            synchronous: connection.prepare('PRAGMA synchronous').get(),
            foreignKeys: connection.prepare('PRAGMA foreign_keys').get(),
            busyTimeout: connection.prepare('PRAGMA busy_timeout').get(),
          }).toEqual({
            journal: { journal_mode: 'wal' },
            synchronous: { synchronous: 2 },
            foreignKeys: { foreign_keys: 1 },
            busyTimeout: { timeout: 500 },
          });
        }
      });

      test('foreign keys reject a dangling reference', () => {
        const { connection } = openEntries();
        connection.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent(id))');
        expect(() => connection.prepare('INSERT INTO child (parent_id) VALUES (?)').run(99)).toThrow();
        expect(connection.prepare('SELECT count(*) AS total FROM child').get()).toEqual({ total: 0 });
      });

      test('transactions begin IMMEDIATE, so a read-only transaction already excludes another writer', () => {
        const { connection: first, path } = openEntries();
        const second = open(path);
        // Under rollback journaling any reader blocks a commit, so only WAL mode,
        // where readers never block writers, makes this an IMMEDIATE check.
        expect(first.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
        first.transaction(() => {
          expect(first.prepare('SELECT count(*) AS total FROM entries').get()).toEqual({ total: 0 });
          expect(() => second.prepare('INSERT INTO entries (value) VALUES (?)').run('competing')).toThrow(/busy|locked/iu);
        });
        expect(second.prepare('INSERT INTO entries (value) VALUES (?)').run('after')).toEqual({ changes: 1 });
        expect(values(first)).toEqual(['after']);
      });
    });

    describe('open failures', () => {
      test.each([
        ['an in-memory database', ':memory:'],
        ['an empty path', ''],
      ])('rejects %s because it cannot provide the selected persistent WAL store', (_label, location) => {
        expect(() => open(location)).toThrow();
      });

      test('rejects a directory path', () => {
        expect(() => open(directory())).toThrow();
      });

      test('rejects a missing parent directory without creating the file', () => {
        const path = join(directory(), 'missing', 'probe.sqlite');
        expect(() => open(path)).toThrow();
        expect(existsSync(path)).toBe(false);
      });

      test('rejects an existing file that is not a SQLite database at open time', () => {
        const root = directory();
        mkdirSync(join(root, 'data'));
        const path = join(root, 'data', 'not-a-database.sqlite');
        writeFileSync(path, 'this is not a sqlite database file\n'.repeat(256));
        expect(() => open(path)).toThrow();
      });
    });

    describe('bound values and row transport', () => {
      test('statements bind values separately from SQL text and report changed rows', () => {
        const { connection } = openEntries();
        const hostile = "x'); DROP TABLE entries; --";
        expect(connection.prepare('INSERT INTO entries (value) VALUES (?)').run(hostile)).toEqual({ changes: 1 });
        expect(connection.prepare('SELECT value FROM entries WHERE value = ?').get(hostile)).toEqual({ value: hostile });
        expect(connection.prepare('SELECT value FROM entries WHERE value = ?').get('absent')).toBeUndefined();
        expect(connection.prepare('UPDATE entries SET value = ? WHERE value = ?').run('changed', 'absent')).toEqual({ changes: 0 });
      });

      test('rows carry text, safe integers, reals, null and detached plain Uint8Array blobs', () => {
        const { connection } = openEntries();
        connection.exec('CREATE TABLE cells (text_value TEXT, integer_value INTEGER, real_value REAL, null_value TEXT, blob_value BLOB)');
        const input = new Uint8Array([1, 2, 3]);
        connection.prepare('INSERT INTO cells VALUES (?, ?, ?, ?, ?)').run('text', Number.MAX_SAFE_INTEGER, 1.5, null, input);
        input[0] = 9;

        const row = connection.prepare('SELECT * FROM cells').get();
        expect(row).toEqual({
          text_value: 'text',
          integer_value: Number.MAX_SAFE_INTEGER,
          real_value: 1.5,
          null_value: null,
          blob_value: new Uint8Array([1, 2, 3]),
        });
        const blob = row?.['blob_value'];
        expect(blob instanceof Uint8Array && Object.getPrototypeOf(blob) === Uint8Array.prototype).toBe(true);
        if (blob instanceof Uint8Array) {
          blob[1] = 8;
        }
        expect(connection.prepare('SELECT blob_value FROM cells').get()).toEqual({ blob_value: new Uint8Array([1, 2, 3]) });
        expect(connection.prepare('SELECT text_value FROM cells').all()).toEqual([{ text_value: 'text' }]);
      });

      test('column names such as __proto__ and constructor stay own data fields without changing the row prototype', () => {
        const { connection } = openEntries();
        const rows = [
          connection.prepare('SELECT ? AS "__proto__", ? AS "constructor", ? AS "value"').get('proto-text', 'constructor-text', 1),
          connection.prepare('SELECT ? AS "__proto__", ? AS "constructor", ? AS "value"').all(new Uint8Array([7]), null, 2)[0],
        ];
        const expectedCells = [
          ['proto-text', 'constructor-text', 1],
          [new Uint8Array([7]), null, 2],
        ] as const;

        rows.forEach((row, index) => {
          if (row === undefined) {
            throw new Error('expected one row');
          }
          const prototype: unknown = Object.getPrototypeOf(row);
          expect(prototype === Object.prototype || prototype === null).toBe(true);
          expect(Object.keys(row)).toEqual(['__proto__', 'constructor', 'value']);
          expect(['__proto__', 'constructor', 'value'].map((column) => {
            const descriptor = Object.getOwnPropertyDescriptor(row, column);
            const ownValue: unknown = descriptor !== undefined && 'value' in descriptor ? descriptor.value : 'missing own data property';
            return ownValue;
          })).toEqual(expectedCells[index]);
          expect(row['constructor']).toEqual(expectedCells[index]?.[1]);
          expect(row['value']).toBe(expectedCells[index]?.[2]);
        });
      });

      test('a non-finite real produced by SQLite fails instead of crossing the boundary; finite reals still pass', () => {
        const { connection } = openEntries();
        for (const sql of ['SELECT 1e999 AS value', 'SELECT -1e999 AS value', 'SELECT 1.5 AS finite, 1e999 AS value']) {
          expectFailureKind(() => connection.prepare(sql).get(), 'RangeError');
          expectFailureKind(() => connection.prepare(sql).all(), 'RangeError');
        }
        connection.exec('CREATE TABLE reals (value REAL NOT NULL); INSERT INTO reals VALUES (1e999)');
        expectFailureKind(() => connection.prepare('SELECT value FROM reals').get(), 'RangeError');
        expect(connection.prepare('SELECT 1.5 AS value, -2.25e10 AS negative, 9007199254740991 AS integer').all()).toEqual([
          { value: 1.5, negative: -2.25e10, integer: Number.MAX_SAFE_INTEGER },
        ]);
      });

      test('an integer beyond the safe range fails instead of being rounded', () => {
        const { connection } = openEntries();
        connection.exec('CREATE TABLE wide (value INTEGER NOT NULL); INSERT INTO wide VALUES (9007199254740993)');
        expectFailureKind(() => connection.prepare('SELECT value FROM wide').get(), 'RangeError');
        expectFailureKind(() => connection.prepare('SELECT value FROM wide').all(), 'RangeError');
      });

      test.each([
        ['NaN', Number.NaN],
        ['positive infinity', Number.POSITIVE_INFINITY],
        ['a boolean', true],
        ['a bigint', 1n],
        ['undefined', undefined],
        ['an object', { value: 'x' }],
      ])('rejects %s as a bound value without writing', (_label, value) => {
        const { connection } = openEntries();
        connection.exec('CREATE TABLE anything (value)');
        expectFailureKind(() => { runUnchecked(connection, 'INSERT INTO anything (value) VALUES (?)', [value]); }, 'TypeError');
        expect(connection.prepare('SELECT count(*) AS total FROM anything').get()).toEqual({ total: 0 });
      });
    });

    describe('synchronous transactions', () => {
      test('a callback result is returned and its writes commit', () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        expect(connection.transaction(() => {
          insert.run('a');
          insert.run('b');
          return 42;
        })).toBe(42);
        expect(values(connection)).toEqual(['a', 'b']);
      });

      test('a throwing callback rolls back every write and rethrows the identical value', () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        const failure = new Error('rollback marker');
        let received: unknown;
        try {
          connection.transaction(() => {
            insert.run('a');
            connection.exec("INSERT INTO entries (value) VALUES ('b')");
            throw failure;
          });
        } catch (error: unknown) {
          received = error;
        }
        expect(received).toBe(failure);
        expect(values(connection)).toEqual([]);

        const thrownText = 'non-error failure';
        let receivedText: unknown;
        try {
          connection.transaction(() => {
            insert.run('c');
            // The contract rethrows arbitrary thrown values unchanged, not only Error instances.
            throw thrownText;
          });
        } catch (error: unknown) {
          receivedText = error;
        }
        expect(receivedText).toBe(thrownText);
        expect(values(connection)).toEqual([]);

        connection.transaction(() => insert.run('usable'));
        expect(values(connection)).toEqual(['usable']);
      });

      test('a nested transaction is rejected without running its callback; propagation rolls back the outer writes', () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        let innerRan = false;

        expect(() => connection.transaction(() => {
          insert.run('outer-propagated');
          connection.transaction(() => { innerRan = true; insert.run('inner'); });
        })).toThrow();
        expect(innerRan).toBe(false);
        expect(values(connection)).toEqual([]);

        connection.transaction(() => {
          insert.run('outer-kept');
          expect(() => connection.transaction(() => { innerRan = true; insert.run('inner'); })).toThrow();
        });
        expect(innerRan).toBe(false);
        expect(values(connection)).toEqual(['outer-kept']);
      });

      test('an async callback is rejected and rolled back; its awaited continuation cannot write through the connection or its statements', async () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        const lateFailures: unknown[] = [];
        let continued = false;
        /** Records each late write attempt so one rejected attempt cannot mask the others. */
        const attempt = (write: () => void): void => {
          try {
            write();
          } catch (error: unknown) {
            lateFailures.push(error);
          }
        };

        expectFailureKind(() => transactionUnchecked(connection, async () => {
          insert.run('before-await');
          await Promise.resolve();
          continued = true;
          attempt(() => { insert.run('statement-after-await'); });
          attempt(() => { connection.exec("INSERT INTO entries (value) VALUES ('exec-after-await')"); });
          attempt(() => { connection.prepare('INSERT INTO entries (value) VALUES (?)').run('prepared-after-await'); });
          attempt(() => { connection.transaction(() => insert.run('transaction-after-await')); });
        }), 'TypeError');
        await settle();

        expect(continued).toBe(true);
        expect(lateFailures).toHaveLength(4);
        expect(values(connection)).toEqual([]);

        insert.run('independent');
        connection.transaction(() => insert.run('independent-transaction'));
        expect(values(connection)).toEqual(['independent', 'independent-transaction']);
      });

      test('inherited work cannot close the connection after its transaction ended; independent use continues', async () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        const lateCloseFailures: unknown[] = [];
        /** Records a late close attempt made by work inherited from an ended transaction. */
        const lateClose = (): void => {
          try {
            connection.close();
          } catch (error: unknown) {
            lateCloseFailures.push(error);
          }
        };

        expectFailureKind(() => transactionUnchecked(connection, async () => {
          await Promise.resolve();
          lateClose();
        }), 'TypeError');
        connection.transaction(() => {
          insert.run('committed');
          setTimeout(lateClose, 0);
        });
        await settle();

        expect(lateCloseFailures).toHaveLength(2);
        insert.run('independent');
        expect(values(connection)).toEqual(['committed', 'independent']);
      });

      test('a native Promise is refused and rolled back even when its own then is shadowed, without reading that then', () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        let thenReads = 0;
        /** Native Promises whose own `then` would hide them from a then-based check. */
        const disguised: readonly (() => Promise<number>)[] = [
          () => Object.defineProperty(Promise.resolve(1), 'then', { value: undefined }),
          () => Object.defineProperty(Promise.resolve(2), 'then', { value: 'not callable' }),
          () => Object.defineProperty(Promise.resolve(3), 'then', {
            get(): never {
              thenReads += 1;
              throw new Error('then getter must not run');
            },
          }),
        ];

        for (const create of disguised) {
          let returned: unknown;
          expectFailureKind(() => transactionUnchecked(connection, () => {
            insert.run('before-disguised-promise');
            returned = create();
            return returned;
          }), 'TypeError');
          expect(returned instanceof Promise).toBe(true);
        }
        expect(thenReads).toBe(0);
        expect(values(connection)).toEqual([]);

        expect(connection.transaction(() => insert.run('ordinary'))).toEqual({ changes: 1 });
        expect(values(connection)).toEqual(['ordinary']);
      });

      test('a foreign thenable result is rejected and rolled back without calling its then', async () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        let thenCalls = 0;
        expectFailureKind(() => transactionUnchecked(connection, () => {
          insert.run('before-thenable');
          return { then(): void { thenCalls += 1; } };
        }), 'TypeError');
        await settle();
        expect(thenCalls).toBe(0);
        expect(values(connection)).toEqual([]);
      });

      test('work scheduled by a committed callback cannot write after the transaction ended', async () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        const lateFailures: unknown[] = [];
        connection.transaction(() => {
          insert.run('committed');
          setTimeout(() => {
            try {
              insert.run('scheduled');
            } catch (error: unknown) {
              lateFailures.push(error);
            }
          }, 0);
        });
        await settle();

        expect(lateFailures).toHaveLength(1);
        expect(values(connection)).toEqual(['committed']);
      });
    });

    describe('close ownership', () => {
      test('close is idempotent and every later connection or statement use fails', () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        const select = connection.prepare('SELECT value FROM entries');
        connection.close();
        connection.close();

        expect(() => connection.exec('SELECT 1')).toThrow();
        expect(() => connection.prepare('SELECT 1')).toThrow();
        expect(() => connection.transaction(() => 1)).toThrow();
        expect(() => insert.run('closed')).toThrow();
        expect(() => select.get()).toThrow();
        expect(() => select.all()).toThrow();
      });

      test('closing one connection leaves another connection to the same file usable', () => {
        const { connection: first, path } = openEntries();
        const second = open(path);
        first.close();
        expect(second.prepare('INSERT INTO entries (value) VALUES (?)').run('second')).toEqual({ changes: 1 });
        expect(values(second)).toEqual(['second']);
      });

      test('close inside a transaction callback is rejected, the transaction rolls back and the connection stays usable', () => {
        const { connection } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        expect(() => connection.transaction(() => {
          insert.run('inside');
          connection.close();
        })).toThrow();
        expect(values(connection)).toEqual([]);
        insert.run('still-open');
        expect(values(connection)).toEqual(['still-open']);
      });

      test('a delayed statement call after close fails and does not reach the file', async () => {
        const { connection, path } = openEntries();
        const insert = connection.prepare('INSERT INTO entries (value) VALUES (?)');
        connection.close();
        await settle();
        expect(() => insert.run('after-close')).toThrow();

        const reopened = open(path);
        expect(values(reopened)).toEqual([]);
      });
    });
  });
}
