---
"@microdelta/accounting": minor
---

Add the Resource Accounting package (project-private `@alpha` surfaces).

- `openDurableAccounting` opens a SQLite-backed accounting store over the Machine SQLite capability. The store has its own versioned schema in the `accounting_` namespace and scopes every fact to an environment.
- `openOperation` durably records the intent that a request of an external operation is about to be sent, before the paid call.
- `acknowledgeUsage` durably acknowledges a usage report keyed by (operation, report). A redelivery is a duplicate and is never summed twice, the same report identity on two operations counts twice, and a report for an unknown operation or for another operation's request is refused.
- `recordEstimate` records an estimate with its versioned basis. Estimates are listed beside observations and never summed into them.
- `summarizeUsage` reports observed sums per unit for an environment, optionally narrowed by run, member, step attempt or operation. An opened request without an acknowledged report is listed as unknown usage and never read as zero.
- Writes need no History writer fence. A commit that does not confirm fails with `AccountingDurabilityUnknownError`, and redelivering the same fact resolves it.
