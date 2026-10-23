/** Independent raw-SQL census and discriminator; synthetic stores only. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDurableHistory } from '@microdelta/history';
import { createNodeSqlite, createNodeMachine } from '@microdelta/machine-node';
const directory = mkdtempSync(join(tmpdir(), 'microdelta-review191-'));
try {
  const location = join(directory, 'v3.sqlite');
  openDurableHistory({ location, logicalStore: 'synthetic-review', sqlite: createNodeSqlite(), sha256: createNodeMachine(), clock: { currentEpochMilliseconds: () => 1000 } }).close();
  const current = new Database(location);
  const old = new Database(':memory:');
  old.exec(readFileSync('packages/core/test/durable-history/fixtures/schema-v2.sql', 'utf8'));
  const tables = current.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE '%_immutable_insert' ORDER BY name").all().map(row => row.name.replace(/_immutable_insert$/u, ''));
  assert.equal(tables.length, 11);
  const census = tables.map(table => {
    const columns = current.pragma(`table_info(${table})`);
    const pk = columns.filter(column => column.pk > 0).sort((a,b) => a.pk - b.pk).map(column => column.name);
    const keys = [pk, ...current.pragma(`index_list(${table})`).filter(index => index.unique).map(index => current.pragma(`index_info(${index.name})`).map(column => column.name))];
    const guard = current.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(`${table}_immutable_insert`).sql;
    // A UNIQUE key containing an already protected key cannot displace an independent row.
    const independent = keys.filter(key => !keys.some(other => other.length < key.length && other.every(column => key.includes(column))));
    for (const key of independent) assert(guard.includes(`(${key.map(column => `${column} = NEW.${column}`).join(' AND ')})`), `${table}: missing ${key}`);
    const integerPrimary = pk.length === 1 && columns.find(column => column.name === pk[0]).type === 'INTEGER';
    const sql = current.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
    assert(integerPrimary || /WITHOUT ROWID/u.test(sql));
    return { table, primaryKey: pk, independentKeys: [...new Set(independent.map(key => key.join(',')))], hiddenRowIdentity: integerPrimary ? 'guarded integer alias' : 'absent' };
  });
  for (const db of [old, current]) db.exec('PRAGMA recursive_triggers=OFF; PRAGMA foreign_keys=OFF');
  const oldBefore = old.prepare('SELECT * FROM history_identity').get();
  assert(oldBefore);
  for (const verb of ['INSERT OR REPLACE', 'REPLACE']) {
    old.exec(`${verb} INTO history_identity SELECT singleton,schema_name,schema_version,'rewritten' FROM history_identity`);
    assert.equal(old.prepare('SELECT logical_store FROM history_identity').get().logical_store, 'rewritten');
    const before = current.prepare('SELECT * FROM history_identity').all();
    assert.throws(() => current.exec(`${verb} INTO history_identity SELECT singleton,schema_name,schema_version,'rewritten' FROM history_identity`), /immutable/u);
    assert.deepEqual(current.prepare('SELECT * FROM history_identity').all(), before);
  }
  old.close(); current.close();
  console.log(JSON.stringify({ tables: census, frozenV2Replacement: 'succeeds', v3Replacement: 'aborts with original row unchanged', recursiveTriggers: 0 }, null, 2));
} finally { rmSync(directory, {recursive:true,force:true}); }
