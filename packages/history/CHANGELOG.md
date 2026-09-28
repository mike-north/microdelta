# @microdelta/history

## 0.1.0
### Minor Changes

- 3420440: Add the project-private `@alpha` durable History authority for a local SQLite store. It records never-reused keyed attempts and their outcomes, enforces one leased and fenced logical writer, and atomically publishes immutable scoped completed results with their current pointers. Exact references continue to address their original historical results, and indexed reads select only requested facts; read-only recovery reports an identified attempt as absent, incomplete, unsuccessful, or completed, and inconsistent stored history fails closed. The existing public row Store API is unchanged. This bounded contract does not claim general concurrent-worker coordination, power-loss durability, or a stable public API.
- 709fb57: Add alpha nested selected reads over exact retained results. Value selects the scalar fact or container shape at one structured address and validates untrusted node and selected-fact envelopes in one pass, History adds an optional synchronous navigation reader capability, Tracking creates observer-owned lazy views over a node source with the same observation semantics as tracked inputs, and Materialization composes them through `materializeView`. Scalar-only readers keep their existing behavior.
- 2f70608: Add canonical keyed-projection encoding and normalization to Value, expose its observation facts through History and Tracking's alpha ports, and add bounded selected Materialization for scalar reads, detached output, and explicit member projections.

### Patch Changes

- Updated dependencies [39eef60]
- Updated dependencies [709fb57]
- Updated dependencies [2f70608]
- Updated dependencies [0b26e08]
  - @microdelta/machine@0.1.0
  - @microdelta/value@0.1.0
