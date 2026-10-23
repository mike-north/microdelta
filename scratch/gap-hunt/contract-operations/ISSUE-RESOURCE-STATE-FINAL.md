# Define nonadditive resource-state observations separately from consumption

Specified-but-missing target, P2. **Leave unlabelled; not implementation-ready until owner decisions below are recorded.** ACC004 in `docs/spec/operations.md` governs nonadditive state. M6 explicitly needs resource observations; treating this as an M6 prerequisite is an interpretation to confirm, with full quota-driven workload acceptance in M7. Bounded M5 additive Accounting acceptance remains settled.

## Consumer need and evidence

A provider reports remaining quota 93 then 90 in one account pool/reset window while requests consume 2 then 3 units. Consumers need state 90 alongside consumption 5, with other pools/windows separate and missing state visible. Recording reset time must not schedule a retry.

The valid current control reports additive consumption 2 + 3 and observes 5. Complete generated Accounting surface inspection shows intent/report/estimate/summary operations and an explicitly additive quantity contract; there is no typed state/pool/window/reset record or nonadditive query. A usage estimate or application memo payload is not a standardized resource-state observation.

## Pinned reproduction

From a clean checkout of `e475049c3f858c270791581fb77f925e761363ce`, with Node 24.22.1/npm, registry access and the native prebuild/toolchain prerequisites:

```sh
bash scratch/gap-hunt/contract-operations/verify-resource-state.sh
```

The runner performs `npm ci`, builds package declarations and runs valid controls. Successful diagnostic completion exits 0: it confirms the reviewed baseline surface and is **not** a behavioral regression test that becomes green after implementation. Write behavioral tests first once the owner selects the contract. [Runner and captured macOS log](https://github.com/mike-north/microdelta/tree/e475049c3f858c270791581fb77f925e761363ce/scratch/gap-hunt/contract-operations) are pinned to that revision. This runner has not been verified on Linux; the separate owner Linux parity report covers earlier commits and different commands. No paid provider is called.

## Owner decisions

1. Define observation identity: provider, account pool, resource and reset window; preserve unknown state without exposing credentials.
2. Select ordering and query semantics: latest replacement versus retained observation history, duplicates/out-of-order arrivals, reset/expiry and behavior at a window boundary. Choose the meaning before choosing storage.
3. Assign typed recording/query ownership and read-side integration, and confirm milestone placement. No new method or storage format is prescribed.

## Conditional implementation acceptance

1. Write tests first for balances 93 then 90 in one pool/window with request deltas 2 then 3. The chosen query yields state 90 and consumption 5; a new process reads the same committed meaning.
2. Negative controls keep other pools/windows distinct, never interpret missing state as zero and never count state as consumption. Recording a reset time grants no admission and schedules no retry.
3. Tests exercise the selected duplicate, out-of-order and expiry rules, including unknown/missing windows. Existing additive/deduplication/estimate behavior remains correct.

Scope: Resource Accounting evidence vocabulary and read-side integration. #151 concerns facade assembly of the existing port and is a dependency only if the selected integration needs it; it does not supply state semantics. #115's additive implementation is not reopened. CLI consumes this contract once defined. Billing, credentials, scheduler policy and a general aggregation engine are excluded.

## Attribution

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North, authored valid-control fixtures, surface diagnostics and this issue draft; no target implementation is claimed.
Agent assistance: Worker executed the valid additive control and generated declaration inventory. Supervisory filing and design decisions remain separate; no human implementation/review is claimed.
