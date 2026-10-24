/** TEST-6: cost placement is author choice; reuse observes values and code, not cost kind. */
import { join } from 'node:path';

import { authoring, openWorkspace } from 'microdelta';

/** The cheap leaves deliberately expose a field the aggregate never consumes. */
interface ILeaf { readonly score: number; readonly note: string }
/** A deterministic CPU result with an independently calculable total. */
interface ITotal { readonly total: number }
/** Current author inputs, reconstructed independently in every process. */
interface IInputs { readonly config: { readonly a: number; readonly note: string; readonly cpu: number } }
/** Declared helpers isolate observable body work from infrastructure. */
interface IHelpers {
  readonly a: (score: number, note: string) => ILeaf;
  readonly b: () => ILeaf;
  readonly aggregate: (a: number, b: number) => ITotal;
  readonly cpu: (seed: number) => ITotal;
}
const directory = process.argv[2];
const phase = process.argv[3];
if (directory === undefined || !['a', 'b', 'c', 'd', 'e'].includes(phase ?? '')) {throw new Error('Expected directory and phase a-e');}
/** Counters are process-local evidence only and never drive any author result. */
const counts = { a: 0, b: 0, aggregate: 0, cpu: 0, aggregateIterations: 0, cpuIterations: 0 };
/** One cheap leaf publishes both fields; downstream observation selects score only. */
function leafA(score: number, note: string): ILeaf { counts.a += 1; return { score, note }; }
/** An independent unchanged cheap leaf. */
function leafB(): ILeaf { counts.b += 1; return { score: 3, note: 'stable' }; }
/** CPU-only aggregate; bounded additions create actual work without a timing promise. */
function aggregate(a: number, b: number): ITotal {
  counts.aggregate += 1;
  let total = 0;
  for (let index = 0; index < 100000; index += 1) { total += a + b; counts.aggregateIterations += 1; }
  return { total };
}
/** Standalone memo work has no dependency on the leaves or aggregate. */
function cpu(seed: number): ITotal {
  counts.cpu += 1;
  let total = 0;
  for (let index = 0; index < 100000; index += 1) { total += seed; counts.cpuIterations += 1; }
  return { total };
}
const api = authoring<IInputs, IHelpers>();
const a = api.memo({ subject: 'cheap-a', run: ({ inputs, helpers }) => helpers.a(inputs.config.a, inputs.config.note) });
const b = api.memo({ subject: 'cheap-b', run: ({ helpers }) => helpers.b() });
const combined = api.memo({ subject: 'cpu-aggregate', children: { a, b }, run: async ({ calls, helpers }) => {
  const aValue = await calls.a();
  const bValue = await calls.b();
  return helpers.aggregate(aValue.data.score, bValue.data.score);
} });
const standalone = api.memo({ subject: 'cpu-only', run: ({ inputs, helpers }) => helpers.cpu(inputs.config.cpu) });
const composition = api.compose({
  scope: 'cost-neutrality',
  inputs: [{ slot: 'config', value: { a: phase === 'd' || phase === 'e' ? 4 : 2, note: phase === 'a' || phase === 'b' ? 'original' : 'edited', cpu: phase === 'e' ? 11 : 7 } }],
  helpers: [{ slot: 'a', helper: leafA }, { slot: 'b', helper: leafB }, { slot: 'aggregate', helper: aggregate }, { slot: 'cpu', helper: cpu }],
  steps: [{ slot: 'a', declaration: a }, { slot: 'b', declaration: b }, { slot: 'aggregate', declaration: combined }, { slot: 'cpu', declaration: standalone }],
});
const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'cost-neutrality' });
try {
  const result = await workspace.run({ authoring: api, composition, environment: 'synthetic', runId: `cost:${phase}` }, async run => {
    const results: Record<string, unknown> = {};
    for (const slot of ['aggregate', 'cpu', 'a', 'b']) {
      const resolved = await run.resolve({ scope: 'cost-neutrality', role: 'step', slot }, { requestKey: `${phase}:${slot}` });
      if (resolved.kind === 'refused' || resolved.kind === 'skipped') {throw new Error('Expected completed result');}
      results[slot] = { kind: resolved.kind, reference: resolved.reference, data: run.read<unknown>(resolved.reference) };
    }
    return results;
  });
  console.log(JSON.stringify({ phase, counts, results: result.value }));
} finally { workspace.close(); }
