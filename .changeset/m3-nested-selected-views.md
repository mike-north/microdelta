---
"@microdelta/value": minor
"@microdelta/history": minor
"@microdelta/tracking": minor
"@microdelta/materialization": minor
---

Add alpha nested selected reads over exact retained results. Value selects the scalar fact or container shape at one structured address and validates untrusted node and selected-fact envelopes in one pass, History adds an optional synchronous navigation reader capability, Tracking creates observer-owned lazy views over a node source with the same observation semantics as tracked inputs, and Materialization composes them through `materializeView`. Scalar-only readers keep their existing behavior.
