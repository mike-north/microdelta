# Result History & Publication

This package owns the scaffold's row Store, memory backend, legacy compatibility
schema, and backend conformance suite. Its public declarations preserve the
existing `microdelta` facade contract. `Path` is a row-storage address, not the
future Value Semantics path. The memory backend proves single-row behavior only;
it has no durable or cross-row publication guarantee.

It also owns the project-private alpha durable authority, `openDurableHistory`.
Over injected Machine SQLite, clock and SHA-256 capabilities it owns a versioned
single-file schema, distinct from the legacy Store, with:

- the single logical writer lease, fence and clock high-water;
- never-reused attempt identities with stable keys and intent digests;
- staging and one-commit atomic publication with a current pointer per scoped subject;
- immutable completed results with an exact scoped selected reader generated from their canonical payload;
- separate acceptance records, namespaced by the explicitly named environment that recorded them;
- environment namespaces within one store, so a trial run's attempts, heads,
  candidates, acceptances and journal records never satisfy production;
- recorded, fenced promotions that admit named exact results of one environment
  into another of the same analysis, without moving or rewriting either one's history;
- Run Supervision's operation journal: opaque versioned records per environment,
  owner-named collection and key, committed atomically by compare-and-set under
  writer fencing, with undeclared record formats and versions refused.

It stores Resolution's provenance and Supervision's journal records as
versioned opaque records and never decides reuse eligibility, freshness or
operation meaning. The durable schema is at version 3, which rejects replacement
of immutable records through primary keys, secondary unique keys and SQLite row
identity aliases. Existing version 1 and version 2 durable files, and files at
any other unsupported version, are explicitly rejected; no migration is
provided. The separate legacy Store schema is unchanged. See the
[package map](../../docs/package-map.md) and the
[durable History evidence record](../../docs/validation/m3-durable-history-2026-09-27.md).
