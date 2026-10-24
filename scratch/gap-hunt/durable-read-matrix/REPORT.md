# Durable selected-read matrix

Frozen runtime: `7a629f94d83366131e4aa25e541a24e41db744fa`. The clean archive executed fixture source `7eb1aba`; final fixture hashes are identical. No product code was changed. Install, package build, Core strict compilation and type-aware lint all exited zero. Raw Jest exited one: four tests passed and the own-presence test failed on its first process. There were eighteen fresh child processes: seventeen successful semantic stages and the preserved cold failure.

| Reader | Fresh-process body counts | Selected values | Exact references |
|---|---|---|---|
| Length only: baseline, same-length element edit, append, repeat | 1 / 0 / 1 / 0 | 3 / 3 / 4 / 4 | Same on irrelevant edit; new on append; retained on repeat |
| Index1: baseline, later element edit, append, insertion before index, repeat | 1 / 0 / 0 / 1 / 0 | 20 / 20 / 20 / 10 / 10 | Same on irrelevant edit/append; new on insertion; retained on repeat |
| Optional value: missing, own undefined, actual7, repeat | 1 / 0 / 1 / 0 | undefined marker / same /7/7 | Missing→own undefined keeps exact reference; actual value publishes |
| Tracked-view closure: factor2, unread change, factor3, repeat | 1 / 0 / 1 / 0 | 6 /6/9/9 | Unread change retains; changed factor publishes; repeat retains |
| Own presence: missing baseline | 1 then execution failure | No successful result | No own-presence precision or reuse claim |

Each reader has an independent same-store sequence with distinct requests and complete process shutdown between stages. Every successful stage asserts the actual test-only body counter, selected value, outcome kind and equality/inequality of the exact durable locator. Every family includes an actual invalidating positive control and an irrelevant-change or unchanged control. The own-presence family remains negative evidence. There is no bare-undefined result root: optional value reads return an ordinary wrapped record containing a comparison result.

The closure is a supported declared helper factory, `make(configuration)`, invoked with the runtime's tracked input view inside the memo. Its returned callable reads `configuration.factor` while that same capture is active. The unchanged factory and returned callable emitted texts are recorded and compared through all stages. It does not capture a raw scalar, manufacture another observer, serialize a closure or claim arbitrary hidden closure soundness. A separate raw probe only reports emitted text and never supplies runtime observations or result values.

## Own-presence boundary and accessible APIs

TRK-5 requires an own-property check to consume ownership rather than inherited existence, values or sibling keys. Missing→own undefined should therefore retain a value-only reader but invalidate an own-presence reader. The latter cannot be demonstrated through the inspected default workspace authoring surface: native `Object.hasOwn` on its input view throws `Native reflection is unsupported; use observer.hasOwn for supported fields`.

That rejection does not itself establish that native `Object.hasOwn` is a required API spelling. `api-accessibility.json` records exact source/generated declaration excerpts and hashes. Tracking's alpha `ITrackingObserver.hasOwn` supplies the semantic operation, but requires its own observer-owned view. The workspace creates that observer internally; its opening/run options, step bindings, `currentRun` and `currentExecution` do not expose it or an own-presence capability. Lower-level `createResolution` accepts a caller-owned observer, so this is an apparent default-facade access seam, not missing Tracking semantics. No foreign-observer workaround, own/membership substitution or new API was added.

Read-only GitHub searches for `hasOwn`, `own presence`, `native reflection` and `authoring facade` are retained in `issue-dedupe.json`. They found the closed owner/lint topics #26/#29 and closed intrinsic-name correction #162, but no same open default-facade capability issue. This is a bounded search, not an exhaustive proof that no discussion exists. `ISSUE-PROPOSAL.md` is local and unfiled for supervisor review.

## Reproduction and preserved failures

From a clean evidence checkout with Node24/npm and native build prerequisites:

```sh
python3 scratch/gap-hunt/durable-read-matrix/reproduce.py
```

The final wrapper is green only when it verifies the exact four passing families and the expected own-presence negative. The normative Jest test remains red and raw Jest exit1 is retained. `outcome_guard.py` validates all counters, values, reference comparisons, emitted texts, the single failed process and exact failure reason; its self-test rejects missing processes, wrong bodies, wrong references, different errors and forged test counts. It cannot turn another failure into evidence of this gap.

The full clean recipe executed at7eb1aba before the final classification-only green wrapper was added; final test and worker source bytes are unchanged. The final guard was executed against both original and public captures. No additional runtime was repeated for this wrapper/report delta. Original raw recipe exit1 and its receipt remain preserved; `final-qualified-receipt.json` states the boundary.

Initial strict compilation rejected the fixture's full array-bearing configuration parameter because tracked arrays intentionally omit native methods. The parameter was narrowed to the `factor` field the helper actually needs, preserving the runtime view. Initial lint rejected direct `Object` capture; the native own operation was moved into a declared deterministic helper, after which strict/lint passed and the runtime own-capability boundary became visible. Both attempts and exact prior source are retained. These are fixture setup corrections, not product repairs or test-first product implementation claims.

Public copies replace local archive/output/checkout paths with named placeholders. Normalization receipts retain raw and public hashes; raw command receipt hashes still identify the originals. No provider ran, no product fix was made, no issue or PR was created, and no release or publication was attempted.

Implementer: Codex worker (GPT-6.1 Sol), operating for Mike North.
Agent assistance: supervising Codex agent scoped the finite controls and requested exact-negative preservation. Independent review is pending.
