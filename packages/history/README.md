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
- separate acceptance records.

It stores Resolution's provenance as a versioned opaque record and never decides
reuse eligibility or freshness. See the
[package map](../../docs/package-map.md) and the
[durable History evidence record](../../docs/validation/m3-durable-history-2026-09-27.md).
