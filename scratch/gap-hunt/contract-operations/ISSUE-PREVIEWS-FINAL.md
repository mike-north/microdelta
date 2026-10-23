# Define and deliver preview envelopes and bounded observation

Specified-but-missing target, P2. **Leave unlabelled; not implementation-ready until owner decisions below are recorded.** RUN006–008 in `docs/spec/operations.md` govern the capability; CLI004 consumes it. M6 inspection needs this support, while the milestone does not independently name every preview mechanism. This is not a regression against bounded M5 acceptance.

## Consumer need and evidence

An operator needs the latest available value with its freshness/error state while deciding whether to continue. A failed refresh must preserve a prior value visibly as stale; no-prior failure must remain distinguishable from successful undefined/zero/empty data. Observation must never initiate refresh work.

The synthetic histogram control publishes once, fails the next authorized refresh, then reads the saved exact reference 1,000 times without another fetch (fetch count stays 2). Exact reads preserve immutable author data. Complete generated run/observer surface inspection finds no latest-value envelope, subscription lifetime or throttle/coalescing contract. Lifecycle events and exact-reference reads are useful existing controls; they do not deliver this target.

## Pinned reproduction

From a clean checkout of `0683c2ed73934d10f9b5a1ad9e0dd9e3d1a88d4f`, with Node 24.x/npm, registry access and the native prebuild/toolchain prerequisites:

```sh
bash scratch/gap-hunt/contract-operations/verify-preview.sh
```

The runner performs `npm ci`, builds package declarations and runs valid controls. Successful diagnostic completion exits 0: it confirms the reviewed baseline surface and is **not** a behavioral regression test that becomes green after implementation. Write behavioral tests first once the owner selects the contract. [Runner and captured macOS log](https://github.com/mike-north/microdelta/tree/0683c2ed73934d10f9b5a1ad9e0dd9e3d1a88d4f/scratch/gap-hunt/contract-operations) are pinned to that revision. This runner has not been verified on Linux; the separate owner Linux parity report covers earlier commits and different commands. No paid provider is called.

## Owner decisions

1. Select envelope discriminants and error/status retention across updates: how absence, stale/unverified value, accepted value and refresh error coexist, including successful undefined.
2. Select observation lifetime: run-owned observation versus an independently opened read-side lifetime; define attachment, disposal and aggregate replacement/removal. Disposal must not implicitly select execution cancellation.
3. Select optional throttle delivery details and clock ownership: periodic latest-state delivery under sustained arrivals, final trailing state, equal-data status changes and disposal boundary. No API spelling is prescribed.

## Conditional implementation acceptance

1. After decisions, write tests first for failed refresh with/without prior data, successful undefined/zero/empty values and freshness changes with equal author data. A verified consumer reports refresh failure; stale preview never becomes accepted success.
2. Negative controls make dispatch, source refresh, claim renewal and writes fail if attempted; repeated observation succeeds without invoking them. Existing exact-reference reads keep their current meaning.
3. Controlled-clock sustained arrivals produce periodic latest states and a final coalesced state, with the selected disposal behavior. Member updates replace prior contributions, established removals disappear, and selected-field observation does not load unrelated large payloads.

Scope: the observation boundary with Materialization and its read-side integration. Coordinate ownership with the CLI issue; CLI depends on this contract. M7 scale optimization, automatic refresh/retry, terminal/GUI toolkit and a general incremental-query engine are excluded.

## Attribution

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North, authored the evidence fixtures and this issue draft; no target implementation is claimed.
Agent assistance: Worker ran synthetic controls and declaration diagnostics. Supervisory filing and design decisions remain separate; no human implementation/review is claimed.

Runner portability note: the guard accepts Node 24.x and prints the actual Node/platform/architecture. Captured macOS runtime logs were tested on Node 24.22.1 before this guard-only change; the revised runners are syntax-checked, and their new Linux invocation remains unexecuted. This does not establish a runtime support policy.
