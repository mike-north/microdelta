---
"@microdelta/tracking": patch
"@microdelta/value": patch
"@microdelta/resolution": patch
"@microdelta/history": patch
---

Retain bounded container-kind evidence so nullable tracked guards invalidate stale results across process restarts. Revalidate prior computation evidence once under the current tracking semantics while preserving exact historical results and journal records.
