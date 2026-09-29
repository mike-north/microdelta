# @microdelta/definition

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
- 8574520: Add project-private `@alpha` Definition declarations for keyed fanout.
  
  - A source can declare itself a keyed collection with a designated identity field.
  - A fanout template's factory runs exactly once against a symbolic member whose builders reject every later call with `frozen`. Member memos may name sibling member steps and composition-wide supplied step slots. An optional custom key and tracked gate can be declared.
  - A strict fold names `{ template, step }` and receives explicit `succeeded` or `skipped` entries in canonical key order; reading a skipped entry's data throws.
  - Compositions accept templates alongside composition-level steps.
  - A member instance is addressed by its template step descriptor plus the member key. Its subject is the step's prefix applied to that key; its declarations are minted per composition and retained only for members that keying returned. An opened instance always records version-2 witnesses, and the version-1 witness parser rejects template-bearing descriptors. A renamed template or moved collection is a miss.
  - `keyMembers` keys a collection snapshot before any gate or body. It rejects malformed members, and missing, non-string, empty or duplicate keys, for the whole snapshot, with a deterministic diagnostic.
  - `gateOf` exposes an instance's gate and `gateOutcome` classifies it.
  - `IInvocation` and `IStepDeclaration` now include folds.
  
  Explicit-member compositions, their descriptors and version-1 witnesses keep their meaning. Resolution refuses template instance steps and strict folds with `invalid-request` before any evidence, candidate lookup or admission.
- 9393e12: Extend the project-private `@alpha` Definition & Binding contract for nested composition. A composition may declare composition-level steps whose descriptors carry no member key. A memo may name a sibling memo as well as a sibling source, and every edge stays pinned at composition. New `stepSlot`, `suppliedStep` and `supply` builders declare supplied callable step slots, bind exactly one implementation to a slot together with an author subject function, and report unsupplied or doubly supplied slots as distinct `missing-slot` and `ambiguous-slot` failures before any body runs. Supplied slot handles accept runtime arguments: plain data is recorded as a canonical derived value, `forward` origins name an input path or an earlier call of the same invocation (member-binding origins are rejected until template instances exist), unsupported values are recorded as unreconstructible with a stable reason, and raw tracked views are rejected. Parents that declare a memo child or a supplied slot emit the version-2 nested invocation witness with their call order and argument recipes, while parents whose children are all sources keep emitting the unchanged version-1 witness. `resolveWitness` reads both versions and reports unknown versions, argument or recipe forms and malformed data as unsupported. The invocation port gains `isTrackedView` and `argumentsJustified`. No public declaration changes.
- 5593f4d: Validate nested memo calls with argument recipes and equal-output cutoff (project-private `@alpha` surfaces).
  
  - Resolution resolves nested calls: sibling memos and implementations supplied to callable step slots, with their runtime arguments.
    - A supplied child's history subject comes from its slot's subject function.
    - Its argument list is a frozen array that behaves as the plain list under every ordinary idiom. Element reads are observed under the `argument` binding, and so are its shape reads (`length`, positions past the end, `in`, key reflection). A changed arity or value under an equal subject therefore reruns the child.
  - Nested memos record provenance version 2: ordered calls, each with its version-2 witness, exact child result and a `call` binding for the consumed output facts. Acceptance version 2 names each call's current result by position.
  - Version-1 provenance keeps its existing meaning, and any other version is unsupported evidence.
  - Validation order:
    - The memo's supplied-slot occupancy is checked before any candidate. A memo whose supplied slot is unbound fails with `unbound-step` before admission.
    - For each candidate, the memo's own evidence is checked first. Then every recorded call's witness is reconnected with no child work, so a missing or ambiguous slot or an unsupported witness is reported without resolving any child.
    - Then each call in recorded order:
      - rebuild its arguments: forwarded origins from current bindings or an earlier call's current output; derived values and forwarded paths only when recorded justified;
      - obtain the current child through its own validation or normal admission;
      - compare only the facts consumed from that call.
    - An unchanged consumed output keeps the parent's exact reference.
  - `ICandidateMiss` gains distinct reasons: `changed-child-output`, `missing-binding`, `ambiguous-binding`, `unreconstructible-argument` and `unjustified-argument`.
  - Children obtained while validating are shared with the parent's execution, so none runs twice in a request.
  - A body that returns while a call it started is unsettled fails without publishing. Every started call settles before an attempt ends, and a body's own thrown error stays the reported failure. `IStepKind` gains `supplied`.
  - Callbacks receive `untracked(view, key)`. `argumentsJustified` now reports whether the calling body has made an observed untracked read.
  - Tracking adds the observed untracked read: `untracked(view, key)` and `untrackedReadObserved()`, recorded as an `untracked-read` observation (`MDU1`) that comparison skips.
  - Definition changes:
    - Forwarded recipes in the version-2 witness now carry `justified`, like derived recipes. A path chosen after an observed untracked read is recorded unjustified, and the parser requires the field.
    - Definition exports `derivedArguments`, which decodes a call's derived recipe values, so Resolution can rebuild arguments without reading Value's encoding directly.
  - Materialization's current-fact provider routes untracked-read requests to its fallback.

## 0.1.0
### Minor Changes

- 5420e30: Add project-private family-bound source and memo declarations, the frozen M3
  composition with exact structural correspondence and direct-child witness
  reconnection, and an invocation bridge that hands actual author callbacks to an
  injected invoker and dispatches argument-free declared child handles through an
  injected port.
- 438854d: Add the project-private Run Supervision owner and the facade's alpha workspace path. Supervision runs scoped work over a structurally injected async-scope capability: runtime context lookup fails outside a live run, after close and during composition; normal requests take the writer lease lazily and the run releases it once; the caller's policy decides admission; observers see frozen events at fixed lifecycle positions and cannot veto work; ordinary nonmemoized work is observed without result identity. The facade composes the owners into `authoring()`, `openWorkspace()` with normal and recovery entry operations, and `currentRun()`, all as facade-local alpha declarations, so the public Store API is unchanged. Definition's topology now names its declared input and callable slots, and `isComposing()` reports the composition phase.

### Patch Changes

- Updated dependencies [709fb57]
- Updated dependencies [2f70608]
- Updated dependencies [0b26e08]
  - @microdelta/value@0.1.0
