# PR178 exact-head subject-correspondence repair review

Runtime pin `efd50c63eb62b8865cd76587673f6d3d56c9732a`; reviewed against original PR head `577644f188a80bf7b081804fd63fe23ba263f88f`. Original published counterexample evidence `e33ad02939a7b217a7ec754f097b6391ad581b13` remains unchanged. Own review branch `gap-hunt-review-178-repair`; no production fixes, PR-branch pushes or GitHub comments.

## Result

**Original false-reuse witness is repaired at this pin.** All six original overlay files were extracted directly from committed e33 evidence and SHA256 verified without changing bytes, paths, callbacks or assertions. The old original runner is retained byte-identically for provenance but is not invoked: its guard correctly qualifies only the old577 runtime. Use the repair runner below for this head.

Independent install and package build succeeded. Strict original-worker compilation and type-aware lint succeeded. The original five Jest assertions pass with zero skips/runtime-error suites. The previously failing subject swap now returns2 as a publication with one body, one publication and a different exact reference; cold/unchanged/fresh-subject/empty-store-swapped controls retain their intended outcomes. All eight raw process receipts are retained for each phase.

## Negative and restoration

The repaired dispatcher unconditionally reads current `recipe.subject` before following edges. Only that emitted JavaScript validation/read block was removed in the compiled occurrence overlay. The original moved-subject assertion fails again: expected2, actual1, `reused`, exact old cold reference, zero body executions/publications. The other four original controls pass; zero runtime-error suites. The production TypeScript is untouched. Actual emitted bytes were restored in `finally`, verified byte-for-byte, then the same five assertions passed again. `negative-control.json`, phase Jest JSON/logs and raw process receipts record this distinction. This establishes dependence on current subject evidence rather than a green assertion disconnected from the repair.

## Changed runtime scope

Strict `experiments/exp-authoring/tsconfig.test.json` compilation and type-aware experiment lint pass. Direct runtime Jest invocation passes18/18 across three suites, including fresh-process child/parent subject exchange, literal subject preservation, exact-reference unchanged/repaired restart reuse, consumed/unread input edits, callback-only equal/changed output, equal-output parent cutoff, alias/reserved-name/ignored-child controls, protocol and unsupported-result negatives. This worker did not run tsd or tooling/authoring-origins.test.mjs; another review worker owns the input-invariance and forged-origin mutation evidence.

Initial capture invocation after build:packages alone had33pass/4fail because generated producer/capture/forged declaration fixtures were absent. Retained captures.log documents that prerequisite failure. After `npm run build:fixtures`, the same tracked/authoring capture command passes37/37 (captures-restored-prerequisites.log). This is not a runtime or checker regression. The clean runner builds the prerequisite fixtures before this check.

## Reproduction

```sh
python3 scratch/gap-hunt/review-178-repair/reproduce.py
```

The runner permits only the original fixture and this evidence subtree to differ from the qualified efd head, verifies original e33 overlay hashes, independently installs/builds packages and declaration fixtures, runs strict types/lint, requires positive5green, original negative1red/4green and restored5green with zero runtime errors, validates negative raw process values/exact references/event counts independently of rendered matcher messages, restores actual emitted bytes in `finally`, and runs18 affected runtime tests plus capture checks. Fresh output is ignored under local-results; captured logs stay unchanged. No original assertion is rewritten. Exit0 qualifies this bounded repair proof; it is not full project acceptance.

## Boundaries and remaining review

The result applies to the experimental fixed one/two-node synchronous numeric adapter at this exact head. It does not qualify DSL adoption, released API behavior, full scale, arbitrary graphs or async author callbacks. Existing #156/#164/#173 runtime gaps are unchanged by this experiment-only delta and were not rerun. Full repository tests/check/build, Linux, provider execution, current-main consumer replay and merge/CI/Copilot acceptance are outside this worker's evidence. Production runtime packages and capture checker are unchanged in577..efd. Input type variance and forged-origin negative acceptance remain separate review evidence.

Attribution: GPT-6.1 Sol worker implemented and executed this independent review under the supervising agent; the PR author supplied the repair. The hunt supervisor owns the final bounded finding and comment only; this review grants no merge authority. Repository supervisory merge authority remains separate. No human implementation is claimed.

Latest-head source qualification: `648b0aa89d1ea20b100c5e2b8591b3d25d55781b` differs from executed efd only in three decision.md wording lines. Independent source review and parent comparison found runtime, tests and tooling byte-identical. Execution remains explicitly pinned to efd; this is source-qualified carry-forward to648, not a fresh648 execution. Parent separately replayed the original five process scenarios successfully; its local receipt is outside this public worker evidence.
