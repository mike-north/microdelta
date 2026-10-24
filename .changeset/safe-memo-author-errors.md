---
"@microdelta/resolution": patch
"microdelta": patch
---

Wrap author-created ResolutionError failures from memo bodies in a safe execution failure while preserving the original object as the cause. Keep recorded declared-child failures classified by their runtime outcome.
