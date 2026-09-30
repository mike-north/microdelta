---
"@microdelta/machine": minor
"@microdelta/machine-node": minor
---

Processes that open the same new SQLite store at the same time now all succeed: the Node adapter retries its durable configuration within the bounded busy wait instead of failing the losers with a raw driver error. Contention that outlasts the wait surfaces from opening, statements and transactions as the typed alpha `SqliteBusyError`, which Machine now declares.
