---
"@microdelta/definition": minor
"@microdelta/resolution": minor
"@microdelta/supervision": minor
"microdelta": minor
---

Resolve keyed template member instances with tracked gates, and report typed member outcomes (project-private `@alpha` surfaces).

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
