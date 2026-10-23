# Deliver the standalone read-only inspection checkpoint

Classification: specified-but-missing target capability. Severity: P2. Stage: **M6 — Usable CLI and inspection checkpoint** (`docs/milestones.md:190–200`). This is not a regression claim against bounded M5 acceptance.

Governing contract: `docs/spec/operations.md` CLI-001–004, `docs/spec/acceptance.md` A-16. A separate process must inspect retained values, attempts, dependencies/acceptances, errors, waits and observed usage without dispatching callbacks, current source hooks, claims or mutations. Commands and output/exit behavior must be settled before implementation; this report does not freeze a command spelling.

Minimal consumer attempt from the checkout:

```sh
npm exec --offline -- microdelta --help
node scratch/gap-hunt/contract-operations/inspect-surface.mjs
```

Observed: npm reports `could not determine executable to run`. Every package and the root manifest has `bin:null` in the generated `surface.json`; no standalone CLI application/entry is supplied. The available alpha workspace has `run`, `close`, and `logicalStore`; read/check/recover/usage/operation inspection live inside a run. A run requires authoring/composition. Existing alpha isolation pieces do not constitute a public standalone read-side CLI.

Expected: an installed executable and supported read-side route can inspect a seeded store, failed attempt, unknown validity and resource gaps in a fresh process, with callback-dispatch and mutation ports instrumented to reject calls. Viewing is not current verification or execution. First/second interrupt semantics and status/explanation output belong to the same grouped deliverable, not individual issues for each CLI distinction.

Evidence: `cli-consumer.log`, `surface.json`, `packages/core/package.json`, `packages/core/src/workspace.ts:640–703`, `packages/supervision/src/contracts.ts:631–718`; existing passing isolation controls are `acceptance/admission-observers.test.ts` check-only and `workspace/recovery.test.ts` writer-free recovery.

Direction: select the smallest explicit command/event/exit contract and public read-side ownership boundary, then implement/test the named M6 checkpoint separately from the full M7 provider workload. No terminal toolkit or guessed command API is required to demonstrate the gap.

Duplicate scan: all84 returned open/closed issue titles scanned (limit200) on2026-10-22 local time; no CLI checkpoint issue found. #151 is facade Accounting assembly, not a CLI. Parent must recheck at filing time; no issue filed by this worker.

Implementer: Codex worker (gpt-6.1-sol).
Agent assistance: Codex worker (gpt-6.1-sol) authored and ran the consumer evidence; parent review/filing remains separate.

## Decision required before implementation pickup

Leave unlabelled for implementation until the owner records these numbered deliverables.

1. Define the supported command set, input/store selection, output schema and exit statuses, including failure/unknown and first/second interrupt behavior. Choose human and machine output responsibilities without assuming a terminal toolkit.
2. Assign the public read-side boundary and process lifetime: which package opens retained state without authoring/composition, and which capabilities are unavailable to inspection.
3. Specify the minimum M6 seeded scenario and defer full M7 workload/scale. Account for preview and resource-state dependencies explicitly; absence must remain visible if those targets are deferred.

Conditional implementation acceptance after those decisions:

1. A fresh process uses the selected installed command to inspect retained values, failed attempts, unknown validity, waits, dependency/acceptance evidence and usage with the decided output/exit contract.
2. Negative control: callbacks, source hooks, claim renewal, writes and dispatch ports throw if invoked; every inspection still succeeds without those calls. Inspection never upgrades unknown/stale to verified.
3. Test both interrupt paths and missing/corrupt/unsupported store errors against the decided contract. Existing library exact reads and writer-free recovery controls remain green.

Out of scope: full provider workload, new host implementations, terminal-framework selection, billing, and automatic execution repair. Dependencies: selected read-side owner; preview/resource-state decisions where included in M6.

Clean evidence-checkout single-command reproduction (Node24.22.1/npm, network registry access and native toolchain/prebuild prerequisites):

```sh
bash scratch/gap-hunt/contract-operations/verify-cli.sh
```

This runner installs the lockfile with npm ci, builds package declarations, passes valid controls, then exits0 after confirming the complete reviewed baseline owning surface. It does not call an imagined API. A future surface change intentionally requires renewed semantic review. This is not a regression test that becomes green after implementation; behavioral test-first assertions must be written after the owner selects the API. The raw CLI npm command legitimately fails and is captured as data. Captured macOS execution is verify-cli.log; Linux remains unverified. No paid service or external provider is called. The resource-state runner never encodes balances as additive deltas.
