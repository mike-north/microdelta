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
await assertion('asyncFailure', 'packages/tracking/test/gap-hunt-contracts-async.test.ts', 'caught tracked async helper failure keeps post-await consumed facts in its consuming frame', 'Caught async helper exception retains exactly before/after leaf evidence plus implementation, without unread sibling evidence.', 'async-results.log');
await assertion('lateHelper', 'packages/tracking/test/gap-hunt-contracts-async.test.ts', 'a detached helper callback after capture %s rejects before its body runs', 'After either success or failure, detached tracked helper invocation throws closed-frame before author body; a fresh frame still calls normally.', 'async-results.log');
await assertion('multiRebind', 'packages/core/test/gap-hunt-contracts-operation-matrix.test.ts', 'TRK-6 historical path rebinds through two equal identities and detects both later leaf updates', 'Five independent processes retain exact references across equal id replacement and publish on both subsequent current-leaf changes.', 'operation-matrix-results.log');
await assertion('currentArguments', 'packages/core/test/gap-hunt-contracts-nested-current.test.ts', 'renumbered derived subjects and changed forwarded fields agree with cold computation across successive restarts', 'Renumbered PR derived subject executes only new child; changed current forwarded PR field executes only affected child/parent; both match cold current stores; rollback reuses.', 'nested-current-results.log');
await assertion('captureLint', 'tooling/tracked-captures.test.mjs', 'typed capture fixture accepts branded influences and flags each documented negative', 'Real typed generated-declaration consumer accepts branded inputs and reports extracted scalar, external flag/helper/config, forged brands and unsupported callback syntax.', 'semantic-capture-lint.log');
await assertion('lengthPosition', obs, 'array length and positional reads remain separate; native reflection rejects the non-enumerable length case', 'Length operation and positional Index address differ; unsupported native reflection rejects visibly.', 'semantic-tracking.log');
await assertion('selectedOutput', 'packages/tracking/test/output-observation.test.ts', 'pass-through stays neutral until snapshotOutput explicitly detaches the selected subtree', 'Explicit selected output detaches only requested subtree and records materialization evidence.', 'semantic-tracking.log');
await assertion('slotMissing', 'packages/definition/test/nested-composition.test.ts', 'EXP-4: opening a parent whose declared slot is unsupplied rejects with missing-slot before any callback runs', 'Missing declared supplied slot rejects before author callback.', 'semantic-definition.log');
await assertion('slotAmbiguous', 'packages/definition/test/nested-composition.test.ts', 'EXP-4: a slot supplied twice rejects with ambiguous-slot, distinct from missing, before any callback runs', 'Multiply supplied slot produces ambiguous-slot before author callback.', 'semantic-definition.log');
await assertion('memberBinding', 'packages/definition/test/member-binding.test.ts', 'instance source run and finality, and member memo run, receive the supplier', 'Instance run/finality/memo receive current supplied member view; component port assertion only.', 'semantic-definition.log');
await assertion('justification', 'packages/definition/test/nested-witness.test.ts', 'CMP-7: justification is read back for forwarded and derived recipes alike, never inferred', 'Forwarded and derived justification flags survive witness parsing rather than inferred validity.', 'semantic-definition.log');
await assertion('argumentMiss', nested, 'an argument derived after an observed untracked read', 'Unjustified and unreconstructible parent variants produce distinct honest misses, one normal parent execution, retained eligible children and report; no validation-only replay.', 'semantic-composition.log');
await assertion('prepare', 'experiments/exp-2/materialization.test.ts', 'explicit async preparation retains ordinary reads for prepared scalars', 'Experimental prepared name reads normally; unprepared city throws without additional source read.', 'semantic-exp2.log');
await assertion('scalarLoading', 'experiments/exp-2/materialization.test.ts', 'fingerprint-only verification makes zero payload reads; positive control really reads', 'Experimental scalar fingerprint check performs zero payload reads, with read-positive control.', 'semantic-exp2.log');
await assertion('nestedLoading', 'experiments/exp-nested/test/nested-sqlite.test.ts', 'view creation, navigation and selected leaves read no root, sibling or unrelated subtree payload', 'Separate-process SQLite nested fixture limits returned payload cells to selected leaf; not disk-page IO or scale evidence.', 'semantic-expnested.log');
await assertion('nestedMetadata', 'experiments/exp-nested/test/nested-sqlite.test.ts', 'metadata comparison in a fresh process performs zero payload fallback', 'Fresh-process nested SQLite fingerprint comparison requests zero payload fallback.', 'semantic-expnested.log');
await assertion('durableBranches', 'packages/core/test/gap-hunt-contracts-operation-matrix.test.ts', 'TRK-8 durable scalar branch replacement abandons old reads and detects newly active reads', 'Five independent processes flip scalar-guard branch, reuse after abandoned leaf edit, publish after newly active leaf edit, and validate old exact result on rollback.', 'operation-matrix-results.log');
await assertion('edgeKeys', 'packages/core/test/gap-hunt-contracts-edge-oracle.test.ts', 'literal special key %s: unread/equal-inherited/changed/current rollback', 'Eight tricky key spellings including lone UTF16 surrogate remain distinct under declared current bindings across unread edits, custom inherited equality, changed values and rollback, matching cold stores.', 'edge-oracle-results.log');
await assertion('edgeNumbers', 'packages/core/test/gap-hunt-contracts-edge-oracle.test.ts', 'canonical number atoms distinguish zero signs, NaN and infinities across restart and rollback', 'Zero, negative zero, NaN and both infinities produce correct current conditional values and exact publish/reuse expectations through fresh-process warm/cold histories.', 'edge-oracle-results.log');
await assertion('edgeSparse', 'packages/core/test/gap-hunt-contracts-edge-oracle.test.ts', 'sparse hole and present undefined have distinct indexed membership facts', 'Sparse holes and present undefined differ under indexed membership through restart, later fill and rollback; separate positional-value row equates them.', 'edge-oracle-results.log');
await assertion('importCapture', 'scratch/gap-hunt/contracts/transitive-capture-lint-probe.mjs', 'assert.equal(diagnostics.length, 4)', 'Actual type-aware lint emits three imported ordinary-helper external-capture diagnostics and one documented unsupported imported-callback diagnostic; no silent bypass in four tested routes.', 'transitive-capture-lint-results.log');
await assertion('ranking', 'packages/tracking/test/gap-hunt-contracts-invalidation.test.ts', 'TRK-5 ordered ranking changes with selected scores and ignores unselected member fields', 'Explicit ranked key sequence reads keys/scores only; changed selected score invalidates while changed unselected avatar fields compare equal.', 'tracking-results.log');
await assertion('outputShape', 'packages/tracking/test/gap-hunt-contracts-output.test.ts', '$name', 'Eight current-shape rows establish selected output sensitivity to record order, missing/undefined, holes, inherited data and ownership, with equal-shape and equal-chain controls; unread sibling is outside the exact subtree request.', 'output-results.log');
await assertion('concurrentReplay', 'packages/tracking/test/gap-hunt-contracts-async.test.ts', 'cached %s evidence replays into each concurrent consumer without leaking its peer leaves', 'Overlapping async frames replay one warmed success/failure derivation without reexecution, close one frame while its peer remains open, and retain exactly each frame own leaves plus shared evidence.', 'async-results.log');
await assertion('falseyGuard', 'packages/core/test/gap-hunt-contracts-operation-matrix.test.ts', 'TRK-5 falsey guard values remain distinct consumption across restart despite equal branch output', 'Eight independent processes distinguish 0, empty string, false, null, undefined, NaN and negative zero as consumed guard facts despite identical falsey output, then roll back to original zero exact result.', 'falsey-guard-results.log');
const blockEvidence = {
 'docs/spec/tracking.md:62': ['falseyGuard'],
 'docs/spec/tracking.md:70': ['ranking'],
 'docs/spec/glossary.md:75': ['leaf','calls'],
 'docs/spec/glossary.md:81': ['frames','restore','asyncFailure','lateHelper'],
 'docs/spec/glossary.md:104': ['selectedOutput','nestedLoading'],
 'docs/spec/glossary.md:127': ['nested','calls'],
 'docs/spec/glossary.md:133': ['rebind','multiRebind','nested'],
 'docs/spec/composition.md:34': ['supplied','slotMissing','slotAmbiguous'],
 'docs/spec/composition.md:51': ['topology','memberBinding','keyed'],
 'docs/spec/composition.md:82': ['supplied','slotMissing','slotAmbiguous'],
 'docs/spec/composition.md:90': ['keyed'],
 'docs/spec/composition.md:104': ['justification','currentArguments'],
 'docs/spec/composition.md:110': ['justification','currentArguments'],
 'docs/spec/composition.md:111': ['justification','currentArguments'],
 'docs/spec/composition.md:112': ['argumentMiss'],
 'docs/spec/composition.md:114': ['currentArguments','argumentMiss','nested'],
 'docs/spec/composition.md:137': ['fold','coverage','empty','gates'],
 'docs/spec/composition.md:175': ['supplied'],
 'docs/spec/composition.md:176': ['keyed'],
 'docs/spec/composition.md:177': ['gates'],
 'docs/spec/composition.md:178': ['rejectGraph'],
 'docs/spec/composition.md:179': ['nested'],
 'docs/spec/composition.md:180': ['argumentMiss'],
 'docs/spec/composition.md:181': ['topology'],
 'docs/spec/tracking.md:41': ['captureLint','importCapture'],
 'docs/spec/tracking.md:67': ['lengthPosition'],
 'docs/spec/tracking.md:68': ['lengthPosition'],
 'docs/spec/tracking.md:73': ['selectedOutput'],
 'docs/spec/tracking.md:126': ['transport','wire'],
 'docs/spec/tracking.md:135': ['edges','transport'],
 'docs/spec/tracking.md:143': ['negative'],
 'docs/spec/tracking.md:181': ['scalarLoading'],
 'docs/spec/tracking.md:188': ['prepare'],
 'docs/spec/tracking.md:196': ['nestedLoading','selectedOutput'],
 'docs/spec/tracking.md:206': ['nestedLoading','nestedMetadata'],
};
const ownerEvidence = {
 'TRK-1': ['primitive','leaf','calls'], 'TRK-2':['calls'], 'TRK-3':['frames','restore','derive','asyncFailure','lateHelper','concurrentReplay'],
 'TRK-4':['captureLint','importCapture'], 'TRK-5':['leaf','optional','presence','member','identity'], 'TRK-6':['rebind','multiRebind'],
 'TRK-7':['leaf','identity'], 'TRK-8':['branches','durableBranches','outputShape'], 'VAL-1':['address','wire','edgeKeys'],
 'VAL-2':['edges','negative','crossprocess','transport','wire','edgeNumbers','edgeSparse'], 'VAL-3':['frozen'],
 'COL-1':['keyed'], 'COL-2':['projection'], 'COL-3':['order','keyed'], 'COL-4':['keyed','gates'],
 'CMP-1':['topology','rejectGraph'], 'CMP-2':['branches','gates'], 'CMP-3':['supplied'],
 'CMP-4':['topology','keyed'], 'CMP-5':['nested'], 'CMP-6':['supplied','keyed'],
 'CMP-7':['nested','currentArguments'], 'CMP-8':['gates','fold','coverage','empty'], 'CMP-9':['rejectGraph'],
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
 if (blockEvidence[b.key]) evidence = blockEvidence[b.key];
 const nonbehavior = b.text.startsWith('#') || b.text.startsWith('Status:') || /^\| (Term|Operation|Recipe|Case|---)/u.test(b.text);
 if (nonbehavior) evidence = [];
 return {
  key: b.key, owner: b.owner, clause: b.text,
  obligationKind: nonbehavior ? 'structural' : b.text.includes('EXP-6') || /historical Lean|checked proof|model uses UTF-16/u.test(b.text) ? 'historical-evidence-dormant' : /proposed .*convenience|exact identity-bearing brand\/helper API remains experimental/u.test(b.text) ? 'normative-with-proposed-unavailable-surface' : b.key.startsWith('docs/spec/glossary.md:') ? 'definition-owned-by-linked-contract' : 'normative-or-bounded-selected-contract',
  status: nonbehavior ? 'structural-text-no-runtime-claim' : evidence.length ? 'bounded-assertions-with-explicit-uncovered-remainder' : 'explicit-uncovered',
  executedAssertionIds: evidence,
  otherOwnerEvidence: b.key.startsWith('docs/spec/glossary.md:') && /operations.md|execution.md/u.test(b.text) ? { branch: 'gap-hunt-durability', commit: 'bfb1cc3', ledger: 'scratch/gap-hunt/contract-operations/requirement-evidence.json', executionIndex: 'scratch/gap-hunt/contract-operations/test-execution-index.json', boundary: 'Suite-granular bounded owner evidence only; does not certify every glossary sub-obligation; three launch SIGKILL failures are not passes.' } : null,
  uncoveredBehavior: nonbehavior ? null : evidence.length
   ? 'Every sub-obligation in this exact clause beyond the bounded proves statements of the linked assertions is explicitly uncovered by this semantic audit. Do not count the whole clause or owner as passed.'
   : 'No independently reviewed executed assertion established this exact clause in this audit. This is an audit coverage gap, not proof the implementation lacks tests or behavior.',
 };
});
await writeFile(prefix + 'semantic-clauses.json', JSON.stringify({
 scope: [...documents], attribution: 'Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.',
 method: 'Each exact inventory paragraph/table row is retained. Assertion proves statements are bounded, manually selected semantic correspondences, not literal-ID matches. Uncovered remainder is explicit and never counted as conformance. Experimental/deferred/proposal paragraphs remain inventoried without asserting they are shipped obligations. Full normative certification remains incomplete.',
 assertions, blocks,
 counterexamples: [{
  kind: 'confirmed-distinct-root-cause-supervisor-filing-owned',
  file: 'packages/tracking/test/gap-hunt-contracts-intrinsic-presence.test.ts',
  executionLog: prefix + 'intrinsic-presence-results.log',
  status: '9 intentionally red presence assertions;2 green supported/rejected-domain controls',
  governingClauses: ['docs/spec/tracking.md:63', 'docs/spec/tracking.md:64', 'docs/spec/tracking.md:135-141'],
  detail: 'Own/membership over Object.prototype intrinsic names reject by selecting unsupported intrinsic data before producing only the required boolean fact. Visible overrejection; not #155 false reuse.',
 }],
}, null, 2) + '\n');
console.log(JSON.stringify({ blocks: blocks.length, assertionAnchors: Object.keys(assertions).length, explicitUncoveredBlocks: blocks.filter(b => b.status === 'explicit-uncovered').length, partialBlocks: blocks.filter(b => b.executedAssertionIds.length).length }));
