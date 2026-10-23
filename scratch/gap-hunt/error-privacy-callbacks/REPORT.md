# Additional issue190 authored callback reproduction

Source baseline: `7677ec4d61fd78efc63da28906175707e1391f12`; Resolution source blob `f6017e0105d24fdcff33d9ad6b617886d0746bf8` is byte-identical to original issue190 baseline `2a640ac`. Exact fresh executed proof: `b63657b167e20fd16ea6a2d3815120a1438ce45d`. Final report/capture publication adds no fixture, runner or product changes.

Eight finite generated-declaration consumer cases execute source cold run/check, suppliedStep body, strict-fold body and outcome-fold body. Each supported API delegates the authored failure to a bound helper, throwing either an ordinary Error or a preconstructed exported ResolutionError('unsupported-result', synthetic marker). No declaration captures the error/counter. Fold cases first resolve a one-member source/template and use their dedicated resolveFold/resolveOutcomeFold APIs. Strict/outcome folds share one runtime catch but are independently authored API routes.

Fresh clean checkout, no preexisting node_modules: locked install, package build, strict TypeScript consumer compile against generated alpha declarations, and repository type-aware consumer lint all pass. Jest exits1 with exactly four ordinary-error controls passed and four named exported-class semantic failures, eight total, one suite, zero suite/runtime errors. Wrapper exits0 only for this exact census plus eight exact observations. Captures/receipt.json and raw Jest JSON/logs retain the evidence.

Every authored helper executes once. All requests reject, and raw SQLite queries find zero completed rows for the failing authored subject. In all four exported-class cases, the outer failure is the exact object thrown by the helper, its message is exactly the synthetic author marker and its code is unsupported-result; the thrown object is not retained as its own cause. This confirms outer framework-message exposure at these four supported routes, in the same open issue190 class-trust family.

Ordinary errors produce safe execution-failure framework text and retain exact error identity as cause at the authored boundary. Source and both aggregates expose that exact cause immediately. Supplied execution crosses a memo caller: the outer safe execution-failure wraps the safe supplied execution-failure, whose cause is the exact ordinary error. Both outer cause identity and boundary cause identity are recorded, so an expected safe caller wrapper is not misreported as loss of the author error.

Only outer error text/classification and failing-subject absence are claimed. These cases do not prove author-path event/store privacy, all callbacks, provider behavior, Linux, or a production fix. Original issue190 nine-case proof remains untouched, including its genuine framework-child propagation control. No issue edit/comment/publication was performed here.

Historical harness outcomes are separate from product evidence. The first attempt stopped at TypeScript's widened fold selector; historical compile log is retained. The next runtime used generic resolve for aggregate steps and expected immediate supplied cause; its receipt is retained as setup failure, not added defects. A subsequent invalid generic annotation was caught by strict compile; that attempt was interrupted before runtime. Generated output accidentally staged during setup was removed before the final executed proof. The final full clean execution has the correct supported APIs, declared boundary-cause assertions and exact four semantic failures.

Reproduce from a clean evidence checkout using Node24:

```sh
python3 scratch/gap-hunt/error-privacy-callbacks/run.py
```

The command installs/builds/strict-compiles/lints and accepts only the bounded expected negative outcomes. It creates captures outside the checkout and verifies clean Git state before/after. No paid-provider calls or product edits.
