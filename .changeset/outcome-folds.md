---
"@microdelta/definition": minor
"@microdelta/resolution": minor
"@microdelta/supervision": minor
"microdelta": minor
---

Add outcome (tolerant) folds over a template step's members (project-private `@alpha` surfaces).

- **Declaration.** `outcomeFold({ subject, over: { template, step }, run })` declares an outcome fold. It is a composition-level step of its own kind, never a child, member step or template step. The composition topology lists it in `outcomeFolds`, apart from strict `folds`.
- **Entries.** The body receives one entry per current member in canonical key order, with that member's settled status: `succeeded` with a view of its result, or `skipped`, `failed` or `cancelled` with no data. Reading data from a failed or cancelled entry throws `unsuccessful-member`. A pending member is never an entry.
- **Completeness.** `resolveOutcomeFold` settles every member first. While discovery is open or any member is pending, the outcome is `waiting` with the partial coverage settled so far. A waiting fold runs no body, admits no fold work and publishes nothing. A rejected or cancelled discovery makes it `failed`.
- **Repair.** Once the set has settled, the fold is validated or executed over its membership-and-status fact, which also records failed and cancelled members. Repairing a failed member makes the fold reconsider, and unaffected member results are reused.
- **Coverage.** Every member is listed under exactly one of `succeeded`, `skipped`, `failed`, `cancelled` or `pending`, with `openDiscovery` and `complete`. Coverage is derived by the framework and is never a claim of complete success. A member cancelled by a stop is settled but not successful for that run.
- **Separation.** Outcome folds record version-4 provenance, so a strict fold never accepts an outcome fold's result, nor the reverse. Strict folds are unchanged.
- **Report.** Supervision and the facade report `IOutcomeFoldReport` with `folded`, `waiting`, `failed`, `pending` or `cancelled`.
- **Nested run operations are refused.** Author code may keep the run and call one of its operations (`resolve`, `resolveMembers`, `resolveFold`, `resolveOutcomeFold`, `check`, `recover`, `ordinary`, or the facade's `read`) from inside member work or any step attempt, a fold's body included. That call now rejects at once with the new `undeclared-call` Supervision error, before any of its work is admitted, and the run records a diagnostic that names the operation and the calling step (CMP-9). What it resolves or reads would enter no evidence of the calling body. Previously such a call could wait for the run-wide window lane that its caller held, and deadlocked with a window of one lane. `IRun.assertDeclaredCall(operation)` checks the same rule: inside member or step work it records the diagnostic and throws the refusal, otherwise it returns. The facade's synchronous `read` uses it.
