---
"@microdelta/supervision": patch
---

Preserve the earliest deferred-work time when a failed strict request returns with pending siblings, including its closed execution observation. The failed request still returns immediately without sleeping, retrying or publishing a strict result; successfully resumed deferrals leave no stale waiting-time receipt.
