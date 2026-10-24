/**
 * A separate process holds SQLite's IMMEDIATE write lock until its parent
 * releases it. The parent exercises the production History authority while
 * this process owns the lock, so contention is real cross-process storage
 * behavior rather than a same-process mock.
 * @packageDocumentation
 */
import { createNodeSqlite } from '@microdelta/machine-node';

/** The database file chosen by the parent test. */
const location = process.argv[2];
if (location === undefined) {
  throw new Error('A lock holder needs the SQLite location');
}

/** This worker alone owns and closes its SQLite connection. */
const connection = createNodeSqlite().openSqlite(location);
connection.exec('BEGIN IMMEDIATE');
process.send?.({ kind: 'locked' });
process.once('message', (message: unknown) => {
  if (typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'release') {
    throw new Error('A lock holder only accepts release');
  }
  connection.exec('ROLLBACK');
  connection.close();
  process.disconnect();
});
