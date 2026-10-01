---
"@microdelta/supervision": patch
"@microdelta/resolution": patch
"@microdelta/definition": patch
"microdelta": patch
---

Fixes for defects found by the M5 acceptance suite (project-private `@alpha` surfaces).

- **Stop at the start of a deferral sleep.** A hard stop that is already in force when a run begins its deferral sleep no longer arms the sleep's keep-alive timer. For example, a stop requested by an observer reacting to the `sleeping` event. The process can now exit at once instead of staying alive until the deferral's time.
- **`resumed` wait events.** `released` reports whether the run released its writer lease for that wait, including a release made while the request slept. It is no longer always `false`.
- **Author error text.** Framework failure messages and diagnostics name the step or position and the failure kind only. They never repeat what author or caller code threw. This covers bodies, source checks, finality hooks, gates, custom keys, slot subject functions, admission, lifecycle and run observers, and abort listeners. The thrown value stays available as the failure's `cause`. `DefinitionError` accepts an optional `cause`, and a throwing slot subject function's rejection carries it.
