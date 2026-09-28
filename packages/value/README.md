# Value Semantics

This package owns the supported data domain, canonical equality and snapshot
encodings, structured observation addresses, and SHA-256 fingerprints. It reports
the fact selected by a caller; Tracking owns deciding which facts an execution
consumes, and Reuse Resolution owns whether retained evidence is acceptable.
`observe` performs an immediate lookup and returns the selected value as-is. If
that value is an object, it may be a mutable source reference; lookup neither
clones nor freezes it and is not retained Tracking evidence. Navigating through
a container selects only the requested descendant and does not materialize its
unread siblings.

`navigate` answers what one exact address selects: the scalar `value` fact at a
leaf, or only the shape of a record or array (arrays carry their length). A
container shape is navigation metadata, never a selected fact or a whole-object
observation. `normalizeSelectedNode` validates and detaches such a node when it
arrives from an untrusted reader, without running accessors.
`normalizeSelectedFact` does the same for a selected fact. It reads each own
data field and array slot once and builds the frozen copy from those values.
It rejects arrays whose iterator, methods or prototype differ from their
indexed data, so a caller returns and records exactly the fact it validated.

`encodeSelectedFact` synchronously encodes the entire supplied fact. Encoding an
object therefore traverses its complete supported contents and rejects any
unsupported descendant. Tracking should encode facts actually consumed or
materialized, not containers merely passed through or navigated. The caller owns
capture timing: mutation before encoding changes the bytes, while an already
produced encoded string remains unchanged.

Equality encoding normalizes string-keyed record order. Snapshot encoding
preserves supported enumeration order so a later key read keeps its meaning.
Both formats are versioned and reject unsupported or noncanonical input. They do
not migrate the compatibility rows in History.

Hashing is supplied by the portable Machine capability. The Value implementation
accepts that capability and contains no Node dependency; `machine-node` provides
the Node crypto implementation. The package's sibling contract is alpha and
does not expand the user-facing facade.
