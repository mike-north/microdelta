# @microdelta/accounting

## 0.1.0
### Minor Changes

- 7e628d2: Add the Resource Accounting package (project-private `@alpha` surfaces).
  
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
  - A write that cannot get the write lock within the host's bounded wait did no work and fails with `AccountingBusyError`, whose cause is the host's typed `SqliteBusyError`.

### Patch Changes

- b6406a9: Follow-ups to external operations (project-private `@alpha` surfaces).
  
  - **Stop during a woken pass's lease wait.** It now returns the earlier pass's report with `waitingUntil`, as a stop during the sleep does, instead of rejecting with `stopped`.
  - **Unsent request attempts.** One is reused, with the attribution its intent was first recorded with, only when that intent may have landed, that is when Accounting's failure carries `durability: 'unknown'`. A failure that recorded nothing, such as `AccountingBusyError`, leaves the attempt as not sent, and the retry is a fresh request attempt credited to the run that sends it. The mark is sticky, so a reused attempt stays unconfirmed whatever its own retry's failure is. A not-sent attempt recorded before the mark existed is read as unconfirmed.
  - **Accounting.** `AccountingDurabilityUnknownError` carries `durability: 'unknown'`, so consumers without an Accounting edge can tell a write that may have landed from one that recorded nothing.
- Updated dependencies [af7323b]
- Updated dependencies [dba23f0]
- Updated dependencies [00f672e]
  - @microdelta/machine@0.2.0
  - @microdelta/value@0.1.1
