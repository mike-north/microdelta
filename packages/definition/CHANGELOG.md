# @microdelta/definition

## 0.3.0
### Minor Changes

- 3eaa7ed: Expose M5's operational surface on the `microdelta` facade (project-private `@alpha` surfaces).
  
  - **Operation ports.** `openWorkspace({ ..., accounting })` takes the caller's Resource Accounting port (`IWorkspaceAccounting`: Supervision's structural `IOperationAccounting`, which the facade now aliases, plus `summarizeUsage`). With it, every run receives Supervision's operation ports: the workspace builds History's operation journal and Node's random identifier source itself. Without it, operations, inspection, settlement and usage fail with `invalid-request`. The facade takes no runtime or type dependency on `@microdelta/accounting`; Accounting's durable adapter satisfies the port structurally.
  - **Operation handle and operator actions.** `currentExecution().operation(request)` performs one declared external operation; `run.inspectOperations()` and `run.settleOperation(...)` now work in workspaces given Accounting. The facade exports aliases for the request, response, view, settlement, event and wait types (`IOperationRequest`, `IOperationResponse`, `IOperationView`, `IOperationSettlement`, `IOperationEvent`, `IWaitEvent` and the rest).
  - **Deferral mode.** Workspace runs accept `deferral: 'sleep' | 'exit'`; in exit mode the result reports `waitingUntil`.
  - **Usage summaries.** `run.usage(filter?)` reads the run environment's usage summary through the injected port, keeping unknown usage and estimates (`estimates`) apart from observed quantities.
  - **Recorded promotion (Supervision).** New run operations `IRun.promote({ into, references, evidence })` and `IRun.promotions()` over a structural promotion port (`IRunOptions.promotion: IRunPromotionPort`), which History's durable store satisfies and the facade supplies. A promotion obtains the writer lease as a normal request does (waiting under `writerWait`, `WriterBusyError` at the deadline), is refused with `stopped` when stop intent is in force immediately before the commit, and offers an identifier-only `promotion` event (`IPromotionEvent`). `promote` targets another environment; `promotions()` lists the promotions recorded into the run's own. `IRunOperationName` gains `'promote'` and `'promotions'`, and `IRunEvent` gains the `promotion` kind: exhaustive handling of either must cover the new members.
  - **Settlement (Supervision).** An operation resolved as succeeded keeps its address consumed until the operator abandons it; `settleOperation({ action: 'abandon' })` now accepts such an operation, which frees its address. The record and `IOperationView` keep the superseded resolution (`resolution`: operator, outcome, time and usage report) beside the abandonment, so the audit trail survives; records written before the field existed read as having none.
  - **Unique run identifiers.** A run without a caller-supplied `runId` is now identified as `run:<32 hex digits>`, minted from 128 random host bits, so no two runs of any process or host share one; it was a per-workspace counter that repeated across processes. A caller-supplied `runId` must be an identifier (`^[a-z][a-z0-9_.:-]{0,63}$`) and must not take the reserved minted form; anything else is refused with `invalid-request`.
  - **Definition.** A supplied step's `run` may be asynchronous (`TResult | Promise<TResult>`), as a memo body may: its call's result is the settled value. This lets an author isolate one awaited external operation per supplied call.
- 7293b47: Add outcome (tolerant) folds over a template step's members (project-private `@alpha` surfaces).
  
  - **Declaration.** `outcomeFold({ subject, over: { template, step }, run })` declares an outcome fold. It is a composition-level step of its own kind, never a child, member step or template step. The composition topology lists it in `outcomeFolds`, apart from strict `folds`.
  - **Entries.** The body receives one entry per current member in canonical key order, with that member's settled status: `succeeded` with a view of its result, or `skipped`, `failed` or `cancelled` with no data. Reading data from a failed or cancelled entry throws `unsuccessful-member`. A pending member is never an entry.
  - **Completeness.** `resolveOutcomeFold` settles every member first. While discovery is open or any member is pending, the outcome is `waiting` with the partial coverage settled so far. A waiting fold runs no body, admits no fold work and publishes nothing. A rejected or cancelled discovery makes it `failed`.
  - **Repair.** Once the set has settled, the fold is validated or executed over its membership-and-status fact, which also records failed and cancelled members. Repairing a failed member makes the fold reconsider, and unaffected member results are reused.
  - **Coverage.** Every member is listed under exactly one of `succeeded`, `skipped`, `failed`, `cancelled` or `pending`, with `openDiscovery` and `complete`. Coverage is derived by the framework and is never a claim of complete success. A member cancelled by a stop is settled but not successful for that run.
  - **Separation.** Outcome folds record version-4 provenance, so a strict fold never accepts an outcome fold's result, nor the reverse. Strict folds are unchanged.
  - **Report.** Supervision and the facade report `IOutcomeFoldReport` with `folded`, `waiting`, `failed`, `pending` or `cancelled`.
  - **Nested run operations are refused.** Author code may keep the run and call one of its operations (`resolve`, `resolveMembers`, `resolveFold`, `resolveOutcomeFold`, `check`, `recover`, `ordinary`, or the facade's `read`) from inside member work or any step attempt, a fold's body included. That call now rejects at once with the new `undeclared-call` Supervision error, before any of its work is admitted, and the run records a diagnostic that names the operation and the calling step (CMP-9). What it resolves or reads would enter no evidence of the calling body. Previously such a call could wait for the run-wide window lane that its caller held, and deadlocked with a window of one lane. `IRun.assertDeclaredCall(operation)` checks the same rule: inside member or step work it records the diagnostic and throws the refusal, otherwise it returns. Its `operation` is one of the closed `IRunOperationName`s, and any other value throws `invalid-request` without recording anything. The facade's synchronous `read` uses it, and the facade's author-facing `IWorkspaceRun` omits it.

### Patch Changes

- cd05189: Fixes for defects found by the M5 acceptance suite (project-private `@alpha` surfaces).
  
  - **Stop at the start of a deferral sleep.** A hard stop that is already in force when a run begins its deferral sleep no longer arms the sleep's keep-alive timer. For example, a stop requested by an observer reacting to the `sleeping` event. The process can now exit at once instead of staying alive until the deferral's time.
  - **`resumed` wait events.** `released` reports whether the run released its writer lease for that wait, including a release made while the request slept. It is no longer always `false`.
  - **A lost writer lease mid-pass.** History may refuse a write because the lease no longer authorizes it. This covers claims, publications, acceptances and attempt endings. The refused write records nothing, and it no longer escapes as History's raw `StaleWriterError`. The step that needed it is denied with reason `lease-lost`. So a soft-stop drain that outlived its lease ends with typed member outcomes, even when it meets results its successor published (EXP-8 ruling R). Every other History failure keeps its own typed outcome and is never reported as `lease-lost`. Integrity damage met while staging or publishing a result now reports `integrity`, as it already did for claims and acceptances.
  - **Author error text.** Framework failure messages and diagnostics name the step or position and the failure kind only. They never repeat what author or caller code threw. This covers bodies, source checks, finality hooks, gates, custom keys, slot subject functions, admission, lifecycle and run observers, and abort listeners. The thrown value stays available as the failure's `cause`. `DefinitionError` accepts an optional `cause`, and a throwing slot subject function's rejection carries it.
  - @microdelta/value@0.1.1

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
