---
"@microdelta/resolution": patch
---

Store new provenance observations losslessly as compact wire-version-5 tuples while preserving semantic variants and legacy wire-version-1–4 reading and reuse. Acceptance and attempt-ending formats remain unchanged. Older Resolution readers treat new provenance as unsupported evidence and cannot reuse those new records.
