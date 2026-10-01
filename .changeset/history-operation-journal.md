---
"@microdelta/history": minor
"@microdelta/resolution": patch
"microdelta": patch
---

Add an operation journal, environment namespaces and recorded promotion to History's durable authority (project-private `@alpha` surfaces).

- **Operation journal.** `openJournal(declaration)` returns a journal port for Run Supervision's operation and deferral records. History stores them as opaque versioned records, each addressed by analysis, environment, an owner-named collection and key.
  - A commit is atomic and uses compare-and-set on revisions. It runs under the current writer's holder, fence and unexpired lease, in the same transaction.
  - Earlier revisions are kept and are immutable.
  - A record's format and version are only its version tag, never part of its identity. A write under another format compare-and-sets against the address's current revision; it never creates a parallel record.
  - A port declares the record formats and versions it understands. A record of any other format or version is refused on write, read, list and overwrite, with `JournalVersionError`. A stale expected revision is refused with `JournalConflictError`.
- **Environment namespaces.** Acceptance records now name the environment whose verification recorded them. `recordAcceptance` requires an explicit `environment`, and so does `readAcceptances`. Resolution passes its own run environment.
  - Attempts, current heads, candidates, acceptances and journal records of one environment never satisfy a lookup in another.
- **Recorded promotion.** `promoteResults({ target, references, evidence })` records a fenced promotion with the promoter's evidence. It admits named exact results into another environment of the same analysis, where they become candidates, dependencies and acceptance targets. `readPromotions({ target })` returns promotion records.
  - A reference that cannot be promoted into the target is refused with `HistoryIntegrityError`: unknown, of another analysis, or already published in the target.
  - A promotion moves no current head. It never rewrites the promoted results, their provenance or their original environment's acceptances.
- **Storage.** The durable SQLite schema is now version 2. A file at any other version, including a version 1 file written by an earlier release, is rejected by its recorded version with `HistorySchemaError`. Stored data is not migrated.
