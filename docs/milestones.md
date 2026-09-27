# Delivery milestones

Authority: [specification entry point](spec/README.md). Status: M0 consolidation
complete (see [validation](spec/validation.md)); M0.5 accepted on 2026-09-27 UTC
(2026-09-26 Pacific; see [foundation evidence](validation/foundation-2026-09-26.md)).
M1 experiment decisions are recorded in the [M1 evidence record](validation/m1-2026-09-26.md);
its final CI and issue-acceptance conditions determine completion. No M2 or later
runtime milestone is complete.
A milestone is a quality checkpoint, including experiments; it need not be a
user-facing release.

## M0 — Consolidated, agent-legible specification

Deliver one linked authority: domain, six-context architecture, package surfaces,
tracking table, graph/binding boundaries, current reuse/history/publication,
operations, acceptance fixtures and experiment charters. Retire contradictory
active guidance. Validate links, IDs, fixture syntax, requirement coverage and
internal consistency. Keep settled contracts separate from proposed mechanisms.

**Exit:** [TEST-7](spec/acceptance.md) and documented consolidation checks. This
milestone does not run the experiments or extend software behavior.

## M0.5 — Tooling, package, and host foundation

Before runtime experiments, establish [PKG-008](spec/package-boundaries.md):
strict TypeScript checks, type-aware lint, tests-first fixtures, API Extractor
declaration rollups and reports, all release-tier consumer checks, fail-closed
source-import checks, and deterministic CI commands. Tests and negative fixtures
must express intended behavior before checker or package implementation. Establish
the coarse package structure and approved context contracts needed to make
these checks real. Package implementation may migrate as needed while retaining
the `microdelta` identity.

Define [Machine](spec/architecture.md) as the Node-first injected host boundary
and establish conformance tests for each capability introduced by this gate or
the first experiment. Isolate runtime Node imports/globals as affected code
moves to the boundary, including the current `AsyncLocalStorage` and `node:v8`
dependencies; record any still-unmigrated baseline source as an explicit gate
failure. History and Accounting persistence adapters remain responsible for
their own ports. No durable filesystem, browser, Lambda, or Worker adapter is a
foundation requirement.

**Exit:** [TEST-8](spec/acceptance.md), [A-15 and A-20](spec/acceptance.md)
pass on the intended package surface from a clean checkout and in CI, with exact
commands and negative-fixture diagnostics recorded. The source-level Node
boundary check passes on runtime code. This foundation must be green before
EXP-1/2/3 runtime prototypes are treated as admissible evidence. The separate
CML mapping experiment may proceed after this gate; it cannot waive the gate.

## M1 — Bounded contract and architecture experiments

After M0.5, run [EXP-1](spec/experiments.md) current binding/restart, EXP-2
value/access semantics, and EXP-3 minimal publication protocol. Run EXP-5 as a
separate bounded CML correspondence experiment; its outcome does not gate the
existing API Extractor declaration checks. EXP-6 Lean and EXP-7 state-model
pilots assess formal artifacts before adoption; their results
may be pass, reject or inconclusive without blocking unrelated contexts. The
publication mechanism must still meet its invariants with or without formal tools.

**Exit:** assertion-first fixtures, exact commands/results, supported-domain limits,
chosen mechanisms or explicit rejection, updated owning contracts. Real process
restart and generated declaration consumers are required where applicable. Do not
build a second miniature product or expand all speculative native-type support.

**Acceptance record:** [M1 evidence and final delivery conditions](validation/m1-2026-09-26.md).
The selected/rejected mechanisms are recorded in their owning contracts. CML,
Lean, and TLC remain optional bounded evidence; their successful checks do not
prove production behavior or make the tools mandatory in unrelated CI.

**Unblocks:** M2/M3 supported data and durable binding/publication. M0.5 already
establishes baseline package enforcement; EXP-5 can refine architecture-model
correspondence without delaying it.
The exact nested-argument cases in EXP-4 and operational details in EXP-8 can wait
until their dependent milestones. No broad product questionnaire is required.

## M2 — Unified tracking and package contracts

Implement supported object/function `tracked()` behavior, automatic implementation
observations, branded type boundary, scoped frames, canonical values/structured
addresses and narrow materialization behavior. Establish independently testable
context contracts on the M0.5 package/API foundation. Extend the compiler-based
capture-lint rules for the supported scope without promising arbitrary JavaScript
soundness. Add Machine capabilities only when these behaviors need them and prove
their Node implementation against the contract.

**Exit:** A-01/A-04/A-15/A-18 and the bounded selected-loading slice of A-17,
collection projection semantics within supported scope,
branch/pass-through cases, isolated async frames, and no live tags in durable
records. Run required source/type/import checks. This is not durable memoization.

## M3 — Tiny durable analysis MVP

Implement the real authoring path over the chosen durable backend: nonmemoized
configuration/helper input plus a minimal declared retained source→memoized
consumer path, exact result references, current source acceptance through the
cached consumer, minimal attempts and crash-safe publication. This includes the
small child-validation path needed for A-03; general nested arguments and
higher-order composition remain M4 work. An enforced
single-writer limitation is acceptable here; it must not masquerade as concurrent
worker safety. SQLite is the recommended initial backend, contingent on EXP-3.

**Exit:** A-02/A-03/A-04/A-09/A-10 and basic A-19 admission in separate processes with kill boundaries;
unchanged/read/unread/code/version changes, reordered explicit member invocations,
retained history and rollback evidence. No fake durability wrapper around a
separate API. No paid provider needed.

## M4 — Composition and keyed collections

Run EXP-4, then implement supplied callable bindings, fixed fanout templates,
hierarchical nested validation, keyed member identity/custom keys, projections,
tracked gates and scoped strict-fold completion. Reconstruct only justified child
arguments; otherwise miss the parent normally. Observe fields implicitly.

**Exit:** A-05/A-06/A-07/A-08/A-11, including equal-output cutoff, discovery closure,
changed current source hooks and illegal topology rejection. No general closure
serialization or result-driven graph mutation.

## M5 — Operational correctness before paid integration

Run EXP-8; implement concurrent claims/fencing, bounded admission, retry/quota waits,
idempotency support, cancellation, durable resource acknowledgments/deduplication,
environment isolation and inspectable structured events. Finish the selected
state-model evidence before claiming concurrency correctness.

**Exit:** A-09 through A-14, A-19 middleware/fault cases, plus lifecycle isolation. Deterministic interleavings and
fresh processes prove stale workers cannot publish/renew/release another holder;
known usage survives faults once; unknown work is not reported free. Presentation
failure cannot cause reexecution of committed success. No real paid acceptance
before this milestone.

## M6 — Usable CLI and inspection checkpoint

Deliver the explicit CLI surface for starting/supervising runs, read-only status,
history/reference inspection, dependency explanations, plan uncertainty, resource
observations, waiting/retries and soft/hard interrupt intent. Commands, event schema
and exit behavior are specified/tested before CLI implementation. Inspection never
starts computation; execution commands express operator intent explicitly.

**Exit:** A-16 and A-13 in a controlled run with success/failure/pending/unknown
states and captured outputs. Verify a separate inspection process and no body/claim
activity from viewing. The CLI is a named deliverable, not incidental scenario glue.

## M7 — Full roster workflow and scale acceptance

Assemble fresh paginated discovery, per-person corpus closure, bounded nested fanout,
strict/explicit partial folds, author-defined trial selection and environment
adapters into [TEST-3/4](spec/acceptance.md). Use the real runtime and CLI with
controlled adapters first. Measure TEST-5/6; distinguish CPU, I/O and data volume
before choosing more elaborate worker policy.

**Exit:** complete cold/restart/change/failure/wait/cancel/trial variants; precise
references and invocation counts; truthful coverage/usage; bounded-memory evidence.
A limited real-provider trial requires explicit authorization and follows these
controlled gates. A React viewer, broad distributed scheduling and package
publication remain outside this delivery sequence.

## Closing a milestone

Write behavioral tests first, observe failure, implement with durable-intent
comments throughout software, including but not limited to modules, constants,
types, functions, classes, and relevant invariants,
run focused and required checks, then report exact scope and remaining work. Never
claim a prototype establishes the full runtime. Update requirement IDs and their
acceptance links together. Escalate only demonstrated conflicts or consequential
product decisions, not routine implementation mechanics.
