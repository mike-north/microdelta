# Bounded special-key/value and imported-capture investigation

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.

`gap-hunt-contracts-edge-oracle.test.ts`: 20 passing deterministic matrix rows,
204 independent Node worker processes over retained and separate cold SQLite
stores. No random fuzzing, hidden captured config, paid provider or production
change is involved. The worker reconstructs every declaration and supported value
from explicit snapshot variants; emitted memo implementations stay fixed.

Eight keys (`then`, own-data `__proto__`, `constructor`, `a.b[0]`, `0`, `01`, emoji,
lone UTF-16 surrogate) undergo unread sibling edits, own→supported-inherited equal
replacement, changed leaf and rollback. Key transport uses base64 UTF-16LE so the
host argv encoding cannot silently replace the lone surrogate. Additional rows
cover membership, missing/present undefined value conditionals, sparse holes
versus explicit undefined under both value and membership operations, signed zero,
canonical NaN and both infinities. Explicit expected publish/reuse outcomes check
precision as well as warm/cold result parity. Missing special-name dictionary keys
use a null prototype: Object.prototype intrinsic presence is isolated in the red
candidate suite, not silently skipped or recast as a passing expected rejection.

`transitive-capture-lint-probe.mjs` exercises the actual configured type-aware rule
through generated alpha declarations. An imported ordinary helper reads its own
untracked configuration. Direct wrapper, same-file callback and nested-local
bridge routes each report the imported helper as an untracked external influence;
passing the imported function directly reports unsupported callback syntax, as
documented. Four exact diagnostics are asserted. Negative fixture suppressions
preserve normal lint cleanliness while the probe checks they were really emitted.
No claimed typed-boundary bypass was found; this is not arbitrary closure proof.

Portable clean-checkout invocations:

```sh
node scratch/gap-hunt/contracts/reproduce.mjs edge
node scratch/gap-hunt/contracts/reproduce.mjs capture-lint
```

Each invocation independently installs/builds before running. See
`edge-oracle-results.log`, `edge-lint.log`, and
`transitive-capture-lint-results.log`. The separate candidate failure is documented
in `INTRINSIC-PRESENCE.md` with exact spec clauses and its own invocation.
