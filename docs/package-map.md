# Implemented package and context map

This is an implementation map for the current checkout. The [architecture](spec/architecture.md)
and [package boundary](spec/package-boundaries.md) contracts govern it; an absent
package below is a planned owner, not a shipped API. The executable role and edge
registry is [`tooling/package-architecture.mjs`](../tooling/package-architecture.mjs).
This map describes the checked-out tree. Milestone acceptance and default-branch
delivery are separate gates recorded in the [M2 evidence record](validation/m2-2026-09-27.md).

| Role | Package now | Existing capability and port | Declared edges |
| --- | --- | --- | --- |
| Author facade / assembly | `microdelta` (`packages/core`) | Supplies the Node Machine to History's memory factory; preserves `createMemoryStore(options?)` and exports the existing Store errors, types, and Jest conformance entry | Composition may consume approved owner contracts and `@microdelta/machine-node`; contexts cannot import through the facade |
| Definition & Binding | `@microdelta/definition` | Function-name inspection for labels and diagnostics only; no binding or identity port yet | Value Semantics |
| Tracking & Observation | `@microdelta/tracking` | Process-local tags, frames, cells, and derivations plus project-private `createTrackingObserver(host)` alpha contracts for detached supported wrappers, consumed semantic facts, called-function implementation evidence, current-fact comparison, and cached evidence replay | Value Semantics and `@microdelta/machine` |
| Result History & Publication | `@microdelta/history` | Existing row Store contract and compatibility row schema; memory adapter receives a snapshot capability; alpha exact completed-result selection and fingerprint-reading ports have no production reader backend; no cross-row publication operation | Value Semantics; `@microdelta/machine` |
| Reuse Resolution | No package yet | Candidate-validation and source-policy ports remain unimplemented | Definition, Tracking, History, Materialization |
| Run Supervision | No package yet | Admission, progress, retry, and cancellation ports remain unimplemented | Definition, Resolution, Accounting |
| Resource Accounting | No package yet | Observation and acknowledgment ports remain unimplemented | None |
| Value Semantics | `@microdelta/value` (`packages/value`) | Supported canonical equality/snapshot encoding, structured observation addresses, selected facts, and fingerprints through Machine's SHA-256 capability | Machine |
| Materialization | `@microdelta/materialization` (`packages/materialization`) | Bounded selected scalar loading, explicit detached output, and keyed projection observation through injected ports; each reader declares its supported capabilities | History, Tracking, Value Semantics |
| Machine host contract | `@microdelta/machine` (`packages/machine`) | Portable async-context, detached-snapshot, and SHA-256 capability contracts | Supporting contract; consumed by Tracking, History, Value Semantics, and the Node adapter |
| Node Machine adapter | `@microdelta/machine-node` (`packages/machine-node`) | Implements the contracts with Node async hooks, V8 structured serialization, and crypto SHA-256 | `@microdelta/machine`; selected by the facade assembly |

History's `types.ts` preserves the old row schema and the facade's existing
exports. Direct History memory-store construction accepts a snapshot capability;
the facade keeps its existing `createMemoryStore(options?)` signature by
supplying the Node adapter at assembly. `Path` addresses rows in that Store; it is not the future structured
semantic address. `Identity`, `Subject`, and `RecordedRead` remain compatibility
shapes, not ratification of the target domain model. `nameOf` supplies a label,
never a durable subject key or current-binding locator.

The Tracking observer is bounded M2 owner functionality: it stores no binding
catalog or History rows and does not decide source freshness or reusable results.
Its explicit output snapshot records consumed data and returns detached immutable
values; Materialization composes that operation with History reading ports.
Its structural binding descriptor is supplied by another owner and resolved through
the current-fact provider. It does not establish
arbitrary JavaScript closure soundness.

Each implemented package generates untrimmed, alpha, beta, and public declaration
rollups plus a reviewed API report. Definition and Tracking's current exports are
project-private `@alpha`, as are Value, Materialization, and History's new reading
ports; History's existing facade exports remain `@public`.
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
