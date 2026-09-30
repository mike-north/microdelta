# @microdelta/supervision

## 0.2.0
### Minor Changes

- 70b9d9b: Resolve keyed template member instances with tracked gates, and report typed member outcomes (project-private `@alpha` surfaces).
  
  - Resolution resolves template instance steps: a template step descriptor plus a member key. Strict folds are still refused with `invalid-request`.
  - Discovery: the template's collection source resolves under its current source policy, once per request. Definition keys its exact result before any gate or member body.
  - A rejected snapshot (duplicate or missing key, failed custom key, malformed snapshot) admits no gate or member work and surfaces Definition's keying diagnostic. A direct instance request fails with the new `collection-rejected` code. A member absent from the current snapshot is an `unbound-step`.
  - Gates: each member's gate runs once per request in its own tracking frame, over the declared inputs and helpers and the member's current record at the `member` binding. Its observations are the member's gate evidence and never enter a step's provenance.
    - An explicit `false` is a new `skipped` normal and check outcome, carrying the gate evidence. It admits, publishes and retracts nothing.
    - A non-boolean result or a throw fails with the new `gate-failure` code.
  - Member step callbacks receive the member binding. A member source's `run` and `finality` and a member memo's `run` get `member`, a view of the instance's current keyed record, typed from the collection's member type (`IMemberBinding`, `IMemberBuilder<F, TMember>`).
    - Definition applies instances with Resolution's member supplier. An instance without one, or any other step with one, rejects with `invalid-bindings`. Explicitly keyed members have no member binding.
    - `ISourceDeclaration`, `IMemoDeclaration` and their options gain a defaulted context-extension parameter; ordinary declarations are unchanged. `IPreviousSupplier.carrier` accepts any source declaration of the result type.
  - Reads of `member` are the step's own observations, validated against the current keyed record on reuse. A forwarded `member` origin is rebuilt from the same record. An unread discovery field therefore changes nothing, and a consumed member field reruns only the member steps that consumed it.
  - A template instance candidate whose recorded step no longer matches the current descriptor (a renamed template, or a collection moved to another slot) is a `correspondence` miss; prior instances are never remapped.
  - `resolveMembers({ template, step, requestKey, lease })` resolves one template step for every current member in canonical key order, each member independently. A member whose evidence is ready completes and publishes while discovery is open or siblings fail.
    - Member-attributable failures (execution, `gate-failure`, `unbound-step` and the like) stay with their member.
    - Run-level failures (`admission-failure`, `observer-failure`, `integrity`, `wrong-intent`, `invalid-request`, History or host errors) reject the whole request.
  - A gate that returns a promise or thenable fails with `gate-failure` ("returned a promise, not a boolean").
  - Admission decisions gain `cancelled`. A refused outcome's `disposition` records whether admission denied or cancelled the work; a cancelled child makes its parent's refusal cancelled, whichever child was refused first.
  - Supervision adds `run.resolveMembers({ template, step }, { requestKey })`. It reports discovery (`keyed`, `rejected`, `pending` or `cancelled`) and each member's typed outcome: `succeeded`, `skipped`, `pending`, `failed` or `cancelled`. A pending member is never a terminal failure.
  - The workspace run exposes `resolveMembers`, and the facade re-exports `IMembersTarget`, `IMembersReport`, `IMemberOutcome`, `IDiscoveryReport` and `IGateEvidence`. Consumers that narrow `IResolutionOutcome` must now handle `skipped`.
- bc4fc00: Resolve strict folds with honest readiness, framework coverage and membership-aware verification (project-private `@alpha` surfaces).
  
  - `resolveFold({ step, requestKey, lease })` resolves one strict fold. It first settles the consumed template step for every current member, each independently, exactly as `resolveMembers` does.
  - Readiness is decided before any fold work:
    - A failed or cancelled required member, a rejected snapshot or cancelled discovery work makes the outcome `failed`. It names the failed, cancelled and pending keys and whether discovery is open.
    - Otherwise, open discovery, denied discovery work or a pending member makes it `waiting`.
    - Neither runs the fold body, admits fold work or publishes.
  - Only a ready fold is validated or executed. Its body receives one explicit entry per current member in canonical key order: `succeeded` with a view of the member's accepted result, or `skipped` with no data.
  - A `reused` or `published` fold carries framework coverage `{ required, skipped, closed: true }`, derived from the delivered members rather than the body's result. A closed empty population is a successful fold. An open one waits, and never rewinds an earlier result.
  - Fold provenance (version 3) records the consumed template step, the membership-and-status fact and the member facts the body consumed; gate observations stay each instance's own evidence. Validation recomputes the fact from current discovery and gate outcomes.
    - A renamed consumed step or template, or a moved collection, is a `correspondence` miss, never a remap.
    - The new miss reasons are `changed-membership` and `changed-member-output`.
    - A gate flip, insertion or deletion reruns the fold. A reorder or a threshold edit that flips no gate reruns nothing. A member change reruns the fold only when a fact it consumed changed.
  - Skips and deletions retract nothing.
  - `resolve` and `check` still refuse a fold step with `invalid-request`, now pointing to `resolveFold`. `recover` reports a fold's admitted execution. Admission requests gain the `fold` step kind.
  - Supervision adds `run.resolveFold(step, { requestKey })`. It reports discovery, every member's typed outcome and the fold's typed outcome: `succeeded`, `waiting`, `failed`, `pending` or `cancelled`. The workspace run exposes it.

### Patch Changes

- Updated dependencies [70b9d9b]
- Updated dependencies [8574520]
- Updated dependencies [9393e12]
- Updated dependencies [5593f4d]
- Updated dependencies [bc4fc00]
  - @microdelta/definition@0.2.0
  - @microdelta/resolution@0.2.0

## 0.1.0
### Minor Changes

- 438854d: Add the project-private Run Supervision owner and the facade's alpha workspace path. Supervision runs scoped work over a structurally injected async-scope capability: runtime context lookup fails outside a live run, after close and during composition; normal requests take the writer lease lazily and the run releases it once; the caller's policy decides admission; observers see frozen events at fixed lifecycle positions and cannot veto work; ordinary nonmemoized work is observed without result identity. The facade composes the owners into `authoring()`, `openWorkspace()` with normal and recovery entry operations, and `currentRun()`, all as facade-local alpha declarations, so the public Store API is unchanged. Definition's topology now names its declared input and callable slots, and `isComposing()` reports the composition phase.

### Patch Changes

- Updated dependencies [5420e30]
- Updated dependencies [7004ca9]
- Updated dependencies [438854d]
  - @microdelta/definition@0.1.0
  - @microdelta/resolution@0.1.0
