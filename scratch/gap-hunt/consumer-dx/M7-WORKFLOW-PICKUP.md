# M7 consumer workflow: select the controlled discovery contract

Codex (gpt-6.1-sol), evidence worker for Mike North; baseline c5802da. Target handoff only; no issue created, implementation or provider calls.

**Recommendation:** one unlabelled target issue is justified: “Define the controlled paginated roster workflow and adapter evidence.” M7 and TEST-3/4 already establish the consumer need; no selected paginated adapter/workflow contract was found. The open-issue inventory checked in this pass contains no M7/discovery issue. This is readiness/specification work, not a runtime bug or an instruction to implement all of M7 at once.

## Settled consumer need and what exists

- `docs/spec/acceptance.md:54` TEST-3 starts with an organization/HR roster, selects trial/full population, freshly discovers each person's PR references, hydrates evidence, performs per-PR work and a strict per-person summary. TEST-4 requires cold/restart/change/failure/wait/cancel/trial variants.
- `docs/spec/operations.md:135–174` RUN-004/005 distinguishes member evidence readiness from population closure. Quiet time, an empty continuing page, and historical rows do not establish closure. Ready PR A may run while later pages remain pending; a strict person summary must wait. Rediscovery after page failure can reuse eligible PR A work.
- `docs/milestones.md:202` explicitly assigns the assembled workflow, controlled adapters, CLI and scale measurement to **undelivered M7**.
- `scratch/gap-hunt/consumer-dx/pipeline.ts` and its three Jest controls already prove author-owned cap-2 range bisection over four synthetic records, exact reuse on identical observation, refresh on an advanced observation, and cumulative open-two/closed-four snapshots across separate runs preserving the first two member references. This is useful authored control evidence. It does not perform actual cursor pagination, enforce a remote search cap, hold a page pending during one live invocation, or prove a selected source-specific consistency/closure contract.
- Current M5 operation controls separately cover provider deferral, rate waits, unknown outcomes and no unsafe replay. They do not turn the synthetic bisection fixture into an integrated discovery workflow. Result-bearing operator settlement belongs to **#152**; standalone CLI delivery belongs to **#167**. Neither should be duplicated here.

## Decisions the supervisory owner must make concrete

1. **Adapter and application owner (preferred):** select one deterministic GitHub-like test adapter under the example/acceptance workload. It owns search ranges, cap detection, page continuation, deduplication, stable PR references, query consistency evidence and truthful per-person exhaustion. Keep provider traversal out of Machine and History. The roster application owns population selection, hydration/assessment composition and strict versus explicit partial report policy.
2. **Optional reusable adapter package:** only choose this if concrete consumers require shared pagination/bisection machinery. State its provider-neutral input/output contract before choosing package representation. No new bounded context or generic paginator API is required by current evidence.
3. **If a single live pending discovery evaluation is required:** specify the publication/readiness bridge to current source/collection authoring, then challenge it against held-page failure and early-member execution. Current cumulative snapshots satisfy a narrower across-run scenario; do not silently treat that as the one-live-run acceptance or fabricate a red test before selecting that contract.

Run Supervision owns retry timing, deferral/unknown operation state and cancellation through its existing operation protocol. Accounting keeps usage/gap attribution. History persists journal/results under its authority. The selected adapter classifies provider outcomes and supplies the evidence needed for safe continuation/closure; it does not invent replay authorization after a lost response.

## Reviewable output / pickup criteria for the target issue

Produce a short accepted controlled-adapter/workflow contract and acceptance scenario table: stable identity and cap-bisection boundaries; empty-page-with-continuation versus exhausted empty corpus; duplicated/moved records; per-person closure evidence; ready A while page two is held; page-two failure followed by fresh rediscovery preserving A; rate wait with exact retry timing; lost-response unknown that never blindly resends; trial/production separation. Explicitly identify what #152 and #167 must supply before full M7 acceptance.

Only then write tests first for the selected workflow. Use deterministic adapters and the real runtime; no paid/live-provider authorization is implicit. Keep measured memory/scale as a separate M7 acceptance dimension. Do not require a new generic adapter interface, native streaming mechanism or constant-time lookup without a demonstrated need.

## Existing control command

After normal generated-package build:

```sh
node node_modules/typescript/bin/tsc -p scratch/gap-hunt/consumer-dx/tsconfig.all.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config scratch/gap-hunt/consumer-dx/jest.config.mjs --runInBand
```

The captured three-test result is `logs/jest.log`; `README.md` explains the generated-alpha setup. This replays the current authored snapshot controls. It is not an M7 acceptance command. Existing M5 operational evidence is separately captured in `../contract-surface/logs/workspace-operations.log` and `owner-contracts.log`; no integrated M7 passing result is claimed.
