# Implemented package and context map

This is an implementation map for the current checkout. The [architecture](spec/architecture.md)
and [package boundary](spec/package-boundaries.md) contracts govern it; an absent
package below is a planned owner, not a shipped API. The executable role and edge
registry is [`tooling/package-architecture.mjs`](../tooling/package-architecture.mjs).

| Role | Package now | Existing capability and port | Declared edges |
| --- | --- | --- | --- |
| Author facade / assembly | `microdelta` (`packages/core`) | Explicitly reexports History's existing Store errors, types, memory factory, and Jest conformance entry | Composition may consume approved owner contracts; contexts cannot import through the facade |
| Definition & Binding | `@microdelta/definition` | Function-name inspection for labels and diagnostics only; no binding or identity port yet | Value Semantics contract when implemented |
| Tracking & Observation | `@microdelta/tracking` | Current process-local tags, capture frames, cells, and derivations; no durable observation encoding | Value Semantics contract when implemented |
| Result History & Publication | `@microdelta/history` | Existing row Store contract, memory adapter, compatibility row schema, and Store conformance suite; no cross-row publication operation | Value Semantics contract when implemented |
| Reuse Resolution | No package yet | Candidate-validation and source-policy ports remain unimplemented | Definition, Tracking, History, Materialization |
| Run Supervision | No package yet | Admission, progress, retry, and cancellation ports remain unimplemented | Definition, Resolution, Accounting |
| Resource Accounting | No package yet | Observation and acknowledgment ports remain unimplemented | None |
| Value Semantics | No package yet | Future canonical encoding, structured paths, and fingerprint port; EXP-2 owns the decision | None |
| Materialization | No package yet | Future selected-load and observation bridge | History, Tracking, Value Semantics |
| Machine host boundary | No package yet | Node capability contract and implementation are issue #3 | Not a bounded context |

History's `types.ts` preserves the old row schema and the facade's existing
exports. `Path` addresses rows in that Store; it is not the future structured
semantic address. `Identity`, `Subject`, and `RecordedRead` remain compatibility
shapes, not ratification of the target domain model. `nameOf` supplies a label,
never a durable subject key or current-binding locator.

Each implemented package generates untrimmed, alpha, beta, and public declaration
rollups plus a reviewed API report. Definition and Tracking's current exports are
project-private `@alpha`; History's existing facade exports remain `@public`.
The only `@internal` production member is the memory backend's `_onValueRead`
conformance probe. No production beta API exists. The fixture-only producer under
`fixtures/declarations/` exercises all four distinct tiers and selected beta
package metadata without publishing a package.

`npm run check` builds producers before checking consumers, then runs strict
TypeScript, type-aware ESLint, source-import enforcement, declaration-path
preflight, API report comparison, and fixture checks. `npm test` runs outcome
fixtures, Jest owner behavior, and tsd type contracts. Source imports must use
approved package names and directed edges; TypeScript paths used by a sibling
must name generated alpha declarations. Runtime ESM imports resolve built package
exports independently of those TypeScript mappings.
