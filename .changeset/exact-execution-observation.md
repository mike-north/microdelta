---
"@microdelta/machine": minor
"@microdelta/machine-node": minor
"@microdelta/history": minor
"@microdelta/supervision": minor
"microdelta": minor
---

Add an alpha exact-execution observation path with a bounded, read-only SQLite reader, a separate terminal acknowledgment, and a finite application completion statement. Machine and Machine Node supply read-only SQLite mechanics; Supervision owns the observation protocol, while the microdelta facade assembles the Node capabilities for observed workspace runs.
