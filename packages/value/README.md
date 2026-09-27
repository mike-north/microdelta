# Value Semantics

This package owns the supported data domain, canonical equality and snapshot
encodings, structured observation addresses, and SHA-256 fingerprints. It reports
the fact selected by a caller; Tracking owns deciding which facts an execution
consumes, and Reuse Resolution owns whether retained evidence is acceptable.

Equality encoding normalizes string-keyed record order. Snapshot encoding
preserves supported enumeration order so a later key read keeps its meaning.
Both formats are versioned and reject unsupported or noncanonical input. They do
not migrate the compatibility rows in History.

Hashing is supplied by the portable Machine capability. The Value implementation
accepts that capability and contains no Node dependency; `machine-node` provides
the Node crypto implementation. The package's sibling contract is alpha and
does not expand the user-facing facade.
