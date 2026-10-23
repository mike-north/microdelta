# PR191 exact-head History immutability verification

Source: `ee72391e330188dbd143d3889f4867da23a468d1`, PR191, issue129. Review evidence only; no product edits or publication.

Result: the focused repair satisfies the issue's bounded DML protection and explicit compatibility choice. Fresh lockfile install, generated package build, strict Core test compilation, and both focused suites pass: 98 tests, 2 suites, no failures or runtime-error suites. Independent raw-SQL census/discriminator passes. See receipt.json for exact environment and clean-checkout qualification.

The owner explicitly selected schema v3 and rejection of v2 without migration (issue129 owner comment, 2026-10-23). RES-003 preserves immutable published envelopes/provenance; RES-006 prevents broken retained references; RES-007 separates mutable current acceptance; PUB-004 owns explicit durable compatibility/recovery. No general migration was authorized.

## Independent checks

The census derives primary and UNIQUE keys from SQLite PRAGMAs, checks each nonredundant conflict key against the BEFORE INSERT predicate, and verifies all eleven immutable tables. Four INTEGER PRIMARY KEY tables guard their row identity through that same key; seven composite-key tables expose no hidden rowid because they use WITHOUT ROWID. A UNIQUE superset of the result primary key needs no separate predicate because its conflict necessarily conflicts with result_id too.

A raw frozen-v2 connection with recursive_triggers OFF accepts both INSERT OR REPLACE and REPLACE and rewrites the identity's logical-store field. The v3 connection aborts both with the immutable-history trigger, leaving the original row unchanged. This establishes the reported mechanism independently of the author's Jest fixture.

The emitted durable-history suite additionally challenges all eleven immutable tables with both spellings; three independent secondary keys with fresh primary keys; rowid/_rowid_/oid aliases; row preservation after each rejection; fresh publication/current-pointer advancement; exact old-result verification; and reopen. The same suite exercises writer/fence/lease, allocation, current acceptance, publication and crash behavior. This is the existing finite suite, not an unbounded SQLite proof.

## Compatibility and fixture integrity

The frozen SQL v2 fixture is independent of the current schema factory and is rejected by version before schema-object comparison, preserving definitions and every row. The genuine frozen pre-kind v2 database retains its recorded hash and is rejected with bytes, rows and schema unchanged. The separate constructed-v3 fixture explicitly copies historical fields into new v3 storage, checks every field and foreign keys, and verifies one miss followed by restart reuse while exact old result/journal evidence remains readable. It is correctly labeled test-only construction, not production migration or an old-runtime v3 capture.

The mutable retained tables and history_current remain outside the new INSERT-conflict guards; positive publication and pointer tests pass. The implementation does not add a migration or alter the legacy Store compatibility schema. Protection assumes the validated schema remains installed; parties allowed to drop/alter schema objects are outside this DML guarantee.

## Reproduce

From the evidence checkout with Node 24:

```sh
python3 scratch/gap-hunt/review-191/run.py
```

The runner installs from lockfile, builds packages, compiles tests, runs the exact two focused suites, and executes the independent key census and v2/v3 replacement discriminator. It verifies product/package/tooling identity against the pinned PR head and requires clean Git state before and after. No paid-provider calls or broad repository suite rerun.
