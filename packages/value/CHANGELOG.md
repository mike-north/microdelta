# @microdelta/value

## 0.2.0
### Minor Changes

- 8b4283e: Value now owns a detached prepared snapshot for repeated exact observations, so History builds selected addresses without rescanning each ancestor array. Existing Value rejection rules and exact selected facts remain intact.

### Patch Changes

- 77715af: Preserve own-property and inherited-membership observations for intrinsic property names on supported plain records. Presence captures boolean facts without selecting unsupported intrinsic values, including during current-fact comparison.
- Updated dependencies [5010548]
  - @microdelta/machine@0.2.1

## 0.1.1
### Patch Changes

- 2be8066: Retain bounded container-kind evidence so nullable tracked guards invalidate stale results across process restarts. Revalidate prior computation evidence once under the current tracking semantics while preserving exact historical results and journal records.
- Updated dependencies [af7323b]
- Updated dependencies [dba23f0]
- Updated dependencies [00f672e]
  - @microdelta/machine@0.2.0

## 0.1.0
### Minor Changes

- 709fb57: Add alpha nested selected reads over exact retained results. Value selects the scalar fact or container shape at one structured address and validates untrusted node and selected-fact envelopes in one pass, History adds an optional synchronous navigation reader capability, Tracking creates observer-owned lazy views over a node source with the same observation semantics as tracked inputs, and Materialization composes them through `materializeView`. Scalar-only readers keep their existing behavior.
- 2f70608: Add canonical keyed-projection encoding and normalization to Value, expose its observation facts through History and Tracking's alpha ports, and add bounded selected Materialization for scalar reads, detached output, and explicit member projections.
- 0b26e08: Add `@microdelta/value` for canonical value and snapshot encodings, structured selected-fact observations, and fingerprints. Add the Machine SHA-256 capability and its Node implementation.

### Patch Changes

- Updated dependencies [39eef60]
- Updated dependencies [0b26e08]
  - @microdelta/machine@0.1.0
