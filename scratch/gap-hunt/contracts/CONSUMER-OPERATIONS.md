# Extended consumer operations and lifetime probes

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

A fresh-process memo oracle compares a retained-store resolution with a separate
cold-store current computation. All declarations and function text stay fixed;
only ordinary declared input snapshots change. The suite reports six intentionally
red assertions and seven passing assertions. The red cases extend **#155**, not a
new issue:

| Consumer | Transition | Result |
| --- | --- | --- |
| `typeof detail` | record → missing | false reuse; cold result differs |
| `typeof detail` | record → null; null → record | pass |
| `Array.isArray(detail)` | record → array; array → record; array → null | false reuse; cold result differs |
| `(detail ?? 'fallback') === 'fallback'` | record → null/missing | false reuse; cold result differs |
| same nullish consumer | null → record | pass |
| `nested?.child?.name ?? 'fallback'` | record → null/nested-null; missing → record | pass |

`Array.isArray` is not in the documented deterministic builtin lint allowlist.
Its adversarial runtime probe contains a narrow documented suppression; it is not
represented as a lint-approved consumer pattern. The typeof/nullish/optional
operations need no capture suppression. Null-preserving typeof is a positive
precision control because `typeof null` and a record both return `object`.

A separate five-process path scenario passes: author a/Ada → b/Ada retains the
original exact result; b/Grace publishes; c/Grace retains that exact result;
c/Katherine publishes. This verifies repeated current-path rebinding rather than
comparison against an old author identity.

Three async helper assertions pass: a caught post-await helper exception retains
its consumed before/after leaves and implementation; detached helper callbacks
after either successful or failed capture reject before entering the helper body;
a new frame still invokes that helper normally. Narrow suppressions explain test
barriers, native Error/Promise usage, and counters; no production checks changed.

The nested current-argument scenario passes in six fresh worker processes: replacing
PR101 with PR901 changes the derived child subject and executes only 901; changing
current forwarded PR201 data executes only 201 and Ben's parent; results agree
with independent cold-current stores after each update; reverting inputs reuses
old eligible work without executing an assessment. This is bounded CMP-7 evidence,
not arbitrary closure reconstruction.

Strict TypeScript compilation and type-aware lint pass for all new files. Runtime
logs are `operation-matrix-results.log`, `async-results.log`, and
`nested-current-results.log`. Reproduce with each package's `test:unit` script and
`--runTestsByPath` pointing to the matching emitted `.test-build/test/` test.
