---
"@microdelta/supervision": patch
---

Refuse sends when a hard stop or deadline lands in a synchronous pre-dispatch callback, without calling the provider or treating an unsent operation as remotely aborted. Preserve durable intent and unknown Accounting usage evidence for operations stopped after intent.
