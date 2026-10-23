# Overnight source-delta coverage audit

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

## Counting unit and current numbers

The unit is **one enumerated finite semantic outcome in this bounded audit cohort**: the preserved 71 Tracking/Composition outcomes plus three explicitly named current-delta or omitted obligations. This is not a denominator for the entire active specification. A broad acceptance scenario may cover several outcomes, and one test may cover several outcomes; neither is counted again as another unit.

| Disjoint classification | Outcomes |
| --- | ---: |
| Executed passing, at the recorded evidence pin | 66 |
| Divergent, already filed | 6 |
| Missing required surface or target | 1 |
| Insufficient proof / unresolved full-target reconciliation | 1 |
| Total enumerated outcomes | 74 |

The 66 passing outcomes comprise **62 carried historical baseline outcomes**, **two outcomes supported by the prior exact-head #171 review**, and **two freshly executed current-main outcomes**. “Passing” means the bounded outcome has executed evidence at that pin; it does not claim all 66 were rerun or recertified on current main. Source-route validation is not execution. No whole-spec coverage percentage is calculated, and unexamined clauses outside this cohort are not silently assigned zero.

The six divergent rows represent three existing issues: #162 has own-presence, inherited-membership and supported-domain rows; #164 has returned-input/output precision; #168 has two custom-key authoring rows. These are outcome counts, not six separate defects. #162/#164 have preserved original-fixture fresh merged-main replays; #168 retains its separately pinned original generated-alpha proof, without inventing a fresh replay.

The missing row is the literal ARC-008 fake-child-resolver validation obligation, owned by #175. Its clean static census exits 0 to report the missing seam; it is not passing conformance. #175 supersedes the older outcome-only rationale that incorrectly required a masked runtime bug before recognizing this explicit isolation requirement.

The insufficient-proof row is `CMP8-gate-kind`: nonboolean/throw/promise/thenable gate negatives and skip behavior have executed evidence, but the broader CMP-8 wording distinguishes bare undefined success from skip. #156 deliberately selects record/array roots for the current alpha. Wrapped undefined does not prove bare undefined success. This row records full-target wording versus the deliberate bounded decision, **not a new runtime defect or a reversal of that choice**, and is distinct from #156's already confirmed type/runtime root mismatch. No duplicate issue or additional result-root decision is proposed.

`coverage.json` lists every outcome exactly once, its classification, source, original assertion routes, issue and evidence boundary. `node scratch/gap-hunt/contracts/overnight-coverage/validate.mjs` derives these counts and checks the three new recorded Jest results, command exits and clean test worktree. It performs no product execution.

## Source pins and deltas

Governing current source: **f43c5872987573d9b98a19f41c324b4d9336894c**. Historical production baseline: **c5802daca4a0bb8ea91159854d84eddcfa5215b6**. Source pins, all reviewed report hashes and the exact changed-spec hashes are in `coverage.json`; `spec-delta.patch` preserves the complete specification delta.

Only two owning specification files changed between those pins:

- `docs/spec/tracking.md:63,73`: navigation to records/arrays records bounded container kind, and passing objects includes that kind plus callee/materialization consumption. This supersedes the historical no-kind oracle.
- `docs/spec/execution.md:151–160`: all provenance declares `trackingSemantics: 2`; earlier or unknown generations cannot authorize reuse before interpretation/finality. Exact old history and operation journals remain readable.

Three newly recorded or updated outcome routes must remain distinct:

| Outcome | Evidence and current disposition |
| --- | --- |
| Bounded container navigation and branch precision | Prior #171 reviewed at ba497cbd903a76196ea0eff9d77b46f77fd22233: semantic supplement 2/2, original durable facade 5/5, original operation oracle 13/13. Nested affected experiment 12/12 at c75ca18e060a04034f4868e50dadd65b237e9d38; exact later delta to 5600ba5db3612d782dfdd12f6c00d8b0eea8f118 was one comment-only edit. Raw historical zero-observation component diagnostics remain disclosed red. |
| Updated pass-object observation shape | Fresh exact-main `packages/tracking/test/observer.test.ts:52` asserts kind plus selected leaf and no extra traversal. 1 passed, 46 unrelated skipped. This updates the existing ledger row rather than adding another count. |
| Tracking-generation compatibility | Fresh exact-main `packages/resolution/test/evidence.test.ts:37–57`: 36 passed across six provenance shapes. Current generation round-trips; malformed current evidence throws; missing/old/unknown/wrong-type generation is unsupported even without observations. Fresh `packages/core/test/container-guard.test.ts:123–158`: old SQLite recomputes once, next independent-process restart reuses, old exact payload and operation journal remain readable; 1 passed, 37 unrelated skipped. |

The separately added ARC-008 row is the previously omitted validation requirement, not another runtime matrix or a new discovery requiring filing.

## Focused current-main execution

A new owned `gap-hunt-semantics-review` checkout started at exact f43c587 without installed dependencies or generated outputs. Independent `npm ci --no-audit --no-fund` and full `npm run build` passed. Then only the existing provenance suite, named migration test, and named pass-through test ran. Their `npm run test:unit` commands include the existing strict TypeScript test compilation. No source or test was edited; there was no new implementation or changed type contract requiring a new tsd fixture.

**38 passed, zero failed, 83 explicitly skipped, zero runtime-error suites.** This total is the new focused test execution, not clause coverage. Node **24.22.1**, npm **11.12.1**. The checkout remained clean. `commands.json` records exact argv and exits; `current-check-metadata.json` records runtime, source/fixture/lock SHA256 and clean status; individual logs and Jest JSON are adjacent. There was no paid execution, broader runtime suite, scale run, release action, issue write, PR or production fix.

## Other inventories and the objective boundary

The DX seven-file **245 paragraph/table-row inventory**, this worker's **173 source-title-log routes**, **67 glossary definitions**, and operational owner's mixed clause/sub-obligation matrix retain their own units and pins in `coverage.json`. They are reviewed cross-references, not additive coverage numbers. The historical 64/71 label is superseded by this row-level reconciliation; it must not be used as current whole-spec conformance.

The original objective audit, source-route corrections, durable artifact body/reference controls, operational completion matrix and seven-file closure report were inspected. No additional unowned finite runtime obligation was identified beyond the current-source proof deltas above. Already filed gaps, unselected #165/#166/#167/#170 choices, external Linux work, the capped 100k run, and unsupported arbitrary-JavaScript/corruption universals remain outside a new local-test claim.

Track G is explicitly **pending**: the root refreshed consumer source d172f5f7c0790914bfc7a0ffbf1398618dd72ad8 against microdelta f43c587. No consumer runtime report was available at this snapshot, so no success, regression, adapter redundancy or new requirement is inferred from those source pins. Its report may add a separately scoped finding later; it does not silently change this 74-outcome denominator. Root reports no new open gap PRs, only release #130; no exact-head PR review is duplicated here.
