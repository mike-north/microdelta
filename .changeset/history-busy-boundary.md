---
'@microdelta/history': patch
'microdelta': patch
---

Expose History's alpha `HistoryBusyError` for exhausted SQLite contention in durable operations, retaining the exact Machine error as its cause. The facade re-exports the class for workspace callers.
