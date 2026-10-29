/**
 * Test-only hot rollback input: an ordinary DELETE writer spills uncommitted
 * changes and dies before commit. This is fixture construction, never a reader
 * recovery path or evidence of normal native release.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeSync } from 'node:fs';

import { createNodeSqlite } from '@microdelta/machine-node';

const location = process.argv[2];
if (location === undefined) { throw new Error('Hot fixture needs a location'); }
const writer = createNodeSqlite().openSqlite(location, { journalMode: 'delete' });
writer.exec('CREATE TABLE foreign_fixture (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
const insert = writer.prepare('INSERT INTO foreign_fixture VALUES (?, ?)');
writer.transaction(() => {
  for (let index = 0; index < 64; index += 1) { insert.run(index, 'a'.repeat(4096)); }
});
const before = createHash('sha256').update(readFileSync(location)).digest('hex');
writer.exec('PRAGMA cache_size = 1; PRAGMA cache_spill = ON; BEGIN IMMEDIATE');
writer.prepare('UPDATE foreign_fixture SET payload = ?').run('b'.repeat(4096));
const after = createHash('sha256').update(readFileSync(location)).digest('hex');
writeSync(1, `${JSON.stringify({ before, after })}\n`);
process.kill(process.pid, 'SIGKILL');
