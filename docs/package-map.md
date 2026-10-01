# Implemented package and context map

This is an implementation map for the current checkout. The [architecture](spec/architecture.md)
and [package boundary](spec/package-boundaries.md) contracts govern it; an absent
package below is a planned owner, not a shipped API. The executable role and edge
registry is [`tooling/package-architecture.mjs`](../tooling/package-architecture.mjs).
This map describes the checked-out tree. Milestone acceptance and default-branch
delivery are separate gates recorded in the [M2 evidence record](validation/m2-2026-09-27.md).

| Role | Package now | Existing capability and port | Declared edges |
| --- | --- | --- | --- |
| Author facade / assembly | `microdelta` (`packages/core`) | Supplies the Node Machine to History's memory factory; preserves `createMemoryStore(options?)` and exports the existing Store errors, types, and Jest conformance entry. Its project-private alpha workspace path composes the owners: `authoring()` builders bound to Resolution's family, `openWorkspace` over durable History with Node SQLite and clock, supervised runs with the normal (`resolve`) and recovery (`recover`) entry operations, `check`, ordinary work and exact reads, `currentRun()` context lookup, operator stop controllers on Node's timer, and `currentExecution()` execution controls | Composition may consume approved owner contracts and `@microdelta/machine-node`; contexts cannot import through the facade |
| Definition & Binding | `@microdelta/definition` | Project-private alpha family-bound builders: frozen source/memo declarations with complete subjects and versions, the fixed M3 composition (memo to sibling source per explicit member), exact structural correspondence with distinct missing/ambiguous outcomes, direct-child witness reconnection, and an invocation bridge that hands actual author callbacks to an injected invoker and dispatches argument-free declared handles through an injected port; the topology's declared input and callable slot names, the read-only `isComposing()` composition-phase query, plus label-only `nameOf` | Value Semantics |
| Tracking & Observation | `@microdelta/tracking` | Process-local tags, frames, cells, and derivations plus project-private `createTrackingObserver(host)` alpha contracts for detached supported wrappers, consumed semantic facts, called-function implementation evidence, current-fact comparison, and cached evidence replay | Value Semantics and `@microdelta/machine` |
| Result History & Publication | `@microdelta/history` | Existing row Store contract and compatibility row schema; memory adapter receives a snapshot capability; alpha exact completed-result selection and fingerprint-reading ports; project-private alpha durable SQLite authority (`openDurableHistory`) over injected SQLite, clock and SHA-256 capabilities, owning the writer lease, attempts, atomic publication, current pointers, immutable results with a generated selected index, environment-scoped acceptance records, recorded promotions between environments, and Run Supervision's fenced operation journal of opaque versioned records | Value Semantics; `@microdelta/machine` |
| Reuse Resolution | `@microdelta/resolution` | Project-private alpha `createResolution`: candidate lookup by scoped subject and version, own implementation/input/helper validation, current finality and explicit-retention source policy, direct-child witness reconnection with consumed-output comparison, admission before claims, check-only evaluation, request-key attempt identity with complete intent digests and no-execution recovery over History's durable authority; plus its binding family and minted source outcome envelopes | Definition, Tracking, History, Materialization |
| Run Supervision | `@microdelta/supervision` | Project-private alpha `createSupervision({ context })` over a structurally injected async-scope capability: scoped runs with volatile run id, analysis and selected environment; `current()` lookup failing outside a live run, after close and during composition; lazy writer-lease use for normal requests only; the caller's admission policy; observe-only observers at the fixed `stepLifecycle` and `ordinaryLifecycle` positions; ordinary nonmemoized work; operator stop control (soft drain with no default deadline, deadline escalation, hard stop aborting bodies, sends, permit waits and timed waits), the publication-commit check, a bounded permit pool guarding real sends, the member fan-out window, and scoped execution controls over an injected timer. External-operation identity, retry and deferral policy remain unimplemented | Definition, Resolution, Accounting |
| Resource Accounting | `@microdelta/accounting` (`packages/accounting`, workspace-private until its npm trusted-publishing registration) | Project-private alpha durable port (`IDurableAccounting`) and its SQLite adapter (`openDurableAccounting`) over the injected Machine SQLite capability: usage intents recorded for each request attempt before its paid call, usage reports keyed by (operation, report) and acknowledged only once durable, estimates with their basis kept apart from observations, and lock-free summaries that report a request attempt without a report of its own as unknown, never zero. Operation identities stay with Run Supervision. Every fact is environment-scoped, immutable and idempotent, so no write needs History's writer fence. Not yet consumed by Supervision | `@microdelta/machine`, Value Semantics |
| Value Semantics | `@microdelta/value` (`packages/value`) | Supported canonical equality/snapshot encoding, structured observation addresses, selected facts, and fingerprints through Machine's SHA-256 capability | Machine |
| Materialization | `@microdelta/materialization` (`packages/materialization`) | Bounded selected scalar loading, lazy nested views through an optional synchronous navigation capability, explicit detached output, and keyed projection observation through injected ports; each reader declares its supported capabilities | History, Tracking, Value Semantics |
| Machine host contract | `@microdelta/machine` (`packages/machine`) | Portable async-context, detached-snapshot, SHA-256, SQLite, clock and timer capability contracts | Supporting contract; consumed by Tracking, History, Resource Accounting, Value Semantics, and the Node adapter |
| Node Machine adapter | `@microdelta/machine-node` (`packages/machine-node`) | Implements the contracts with Node async hooks, V8 structured serialization, crypto SHA-256, SQLite, the wall clock and Node timers | `@microdelta/machine`; selected by the facade assembly |

History's `types.ts` preserves the old row schema and the facade's existing
exports. Direct History memory-store construction accepts a snapshot capability;
the facade keeps its existing `createMemoryStore(options?)` signature by
supplying the Node adapter at assembly. `Path` addresses rows in that Store; it is not the future structured
semantic address. `Identity`, `Subject`, and `RecordedRead` remain compatibility
shapes, not ratification of the target domain model. `nameOf` supplies a label,
never a durable subject key or current-binding locator.

History's durable authority is a separate alpha entry beside the unchanged
row Store: the facade does not export it and the public Store API is unchanged.
It stores Resolution provenance and acceptance evidence as versioned opaque
records and validates their exact dependency references, without importing
Definition or Tracking. Environments are namespaces within one store
(RUN-017): attempts, heads, candidates, acceptances and journal records of one
environment never satisfy another, except results that a recorded, fenced
promotion admits. Run Supervision's operation and deferral records are stored
through the same authority's operation journal, as opaque versioned records
with compare-and-set revisions under writer fencing; History never interprets
them. Its real-SQLite and independent-process evidence runs in the facade's
assembly tests (`packages/core/test/durable-history` and
`packages/core/test/journal`), because only assembly may compose History with
the Node adapter.

Reuse Resolution is History's first consumer. It records its provenance,
acceptance and attempt-ending evidence in its own versioned formats, and its
behavioral suites also run in the facade's assembly tests
(`packages/core/test/resolution`) over the real SQLite authority.

Resource Accounting owns its persistence port and schema (`microdelta.accounting.durable`,
the `accounting_` namespace) in its own SQLite file; it does not share History's
file, whose exact-schema validation admits only History's objects. Its Node
conformance and independent-process kill evidence runs in the facade's assembly
tests (`packages/core/test/accounting`), which alone may compose it with the Node
adapter; the facade consumes it there as a development dependency only.

Run Supervision owns run lifetime, admission and observer positions without a
Machine or History import: assembly injects the Node Machine as its scope
capability, builds each run's Resolution over Supervision's admission and
observer ports, and supplies History's writer lease through a writer port. The
facade's alpha workspace path is exactly that composition; its surface is
declared as facade-local `@alpha` aliases, so the public rollup still exposes
only the Store API. Its assembly suites (`packages/core/test/workspace`) run
over the real owners, and the checked-in
[contribution report example](../examples/contribution-report/README.md)
compiles against the installed workspace's generated alpha declarations and
runs through the same path. The M3 independent-process acceptance harness
(`packages/core/test/acceptance`) runs each step as a separate process over the
built facade and the real SQLite store, including kill boundaries and
lost-acknowledgment recovery; see the
[M3 acceptance record](validation/m3-acceptance-2026-09-28.md). The M4 independent-process
acceptance suite (`packages/core/test/m4-acceptance`) drives the keyed
discovery, gated template, nested supplied assessor and strict fold the same
way; see the [M4 acceptance record](validation/m4-acceptance-2026-09-29.md).

The Tracking observer is bounded M2 owner functionality: it stores no binding
catalog or History rows and does not decide source freshness or reusable results.
Its explicit output snapshot records consumed data and returns detached immutable
values; Materialization composes that operation with History reading ports.
Its structural binding descriptor is supplied by another owner and resolved through
the current-fact provider. It does not establish
arbitrary JavaScript closure soundness.

Each implemented package generates untrimmed, alpha, beta, and public declaration
rollups plus a reviewed API report. Definition, Tracking, Resolution,
Supervision and Accounting's current exports are project-private `@alpha`, as are Value,
Materialization, History's new reading ports and the facade's workspace path;
History's existing facade exports remain `@public`. A project-private rollup may
name its approved producers' alpha contracts; the declaration preflight admits
exactly that alpha declaration closure for type resolution without granting a
source edge.
History and the facade each generate the same four views and a separate API report
for the exported `conformance/store` compatibility subpath; package metadata points
external consumers to the public rollup, and the facade resolves History's
subpath through its alpha rollup. These are declaration surfaces, not runtime
privacy controls.
History's root and conformance reports check their own export sets. Their published
declaration shims select those sets from one additional canonical History rollup
per tier, so a `Fingerprint` or `Store` used across the two entries retains one
TypeScript identity. The build verifies exact export parity and the checked gate
rejects a missing canonical view or a shim pointing at the wrong tier. The
runtime JS entries remain distinct; the root does not export the Jest suite.
The only `@internal` production member is the memory backend's `_onValueRead`
conformance probe. No production beta API exists. The fixture-only producer under
`fixtures/declarations/` exercises all four distinct tiers and selected beta
package metadata without publishing a package.

`npm run check` builds producers before checking consumers, then runs strict
TypeScript, including `types: []`/`skipLibCheck: false` checks for portable
Tracking and History source, type-aware ESLint, source-import enforcement, declaration-path
preflight, API report comparison, and fixture checks. The typed capture rule
checks its declared syntax and canonical generated brands; it does not prove
arbitrary closure purity or dynamic JavaScript behavior. `npm test` runs outcome
fixtures, Jest owner behavior, and tsd type contracts. Source imports must use
approved package names and directed edges; TypeScript paths used by a sibling
must name generated alpha declarations. The preflight resolves inherited compiler
paths and rejects aliases, forbidden edges, wrong tiers, or missing producers.
The CI wiring check fails if a required aggregate command or API report is omitted.
Runtime ESM imports resolve built package exports independently of TypeScript mappings.
