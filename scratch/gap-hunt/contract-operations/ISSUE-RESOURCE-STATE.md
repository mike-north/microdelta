# Represent resource state separately from additive consumption

Classification: specified-but-missing target capability; **not a summation bug**. Severity: P2. Stage: **M6 resource-observation inspection prerequisite**, with full quota-driven workload acceptance in M7. ACC-004 is settled, but the accepted bounded M5 mechanism explicitly implements additive consumption deltas/estimates; this report does not reopen that acceptance or claim state was delivered. The milestone does not assign a separate resource-state issue, so this M6 placement follows its explicit “resource observations” checkpoint.

Governing contract: `docs/spec/operations.md` ACC-004. Remaining quota/reset observations must stay distinct from consumption; separate provider/account pools/windows cannot invent a shared balance, and recording reset time does not schedule retries. RUN-011's `retryAt` controls execution eligibility and is not a resource-state accounting record.

Concrete consumer: GitHub reports balances93then90 for one credential pool/reset window, alongside request deltas2then3. Preserve consumption5 and nonadditive state90, both with their meaning; a second pool/window remains separate.

Replay:

```sh
node scratch/gap-hunt/contract-operations/inspect-surface.mjs
node scratch/gap-hunt/contract-operations/resource-state.mjs
```

Observed type/contract boundary: generated alpha `IUsageQuantity` contains only `unit,amount`; `IUsageReport` contains only `environment,operation,requestAttempt,report,quantities`. `IDurableAccounting` offers intent, additive report, estimate and summary operations. `accounting/src/contracts.ts:101–130` explicitly defines additive deltas and excludes cumulative snapshots/corrections. No state category, pool/window/reset record or corresponding nonadditive query exists. Encoding a provider/pool name into a unit separates units but does not make their update rule nonadditive. An estimate's basis is not an observed resource-state record, and a memoized application payload is not standardized Accounting evidence.

The synthetic repro first passes the **additive positive control**: request deltas2+3 produce observedRequests5. It then deliberately attempts the only existing quantity-report route for balances93/90 and fails its consumer latest-state assertion because that route returns183. This misuse is expected for the delta API and is preserved solely to demonstrate why an adapter must not use it for state. No arithmetic or validation defect is alleged. `resource-state.log` says exactly what passed and what assertion was intentionally red.

Expected: a distinct typed resource-state observation path and query preserve provider/account-pool and reset-window identity, state updates/history and honest missing state. They neither enter consumption totals nor schedule retries. Correct additive report behavior remains unchanged.

Direction: extend Accounting's evidence vocabulary/port and read-side view; define state ordering/replacement/expiry semantics with controlled fixtures before choosing storage. Test separate pools/windows, reset observation without admission, additive totals unchanged, and replay/durable read semantics. No generic aggregation engine, credential exposure, or billing integration is needed.

Duplicate scan: #115 (closed M5 Accounting package) delivered additive deltas, #151 (open facade adapter construction) wires that existing port. Neither adds state representation. No open resource-state issue found in84 returned issue titles (limit200); parent rechecks before filing. No issue filed here.

Implementer: Codex worker (gpt-6.1-sol).
Agent assistance: Codex worker (gpt-6.1-sol) authored the surface inspection and synthetic positive/misuse controls; parent review/filing remains separate.

## Decision required before implementation pickup

Leave unlabelled until the owner records these deliverables. Existing additive Accounting acceptance is settled.

1. Define state identity: provider/account pool, resource and reset window, including honest missing/unknown state without exposing credentials.
2. Define ordering, duplicate and out-of-order observations, replacement/history rules, reset/expiry semantics and durable replay behavior. Decide what a query means at a window boundary before choosing storage.
3. Assign the typed recording/query owner and its read-side integration. Confirm delivery placement: M6 resource-inspection prerequisite is this report's interpretation; M7 full-workflow acceptance remains separate.

Conditional implementation acceptance:

1. Record balances93then90 in one pool/window alongside request deltas2then3; query yields the decided state90 and consumption5. Replay in another process preserves the decided meaning.
2. Negative controls: another pool/window never merges into that balance; unknown state never becomes zero; reset-time observation never schedules retries or grants admission; consumption remains additive.
3. Tests cover the decided duplicate/out-of-order/window-expiry rules and missing state. Do not turn the deliberately misencoded183 delta control into a product defect or alter delta arithmetic to make it90.

Out of scope: generic aggregation framework, billing, credentials, scheduler policy or reopening #115. Dependencies: Accounting vocabulary/owner decision, #151 only where facade construction is required, CLI read-side integration if included in M6.

Clean evidence-checkout single-command reproduction (Node24.22.1/npm, network registry access and native toolchain/prebuild prerequisites):

```sh
bash scratch/gap-hunt/contract-operations/verify-resource-state.sh
```

This runner installs the lockfile with npm ci, builds package declarations, passes valid controls, then exits0 after confirming the complete reviewed baseline owning surface. It does not call an imagined API. A future surface change intentionally requires renewed semantic review. This is not a regression test that becomes green after implementation; behavioral test-first assertions must be written after the owner selects the API. The raw CLI npm command legitimately fails and is captured as data. Captured macOS execution is verify-resource-state.log; Linux remains unverified. No paid service or external provider is called. The resource-state runner never encodes balances as additive deltas.
