# TEST-6 bounded CPU cost-placement supplement

Product source: `e59c64d0e1c607b5a4a8ae1fa124b1be5cdc2573` (the merged PR188 product). This is a separate executed supplement outside the immutable historical 74-row ledger. No product source changes or defect were found.

## Claim and owning clauses

[TEST-6](../../../docs/spec/acceptance.md) explicitly asks for a CPU-expensive memoized step and cheap leaves with an expensive aggregate. [DOM-1](../../../docs/spec/domain.md) says memoization minimizes whatever work the author chooses, independent of cost kind. The existing M4 `nested.test.ts` and `fold.test.ts` already prove restart, projection cutoff, changed-member invalidation, and exact-reference retention with cheap arithmetic/formatting bodies. Published supplement `9fdf8e8` covers the retained-results local filter. This witness adds the two cost-placement variants; it does not claim new cutoff semantics or repeat the local-filter proof.

The aggregate here is an **ordinary composition-level memo over two explicit cheap memo children**, not a fanout or strict fold. The other memo is independent. Each expensive body performs 100,000 additions, records every iteration, and returns the accumulated value. Cheap bodies produce two-field records without a work loop. This is actual bounded CPU-only work, not a latency measurement or claim about production workload expense. Expected totals use multiplication in the Jest oracle, independently of the repeated-addition implementation. No execution operation/provider API is called.

## Outcomes across independent processes

Each worker reconstructs callbacks/declarations/inputs and opens the same SQLite History store through built `microdelta` alpha declarations and runtime. The observer sequence reads the aggregate, standalone memo, and both leaves. An explicit leaf resolution after its use by the aggregate may report `reused` within the same run; body counters still record its earlier execution exactly once.

| Process | Input change | Cheap A/B bodies | Aggregate body/iterations | CPU memo body/iterations | Retention |
| --- | --- | --- | --- | --- | --- |
| A | Cold | 1/1 | 1/100000 | 1/100000 | Published totals 500000 / 700000 |
| B | None | 0/0 | 0/0 | 0/0 | All original exact references |
| C | A's unread note | 1/0 | 0/0 | 0/0 | B and both expensive references unchanged |
| D | A score 2 to 4 | 1/0 | 1/100000 | 0/0 | B and CPU unchanged; aggregate total 700000 |
| E | CPU seed 7 to 11 | 0/0 | 0/0 | 1/100000 | Both leaves and aggregate unchanged; CPU total 1100000 |

Every phase also asserts complete leaf data and both CPU outputs. The final captured `results-final/matrix.log` and `results-final/restored-matrix.log` contain the exact reference and output records.

## Test-first, counterfactual, and restoration

`ASSERTIONS.md` and the Jest matrix were written before `worker.ts`. The initial Jest execution failed with child exit 1 because the compiled worker did not yet exist (observed in the session, not retained as a raw report file). This establishes fixture construction order only; it was not a product failure. Exploratory setup/runtime checks preceded the final capture below.

For the semantic sensitivity control, an original cold process publishes a separate baseline. The runner changes exactly `total += a + b;` to `total += b + a;` in the tracked aggregate helper and compiles it. This is a **legitimate tracked implementation invalidation/oracle counterfactual**, not a semantic product mutant expected to preserve reuse. On unchanged inputs the aggregate legitimately executes 100000 additions and publishes a new exact reference with equal output; leaves and standalone CPU retain their exact references. The zero-work Jest oracle fails exactly on aggregate body/iteration counts, and the runner independently checks those counts, equal output, new aggregate reference, and retained other references.

The finalizer restores the exact author source, recompiles it, checks the emitted worker byte for byte against the original, and reruns the unchanged oracle over the same baseline store. It checks zero bodies plus all four original references. It then runs the complete five-process matrix over a new store. Primary failure evidence remains primary if restoration fails; errors are recorded separately. `results-final/restoration.json` records successful source/emitted restoration and no errors.

## Reproduction and evidence boundary

Run from this checkout's root:

```sh
python3 scratch/gap-hunt/cost-neutrality/replay.py
```

The original exploratory captured run remains under `results/`, produced before commit `54455c9`. After runner review, the final guarded recipe is committed as `0de2533`; `results-final/` captures its one final eleven-command replay. The receipt distinguishes product runtime source `e59c64d` from proof HEAD `0de2533`. The subsequent evidence commit adds reports and captures without changing the final executed recipe or product source. Eleven commands: locked install, dependency-ordered package build, generated-alpha strict TypeScript compile, type-aware lint, matrix, cold baseline, counterfactual compile, expected failing oracle, restored compile, restored oracle, restored matrix. All exits match the receipt; the one exit 1 is intentional. Logs retain the receipt's complete command output. The runner verifies a clean tracked checkout and the complete runtime-source tracked inventory before creating a fresh temporary output directory. It rejects untracked production inputs under packages/tooling. It clears inherited oracle environment variables for ordinary matrix runs and sets them only for the selected oracle. Captured workload commands have 900-second timeouts; worker children have 30-second timeouts. Jest JSON guards require exactly one selected pass (or the one intended counterfactual failure), one skipped alternative, two total assertions, one suite, and zero runtime-error suites. `--check-logs DIR` revalidates the captured inventories without running product code. Jest reports one selected passing/failing test and one skipped alternative in each invocation; the skip selects matrix versus unchanged oracle mode.

This is local Node 24.22.1/macOS evidence, with one writer and two leaves. It does not prove Linux, scale, timing, provider behavior, arbitrary cached local derivation replay, dynamic membership/fold behavior, or whole-spec conformance. The historical ledger and its denominator are unchanged. No paid execution, consumer modification, package publication, or remote write occurred.

## Public capture copies

This publication branch starts at the product source and contains only this evidence tree. The public reports and captures normalize local checkout and temporary paths; private original captures remain byte-exact locally. The final executed recipe and runtime fixtures are unchanged from `0de2533e74b1a0598ecedbd9e4d9b25eabfe0072`; path normalization is packaging only, with no workload repeat. Historical initial captures remain as normalized copies under `results/`.
