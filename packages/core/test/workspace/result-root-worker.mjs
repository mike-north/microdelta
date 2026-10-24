/**
 * Exercise untyped JavaScript result roots through the assembled alpha facade.
 * Types reject scalar authoring, while runtime publication must still reject
 * invalid JavaScript results without creating a completed History result.
 */
import Database from 'better-sqlite3';

import { authoring, openWorkspace, sourceOutcome } from 'microdelta';

/** The Value atoms whose nesting remains supported under the alpha root limit. */
const atoms = new Map([
  ['string', 'ready'],
  ['number', 1],
  ['boolean', true],
  ['null', null],
  ['undefined', undefined],
  ['negative-zero', -0],
  ['nan', Number.NaN],
  ['infinity', Number.POSITIVE_INFINITY],
]);

const [location, kind, atomName] = process.argv.slice(2);
if (location === undefined || kind === undefined || atomName === undefined || !atoms.has(atomName)) {
  throw new Error('Expected store location, result kind and supported atom name');
}
const atom = atoms.get(atomName);
const builders = authoring();
let bodyCalls = 0;
const source = builders.source({ subject: 'scalar-source', run: () => { bodyCalls += 1; return sourceOutcome.fresh(atom); } });
const memo = builders.memo({ subject: 'scalar-memo', run: () => { bodyCalls += 1; return atom; } });
const wrapped = builders.memo({ subject: 'wrapped-memo', run: () => { bodyCalls += 1; return { value: atom }; } });
const composition = builders.compose({
  scope: 'scalar-root-analysis',
  steps: [{ slot: 'source', declaration: source }, { slot: 'memo', declaration: memo }, { slot: 'wrapped', declaration: wrapped }],
});
const workspace = openWorkspace({ location, logicalStore: 'scalar-root-store' });
let result;
try {
  const run = await workspace.run({ authoring: builders, composition, environment: 'fixture' }, async current => {
    try {
      const outcome = await current.resolve({ scope: 'scalar-root-analysis', role: 'step', slot: kind }, { requestKey: 'first' });
      if (outcome.kind !== 'published') { throw new Error(`Unexpected ${outcome.kind}`); }
      const data = current.read(outcome.reference);
      return { kind: 'returned', hasValue: Object.hasOwn(data, 'value'), matches: Object.is(data.value, atom) };
    } catch (error) {
      return { kind: 'failed', code: error?.code, message: error?.message };
    }
  });
  result = run.value;
} finally {
  workspace.close();
}
/** A failed attempt may exist, but no immutable completed result may follow it. */
const database = new Database(location, { readonly: true });
try {
  const completed = database.prepare('SELECT COUNT(*) AS count FROM history_results').get().count;
  console.log(JSON.stringify({ ...result, completed, bodyCalls }));
} finally {
  database.close();
}
