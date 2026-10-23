# Pre-kind Tracking history fixture

`container-guard-pre-kind.json` contains gzip/base64 bytes of an actual SQLite
History store produced by main `86a4f17011b040d3cc793bd818cba5bc47760259`, Node
24.14.0, using pinned dependencies. The JSON records the uncompressed SHA-256.
The guard declaration and callback are identical to `container-guard-worker.ts`:
`inputs.config.detail ? 'present' : 'absent'`, under subject `container-guard`.
The initial input was `{ enabled: true, detail: { name: 'Ada' } }` and the old
result is `present`. No provenance or observation records were synthesized.

To regenerate, extract that exact main revision in an isolated temporary checkout,
copy the current worker into its core test directory, run `npm ci`, `npm run build`,
and `npx tsc -p packages/core/tsconfig.test.json`. Run the emitted worker against
an empty database with arguments `DATABASE object old container`. Open the same
store with the old durable History API and commit the opaque fixture journal
record (`fixture.operation` v1, `fixture-journal/retained-operation`, content
`{ state: 'succeeded', receipt: 'retained-evidence' }`). Close all connections,
gzip the complete SQLite file with deterministic mtime zero, base64 it, and update
the JSON checksum. The journal is synthetic fixture data, not an executed provider
operation; it exercises preservation of opaque owner records.

The genuine fixture retains its version 2 storage layout and checksum. The
current runtime rejects that unsupported layout without changing its bytes,
rows, or schema; no production migration is provided.

A separate provenance-compatibility test constructs a version 3 store and copies
all non-identity rows from this frozen fixture using test-only SQL. It compares
every copied field with the original and verifies foreign keys before opening
the new store. This constructed database is not presented as old-runtime output.
The test requires the new runtime to recompute the stale guard, then reuse the
new evidence after another complete process exit. It also reads the original
exact result and the original journal revision unchanged.
