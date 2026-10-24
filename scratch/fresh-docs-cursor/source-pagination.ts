import { randomUUID } from 'node:crypto';
import { authoring, openWorkspace } from 'microdelta';
import { collect } from './adapter.js';
import type { IRunObserver } from 'microdelta';
import type { IRecord, IPage } from './adapter.js';

/** Fake immutable revision is current policy, not a universal GitHub validator. */
interface IInputs { readonly revision: string }
interface IHelpers { readonly fetch: (cursor: string | null) => Promise<IPage>; readonly collect: typeof collect }
interface ISummary { readonly count: number; readonly total: number; readonly ids: readonly number[] }
/** Instrument only actual provider sends; no captured provider state influences output. */
async function fetchPage(cursor: string | null): Promise<IPage> {
  console.error(`provider-page:${cursor}`);
  if (cursor === null) { return { records: [{ id: 2, score: 2 }, { id: 1, score: 1 }], next: 'page:2' }; }
  if (cursor === 'page:2') { return { records: [{ id: 4, score: 4 }, { id: 3, score: 3 }], next: null }; }
  throw new Error('unknown cursor');
}
const builders = authoring<IInputs, IHelpers>();
const snapshot = builders.source<readonly IRecord[]>({
  subject: 'github-like:source-pages',
  // This deterministic provider's revision is immutable; an actual provider needs its own policy.
  finality: ({ inputs }) => inputs.revision === 'fixture-v1',
  run: async ({ helpers, outcome }) => outcome.fresh<readonly IRecord[]>(await helpers.collect(helpers.fetch)),
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
const composition = builders.compose({ scope: 'cursor-pipeline', inputs: [{ slot: 'revision', value: 'fixture-v1' }], helpers: [{ slot: 'fetch', helper: fetchPage }, { slot: 'collect', helper: collect }], steps: [{ slot: 'snapshot', declaration: snapshot }, { slot: 'summary', declaration: summary }] });
const location = process.argv[2];
if (location === undefined) { throw new Error('store location required'); }
const executions: Record<string, number> = {};
const observer: IRunObserver = { observe(event) {
  if (event.kind === 'step' && event.event.phase === 'execute') {
    const slot = event.event.step.slot;
    executions[slot] = (executions[slot] ?? 0) + 1;
  }
} };
const workspace = openWorkspace({ location, logicalStore: 'cursor' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'fixture', observers: [observer] }, async run => {
    const outcome = await run.resolve({ scope: 'cursor-pipeline', role: 'step', slot: 'summary' }, { requestKey: randomUUID() });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`unexpected outcome: ${outcome.kind}`); }
    return { executions, kind: outcome.kind, reference: outcome.reference, data: run.read<ISummary>(outcome.reference) };
  });
  console.log(JSON.stringify(result.value));
} finally { workspace.close(); }
