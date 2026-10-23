---
"@microdelta/history": patch
---

Reject insert conflict replacement of immutable durable History records, including secondary unique keys and SQLite row identity aliases. Composite-key immutable tables no longer expose hidden row IDs. New stores use schema version 3; existing version 1 and version 2 durable History files are explicitly rejected without migration. The legacy Store format is unchanged.
