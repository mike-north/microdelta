/**
 * History candidate-query access-path regression. This test reads the SQL and
 * relevant schema objects from production source, then counts SQLite virtual
 * machine instructions over invented rows. The counter distinguishes scanning
 * unrelated subjects from returning one row; real History tests separately
 * establish publication, integrity and facade behavior.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

/** Repository root, independent of the process working directory. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The original broad predicate, retained only as a regression negative. */
const oldBroadQuery = `SELECT result_id, analysis, environment, subject, version, publication, encoding, index_version,
      provenance_format, provenance_version, provenance FROM history_results r
      WHERE r.analysis = ? AND r.subject = ? AND r.version = ?
        AND (r.environment = ? OR EXISTS (SELECT 1 FROM history_promotion_results pr JOIN history_promotions p ON p.promotion_id = pr.promotion_id
          WHERE pr.result_id = r.result_id AND p.analysis = r.analysis AND p.environment = ?))
      ORDER BY publication DESC`;

/** Extract one exact String.raw SQL statement by its prepared-statement role. */
function productionQuery() {
  const source = readFileSync(join(root, 'packages/history/src/durable/index.ts'), 'utf8');
  const match = /candidates: connection\.prepare\(sql`([\s\S]*?)`\)/u.exec(source);
  assert.ok(match, 'production candidate SQL must be located');
  return match[1];
}

/** Extract production table/index DDL used by candidate discovery. */
function productionSchema() {
  const source = readFileSync(join(root, 'packages/history/src/durable/schema.ts'), 'utf8');
  const names = ['history_results', 'history_results_by_subject', 'history_promotions', 'history_promotions_by_target', 'history_promotion_results', 'history_promotion_results_by_result'];
  return names.map((name) => {
    const match = [...source.matchAll(/sql`(CREATE (?:TABLE|INDEX) [\s\S]*?)`/gu)]
      .find((candidate) => new RegExp(`^CREATE (?:TABLE|INDEX) ${name}\\b`, 'u').test(candidate[1]));
    assert.ok(match, `production schema object ${name} must be located`);
    return match[1];
  });
}

/** Run the Python SQLite VM counter over the exact SQL supplied by this test. */
function measure(query, schema, shape) {
  const result = spawnSync('python3', [join(root, 'tooling/candidate-query-vm.py')], {
    input: JSON.stringify({ query, schema, shape }), encoding: 'utf8', maxBuffer: 2_000_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

/** Confirm the installed Node SQLite engine follows both indexed access paths. */
function nodePlan(query, schema) {
  const database = new Database(':memory:');
  try {
    for (const ddl of schema) database.exec(ddl);
    const version = database.prepare('SELECT sqlite_version() AS version').get().version;
    const detail = database.prepare(`EXPLAIN QUERY PLAN ${query}`).all('a', 'prod', 'target', 1)
      .map((row) => row.detail);
    return { version, detail };
  } finally {
    database.close();
  }
}

test('candidate query bounds unrelated-subject VM work and rejects the old broad predicate', () => {
  const schema = productionSchema();
  const query = productionQuery();
  const shape = query.includes('WITH requested(') ? 'scoped' : 'legacy';
  const repaired = measure(query, schema, shape);
  const broad = measure(oldBroadQuery, schema, 'legacy');
  assert.match(repaired.sqlite_version, /^\d+\.\d+\.\d+$/u);
  for (const filler of ['same-environment', 'other-environment', 'other-analysis']) {
    const counts = repaired.counts[filler];
    assert.deepEqual(counts.map((row) => row.population), [100, 1000, 10000]);
    for (const row of counts.slice(1)) {
      assert.ok(row.steps <= 2 * counts[0].steps,
        `${filler}: ${row.steps} VM instructions at ${row.population} versus ${counts[0].steps} at 100`);
    }
  }
  assert.ok(broad.counts['same-environment'][2].steps > 2 * broad.counts['same-environment'][0].steps,
    'old broad-query mutant must still exhibit unrelated-subject growth');
  assert.deepEqual(repaired.semantic, broad.semantic, 'access-path repair must preserve result eligibility and order');
  if (shape === 'scoped') {
    const native = nodePlan(query, schema);
    assert.ok(native.detail.some((line) => /SEARCH r USING INDEX history_results_by_subject \(analysis=\? AND environment=\? AND subject=\? AND version=\?\)/u.test(line)), native.detail.join('\n'));
    assert.ok(native.detail.some((line) => /SEARCH p USING COVERING INDEX history_promotions_by_target \(analysis=\? AND environment=\?\)/u.test(line)), native.detail.join('\n'));
    assert.ok(!native.detail.some((line) => /SEARCH r USING INDEX history_results_by_subject \(analysis=\?\)/u.test(line)), native.detail.join('\n'));
    console.log(`candidate-query engines: Python SQLite ${repaired.sqlite_version}; Node SQLite ${native.version}`);
    console.log(`candidate-query same-environment VM steps: ${repaired.counts['same-environment'].map((row) => row.steps).join(', ')}`);
  }
});
