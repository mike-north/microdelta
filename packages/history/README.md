# Result History & Publication

This package owns the scaffold's row Store, memory backend, legacy compatibility
schema, and backend conformance suite. Its public declarations preserve the
existing `microdelta` facade contract. `Path` is a row-storage address, not the
future Value Semantics path. The memory backend proves single-row behavior only;
it has no durable or cross-row publication guarantee. See the
[package map](../../docs/package-map.md).
