import { randomUUID } from 'node:crypto';
import { authoring, openWorkspace } from 'microdelta';
import { collect, fixture } from './adapter.js';
import type { IRecord } from './adapter.js';

/** Provider traversal is application work; the runtime receives a complete current snapshot. */
interface IInputs { readonly snapshot: readonly IRecord[] }
interface ISummary { readonly count: number; readonly total: number; readonly ids: readonly number[] }
const provider = fixture();
const records = await collect(provider.fetch);
const builders = authoring<IInputs, Record<never, never>>();
const snapshot = builders.source<readonly IRecord[]>({
  subject: 'github-like:four-record-snapshot',
  finality: () => true,
  run: ({ inputs, outcome }) => {
    const copied: IRecord[] = [];
    for (let index = 0; index < inputs.snapshot.length; index += 1) {
      const record = inputs.snapshot[index];
      if (record === undefined) { throw new Error('missing source record'); }
      copied.push({ id: record.id, score: record.score });
    }
    return outcome.fresh<readonly IRecord[]>(copied);
  },
});
const summary = builders.memo({
  subject: 'github-like:summary',
  children: { snapshot },
  run: async ({ calls }): Promise<ISummary> => {
    const { data } = await calls.snapshot();
    let total = 0;
    const ids: number[] = [];
    for (let index = 0; index < data.length; index += 1) {
      const record = data[index];
      if (record === undefined) { throw new Error('missing snapshot record'); }
      total += record.score;
      ids.push(record.id);
    }
    return { count: data.length, total, ids };
  },
});
const composition = builders.compose({ scope: 'cursor-pipeline', inputs: [{ slot: 'snapshot', value: records }], steps: [{ slot: 'snapshot', declaration: snapshot }, { slot: 'summary', declaration: summary }] });
const location = process.argv[2];
if (location === undefined) { throw new Error('store location required'); }
const workspace = openWorkspace({ location, logicalStore: 'cursor' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'fixture' }, async run => {
    const outcome = await run.resolve({ scope: 'cursor-pipeline', role: 'step', slot: 'summary' }, { requestKey: randomUUID() });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`unexpected outcome: ${outcome.kind}`); }
    return { calls: provider.calls, kind: outcome.kind, reference: outcome.reference, data: run.read<ISummary>(outcome.reference) };
  });
  console.log(JSON.stringify(result.value));
} finally { workspace.close(); }
