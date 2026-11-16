/** Query admission must precede any driver preparation or configuration effect. */
import { expect, test } from '@jest/globals';
import { _scopeFor } from '../src/node/sqlite-coordinated-read.js';

test('unsupported queries cannot reach driver preparation or configure the scope', () => {
  const calls: string[] = [];
  let configurationEffects = 0;
  const driver = {
    exec(sql: string): void { calls.push(`exec:${sql}`); if (sql.includes('PRAGMA')) { configurationEffects += 1; } },
    prepare(sql: string): never { calls.push(`prepare:${sql}`); configurationEffects += 1; throw new Error('unexpected preparation'); },
    close(): void { calls.push('close'); },
  };
  const scope = _scopeFor(driver);
  scope.begin();
  const baseline = [...calls];
  const unsupported = [
    'PRAGMA busy_timeout = 1', 'PRAGMA locking_mode = exclusive', 'PRAGMA journal_mode = DELETE', 'PRAGMA wal_checkpoint',
    'SELECT * FROM pragma_busy_timeout(1)', 'SELECT load_extension(?)', 'SELECT * FROM "pragma_busy_timeout"(1)',
    'SELECT 1; PRAGMA busy_timeout = 1', 'SELECT /* hidden */ 1', 'EXPLAIN SELECT 1',
    "SELECT * FROM 'pragma_busy_timeout'", "SELECT * FROM 'pragma_table_info'('evidence')",
    "SELECT * FROM main.'pragma_busy_timeout'", "SELECT * FROM main.'pragma_table_info'('evidence')",
    "SELECT * FROM 'main'.'pragma_busy_timeout'", "SELECT * FROM 'main'.'pragma_table_info'('evidence')",
    "SELECT * FROM ('pragma_busy_timeout')", "SELECT * FROM evidence, 'pragma_busy_timeout'",
    "SELECT * FROM evidence CROSS JOIN 'pragma_busy_timeout'", "SELECT 'count'(*) FROM evidence",
  ];
  for (const sql of unsupported) { expect(() => scope.prepare(sql)).toThrow(TypeError); }
  expect(calls).toEqual(baseline);
  expect(configurationEffects).toBe(0);
  scope.end(); scope.close();
});
