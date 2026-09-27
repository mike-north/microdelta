# microdelta specification — start here

**Status: consolidated design baseline, 2026-09-26. M0.5 accepted;
M1 experiment evidence is under review. Runtime implementation remains incomplete.**
This specification describes the target, not an assertion that the current
scaffold implements it.

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
| [Domain](domain.md) | Purpose, vocabulary, scope, governing distinctions | Always on first entry |
| [Architecture](architecture.md) | Six contexts, ownership, dependency directions, Machine host boundary, supporting modules | Crossing or changing boundaries |
| [Package boundaries](package-boundaries.md) | Declaration tiers, visibility, compiler/API enforcement and separate CML mapping | Package/API/tooling work |
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
experiments precede their dependent mechanisms. CML correspondence is separate
from baseline API Extractor enforcement. Raise a product question only for a demonstrated
conflict with a settled contract or a consequential author-visible choice. Routine
encoding and tooling choices belong in experiments. No paid calls, publication,
or runtime implementation are part of this specification update.

## Artifact conventions

Stable IDs are searchable literal strings. Links are relative and readable in a
plain checkout. Mermaid/ASCII figures explain the adjacent normative tables; they
do not independently redefine them. The JSON [reuse fixtures](artifacts/reuse-cases.json)
are language-neutral scenario data with expected outcomes, not a persistence or
public API schema. CML and formal proof files will be added only by the relevant
experiments using their real parsers/checkers; placeholder syntax is not authority.

The [validation record](validation.md) documents M0 checks and their limits.

The [reconciliation inventory](artifacts/source-map.csv) records where each former
design area is covered. Historical docs are not part of the normal reading path.

## Current checkout

The `microdelta` facade explicitly reexports the existing public History Store
contract. `@microdelta/definition`, `@microdelta/tracking`, and
`@microdelta/history` own the current diagnostic naming, process-local tracking,
and legacy row Store code respectively. The portable `@microdelta/machine`
contracts cover async context propagation and detached snapshots; the
`@microdelta/machine-node` adapter owns the Node bindings. Tracking and History
receive their capabilities through injection, and the facade supplies the Node
adapter while preserving `createMemoryStore(options?)`. The [implementation
map](../package-map.md) records implemented and absent roles without placeholder
APIs. API Extractor rollups/reports and checked import edges are present, and the
Machine boundary is implemented. The [M0.5 acceptance record](../validation/foundation-2026-09-26.md)
links the accepted tooling, package, Machine, CI, and repository-protection evidence.
M1 candidates require their own review and owning-contract decisions; foundation
acceptance does not establish durable runtime behavior. [Historical validation](../validation.md)
remains dated evidence, not a fresh run.
