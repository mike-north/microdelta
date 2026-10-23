/** Preserve the historical audit and make its corrected evidence boundaries mechanically inspectable. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = 'scratch/gap-hunt/contracts/';
const prior = JSON.parse(await readFile(base + 'completion-audit.json', 'utf8'));
const added = {};
async function anchor(id, file, title, log, proves) {
  const source = await readFile(file, 'utf8');
  const offset = source.indexOf(title);
  if (offset < 0) throw new Error(`Missing assertion ${id}`);
  const executionLog = base + log;
  await readFile(executionLog, 'utf8');
  added[id] = { file, line: source.slice(0, offset).split('\n').length, title, executionLog, proves };
}
await anchor('importedDeclaration', 'packages/tracking/test/gap-hunt-contracts-imported-closure.test.ts', 'an imported tracked declaration needs no rewrap and unchanged helper text still invalidates for changed tracked closure facts', 'imported-closure-results.log', 'A genuinely already-tracked module export is called directly; repeated derivation is cached; tracked closure factor replacement changes 6 to 9; implementation evidence remains equal. Fresh current-fact comparison ignores unread metadata. Local-cell replacement is not claimed to avoid recomputation.');
await anchor('lengthPositionTransitions', 'packages/tracking/test/gap-hunt-contracts-invalidation.test.ts', 'gap hunt TRK-5 invalidation matrix', 'tracking-results.log', 'Executed rows: same length element replacement equal; append changes length; insert before consumed position changed; edit after consumed position equal; unread field edit equal; missing/present undefined value equal but own/membership changed. These are comparison outcomes, not durable body counts.');
await anchor('forwardedUnjustified', 'packages/core/test/nested/arguments.test.ts', 'a forwarded path chosen after an observed untracked read is unjustified: the parent reruns and reads the current choice', 'resolution-gap-controls.log', 'Forwarded unjustified is a distinct executed variant, not inferred from derived unjustified. Included in verified 221-test baseline and restored matrix.');
await anchor('forwardedUnavailable', 'packages/core/test/nested/arguments.test.ts', 'a forwarded origin whose current shape no longer answers the recorded path is changed evidence', 'resolution-gap-controls.log', 'An unavailable current forwarded path is not replaced by its saved value.');
await anchor('unreconstructible', 'packages/core/test/nested/validation.test.ts', 'an unreconstructible argument is an immediate miss before its child is invoked; the parent reruns and children reuse', 'resolution-gap-controls.log', 'Unreconstructible function argument honestly misses before child invocation.');
await anchor('promiseGate', 'packages/core/test/keyed/members.test.ts', 'a gate that returns a %s fails only that member: it returned a promise, not a boolean', 'resolution-gap-controls.log', 'Both promise and thenable rows execute, beyond scalar/nonboolean/throw gate negatives.');
await anchor('foldObserver', 'packages/core/test/gap-hunt-contracts-fold-observer.test.ts', 'a pre-execution member observer failure rejects the whole strict-fold request and publishes no fold', 'fold-observer-results.log', 'Observer exception at member verify rejects with observer-failure; fold body and publication remain absent. Post-commit observer diagnostics are a separate settled contract.');
await anchor('foldIntegrity', 'packages/core/test/fold/fold.test.ts', 'malformed version-3 fold evidence is integrity damage, never a miss: %s', 'resolution-gap-controls.log', 'Malformed version-3 fold evidence returns request integrity error; #144 additionally tests missing own implementation.');
await anchor('calledHelperBodies', 'packages/core/test/resolution/summary-validation.test.ts', 'a changed called formatter re-executes both summaries even with unchanged statistics', 'resolution-gap-controls.log', 'Durable summaries run twice after consumed helper code changes despite equal output.');
await anchor('uncalledHelperBodies', 'packages/core/test/resolution/summary-validation.test.ts', 'a changed uncalled helper alone retains both summaries', 'resolution-gap-controls.log', 'Durable summaries retain references with zero bodies when only uncalled helper changes.');
await anchor('durableArtifacts', 'packages/core/test/gap-hunt-contracts-artifact-durable.test.ts', 'Track D durable emitted imported implementation variants', 'artifact-durable-results.log', 'Six cases each use cold/changed/repeated fresh processes over the same store. Declared transitive imported body/name/emitted-comment/emitted-format changes each execute one body with a different exact reference; unchanged modules and version metadata alone execute zero bodies and retain the exact baseline reference. Every repeated variant reuses with zero bodies. Actual references/counts and leaf hashes are in artifact-durable-results.json.');
const corrections = {
  'TRK1-imported': { status: 'aligned-new-witness', evidence: ['importedDeclaration'], note: 'Prior imported-artifact probe imported a raw function and wrapped it in the consumer; that alone did not prove this requirement.' },
  'TRK2-called-only': { evidence: ['calledHelperBodies', 'uncalledHelperBodies'], note: 'Keep observer evidence and durable re-execution counts distinct.' },
  'TRK2-artifact-policy': { status: 'aligned-durable-variant-witnesses', evidence: ['durableArtifacts'], note: 'Original six probes established observer comparison only. Added six durable cases now measure bodies and exact references across 18 fresh processes. All imported implementations are explicit declared helpers; hidden untracked transitive effects remain excluded. Comment/format edits matter only when present in emitted function text.' },
  'TRK4-ordinary-guard': { status: 'historical-divergence-superseded', note: '#155 is baseline evidence; merged #171 at f43c587 changes bounded container-kind navigation. Do not describe the old failure as confirmed current behavior.' },
  'TRK5-length': { evidence: ['lengthPositionTransitions'], note: 'Old observer.test.ts static operation/address assertion did not alone prove length invalidation boundaries.' },
  'TRK5-position': { evidence: ['lengthPositionTransitions'], note: 'Old observer.test.ts static operation/address assertion did not alone prove insertion/edit invalidation boundaries.' },
  'TRK5-pass-through': { status: 'baseline-aligned-current-spec-delta', note: 'At c5802da only callee facts were recorded. #171 adds bounded navigation container-kind, excluding members/length/identity/payload. Old no-kind evidence is historical, not proof against the newer table.' },
  'CMP7-honest-miss': { evidence: ['forwardedUnjustified', 'forwardedUnavailable', 'unreconstructible'], note: 'Include forwarded and derived justification, unavailable current path and unreconstructible function as separate required variants.' },
  'CMP8-gate-kind': { status: 'spec-scope-reconciliation-required-156', evidence: ['promiseGate'], note: 'Scalar nonboolean, throw, promise and thenable negatives plus explicit skipped-entry behavior are covered. Bare undefined success is not: #156 selects record/array roots for current alpha. Wrapped undefined data does not prove bare undefined success. composition.md:131-135 still names the full-target distinction.' },
  'CMP8-infrastructure': { status: 'aligned-expanded-variants', evidence: ['foldObserver', 'foldIntegrity'], note: 'Old evidence covered admission only. Now admission, pre-execution member observer, and integrity have explicit request-level witnesses; post-commit observer errors preserve committed outcomes with diagnostics per existing tests.' },
};
const obligations = prior.obligations.map(row => {
  const correction = corrections[row.id];
  return { ...row, historicalStatus: row.status, status: correction?.status ?? (row.status === 'divergent' ? 'baseline-divergence-owner-tracked' : 'bounded-executed-evidence-carried'), reviewNote: correction?.note ?? 'Named evidence retained after source review; no claim that this is a universal proof or a merged-runtime rerun.', evidence: [...row.evidence, ...(correction?.evidence ?? []).map(id => ({ id, ...added[id] }))] };
});
const files = [...new Set(['docs/spec/tracking.md', 'docs/spec/composition.md', 'docs/spec/architecture.md', ...Object.values(added).flatMap(item => [item.file, item.executionLog]), base + 'imported-artifact-probe.mjs', base + 'imported-artifact-results.log', base + 'artifact-durable-results.json', base + 'completion-audit.json'])];
const hashes = {};
for (const file of files) hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile(base + 'source-review.json', JSON.stringify({
  attribution: 'Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.',
  productionBaseline: prior.baseline,
  priorEvidenceHead: 'ee9c5cf603d85118db3772312e6c7d5112e4dc80',
  method: 'All 71 historical rows remain inspectable. Source review qualifies overbroad claims and adds required variants; no new aggregate satisfaction count replaces the source-level judgment. Existing executed evidence keeps its original production baseline. Follow-ups execute two added single-case witnesses plus six durable artifact variants and package checks.',
  obligations, addedAssertions: added, sha256: hashes,
}, null, 2) + '\n');
console.log(`Preserved ${obligations.length} rows; corrected ${Object.keys(corrections).length}; added ${Object.keys(added).length} exact assertion routes.`);
