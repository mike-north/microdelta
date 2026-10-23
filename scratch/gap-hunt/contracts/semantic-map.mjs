/** Exhaustive clause ledger with intentionally conservative semantic-coverage claims. */
import { readFile, writeFile } from 'node:fs/promises';
const prefix = 'scratch/gap-hunt/contracts/';
const inventory = JSON.parse(await readFile(prefix + 'clause-blocks.json', 'utf8'));
const assertions = {};
async function assertion(id, file, title, proves, log) {
  const source = await readFile(file, 'utf8');
  const offset = source.indexOf(title);
  if (offset < 0) throw new Error('Missing test: ' + title);
  assertions[id] = { file, line: source.slice(0, offset).split('\n').length, title, proves, executionLog: prefix + log };
}
const obs = 'packages/tracking/test/observer.test.ts';
const value = 'packages/value/test/value.test.ts';
const keyed = 'packages/core/test/m4-acceptance/keyed.test.ts';
const nested = 'packages/core/test/m4-acceptance/nested.test.ts';
const topology = 'packages/core/test/m4-acceptance/topology.test.ts';
const fold = 'packages/core/test/m4-acceptance/fold.test.ts';
await assertion('leaf', obs, 'tracked containers navigate without whole-tree reads; pass-through is observed only by the callee', 'One selected leaf produces exactly one property path; passing a container adds no sibling or identity evidence.', 'semantic-tracking.log');
await assertion('rebind', obs, 'rebinding an intermediate object keeps equal consumed values and compares later changes at the new path', 'A replacement author with equal name compares equal; its later changed name compares changed; original encoded observation remains Ada.', 'semantic-tracking.log');
await assertion('optional', obs, 'compares absent and present undefined as the same value read, preserving falsey values literally', 'Missing/present undefined fingerprint equal; 0/empty string fingerprints differ.', 'semantic-tracking.log');
await assertion('presence', obs, 'explicit keys, own-property checks, and inherited membership keep their operation meanings', 'Explicit keys, own-property and inherited membership produce distinct operations and expected values.', 'semantic-tracking.log');
await assertion('member', obs, 'membership evidence ignores unrelated additions and changes when the selected member is removed', 'Selected membership equal after unrelated addition; changed after selected deletion.', 'semantic-tracking.log');
await assertion('identity', obs, 'explicit identity reads ignore unread names but change when the identity changes', 'Explicit id changes invalidate; unread name changes do not.', 'semantic-tracking.log');
await assertion('calls', obs, 'called functions record implementation evidence; uncalled functions do not and calls are not memoized', 'Uncalled wrapper has zero evidence, two calls execute twice, actual implementation replacement compares changed.', 'semantic-tracking.log');
await assertion('frames', obs, 'async capture isolates concurrent frames and rejects detached reads after closure', 'Concurrent frames own disjoint evidence and detached late reads throw.', 'semantic-tracking.log');
await assertion('restore', obs, 'async tracked calls preserve post-await reads and nested failure restores the parent capture', 'Awaited reads remain captured; failing nested scope restores parent.', 'semantic-tracking.log');
await assertion('derive', obs, 'cached derivations replay successful and failed semantic observations, including nested derivations', 'Cached success/failure replays consumed semantic observations.', 'semantic-tracking.log');
await assertion('branches', obs, 'local replacement invalidates tags and replaces the semantic branch observations', 'Local scalar guard replacement reevaluates derivation and abandons prior branch evidence.', 'semantic-tracking.log');
await assertion('primitive', obs, 'primitive and class inputs fail at runtime', 'Unsupported primitive and class wrapper inputs throw.', 'semantic-tracking.log');
await assertion('projection', obs, 'retains only projection descriptor and digest while keeping visited coverage explicit', 'Exhaustive one-digest evidence does not retain selected payload; visited coverage stays explicit; insertion changes comparison.', 'semantic-tracking.log');
await assertion('address', value, 'an object numeric key and an array index have different structured addresses', 'Numeric property/index structured evidence stays distinct.', 'semantic-value.log');
await assertion('order', value, 'unordered dictionary content ignores insertion order; ordered enumeration records it', 'Unordered value comparison ignores key insertion order while explicit keys preserves it.', 'semantic-value.log');
await assertion('transport', value, 'snapshot transport preserves later explicit enumeration while equality stays unordered', 'Snapshot transport retains key order independently of normalized equality.', 'semantic-value.log');
await assertion('edges', value, 'round trips supported edge values with stable fingerprints', 'Supported scalar/sparse value roundtrip and digest consistency for enumerated fixtures.', 'semantic-value.log');
await assertion('negative', value, 'unsupported native, callable, symbol, accessor, hidden, cyclic, and shared data fail explicitly', 'Unsupported data classes explicitly reject.', 'semantic-value.log');
await assertion('crossprocess', value, 'an independent Node process preserves canonical bytes and snapshot lookup meaning', 'Independent process equality bytes and snapshot lookup agree.', 'semantic-value.log');
await assertion('frozen', value, 'decoded snapshots cannot mutate retained record or array content', 'Decoded stored data rejects mutation.', 'semantic-value.log');
await assertion('wire', value, 'digest input includes operation, address, fact, and format version', 'Digest input contains structured operation/address/fact/version.', 'semantic-value.log');
await assertion('topology', topology, 'the step factory runs once per process, and mutating every author array, record and input after composing changes nothing in a later process', 'Factory executes once; postcompose mutation preserves topology, retained references, and zero bodies after restart.', 'semantic-composition.log');
await assertion('rejectGraph', topology, 'an operation created from a result is rejected before any work is admitted for it; nothing is published for it or for the summaries that tried it', 'Runtime created declaration rejects before admission/publication.', 'semantic-composition.log');
await assertion('gates', topology, 'with a report that does not read the threshold, a gate flip reaches the fold only through membership, and a flip-free edit runs nothing at all', 'Gate flip changes required membership; flip-free threshold produces zero bodies/admissions; old references remain.', 'semantic-composition.log');
await assertion('keyed', keyed, 'an inserted contributor runs once and reruns the report; a deleted one is no longer required and never retracted; a reorder alone runs no member or report body', 'Insertion admits only new member and aggregate; deletion does not retract; reorder produces zero member/aggregate bodies.', 'semantic-composition.log');
await assertion('nested', nested, 'a rubric wording change reruns every assessment once; summaries and the report keep their exact references with zero bodies', 'Changed tracked child input with equal selected output reruns children while outer references/bodies remain retained/zero.', 'semantic-composition.log');
await assertion('supplied', nested, 'binding rubric B is a child implementation change with equal scores (parents retained); binding rubric C changes Ada', 'Supplied callable replacement is child implementation change; equal selected scores preserve parents and changed scores rerun only affected parents.', 'semantic-composition.log');
await assertion('fold', fold, 'A-11: with Cy failing, Ben pending and discovery open, Ada publishes and the report fails naming each state; the repair runs only the unfinished members and the report', 'Strict fold reports failure/pending/open-discovery and does not run report until repair.', 'semantic-composition.log');
await assertion('coverage', fold, 'a report body that drops exclusions still carries framework coverage naming required and skipped keys and closure, cold and reused', 'Framework coverage survives author omission, cold and reused.', 'semantic-composition.log');
await assertion('empty', fold, 'a closed zero-member listing is a complete report, distinct from an open empty listing and from discovery that did not settle; neither rewinds it', 'Closed empty succeeds; open/unsettled waits without replacing earlier publication.', 'semantic-composition.log');
const ownerEvidence = {
 'TRK-1': ['primitive','leaf','calls'], 'TRK-2':['calls'], 'TRK-3':['frames','restore','derive'],
 'TRK-4':[], 'TRK-5':['leaf','optional','presence','member','identity'], 'TRK-6':['rebind'],
 'TRK-7':['leaf','identity'], 'TRK-8':['branches'], 'VAL-1':['address','wire'],
 'VAL-2':['edges','negative','crossprocess','transport','wire'], 'VAL-3':['frozen'],
 'COL-1':['keyed'], 'COL-2':['projection'], 'COL-3':['order','keyed'], 'COL-4':['keyed','gates'],
 'CMP-1':['topology','rejectGraph'], 'CMP-2':['branches','gates'], 'CMP-3':['supplied'],
 'CMP-4':['topology','keyed'], 'CMP-5':['nested'], 'CMP-6':['supplied','keyed'],
 'CMP-7':['nested'], 'CMP-8':['gates','fold','coverage','empty'], 'CMP-9':['rejectGraph'],
};
// Explicitly map row semantics, rather than pretending owner references prove each row.
const rowEvidence = [
 ['`pr.author.name`',['leaf','rebind']], ['`obj.optional`',['optional']], ['`if (obj.flag)`',['optional']],
 ['Own-property check',['presence']], ['Inherited membership',['presence']], ['Single keyed-member presence',['member']],
 ['Key enumeration',['presence','order']], ['Array `length`',[]], ['Positional array read',[]],
 ['Keyed member field',['keyed']], ['Ordered ranking/list',[]], ['Explicit identity read',['identity']],
 ['Pass object',['leaf']], ['Materialize/return',[]], ['Invoke tracked',['calls']],
];
const documents = new Set(['tracking.md','composition.md','glossary.md'].map(x => 'docs/spec/' + x));
const blocks = inventory.blocks.filter(b => documents.has(b.key.split(':')[0])).map(b => {
 let evidence = b.owner ? (ownerEvidence[b.owner] ?? []) : [];
 if (b.text.startsWith('|')) evidence = rowEvidence.find(([text]) => b.text.includes(text))?.[1] ?? [];
 if (b.key.startsWith('docs/spec/glossary.md:')) {
  evidence = [...new Set(Object.entries(ownerEvidence).filter(([owner]) => b.text.includes(owner)).flatMap(([, ids]) => ids))];
 }
 const nonbehavior = b.text.startsWith('#') || /^\| (Term|Operation|Recipe|Case|---)/u.test(b.text);
 return {
  key: b.key, owner: b.owner, clause: b.text,
  status: nonbehavior ? 'structural-text-no-runtime-claim' : evidence.length ? 'bounded-assertions-with-explicit-uncovered-remainder' : 'explicit-uncovered',
  executedAssertionIds: evidence,
  uncoveredBehavior: nonbehavior ? null : evidence.length
   ? 'Every sub-obligation in this exact clause beyond the bounded proves statements of the linked assertions is explicitly uncovered by this semantic audit. Do not count the whole clause or owner as passed.'
   : 'No independently reviewed executed assertion established this exact clause in this audit. This is an audit coverage gap, not proof the implementation lacks tests or behavior.',
 };
});
await writeFile(prefix + 'semantic-clauses.json', JSON.stringify({
 scope: [...documents], attribution: 'Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.',
 method: 'Each exact inventory paragraph/table row is retained. Assertion proves statements are bounded, manually selected semantic correspondences, not literal-ID matches. Uncovered remainder is explicit and never counted as conformance. Experimental/deferred/proposal paragraphs remain inventoried without asserting they are shipped obligations. Full normative certification remains incomplete.',
 assertions, blocks,
}, null, 2) + '\n');
console.log(JSON.stringify({ blocks: blocks.length, assertionAnchors: Object.keys(assertions).length, explicitUncoveredBlocks: blocks.filter(b => b.status === 'explicit-uncovered').length, partialBlocks: blocks.filter(b => b.executedAssertionIds.length).length }));
