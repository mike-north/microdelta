---
"@microdelta/resolution": minor
"@microdelta/supervision": minor
"microdelta": minor
---

Resolve strict folds with honest readiness, framework coverage and membership-aware verification (project-private `@alpha` surfaces).

- `resolveFold({ step, requestKey, lease })` resolves one strict fold. It first settles the consumed template step for every current member, each independently, exactly as `resolveMembers` does.
- Readiness is decided before any fold work:
  - A failed or cancelled required member, a rejected snapshot or cancelled discovery work makes the outcome `failed`. It names the failed, cancelled and pending keys and whether discovery is open.
  - Otherwise, open discovery, denied discovery work or a pending member makes it `waiting`.
  - Neither runs the fold body, admits fold work or publishes.
- Only a ready fold is validated or executed. Its body receives one explicit entry per current member in canonical key order: `succeeded` with a view of the member's accepted result, or `skipped` with no data.
- A `reused` or `published` fold carries framework coverage `{ required, skipped, closed: true }`, derived from the delivered members rather than the body's result. A closed empty population is a successful fold. An open one waits, and never rewinds an earlier result.
- Fold provenance (version 3) records the membership-and-status fact and the member facts the body consumed; gate observations stay each instance's own evidence. Validation recomputes the fact from current discovery and gate outcomes.
  - The new miss reasons are `changed-membership` and `changed-member-output`.
  - A gate flip, insertion or deletion reruns the fold. A reorder or a threshold edit that flips no gate reruns nothing. A member change reruns the fold only when a fact it consumed changed.
- Skips and deletions retract nothing.
- `resolve` and `check` still refuse a fold step with `invalid-request`, now pointing to `resolveFold`. `recover` reports a fold's admitted execution. Admission requests gain the `fold` step kind.
- Supervision adds `run.resolveFold(step, { requestKey })`. It reports discovery, every member's typed outcome and the fold's typed outcome: `succeeded`, `waiting`, `failed`, `pending` or `cancelled`. The workspace run exposes it.
