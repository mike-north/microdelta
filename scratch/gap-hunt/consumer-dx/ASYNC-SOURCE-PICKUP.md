# Async source callbacks: generated declaration gap

Codex (gpt-6.1-sol), evidence worker for Mike North. Production baseline c5802da. No implementation change, scalar-root expansion or provider call.

## Consumer contract and classification

Current source authoring should permit a check/retrieval callback to await work before returning its trusted fresh/retain outcome. `docs/spec/execution.md` REUSE-004 describes a conditional request confirming unchanged data and retaining the previous exact snapshot, with the work recorded separately. M5 operational work is scoped to the invocation lifetime. This need exists for an ordinary source today and does not depend on future M7 pagination.

This is a scoped **declaration gap**: strict generated-alpha TypeScript rejects `async ({ outcome }) => outcome.fresh<IValue>({ value: 1 })` and async conditional retain, although JavaScript runtime controls execute those outcomes correctly. No synchronous-source boundary was found in active M3/M4/M5 plans. Their synchronous restrictions concern SQLite/selected materialization getters. The sync/async implementation-choice sentence at execution.md:187 refers to finality hooks; it does not require source check/retrieval to be synchronous.

## Minimal reproduction and exact boundary

`async-source.ts` imports only the facade API with the required generated owner-declaration mappings. Matching synchronous fresh/retain controls compile. Four async callbacks fail with **TS2322**: direct source fresh/retain and template-member source fresh/retain. Every payload is the supported object `{ value: 1 }`; no cast, suppression or weakened compiler setting is used.

The restrictive signatures are `packages/definition/src/declaration.ts:230` (`ISourceOptions.run`) and `packages/definition/src/template.ts:90` (`ITemplateSourceOptions.run`), both returning only `IApply<TFamily['outcomes'], TResult>`. Resolution's family maps that directly to `ISourceOutcome<TResult>` (`packages/resolution/src/family.ts:64`). Runtime `callSource` at `resolution.ts:1120` returns captured asynchronous invocation completion. Runtime evidence is direct sources only; no template-runtime parity claim is inferred from it.

JavaScript/Jest controls pass **2/2**: async fresh publishes; a separate-process async check retains the exact earlier reference; rejection after an await propagates as failure. An initial harness descriptor omitted required scope/role and failed before callbacks; it was corrected before this evidence. No product failure is inferred from that harness mistake.

True-negative tsd controls pass: forged/wrong outcome envelope, scalar supplied to explicitly object-shaped `IValue`, and promised scalar outcome supplied to an object-shaped source remain rejected. This does **not** establish a general scalar-root policy: #156 owns the existing generic scalar-root acceptance mismatch. Async repair must neither expand roots nor claim to fix #156.

## Portable red-to-green command

```sh
node scratch/gap-hunt/consumer-dx/repro-async-source.mjs
```

Node 24.x; default clean `npm ci` and package build, strict generated-declaration compiler check, tsd negatives, type-aware lint and isolated Jest. On this baseline the compiler reports exactly four TS2322 errors; the runner still executes the independent lint/type-negative/runtime controls, then exits **2**. After a correct declaration repair, compilation succeeds and the same command exits **0**. Unexpected compiler diagnostics stop the replay. `GAP_HUNT_REUSE_BUILD=1` explicitly skips installation/build during development.

Captured complete baseline replay: `logs/async-source-replay.log`. It reused fresh generated packages. The analogous M7 runner's **default** clean install/build was separately verified in a detached e6fc3de checkout: `logs/m7-clean-bootstrap.log` (3/3 snapshot controls). Those M7 controls are not evidence for this async-source acceptance.

## Numbered acceptance criteria / contained pickup

1. Direct source fresh and retain callbacks support both synchronous trusted outcomes and asynchronously completed trusted outcomes under strict generated-alpha declarations. The unchanged `async-source.ts` direct-source cases must compile; no casts, `any`, `unknown` result widening, suppression or `skipLibCheck` workaround.
2. Template-member source fresh/retain supports the same completion semantics, preserving precise previous/member/payload types. The unchanged two template cases must compile. Keep synchronous existing callbacks source compatible.
3. Wrong result shape, wrong/forged control envelope and Promise of the wrong declared result remain rejected by tsd. A Promise must not erase the source result type or mint trust. Supported result roots remain governed by current runtime constraints and #156; this issue does not add scalar roots.
4. Runtime controls prove awaited fresh publication and awaited explicit retention after restart preserving the exact previous reference. Fresh equal object data must still produce a distinct publication, and retaining without an eligible previous carrier must remain rejected. Add missing negative controls before an implementation change if not already covered by owner tests.
5. Rejection after await must fail the source check without successful publication/acceptance; a previously completed result remains historically readable. Preserve current admission, active execution lifetime, cancellation and source-policy ordering. Do not infer that a Promise permits work to escape supervision.
6. Cover template-member runtime parity for the selected async cases before calling both signatures closed. Preserve trusted source outcome handling and consumed read capture across await; do not make memo/output/materialization contracts more permissive to fix callback typing.
7. Rebuild generated declarations/API reports and run focused Jest, tsd, strict compiler and type-aware lint checks. The portable command above must become green as written; do not invert expected errors to make the original gap a passing test.

Owners: Definition owns direct/template callback contracts; Resolution owns its outcome family and execution/capture semantics; facade generated declarations must expose the corrected precision. Dependencies: existing source outcome/retention contracts only. #156 is related separate root policy; no dependency on M7, #152 result-bearing operator settlement or new adapters. No new public API spelling, host or persistence authority is prescribed.
