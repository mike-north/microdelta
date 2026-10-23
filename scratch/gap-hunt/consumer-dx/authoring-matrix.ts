/** Generated-alpha consumer matrix: supported array roots and source policy envelopes. */
import { authoring, openWorkspace } from 'microdelta';
interface IRow { readonly key: string; readonly score: number }
type IRows = readonly IRow[];
interface IInputs { readonly minimum: number }
interface IListing { readonly status: 'complete'; readonly members: IRows }
const [location, requestKey] = process.argv.slice(2);
if (location === undefined || requestKey === undefined) { throw new Error('Expected store and request key'); }
const api = authoring<IInputs, Record<string, never>>();
const rows = api.source<IRows>({ subject: 'rows', run: ({ outcome, previous }) => previous === undefined ? outcome.fresh<IRows>([{ key: 'ada', score: 3 }]) : outcome.retain(previous) });
const arrayMemo = api.memo({ subject: 'array-memo', children: { rows }, run: async ({ calls }) => {
  const data = (await calls.rows()).data;
  const row = data[0];
  if (row === undefined) { throw new Error('Expected one row'); }
  return [{ key: row.key, score: row.score }];
} });
const tuple = api.memo({ subject: 'tuple', run: (): readonly [number, string] => [3, 'ada'] });
const summary = api.memo({ subject: 'summary', children: { arrayMemo, tuple }, run: async ({ calls }) => {
  const values = (await calls.arrayMemo()).data;
  const selected = values[0];
  if (selected === undefined) { throw new Error('Expected array child'); }
  const pair = (await calls.tuple()).data;
  return { key: selected.key, score: selected.score + pair[0], name: pair[1], length: values.length };
} });
const listing = api.source<IListing>({ subject: 'listing', collection: { identity: 'key' }, finality: () => true, run: ({ outcome }) => outcome.fresh<IListing>({ status: 'complete', members: [{ key: 'ada', score: 3 }, { key: 'ben', score: 1 }] }) });
const template = api.template({ slot: 'person', collection: listing, gate: ({ member, inputs }) => member.score >= inputs.minimum, steps: member => ({ result: member.memo({ subject: member.subject('result'), run: ({ member: bound }) => [bound.key, bound.score] }) }) });
const composition = api.compose({ scope: 'matrix', inputs: [{ slot: 'minimum', value: 2 }], steps: [{ slot: 'rows', declaration: rows }, { slot: 'arrayMemo', declaration: arrayMemo }, { slot: 'tuple', declaration: tuple }, { slot: 'summary', declaration: summary }, { slot: 'listing', declaration: listing }], templates: [template] });
const workspace = openWorkspace({ location, logicalStore: 'matrix' });
try {
  const result = await workspace.run({ authoring: api, composition, environment: 'fixture' }, async run => {
    const resolved = await run.resolve({ scope: 'matrix', role: 'step', slot: 'summary' }, { requestKey: `${requestKey}:summary` });
    if (resolved.kind !== 'published' && resolved.kind !== 'reused') { throw new Error(`Unexpected ${resolved.kind}`); }
    const members = await run.resolveMembers({ template: 'person', step: 'result' }, { requestKey: `${requestKey}:members` });
    return { kind: resolved.kind, reference: resolved.reference, value: run.read<unknown>(resolved.reference), members };
  });
  console.log(JSON.stringify(result.value));
} finally { workspace.close(); }
