/** Corroborate captured query plans on the installed Node driver without executing provider/library work. */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
const captures = JSON.parse(readFileSync(new URL('./captured-sql.json', import.meta.url), 'utf8'));
for (const [name, capture] of Object.entries(captures)) {
  const database = new Database(':memory:');
  for (const ddl of capture.ddl) database.exec(ddl);
  const parameters = name === 'published' ? ['a', 'prod', 'target', 1] : ['a', 'target', 1, 'prod', 'prod'];
  console.log(JSON.stringify({ implementation: name, sqlite: database.prepare('SELECT sqlite_version() version').get(), plan: database.prepare(`EXPLAIN QUERY PLAN ${capture.query}`).all(...parameters) }));
  database.close();
}
