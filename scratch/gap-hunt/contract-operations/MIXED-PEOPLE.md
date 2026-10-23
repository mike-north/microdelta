# TEST-4.6 source failure, long quota and complete people

Bounded synthetic real-facade integration on macOS arm64 Node24.22.1. The roster source discovers three people; each member has a **synchronous complete-corpus source**, and a whole-person summary memo calls that source and then an asynchronous external assessment operation. Ada's source throws, Ben's memo operation receives a three-hour quota response, and Cy's source is a legitimate complete empty corpus. No async source declaration, casts, provider adapter design, new API or paid call is involved. The existing fake provider records real operation identities/request attempts into a synthetic JSONL ledger.

Owning requirements: TEST-4.6 and A-11 in `docs/spec/acceptance.md`; strict/outcome coverage RUN-010 and durable quota RUN-011 in `docs/spec/operations.md`. Existing M4 fold, M5 deferral and M5 outcome-fold suites covered these mechanisms separately. This fixture assembles the exact person-source/quota/summary combination and retains independent process boundaries.

Run from the worktree root after generated package build:

```sh
npx tsc -p packages/core/tsconfig.test.json
npx tsc --noEmit -p packages/core/tsconfig.json
npx eslint packages/core/test/gap-hunt-durability-mixed-people-worker.ts packages/core/test/gap-hunt-durability-mixed-people.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-durability-mixed-people.test.js
```

All pass; Jest1/1 invokes five separate Node workers over one synthetic store pair, with fresh builders/helpers per process. `mixed-people.log` preserves final Jest result. `mixed-people-processes.jsonl` preserves a separate completed five-worker evidence run with exact statuses, fold outcomes, references, bodies and provider sends. Host time is fixed only inside each child via Date.now, matching the Node clock seam; exit deferral avoids sleeping three actual hours. No production code changed.

| Process | Independent expected and observed outcomes |
| --- | --- |
| initial at1000000 | Ada failed; Ben pending until11800000; Cy's whole-person summary succeeds with count0/complete=true. Strict fold is **failed**, naming Ada failed and Ben pending, and executes no report body. This is the selected honest failure+pending outcome, not a claim its discriminant is waiting. Outcome fold waits with succeeded[Cy]/failed[Ada]/pending[Ben]/complete=false and executes no body. Only Ben and Cy are sent. |
| early at1000001 | Same failed/pending/success states and retry time; no new provider send, no Ben or Cy summary body. Cy retains exact reference. |
| due at11800001 | Ben retries with the same operation identity and a different request attempt. Cy is unexecuted and retains exact reference. Ada remains failed. Outcome fold publishes settled coverage complete=true with failed[Ada] and explicit statuses, distinct from complete success. |
| repair at11800001 | Ada's source repairs and only Ada's summary executes. Ben/Cy retained. Outcome fold publishes a different reference with all succeeded and no failed coverage; strict fold now succeeds. |
| unchanged at11800001 | No source/summary/report helper bodies; tolerant report reused; Cy remains exact-readable at original reference; Ben has exactly two total sends and Cy exactly one. |

The negative author control replaces only Ada's `throw new Error('synthetic person source unavailable')` with `return sourceOutcome.fresh<ICorpus>({ key, prs: [], complete: true })`. It typechecks, but runtime fails the first process's independent expected status map: Ada became succeeded instead of failed. `mixed-people-negative.log` preserves that failure. Restoring the throwing helper passes all five processes. This tests detection of the forbidden missing-evidence-as-empty-success substitution; it is not a production mutation or a newly discovered runtime defect.

Initial test authoring hit compiler errors in assertion imports/narrowing and folded-coverage access; these were corrected with named namespace imports, explicit discriminant/property narrowing and the actual nested coverage port. No compiler checks were weakened. Strict source/test types and targeted type-aware lint pass. No full HR CSV/provider-pagination application, Linux execution, arbitrary provider behavior or scale claim follows.

Implementer: Codex worker (gpt-6.1-sol).
