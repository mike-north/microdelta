/** Current calls are reconstructed through two earlier outputs without replaying a retained outer body. */
import { authoring, openWorkspace } from 'microdelta';
import { openHistory } from './durable-history/support.js';
interface IProfile { readonly name: string; readonly unread: string }
interface IConfig { readonly name: string; readonly revision: number; readonly decoration: string; readonly unread: string }
interface IInputs { readonly config: IConfig }
interface IHelpers { readonly trace: (body: string) => void }
interface IListing { readonly profile: IProfile; readonly revision: number }
interface INormalized { readonly payload: { readonly name: string }; readonly decoration: string }
interface IScore { readonly score: number }
type INormalizeArgs = readonly [IProfile];
type IScoreArgs = readonly [string, { readonly name: string }];
/** Fixture diagnostics are not an intended influence on reuse. */
function trace(body: string): void { process.stderr.write(`BODY:${body}\n`); }
function configOf(variant: string): IConfig {
  switch (variant) {
    case 'base': return { name: 'Ada', revision: 1, decoration: 'old', unread: 'one' };
    case 'equal-rebound': return { name: 'Ada', revision: 2, decoration: 'new', unread: 'two' };
    case 'equal-score-new-name': return { name: 'Eve', revision: 3, decoration: 'new', unread: 'three' };
    case 'changed-score': return { name: 'Grace', revision: 4, decoration: 'new', unread: 'four' };
    case 'unread-edit': return { name: 'Grace', revision: 5, decoration: 'new', unread: 'five' };
    default: throw new Error('Unknown multi-hop fixture');
  }
}
const [location, variant, requestKey] = process.argv.slice(2);
if (location === undefined || variant === undefined || requestKey === undefined) { throw new Error('Expected store, variant and request'); }
const builders = authoring<IInputs, IHelpers>();
const { forward } = builders;
const listing = builders.source<IListing>({ subject: 'listing', run: ({ inputs, helpers, outcome }) => {
  helpers.trace('listing');
  return outcome.fresh({ profile: { name: inputs.config.name, unread: inputs.config.unread }, revision: inputs.config.revision });
} });
const normalizeSlot = builders.stepSlot<INormalizeArgs, INormalized>({ slot: 'normalize' });
const scoreSlot = builders.stepSlot<IScoreArgs, IScore>({ slot: 'score' });
const normalize = builders.suppliedStep<INormalizeArgs, INormalized>({ run: ({ args, inputs, helpers }) => {
  helpers.trace('normalize');
  return { payload: { name: args[0].name }, decoration: inputs.config.decoration };
} });
const score = builders.suppliedStep<IScoreArgs, IScore>({ run: ({ args, helpers }) => {
  helpers.trace(`score:${args[0]}`);
  return { score: args[1].name.length };
} });
const outer = builders.memo({ subject: 'outer', children: { listing, normalize: normalizeSlot, score: scoreSlot }, run: async ({ calls, helpers }) => {
  helpers.trace('outer');
  const listed = await calls.listing();
  const normalized = await calls.normalize(forward.child<IProfile>(listed, ['profile']));
  const scored = await calls.score(`score:${normalized.data.payload.name}`, forward.child<{ readonly name: string }>(normalized, ['payload']));
  return { score: scored.data.score };
} });
const root = builders.memo({ subject: 'root', children: { outer }, run: async ({ calls, helpers }) => {
  helpers.trace('root');
  return { score: (await calls.outer()).data.score };
} });
const composition = builders.compose({ scope: 'multihop', inputs: [{ slot: 'config', value: configOf(variant) }], helpers: [{ slot: 'trace', helper: trace }],
  steps: [{ slot: 'listing', declaration: listing }, { slot: 'outer', declaration: outer }, { slot: 'root', declaration: root }],
  supplied: [builders.supply({ slot: normalizeSlot, declaration: normalize, subject: () => 'normalize' }), builders.supply({ slot: scoreSlot, declaration: score, subject: derived => {
    const subject = derived[0];
    if (subject === undefined) { throw new Error('Expected derived score subject'); }
    return subject;
  } })],
});
const workspace = openWorkspace({ location, logicalStore: 'multihop-store' });
try {
  const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async run => {
    const outcome = await run.resolve({ scope: 'multihop', role: 'step', slot: 'root' }, { requestKey });
    if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
    return { kind: outcome.kind, reference: outcome.reference.locator, value: run.read<unknown>(outcome.reference), accepted: outcome.kind === 'reused' ? outcome.acceptance.dependencies.map(item => item.locator) : [] };
  });
  workspace.close();
  const history = openHistory({ location, store: 'multihop-store' });
  try {
    const subjects = Object.fromEntries(['listing', 'normalize', 'outer', 'root', 'score:Ada', 'score:Eve', 'score:Grace'].map(subject => {
      const candidates = history.findCandidates({ analysis: 'multihop', environment: 'test', subject, version: 1 });
      return [subject, candidates.map(candidate => ({ reference: candidate.reference.locator, dependencies: history.readEnvelope(candidate.reference).dependencies.map(item => item.locator), acceptances: history.readAcceptances(candidate.reference, 'test').map(acceptance => acceptance.dependencies.map(item => item.locator)) }))];
    }));
    process.stdout.write(`${JSON.stringify({ ...result.value, subjects })}\n`);
  } finally { history.close(); }
} finally { workspace.close(); }
