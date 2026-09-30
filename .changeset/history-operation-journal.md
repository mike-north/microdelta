---
"@microdelta/history": minor
"microdelta": patch
---

Add an operation journal, environment namespaces and recorded promotion to History's durable authority (project-private `@alpha` surfaces).

- **Operation journal.** `openJournal(declaration)` returns a journal port for Run Supervision's operation and deferral records. History stores them as opaque versioned records, each addressed by analysis, environment, format and key.
  - A commit is atomic and uses compare-and-set on revisions. It runs under the current writer's holder, fence and unexpired lease, in the same transaction.
  - Earlier revisions are kept and are immutable.
  - A port declares the record formats and versions it understands. A record of any other version is refused on write, read, list and overwrite, with `JournalVersionError`. A stale expected revision is refused with `JournalConflictError`.
- **Environment namespaces.** Acceptance records now name the environment whose verification recorded them. `recordAcceptance` accepts an optional `environment`, and `readAcceptances` an optional environment argument.
  - Attempts, current heads, candidates, acceptances and journal records of one environment never satisfy a lookup in another.
- **Recorded promotion.** `promoteResults` records a fenced promotion with the promoter's evidence. It admits named exact results into another environment of the same analysis, where they become candidates, dependencies and acceptance targets. `readPromotions` returns promotion records.
  - A promotion moves no current head. It never rewrites the promoted results, their provenance or their original environment's acceptances.
- **Storage.** The durable SQLite schema is now version 2. A file at any other version, including a version 1 file written by an earlier release, is rejected by its recorded version with `HistorySchemaError`. Stored data is not migrated.
