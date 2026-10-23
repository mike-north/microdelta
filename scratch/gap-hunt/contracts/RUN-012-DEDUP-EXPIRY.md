# RUN-012 finite provider deduplication horizon

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.
Baseline: main c5802daca4a0bb8ea91159854d84eddcfa5215b6.
No production changes or provider/network execution.

## Selected contract and evidence boundary

`docs/spec/operations.md:393-454` requires stable operation identity, equivalent
binding under the provider's contract, visible ambiguity, and a negative for expired
provider deduplication. The selected M5 mechanism retries unknown outcomes only
with a safety basis and remaining author policy. `docs/plans/m5-operations.md:123`
retains that same selection; it does not select general reconciliation.

The actual generated-alpha request contract is `IOperationRequest` in
`packages/supervision/src/operations.ts:138-174`: `providerIdempotency` and
`safeToRepeat` are booleans; `perform` receives `operation`, `requestAttempt`, and
an optional `idempotencyKey`. There is no deduplication deadline, duration, lookup
callback, or automatic provider-reconciliation policy in that interface.
`operation-engine.ts:194` selects a safety basis. `records.ts:131` denies retry
when safety is none even if maxAttempts permits more sends. The call path checks
its current declaration (`operation-engine.ts:548`); a later run's admission also
checks stored unsettled operations before author work. This is not a promise that
an earlier true declaration will expire automatically.

The existing positive `operations/replay.test.ts:173` was rerun separately: a
provider whose deduplication promise covers the retry gets the same key and
applies one effect. It passes (1 pass/8 skipped in `dedup-positive-control.log`).
The existing independent-process provider-idempotency case is
`operations/processes.test.ts:179`; this new test does not replace it or claim a
new independent-process execution.

## New mandatory negative, current supported path

`packages/core/test/gap-hunt-contracts-dedup-expiry.test.ts` has two passing tests:

1. A deterministic finite provider retains a key for one hour. A direct same-key
   resend at T+hour−1 applies no new effect; at T+hour it applies a second effect.
   The control proves this fake has an actual expiry boundary, not indefinite
   deduplication masquerading as expiry coverage.
2. An adapter knows it cannot guarantee the retry horizon. It truthfully declares
   `providerIdempotency: false`, omits `safeToRepeat`, but sets maxAttempts to 3.
   Its `perform` callback can still use the stable `send.operation` as the key
   sent to the provider; the false declaration withholds automatic retry
   authorization, not access to the stable operation identity. The fake commits
   one effect and loses the response. The member is pending on unknown outcome
   with reason `not-repeat-safe`; usage is unknown, never zero. After closing and
   reopening the real durable History/Accounting session at T+2 hours, the same
   operation remains unknown/pending. There is still just one provider receipt
   and one remote effect, despite exhausted deduplication and retry budget left.

The negative uses the existing operations harness: generated owner-alpha ports,
real SQLite History/Accounting, Supervision and Reuse Resolution, and a controlled
clock. Reopening is a new durable session in the same Node test process, with the
external fake provider retained. This is not a new process-termination claim.
Both tests pass; `dedup-expiry-results.log` records 2/2. Core strict TypeScript and
type-aware lint pass in `dedup-expiry-check.log`.

## Classification

This closes the conservative adapter negative required by RUN-012 without
inventing engine-managed expiry. It does **not** prove automatic expiry tracking,
revocation of an earlier true provider-idempotency declaration, or a restart-safe
provider-specific time horizon. A provider with a finite window can be used safely
by withholding safety authorization when that window is uncertain. Explicit
operator reconciliation remains the selected path for ambiguity without safety.

The `perform` seam can implement provider-specific checks before actual I/O, but
this test does not assert that returning unknown from such a guard revokes a
true declaration or avoids all additional framework request attempts. The boolean
alone carries no date and cannot establish that a future retry remains inside a
provider's retention horizon. Parent-owned #170 can document an adapter's horizon
and reconciliation obligations; no new runtime bug is inferred from a deliberately
false safety claim, and no new runtime expiry API is proposed here.

## Reproduction

```
node scratch/gap-hunt/contracts/reproduce.mjs dedup-expiry
```

Underlying compile/Jest and strict checks ran locally on Node24.22.1. The runner's
npm-ci/declaration-build wrapper was not rerun for this selector; the prior Linux
report does not cover these new assertions.
