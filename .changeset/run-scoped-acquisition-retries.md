---
"@microdelta/supervision": minor
"microdelta": minor
---

Allow finite acquisition retries per run invocation, with three total sent attempts by default and a fresh allowance for a new run. Preserve prior request-attempt history and unknown usage when a response is lost. Record private run-instance identity in version-2 operation journals while continuing to read version-1 records without inventing that identity.
