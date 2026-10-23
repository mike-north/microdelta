# PR188 acceptance acknowledgement verification

Bounded PASS for [PR188](https://github.com/mike-north/microdelta/pull/188) at `4853f0e5ba2f1f56898bdb79584d7e4850c0f2ba`, against [issue159](https://github.com/mike-north/microdelta/issues/159)'s numbered acceptance criteria. Actual host and versions are recorded in `captures/summary.json`; this execution used macOS27.0.1 arm64, Node24.22.1/npm11.12.1.

## Production path and governing contract

`docs/spec/execution.md` RES-005/007 separate successful current acceptance from immutable historical results; failed validation must not advance acceptance evidence. ARC-007 preserves History's publication ownership and forbids acceptance from rewinding current or rewriting provenance. PUB-002 requires the existing fenced transaction. DOM-3/TEST-5 motivate bounded materialization, while issue159 supplies the explicit one-row regression boundary. Neither those requirements nor this verification establish a latency SLA or M7-scale delivery.

The production diff adds `acceptanceById` selecting the acceptance's ID, result, environment, fence and evidence with `WHERE acceptance_id = ? AND result_id = ? AND environment = ?`. `recordAcceptance` calls `.get(acceptanceId, resultId, scope.environment)` inside the existing `asHolder` transaction after inserting the acceptance and dependencies. It checks all returned identity/scope/fence/canonical-evidence fields before returning. The primary key on acceptance_id bounds that exact lookup; the real-SQLite test counts rows actually materialized through the injected production port, including `.get` and `.all`. This is not a fake acceptance implementation or a source-text-only assertion.

`asHolder` still checks holder/fence/expiry inside the real transaction. `acceptanceScope` and `dependencyIds` still resolve admissible references in the accepting environment before insertion. Exceptions escape the transaction callback; the completed return is delivered only after the transaction returns. Full inspection still calls the unchanged ordered `acceptances.all(resultId, environment)` and reads all immutable rows. No schema, resolver policy, deletion, concurrency or public API change is part of the fix.

The immediate fix-parent `0194b33d4f8cb7ccbf6f58100f833e0248f76230` differs in exactly three files: History implementation, expanded regression, changeset. The negative uses the complete previous production History source from `2a640aca75d5728484a2cb06af88c77690616ba9`, verified byte-identical to that immediate parent. No hand-written approximation of the previous bug is used.

## Acceptance criteria and executed evidence

| Issue criterion | Evidence and outcome |
| --- | --- |
| 1. Exact inserted ID, bounded materialized rows | The byte-exact original fixture from `abb9bab1987d18644093fb67dadb17c3ea9f94ce` passes1 test. Expanded real-SQLite tests pass9. Successive acknowledgements each read1 acceptance row. |
| 2. Complete immutable inspection | Original full-history control returns3 records. Expanded matrix retains36 acceptances split among3 result/environment targets, preserves complete histories and envelopes, and confirms36 stored rows. The decoy case retains14 rows while returning the intended inserted ID. |
| 3. Result/environment, evidence, dependencies and fencing | Expanded wrong-id/wrong-result/wrong-environment/stale-evidence/missing readbacks throw without committing rows or sequence changes. Stale writer is rejected. Interleaved matrix checks exact reference/environment/fence/evidence/dependencies. Existing environment tests pass5 cases, including forbidden cross-environment acceptance, promoted-result acceptance in production only, and reopen readback. Production checks and unchanged admissibility/fencing owners were inspected. |
| 4. Failed insert/readback returns no speculative success | Injected real-SQLite insert failure, missing/incorrect/stale readback and stale writer return no new completed acceptance. Tests assert preserved rows and sequence state after failures. |
| 5. Multiple results/environments, sufficient history and newest-row decoy | Matrix records36 interleaved acceptances. After12 prior acceptances, a test-only injected later same-result/environment row ensures acknowledgement still identifies the inserted ID and materializes1 row. Full inspection preserves all14. |

Four selected existing durable-History tests additionally pass: atomic staged/publication transition; dependency exactness; rollback acceptance preserving current/provenance; immutable results and acceptance rows. These targeted checks exercise preservation responsibilities touched by the production transaction; unrelated broad suites are not repeated.

## Negative control and restoration

The frozen original runner and its support file are byte-exact copies of the issue's `abb9bab` source, relocated at the same directory depth so its checkout-root calculation remains unchanged. Its default path performs normal `npm ci` and `npm run build:packages`; no reuse-build flag or borrowed node_modules is used. A separate default `npm run build` passes. Compilation and type-aware ESLint checks pass without compiler relaxation, source aliases or suppression changes.

Replacing only the production History source with the byte-exact previous file and rebuilding its generated runtime makes the expanded suite fail exactly5 of9 cases: original row counter; interleaved bounded-row matrix; later-row bounded acknowledgement; wrong-result readback; stale-evidence readback. The other4 cases pass. The frozen original alone fails exactly1 assertion with `[1,2,3]` rather than `[1,1,1]`, while its full-history positive control succeeds. No suite fails to load and no runtime-error suite is counted as a negative oracle.

The runner restores current production source and the expanded test in `finally`, rebuilds History, recompiles tests, and reruns9/9 green before preservation checks. It verifies both restored files byte-exact against the reviewed commit. Previous failures remain separate captures rather than overwritten by restored positives.

## Reproduction and limits

From the evidence commit with Node24 and native SQLite build prerequisites:

```sh
python3 scratch/gap-hunt/review-188/reproduce.py
```

The command installs/builds, runs the original and expanded positives, swaps the exact previous production file for two expected failing controls, restores/rebuilds, and runs the targeted preservation cases. The driver expects precisely those two Jest exit1 results; other commands must exit0. Raw local results are ignored. Public captures normalize checkout-root paths, the absolute Node executable path, and trailing whitespace only; JSON test paths are normalized recursively.

This verifies finite row materialization and acknowledgement correctness on the recorded host. It does not measure latency, disk-page I/O, retention under unbounded history, other platforms, a full repository suite, or distributed/multi-writer behavior. No provider execution, package publication or release action occurs. The hunt supervisor owns publication; the repository supervisor retains acceptance and merge authority.
