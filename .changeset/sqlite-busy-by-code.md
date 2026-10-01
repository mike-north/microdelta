---
"@microdelta/machine-node": patch
---

The Node SQLite adapter now recognizes contention by the driver error's stable name and `SQLITE_BUSY*` code instead of by the identity of the driver's error class, so a host that loads the driver module more than once still receives the typed `SqliteBusyError` rather than a raw driver error.
