---
"@microdelta/supervision": patch
"@microdelta/accounting": patch
---

Follow-ups to external operations (project-private `@alpha` surfaces).

- **Stop during a woken pass's lease wait.** It now returns the earlier pass's report with `waitingUntil`, as a stop during the sleep does, instead of rejecting with `stopped`.
- **Unsent request attempts.** One is reused, with the attribution its intent was first recorded with, only when that intent may have landed, that is when Accounting's failure carries `durability: 'unknown'`. A failure that recorded nothing, such as `AccountingBusyError`, leaves the attempt as not sent, and the retry is a fresh request attempt credited to the run that sends it.
- **Accounting.** `AccountingDurabilityUnknownError` carries `durability: 'unknown'`, so consumers without an Accounting edge can tell a write that may have landed from one that recorded nothing.
