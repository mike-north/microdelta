---
"@microdelta/accounting": minor
---

Add the Resource Accounting package (project-private `@alpha` surfaces).

- `openDurableAccounting` opens a SQLite-backed accounting store over the Machine SQLite capability. The store has its own versioned schema in the `accounting_` namespace. Every fact is scoped to an environment and immutable, including against `REPLACE`.
- `recordUsageIntent` durably records the usage intent for a request attempt of an external operation before the paid call. It returns `recorded` or `duplicate`. Operation identities stay with Run Supervision.
- `acknowledgeUsage` durably acknowledges a usage report keyed by (operation, report):
  - a redelivery is a duplicate and is never summed twice;
  - the same report identity on two operations counts twice;
  - a report for an unknown operation or request attempt, or for another operation's request attempt, is refused.
- The report identity must be stable across redelivery. Derive it from the provider's response.
- `recordEstimate` records an estimate with its versioned basis. Estimates are listed beside observations and never summed into them.
- `summarizeUsage` reports observed sums per unit for an environment, optionally narrowed by run, member, step attempt or operation.
  - Its status is `complete` or `incomplete`.
  - A recorded request attempt without an acknowledged report of its own is listed as unknown usage and never read as zero.
  - Summaries are single-statement reads that never take the write lock.
- Writes need no History writer fence. A commit that does not confirm fails with `AccountingDurabilityUnknownError`, and redelivering the same fact resolves it.
