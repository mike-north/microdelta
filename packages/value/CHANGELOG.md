# @microdelta/value

## 0.1.0
### Minor Changes

- 709fb57: Add alpha nested selected reads over exact retained results. Value selects the scalar fact or container shape at one structured address and validates untrusted node and selected-fact envelopes in one pass, History adds an optional synchronous navigation reader capability, Tracking creates observer-owned lazy views over a node source with the same observation semantics as tracked inputs, and Materialization composes them through `materializeView`. Scalar-only readers keep their existing behavior.
- 2f70608: Add canonical keyed-projection encoding and normalization to Value, expose its observation facts through History and Tracking's alpha ports, and add bounded selected Materialization for scalar reads, detached output, and explicit member projections.
- 0b26e08: Add `@microdelta/value` for canonical value and snapshot encodings, structured selected-fact observations, and fingerprints. Add the Machine SHA-256 capability and its Node implementation.

### Patch Changes

- Updated dependencies [39eef60]
- Updated dependencies [0b26e08]
  - @microdelta/machine@0.1.0
