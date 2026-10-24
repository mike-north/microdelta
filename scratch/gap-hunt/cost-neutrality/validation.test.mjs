import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from '@jest/globals';

/** Every observation comes from an independent process over the same durable store. */
function run(directory, phase) {
  const child = spawnSync(process.execPath, [join(import.meta.dirname, 'dist/worker.js'), directory, phase], { encoding: 'utf8', timeout: 30000 });
  if (child.status !== 0) throw new Error(child.stderr);
  expect(child.status).toBe(0);
  return JSON.parse(child.stdout.trim().split('\n').at(-1));
}
function counts(value, a, b, aggregate, cpu) {
  expect(value.counts).toEqual({ a, b, aggregate, cpu, aggregateIterations: aggregate * 100000, cpuIterations: cpu * 100000 });
}
function retained(next, previous, slots) {
  for (const slot of slots) expect(next.results[slot].reference).toEqual(previous.results[slot].reference);
}
(process.env.COST_ORACLE_STORE === undefined ? test : test.skip)('TEST-6: CPU memo and cheap leaves with CPU aggregate preserve selected-work boundaries across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-cost-'));
  const a = run(directory, 'a'); counts(a, 1, 1, 1, 1);
  expect(a.results.aggregate.data).toEqual({ total: 5 * 100000 });
  expect(a.results.cpu.data).toEqual({ total: 7 * 100000 });
  const b = run(directory, 'b'); counts(b, 0, 0, 0, 0); retained(b, a, ['a','b','aggregate','cpu']);
  const c = run(directory, 'c'); counts(c, 1, 0, 0, 0); retained(c, b, ['b','aggregate','cpu']);
  expect(c.results.a.reference).not.toEqual(b.results.a.reference);
  const d = run(directory, 'd'); counts(d, 1, 0, 1, 0); retained(d, c, ['b','cpu']);
  expect(d.results.aggregate.data).toEqual({ total: 7 * 100000 });
  expect(d.results.aggregate.reference).not.toEqual(c.results.aggregate.reference);
  const e = run(directory, 'e'); counts(e, 0, 0, 0, 1); retained(e, d, ['a','b','aggregate']);
  expect(e.results.cpu.data).toEqual({ total: 11 * 100000 });
  expect(e.results.cpu.reference).not.toEqual(d.results.cpu.reference);
  for (const row of [a,b,c,d,e]) {
    expect(row.results.a.data).toEqual({ score: ['d','e'].includes(row.phase) ? 4 : 2, note: ['a','b'].includes(row.phase) ? 'original' : 'edited' });
    expect(row.results.b.data).toEqual({ score: 3, note: 'stable' });
    expect(row.results.aggregate.data).toEqual({ total: (['d','e'].includes(row.phase) ? 7 : 5) * 100000 });
    expect(row.results.cpu.data).toEqual({ total: (row.phase === 'e' ? 11 : 7) * 100000 });
  }
  console.log(JSON.stringify({ directory, observations: [a,b,c,d,e] }));
});

(process.env.COST_ORACLE_STORE === undefined ? test.skip : test)('unchanged cost oracle rejects legitimate extra aggregate execution', () => {
  const row = run(process.env.COST_ORACLE_STORE, 'b');
  console.log(JSON.stringify({ counterfactual: row }));
  counts(row, 0, 0, 0, 0);
  const baseline = JSON.parse(readFileSync(process.env.COST_BASELINE, 'utf8'));
  retained(row, baseline, ['a', 'b', 'aggregate', 'cpu']);
});
