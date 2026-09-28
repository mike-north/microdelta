---
"@microdelta/history": minor
---

Add the project-private `@alpha` durable History authority for a local SQLite store. It records never-reused keyed attempts and their outcomes, enforces one leased and fenced logical writer, and atomically publishes immutable scoped completed results with their current pointers. Exact references continue to address their original historical results, and indexed reads select only requested facts; read-only recovery reports an identified attempt as absent, incomplete, unsuccessful, or completed, and inconsistent stored history fails closed. The existing public row Store API is unchanged. This bounded contract does not claim general concurrent-worker coordination, power-loss durability, or a stable public API.
