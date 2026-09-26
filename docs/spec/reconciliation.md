# Reconciliation and migration

Status: authority migration record, 2026-09-26. The new [entry point](README.md)
replaces reading historical documents in chronological order to infer the contract.
The consolidated specification preserves product behavior while retiring superseded
mechanisms. It does not retrofit new runtime behavior into the existing scaffold.

## Explicit supersessions

| Earlier rule/proposal | Active contract | Consequence |
| --- | --- | --- |
| Memo subject derived from function name and input identities | RES-001 | Full author-provided opaque subject, unique within analysis; no hidden name namespace |
| Automatic derived identity for every transformation | TRK-7, COL-1 | Logical identity is explicit; ordinary value reads do not automatically consume it |
| Source hashing prohibited/advisory only | TRK-2, REUSE-008 | Tracked implementation evidence automatically affects validation; not a locator |
| Compatibility details still all open | REUSE-008 | Per memoized step, positive integer, default 1; validated rollback permitted |
| One dynamic graph or no declared graph | CMP-1/2 | Fixed step graph, dynamically expanded result graph and observed reads |
| Ban all nested memoized calls | CMP-5/7 | Declared nested calls allowed; justified current arguments or honest outer miss |
| Flatten child internals or compare only child generation IDs | REUSE-005 | Current child validation and consumed-output cutoff |
| Passing a proxy consumes its whole subtree/identity | TRK-5/6 | Actual reads/materialization determine observations |
| Dotted string paths or numeric positions as universal identity | VAL-1, COL-1/2 | Structured addresses and distinct keyed/collection observations |
| Result row includes claimed/abandoned as if completed | RES-003/5 | Completed immutable snapshots separate from attempts and current acceptance |
| Persist a finality marker/answer and skip later hook | REUSE-002 | Current hook authoritative every needed resolution |
| Retention inferred from equal output | RES-004 | Exact explicit retain outcome; fresh equal results remain distinct |
| Cost-based reclamation can remove referenced data | RES-006, ACC-008 | Referential integrity and retention required; unknown cost grants no permission |
| Single-row CAS establishes full publication | PUB-001–004 | Atomic/recoverable joint protocol required and crash-tested |
| Exact dry-run future work/cost forecast | CLI-002, REUSE-009 | Known boundaries and uncertainty; no paid validation replay |
| Retry entirely outside library support | RUN-011–013 | Supervised retry/waits/idempotency support; adapters own provider specifics |
| First interrupt necessarily drains entire steps | RUN-014/15, EXP-8 | Escalating intent settled; drain/deadline/race policy remains experimental |
| Experiment isolation only a distinguishing input | RUN-017 | Store, credentials/services and external effects isolated too |
| USD as universal resource total | ACC-001–008 | Observed quantities/units, estimates, gaps and acknowledgment separate |
| Twelve internal components as final package architecture | ARC-001–009 | Six contexts and strong supporting components, each with owned contracts |
| Siblings use public-only or raw source declarations | PKG-003/4 | Explicit alpha-trimmed paths; own tests untrimmed, external default public |
| Java package tree translates literally to workspace packages | PKG-001/006 | Coarse workspace boundary; internal modules remain internal |
| CML private, TypeScript private, # privacy and release tier are one axis | PKG-002/006 | Independent facts; experimental native CML subset, no invented DSL |

## Preserved original product obligations

The old success criteria are reconciled here rather than silently discarded.
References identify old labels solely for migration, not secondary authority.

| Original area | Preserved target/evidence | Qualification |
| --- | --- | --- |
| SC1/2/3 minimal reevaluation | DOM-1/6, TRK-5, A-02/A-05 | Tracked implementation change now intentionally affects its consumers; output cutoff still applies across child results |
| SC4/5/6 fanout and narrow reads | COL-1–4, DOM-3, A-07/A-17 | No constant-space promise for arbitrary conditional evidence; measure memory |
| SC7 retained regeneration | RES-004/6, A-10 | Tracked reroll input may produce new snapshot; no automatic deletion |
| SC8 explanation | CLI-001/3, RES-007 | Reads historical evidence without executing work |
| SC9 interruption | PUB-004, RUN-015, TEST-4 | Completed work survives; in-flight external effects/usage can remain uncertain |
| SC10 scale | TEST-5 | 150k is measurement target; no unmeasured deadline guarantee |
| SC11 dry run | CLI-002 | Exact predictions limited by unknown future outputs/source work |
| SC12 convergence | PUB-002/5 | Default coordination, fenced publication; stale remote calls prevent universal exactly-once guarantee |
| SC13 interchangeable mechanisms | ARC-003/8, EXP-3 | Ports tested independently; qualifying a backend requires its real fault evidence |
| SC14 inverted costs | DOM-1, TEST-6 | CPU-bound and expensive-aggregate consumers remain valid |
| SC15 library usability | DOM-2, PKG-004 | Authors use ordinary TypeScript; architecture tooling need not run in each analysis |
| SC16/18 failures and progress leases | RUN-015, PUB-002/4 | No timer-generated fake progress or stale ownership changes |
| SC17 identity | RES-001, TRK-7, COL-1 | Superseded name/implicit identity derivation not preserved |
| SC19 middleware | REUSE-009 | Protected lifecycle; valid hits before budget refusal; observer failure isolation |
| SC20 naming | RES-001 | Names remain useful display metadata, no longer storage identity |
| SC21 tags and immutable values | TRK-3, VAL-3 | Fresh-process observations and retained snapshots distinct |

Additional preserved constraints: author locality hints express locality rather
than a balance promise; measure before adopting work stealing/adaptive workers.
Retain the ability to substitute concurrency/storage/materialization ports. A
first distributed worker design is deferred; do not turn that deferral into an
assumption that a member always runs in one process. HTTP response caching remains
an optional adapter mechanism, never an automatic step-level retention decision.

## Scaffold migration

1. Keep existing Store/naming/tracking tests as dated baseline evidence. The name
   utility remains useful metadata code; its existence does not authorize name-keyed
   memoization. Single-row Store conformance is not publication qualification.
2. Establish new package/type/import enforcement after EXP-5; migrate incrementally
   with tests before software. The old dependency graph check remains a **baseline
   fixture** until then, not proof of six-context conformance.
3. Select canonical encoding and binding protocol before durable writes. Existing
   provisional row types are replaceable; no claim of a shipped compatible format
   exists. If persisted experimental data exists, identify/version it explicitly;
   never silently reinterpret it as the new model.
4. Existing authoring examples test proposed signatures/application callbacks only.
   Adapt them after experiments; do not ship obsolete constructors as a shortcut.
5. API reports, context import rules, runtime tests and documentation must migrate
   together. No source-path alias bypass to make interim consumer checks pass.

## Artifact policy

The previous source drafts, decision chronology, design findings, implementation
plans, scenarios and authoring explorations are moved under
[archive/pre-consolidation](../archive/README.md). They retain provenance but carry
no active design authority. The old component graph remains at its original path
as a minimal, labeled fixture because an existing tooling test reads that file;
its full historical narrative is archived. Historical validation/adoption records
remain reachable as evidence with explicit links to the new entry point.

[Source map](artifacts/source-map.csv) supplies a compact machine-readable inventory.
The machine-readable restart fixtures encode selected semantics without freezing
an API or storage format. CML/Lean/TLA+ artifacts are planned by named experiments;
we do not claim a model is valid without its actual toolchain checking it.
