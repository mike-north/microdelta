> Historical artifact. Superseded by the [active specification](../../spec/README.md). Do not implement from this document.

# microdelta core: implementation plan

**2026-09-26 roadmap update:** use [the milestone plan](../../milestones.md) for the
current delivery sequence, including scoped design explorations and executable
proofs. It carries the later tracking and identity decisions into explicit gates.
The dated plan below remains background; its older sequencing, fixed Store API,
and exclusion of automatic source-change tracking do not override that roadmap.
Existing implementation and historical test results are foundations, not evidence
that the new milestone gates have passed.

The supplied handoff is the implementation brief. Rev 9 governs semantics; the draft core specification supplies proposed APIs; the components document supplies sequencing; the viewer is context only. Unmodified source copies are in `docs/source/`. No package will be published.

**2026-09-15 current continuation:** the user selected scoped analysis context.
The [detailed test-first plan](scoped-context-implementation-plan.md) adds the
context leaf proposal, contract prerequisites, and trial/helper/CLI delivery gates
while preserving the core sequencing below. It supersedes earlier statements
here that those product capabilities are merely optional exploration; exact
unselected APIs and lifecycle details remain explicit contract gates.

## Decisions and scaffold

- **Pipeline scope (2026-09-15 user decision):** analysis structure is known
  upfront; runtime discovery determines result instances and cardinality within
  known fan-outs. Design bindings for preview versus complete-value consumption.
  Do not solve arbitrary dynamically introduced analysis structure. This narrows
  earlier assumptions; exact declaration syntax remains under exploration.

- **Tracking:** adopt `@preact/signals-core@1.14.4` behind `track`, using its signals/computed machinery and façade-owned AsyncLocalStorage frames. Cached derivations replay their concrete consumed tags into the caller's frame. Node ≥20 and AsyncLocalStorage are confirmed; the façade can now proceed. See [adoption evidence](../../track-adoption.md) and [decisions](decisions.md).
- **Layout:** npm workspace, `packages/core` named `microdelta`; both workspace and package marked private during implementation. No helpers or React package. TypeScript 5.9, strict NodeNext ESM, declarations and source maps; no bundler. Compiler and tooling versions are pinned in the lockfile. No `skipLibCheck`.
- **Verification:** tests precede implementation. Jest executes compiled ESM; tsd covers public type contracts. DR-1 uses a custom ESLint boundary rule (proposed tooling refinement) to check resolved paths, re-exports, dynamic imports and the schema-only claim/repository edge. Tests compare it against the exact components §6 graph. CI is configured for Node 20/22/24; local validation is on Node 24.14.0 until additional runtime runs are performed.
- **First storage contract:** preserve the draft Store API and distinguish its single-row CAS guarantee from the unresolved multirow publication protocol. The memory backend isolates caller-owned values, maintains a separate fingerprint index, and exposes a test diagnostic for actual value reads. It does not know lifecycle semantics.

## Sequencing gates

1. **Store first:** shared row types and interface → reusable SA-1…SA-7 conformance tests → memory backend. Check one-winner CAS, insert races, tuple isolation, immutable field rows, copy isolation, metadata, and expiry-query ordering. This does not qualify claim crash recovery or durable SQLite behavior.
2. **Remaining leaves:** name; fingerprint and identity after canonicalization/path/graph questions are resolved; adopted track with the confirmed Node/ALS baseline; middleware after its outcome/context contract is concrete. Each component gates on its own rule-derived tests.
3. **Second layer:** trace, repository, claim against fakes; SQLite conformance including reopen, independent connections, and crash boundaries. Blocked components remain unimplemented until their settled-rule contradictions are corrected.
4. **Materialize then wrapper:** explore the authoring surface through code snippets before selecting property promises, field bags, or lightweight handles. Promise-valued properties are allowed, not selected. Build dependent paths after durable nested-address contracts are testable. Gate on rev9's ST0–ST3, ST7, ST9, ST16 and S34/S36/S37/S43. Include core storage-laziness checks; do not silently renumber ST3.
5. **Explain:** seeded repository tests for explanation and pricing, with explicit limits where dry-run outputs are unknown. Measure ST11 on SQLite before considering infrastructure.

## Confirmed and pending assumptions

The user confirmed Node ≥20, AsyncLocalStorage, and array length as a field read.
Argument-order subjects, the pinned-string identity encoding, unnamed `step()`
throwing, and the provisional lease/poll/sweep/tracing defaults remain pending.
The ESM scaffold remains a proposed package-format choice. No unanswered item is
treated as confirmed by silence. OQ2's member-identity-only collection fingerprint
is still unresolved because it may hide content changes. See [decisions](decisions.md).

## Findings requiring decisions

The [design findings](design-findings.md) give source lines, counterexamples, and affected gates. Most consequential: single-row CAS does not yet provide atomic/fenced publication; nested generation invalidation contradicts field-level early cutoff; the durable trace cannot describe all specified reads or reconstruct nested arguments; and paid-result deletion contradicts rev9. Promise-valued properties resolve the earlier asynchronous-access question. These are contract findings, not permission to reopen settled semantics.

## Added product scope: analysis CLI and fan-out failures

Use the user's [GitHub contribution scenario](scenarios/github-contribution-analysis.md)
as a product acceptance anchor: cheap histograms update as facts arrive while
memoized analysis of an individual's review period waits for complete required
evidence. Prototype the same data feeding both consumers before finalizing the
preview/combinator/readiness surface. Its acceptance cases are not yet implemented.

The user now requires excellent live analysis progress, cache confidence, and
first-class fan-out presentation, with aggregate metric/cost affordances under
exploration. See [CLI and failure design](exploration/analysis-cli-and-failures.md).
Extend the authoring exercises with strict completion, explicit partial folds,
sibling failure policies, and coverage-aware verification before choosing APIs.

This extends the original core-only product scope. Plan an observer contract at
the core boundary, structured group reporting at the helper boundary, and CLI
presentation separately. Package placement and policy defaults remain undecided;
this does not authorize moving helpers or retry into core. Live cost reporting
must distinguish observed usage from durable recorded usage under the existing
generation contract. The new document lists acceptance scenarios; none is yet
implemented or validated.

No tiering, notification service, timer renewal, core retry, core scheduler,
source hashing, or React viewer implementation is planned. Helper/application
retry, bounded fan-out, cancellation, author-defined trial mode, scoped context,
and observed resource accounting are required capabilities. Their remaining
mechanics and API decisions are listed in the detailed plan; the example
declarations do not constitute an implemented runtime.
