# @microdelta/materialization

## 0.1.0
### Minor Changes

- 709fb57: Add alpha nested selected reads over exact retained results. Value selects the scalar fact or container shape at one structured address and validates untrusted node and selected-fact envelopes in one pass, History adds an optional synchronous navigation reader capability, Tracking creates observer-owned lazy views over a node source with the same observation semantics as tracked inputs, and Materialization composes them through `materializeView`. Scalar-only readers keep their existing behavior.
- 2f70608: Add canonical keyed-projection encoding and normalization to Value, expose its observation facts through History and Tracking's alpha ports, and add bounded selected Materialization for scalar reads, detached output, and explicit member projections.

### Patch Changes

- 7004ca9: Add the project-private Reuse Resolution owner: current source policy with finality evaluated only for eligible candidates, explicit retention versus fresh publication, direct-child validation that compares only consumed child output facts, admission before claims, check-only evaluation, and request-key recovery with complete intent digests over History's durable authority. Materialization's generated declarations now name their projection types through Tracking so consumers without a Value edge can resolve them.
- Updated dependencies [3420440]
- Updated dependencies [709fb57]
- Updated dependencies [2f70608]
- Updated dependencies [7f0c96a]
- Updated dependencies [0b26e08]
  - @microdelta/history@0.1.0
  - @microdelta/value@0.1.0
  - @microdelta/tracking@0.1.0
