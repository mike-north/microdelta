# microdelta specification — start here

**Status as of 2026-09-27: consolidated design baseline; M0.5 accepted;
M1 bounded experiment decisions are recorded; final acceptance follows the
[M1 evidence record](../validation/m1-2026-09-26.md). M2 bounded tracking and
package components are implemented; their [evidence record](../validation/m2-2026-09-27.md)
and [acceptance issue](https://github.com/mike-north/microdelta/issues/32) record delivery and verification.
The complete durable runtime remains unimplemented.**
This specification describes the full target; the current checkout implements
only the capabilities listed below.

microdelta keeps analyses current across complete process shutdown while reusing
retained expensive results when the evidence they actually consumed remains
acceptable. Authors choose what to memoize; the runtime observes dependencies,
preserves history, and explains execution without guessing which work is costly.
The repository, workspace, and core package use the `microdelta` identity.

## Authority and reading order

**SPEC-1 — One active specification.** This directory and the linked
[milestones](../milestones.md) are the active design authority. They consolidate
rev 9 and subsequent user decisions, including decisions that supersede rev 9.
The [archive](../archive/README.md) is historical evidence only. Existing source,
types, tests, and old example APIs are implementation evidence, not competing
requirements. If active artifacts conflict, report the conflicting IDs and resolve
the conflict before implementing affected behavior; do not silently pick one.

Read this entry point, then only the contracts relevant to the task:

| Artifact | Owns | Read when |
| --- | --- | --- |
| [Ubiquitous language](glossary.md) | Shared terms, distinctions, relationships, and ownership | Learning or changing domain vocabulary |
| [Domain](domain.md) | Purpose, vocabulary, scope, governing distinctions | Always on first entry |
| [Architecture](architecture.md) | Six contexts, ownership, dependency directions, Machine host boundary, supporting modules | Crossing or changing boundaries |
| [Package boundaries](package-boundaries.md) | Declaration tiers, visibility, compiler/API enforcement as the architecture/API contract | Package/API/tooling work |
| [Tracking](tracking.md) | Unified tracking, value/path/identity/collection observation rules | Changing dependencies or values |
| [Composition](composition.md) | Fixed step graph, dynamic result instances, higher-order binding | Graphs, nesting, fanout |
| [Execution](execution.md) | Current validation, exact references, retention, publication | Reuse, persistence, recovery |
| [Operations](operations.md) | Readiness, preview, failure, retry, cancellation, trial, accounting, CLI | Run lifetime or operational work |
| [Acceptance](acceptance.md) | Cross-contract scenarios, expected outcomes, proof obligations | Writing tests or closing a gate |
| [Experiments](experiments.md) | Bounded unknowns, fixtures, evidence, adoption gates | After foundation, for dependent runtime work |
| [Milestones](../milestones.md) | Delivery order and independently reportable quality gates | Selecting work |
| [Reconciliation](reconciliation.md) | Superseded rules, migration from the scaffold, artifact coverage | Checking historical contradictions |

**SPEC-2 — Requirement status.** `MUST`/`must` and stable IDs express settled
requirements. `Proposal` denotes a candidate mechanism; `Experiment` denotes a
question with a bounded evidence gate; `Deferred` excludes a capability from the
current implementation sequence. A proposed API spelling is not a public contract.
Do not promote a proposal merely by implementing or copying its example.

## Agent work protocol

**SPEC-3 — Tests before software and durable comments.** Find the owning requirement
IDs and acceptance cases; write outcome-based failing tests before implementation.
Document durable intent throughout software, including but not limited to
modules, constants, types, functions, and classes: their meaning,
responsibilities, boundaries, and relevant invariants.
Comments explain semantic contracts rather than repeating declarations or
narrating implementation steps. Keep milestone status and temporary progress in
work records, and update comments when the contract changes. When a proposed
change expands an abstraction's purpose, assess whether a composing abstraction
better preserves its responsibility. For experiments, define executable
assertions before the mechanism under test. Reversible documentation edits require
consistency and link checks, not invented runtime tests. Keep observations of
existing behavior distinct from promised behavior.

**SPEC-4 — Evidence scope.** A compiler probe proves a type boundary, not runtime
privacy. A memory backend test proves no restart guarantee. An executable formal
model does not prove TypeScript implements it. Durable gates require independent
processes and fault injection. Report what passed, what did not run, and what
remains outside the proven scope. See [acceptance](acceptance.md).

**SPEC-5 — Stop at the actual gate.** Consolidation precedes the M0.5 tooling,
package, and Machine foundation; that foundation precedes runtime experiments;
experiments precede their dependent mechanisms. Shaped package/API surfaces and
their compiler, API Extractor, and import checks are the selected architecture
contract; CML correspondence is retired (PKG-006). Use TLA selectively under the
bounded model-to-code-and-test review in PUB-004; Lean remains dormant unless a
concrete correctness need justifies resuming it (VAL-2). Raise a product question
only for a demonstrated conflict with a settled contract or a consequential
author-visible choice. Routine encoding and tooling choices belong in experiments.
No paid calls, publication, or runtime implementation are part of this specification update.

## Artifact conventions

Stable IDs are searchable literal strings. Links are relative and readable in a
plain checkout. Mermaid/ASCII figures explain the adjacent normative tables; they
do not independently redefine them. The JSON [reuse fixtures](artifacts/reuse-cases.json)
are language-neutral scenario data with expected outcomes, not a persistence or
public API schema. Formal models are supporting evidence only when selected for a
concrete correctness question; owning contracts record their scope and limits.
Retired CML and dormant Lean artifacts are historical evidence, not active
tooling requirements or alternate authorities.

The [validation record](validation.md) documents M0 checks and their limits.

The [reconciliation inventory](artifacts/source-map.csv) records where each former
design area is covered. Historical docs are not part of the normal reading path.

## Current checkout

The `microdelta` facade preserves its public History Store API. The checked-out
packages also contain bounded project-private alpha components: Value equality,
snapshot and projection semantics; Tracking's semantic observer, called-function
evidence, scoped capture and replay; History's exact selected-reading ports; and
Materialization's selected scalar views, explicit detached output, and keyed
projections. Machine supplies injected host capabilities, with the Node adapter
owning async context, snapshots, and SHA-256. The [implementation map](../package-map.md)
records each owner's current scope and missing roles.

Generated declaration tiers, API reports, package edges, and the supported typed
capture boundary are checked by executable tooling. They do not establish
arbitrary JavaScript closure soundness. The new components do not provide durable
memoization, a production completed-result reader, general fanout, or scale proof.

The [M2 evidence record](../validation/m2-2026-09-27.md) maps these bounded
capabilities to current-head reviews, integrated checks, component merges, and
default-branch verification. The [acceptance issue](https://github.com/mike-north/microdelta/issues/32)
records the final milestone decision and the documentation delivery result. The
[M0.5 acceptance record](../validation/foundation-2026-09-26.md) and
[M1 evidence record](../validation/m1-2026-09-26.md) retain their bounded evidence;
[historical validation](../validation.md) remains dated evidence, not a fresh run.
