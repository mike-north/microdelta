# Add preview envelopes and bounded live observation without execution

Classification: specified-but-missing target capability. Severity: P2. Stage: **M6 inspection support**, because CLI-004 requires progressing values/errors/coverage for intervention and CLI-001 forbids inspection-triggered work. The milestone does not separately name every library preview mechanism; RUN-006–008 remain their normative owners. M7 full-workflow scale/aggregate optimization is separate.

Governing contract: `docs/spec/operations.md` RUN-006–008 and CLI-004. A latest-value preview distinguishes unavailable, available-but-stale/unverified and accepted values; failed refresh preserves the prior value plus stale/error status. Empty/zero/undefined cannot mean unavailable. Repeated observation never refreshes sources. Optional throttling delivers periodic latest states under sustained arrivals and a final trailing state; delivery does not renew claims or establish readiness.

Minimal synthetic consumer using actual alpha operations:

```sh
node scratch/gap-hunt/contract-operations/preview-consumer.mjs
node scratch/gap-hunt/contract-operations/inspect-surface.mjs
```

Observed/control: a histogram source publishes `{buckets:{accepted:3},total:3}`. The next authorized resolution fails with `execution-failure`. A new run performs1000 `read(oldReference)` calls: they all return the prior immutable **author payload**, and fetch count stays2. This verifies exact-read safety and preservation. The failed resolution is a separate error; the caller has to retain the old reference and synthesize freshness/error state itself.

The complete generated alpha `IWorkspaceRun` property inventory in `surface.json` has resolve/member/fold/check/recover/ordinary/operation/promotion/read/usage capabilities. `IRunObserver` has an `observe(event)` callback captured in run options; events carry restricted lifecycle/status identifiers and do not expose author values. There is no supported latest-value preview envelope, value/status observer lifetime/disposal contract or throttle/coalescing boundary. Consequently the consumer cannot request the stipulated stale+error envelope or drive a controlled-clock throttle assertion through a supported operation. This is an unavailable capability, not a failed call to an invented method or a claim that exact `read` should secretly return a different type.

Expected: a supported observation path supplies a library envelope independently of evaluation, preserves stale value/error after failure, distinguishes successful undefined from absence and delivers periodic/final coalesced states without dispatch or writes. Its contract specifies status/error lifetime and disposal; valid exact reads remain exact reads.

Direction: define the minimum preview/read-side contract and controlled-clock delivery owner, then test stale+error, no-prior failure, equal-data status changes, no-dispatch controls, sustained arrivals/final delivery, replacement/removal in aggregates and narrow payload loads. Group envelopes and throttle/disposal under one observation capability. Do not count event logging or materializing an old result as proof of this target.

Duplicate scan: all84 returned open/closed issue titles scanned (limit200); no preview/envelope/throttle issue found. Existing tracked observation #26 covers semantic capture, not this delivery surface. Parent rechecks before filing; no issue filed here.

Implementer: Codex worker (gpt-6.1-sol).
Agent assistance: Codex worker (gpt-6.1-sol) authored and ran synthetic consumer/control evidence; parent review/filing remains separate.

## Decision required before implementation pickup

Leave unlabelled until the owner records these deliverables; do not infer a new method from this report.

1. Define envelope discriminants and the relationship among absence, successful undefined, stale/unverified value, accepted value and refresh error. Define error/status lifetime and which value is retained after failed refresh.
2. Assign observation ownership, lifetime/disposal and read-side boundaries independently of run evaluation. State whether subscriptions outlive a run and how aggregate replacement/removal is observed.
3. Define coalescing/throttling clock and delivery guarantees: periodic latest states during sustained arrivals, final trailing delivery, equal-data status changes, and disposal behavior.

Conditional implementation acceptance:

1. Test no-prior failure, successful undefined/zero/empty values, prior-value failed refresh and equal-data status changes against the chosen discriminants.
2. Negative control: repeated observation dispatches no callbacks, writes or claim renewal; exact-reference read retains its current author-payload semantics.
3. Controlled-clock tests prove sustained-arrival periodic delivery, final trailing delivery and no delivery after the decided disposal boundary. Test aggregate replacement/removal without eagerly loading unrelated payloads.

Out of scope: M7 scale optimization, automatic refresh/retry, UI toolkit, or changing exact-read meaning. Dependencies: public read-side/lifetime owner, coordinated with CLI M6; no assumption that current lifecycle event logging supplies value observation.

Clean evidence-checkout single-command reproduction (Node24.22.1/npm, network registry access and native toolchain/prebuild prerequisites):

```sh
bash scratch/gap-hunt/contract-operations/verify-preview.sh
```

This runner installs the lockfile with npm ci, builds package declarations, passes valid controls, then exits0 after confirming the complete reviewed baseline owning surface. It does not call an imagined API. A future surface change intentionally requires renewed semantic review. This is not a regression test that becomes green after implementation; behavioral test-first assertions must be written after the owner selects the API. The raw CLI npm command legitimately fails and is captured as data. Captured macOS execution is verify-preview.log; Linux remains unverified. No paid service or external provider is called. The resource-state runner never encodes balances as additive deltas.
