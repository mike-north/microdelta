# microdelta ubiquitous language

This is the shared vocabulary for discussing, specifying, implementing, and
reviewing microdelta. Use these meanings in issues, code comments, tests, and
conversation. Introduce a narrower term when a distinction matters: “the step
changed” is less precise than “the step definition's implementation changed.”

These definitions describe the target domain, not a list of shipped features.
The [implementation map](../package-map.md) records what exists today. This file
owns concise terminology; the linked contracts own behavioral requirements and
acceptance criteria. A vocabulary edit must preserve those contracts or identify
the proposed contract change explicitly. API spellings and storage representations
remain separate choices.

## Analysis, declarations, and work

| Term | Meaning and boundary | Owner and contract |
| --- | --- | --- |
| **Analysis** | A declared computation and its logical namespace. It can be run repeatedly, including after complete process shutdown. It is larger than a particular execution attempt or memoized step. | Definition & Binding; [DOM-1/2](domain.md) |
| **Environment** | The selected storage, services, credentials, and isolation scope in which work runs. A label alone does not establish isolation. | Run Supervision coordinates the scope; each context preserves its own state boundary; [RUN-017](operations.md) |
| **Execution context** | The scoped access to a run's environment, services, cancellation, and resource-reporting facilities. It is not the observation collector; lookup outside a live run scope fails. | Run Supervision; [DOM-2](domain.md), [RUN-001](operations.md) |
| **Bounded context** | An ownership boundary for a coherent domain model and its invariants. microdelta has six peer bounded contexts; supporting components and Machine do not add another domain authority. This architectural meaning of “context” is distinct from an execution context. | [ARC-001/002/010](architecture.md) |
| **Run** | One supervised execution lifetime in an environment. It may contain many invocations, attempts, and tracking frames. A run is not a retained result, and its completion does not erase history. | Run Supervision; [DOM-2](domain.md), [RUN-001/002](operations.md) |
| **Step definition** | A declared operation with its implementation and applicable policy. It describes work that may be invoked; it is not one invocation or one saved output. Use **step** as shorthand only when this meaning is clear. | Definition & Binding; [CMP-1/3](composition.md) |
| **Invocation** | A particular call of a bound step with its applicable inputs or arguments. It may be satisfied through reuse; a call does not by itself imply that the body executes. | Definition & Binding supplies the call relationship; Reuse Resolution resolves it; [CMP-5/6](composition.md) |
| **Attempt** | Work undertaken to produce or accept a result. An execution attempt can fail, be interrupted, or finish without publishing a new completed result. An acceptance check retaining an old result records current-check evidence separately from that result's original provenance. | Result History & Publication records it; [RES-005](execution.md) |
| **Binding** | The current relationship connecting a declared operation, input, or callable slot to what it denotes now. A structural descriptor identifies the declared relationship; its current target is resolved through that relationship. A function's text, display label, or surviving object identity cannot substitute for current correspondence. | Definition & Binding; [CMP-6/7](composition.md) |
| **Callable slot** | A declared place in a composition where a supplied function or step belongs, such as an `assessor` input. Its structural relationship helps reconnect the current callable after restart. It is not a function fingerprint. | Definition & Binding; [CMP-3/6](composition.md) |
| **Step graph** | The fixed abstract operations and possible relationships established by composition. Runtime data can select or instantiate declared work, but cannot invent or reconnect abstract operations. | Definition & Binding; [CMP-1](composition.md) |
| **Result graph** | The invocations/results and actual observed relationships that arise at runtime. Its cardinality and observed reads may vary while the step graph stays fixed. It is not a serialized graph of live proxies. | Relationships span Definition, Tracking, and History; [ARC-005](architecture.md), [CMP-2](composition.md) |
| **Fanout template** | A declared member computation built once using a symbolic member input, then instantiated for actual member keys. Member count may vary without rebuilding the abstract topology for each member. | Definition & Binding; [CMP-4](composition.md) |
| **Gate** | A tracked runtime predicate that selects whether an already-declared operation instance runs. A skipped operation is distinct from success returning `undefined`. | Definition & Binding defines the relationship; Run Supervision governs execution; [CMP-8](composition.md) |
| **Required population** | The members of a keyed collection whose gate selects them for a strict consumer. A gated-out member is explicitly **skipped**: outside the required population, carrying no data, and distinct from pending, failed, cancelled or successful-empty outcomes. | Definition & Binding declares the gate; Reuse Resolution and Run Supervision apply it; [CMP-8](composition.md), [RUN-010](operations.md) |
| **Strict fold** | A memoized consumer of a keyed collection that completes only when discovery is closed and every required member has an accepted result. A failed or cancelled required member fails it; open discovery or a pending member leaves it waiting. Neither case runs its body or publishes. It is distinct from a tolerant (outcome) fold. | Reuse Resolution with Run Supervision; [CMP-8](composition.md), [RUN-005/010](operations.md) |
| **Argument recipe** | The durable description of how a nested call's argument is reconstructed: `forwarded` from a current binding, `derived` as a recorded value justified by the parent's validated prefix, or `unreconstructible` (always an honest parent miss). It is evidence for validation, not a serialized closure. | Definition & Binding records the call relationship; Reuse Resolution validates it; [CMP-7](composition.md), [REUSE-006/007](execution.md) |
| **Supplied step** | A step implementation bound at composition to a callable slot, such as an `assessor`. Calls through the slot may carry arguments and use the slot's subject function over their derived values. Exchanging the bound implementation is a child implementation change, never a parent-graph change. | Definition & Binding; [CMP-3](composition.md) |
| **Member binding** | The tracked view of a template member's current keyed record, given to that member's gate and step callbacks. Reads are the step's own observations and are validated against the current keyed snapshot. Explicit members have none. | Definition & Binding supplies it; Tracking and Reuse Resolution observe and validate it; [CMP-4](composition.md) |
| **Coverage** | The framework-derived statement on a successful strict fold of which keys were required, which were skipped, and that discovery was closed. It does not depend on what the fold body reports. | Reuse Resolution; [CMP-8](composition.md) |
| **Soft stop / hard stop** | A soft stop admits no new work and drains admitted steps, with no default deadline. A hard stop aborts in-flight sends, waits and sleeps, marks the attempts interrupted, and records remote state as cancelled, still running or unknown. Neither ever publishes partial output. | Run Supervision; [RUN-014/015](operations.md) |
| **External operation** | One logical external call, such as a paid provider request. Its stable identity is persisted before the first send and shared by every retry, so a lost response is **unknown** rather than silently replayed. | Run Supervision, persisted through History; [RUN-012/013](operations.md) |
| **Durable deferral** | A persisted "not before T" for operation work waiting on a rate or quota limit. It holds no execution permit, releases the writer lease once only deferred work remains, and is honored by later runs. | Run Supervision, persisted through History; [RUN-011](operations.md) |
| **Unknown usage** | Usage for an operation that was started but has no acknowledged report. It is reported as unknown, never as zero. | Resource Accounting; [ACC-005](operations.md) |
| **Writer-busy** | The typed outcome for a process that waited for a store's writer lease until the operator deadline passed. It names the current holder. | Result History with Run Supervision; [RUN-002](operations.md) |

## Tracking and consumed evidence

| Term | Meaning and boundary | Owner and contract |
| --- | --- | --- |
| **Tracking frame**, or **frame** | One bounded scope for collecting the dependency observations made by a computation. It remains active across the asynchronous work it owns, closes when that capture ends, and rejects late use. Frames can nest and run concurrently without mixing observations. A frame is not a run, step definition, JavaScript stack frame, or durable record. | Tracking & Observation; [TRK-3](tracking.md) |
| **Capture** | The act of collecting observations within a frame. Capturing does not itself memoize the body, publish a result, or establish source freshness. | Tracking & Observation; [TRK-2/3](tracking.md) |
| **Tracked value** | A supported object or function wrapped so its consumed operations can be observed. Scalar-valued fields still yield ordinary scalars; a function is called normally. Wrapping a function does not memoize its output. | Tracking & Observation; [TRK-1/2](tracking.md) |
| **Observation** | Evidence of a semantic fact actually consumed: for example a field value, own-property presence, lookup-chain membership, key order, or called implementation. It is narrower than everything reachable from the input. | Tracking & Observation; [TRK-5](tracking.md) |
| **Dependency** | A relationship created by consuming a fact from an input, callable, or result. State the consumed fact when precision matters. Nested result dependencies preserve the selected-output boundary; they are not automatically flattened into all transitive source reads. | Tracking captures consumption; Reuse Resolution applies it; [TRK-5](tracking.md), [REUSE-005](execution.md) |
| **Implementation fingerprint** | Automatically observed evidence about the actual called function's implementation. The selected bounded mechanism uses the actual called function's emitted `Function.prototype.toString()` text, after current structural correspondence is established. It is neither a definition's identity, a restart locator, nor proof that all closure influences were tracked. | Tracking & Observation; [TRK-2](tracking.md) |
| **Structured address** | An ordered path of meaningful segments plus the relevant operation. Property `"0"`, array index `0`, and a collection member key are distinct concepts. Dots in a property name do not create extra segments. | Value Semantics supplies representation; Tracking supplies consumed-operation meaning; [VAL-1](tracking.md) |
| **Content fingerprint** | A digest of versioned canonical evidence for a supported value or selected fact. It compares content under the specified semantics; it does not identify a subject, prove freshness, or authorize reuse. SHA-256 collision resistance is an assumption. | Value Semantics; [VAL-2](tracking.md) |
| **Tag** | An opaque process-local token used for reactive dependency composition. A tag and its revision have no durable meaning and must not enter retained semantic evidence. | Tracking & Observation; [TRK-3](tracking.md), [ARC-004](architecture.md) |
| **Revision** | A process-local change marker used with tags to determine whether a local derivation may need reevaluation. It is distinct from a compatibility version or durable snapshot identifier. | Tracking & Observation; [TRK-3](tracking.md) |
| **Derivation** | A process-local cached calculation whose tracked dependencies govern invalidation. Serving its cached value replays its observations to consuming frames. This local cache does not establish restart-safe memoization. | Tracking & Observation; [TRK-3](tracking.md) |

### What a frame means in practice

Suppose an assessment reads `settings.strict`, then `pr.author.name`, and calls
a tracked `formatName` helper. One capture frame collects the guard's actual
value, the selected name, the called helper's implementation, and any tracked
facts the helper consumes. Merely passing `pr` to the helper does not consume
all PR fields. An unread `pr.labels` field contributes no observation.

If the computation awaits work, its frame continues to collect its own reads.
A concurrent assessment has a separate frame. An explicitly nested capture scope
collects independently and restores the surrounding scope when it finishes;
composition must propagate the observations the surrounding computation consumes.
Once a frame closes, a detached callback cannot append observations to it or
silently claim that its late reads were captured. Success and failure both end
the frame's lifetime.

On a later execution, a fresh frame records the newly taken branch. It does not
accumulate abandoned branch reads from the old frame. A cached in-process
derivation must replay its observations when another frame consumes it. Durable
reuse later relies on semantic evidence and current bindings, never on reopening
an old frame or reviving its tags. These are [TRK-3/8](tracking.md) obligations;
the paragraph does not prescribe a public capture API.

## Identity, collections, and materialization

| Term | Meaning and boundary | Owner and contract |
| --- | --- | --- |
| **Identity** | Which logical entity or member something represents. Identity is independent of content equality. Traversing an identity-bearing object does not automatically consume its identity field. | Explicit consumption belongs to Tracking; member relationships to Definition; [TRK-7](tracking.md), [COL-1](tracking.md) |
| **Subject** | The complete opaque author-supplied identity of memoized work, unique within an analysis. It identifies a history of work, not one exact result. A display name or content hash is not a substitute. Nonmemoized work does not require a subject. | Reuse Resolution uses it; History scopes retained work by it; [RES-001](execution.md) |
| **Member key** | The stable identity of a member within its collection binding, using the designated identity or an explicit supported custom-key strategy. A traversal ordinal is not an implicit identity. Duplicate keys fail. | Definition & Binding, with observed collection facts in Tracking; [COL-1](tracking.md) |
| **Collection projection** | The selected facts consumed across members, together with relevant membership, order, and coverage semantics. An exhaustive uniform projection can be one logical dependency; an early-stop traversal must preserve actual coverage and remain incomplete. | Tracking & Observation; [COL-2/3](tracking.md) |
| **Materialization** | Making selected stored data available as immutable value views or output data, while recording what access consumes. Loading is distinct from accepting freshness or granting permission to execute. | Materialization supporting component; [ARC-002](architecture.md), [DOM-3](domain.md) |
| **Snapshot** | A detached immutable representation of data at a particular point. A value snapshot alone is not necessarily a published completed result with framework identity and provenance. | Value Semantics defines representation; History owns completed result snapshots; [VAL-3](tracking.md), [RES-003](execution.md) |

## Results and current validity

| Term | Meaning and boundary | Owner and contract |
| --- | --- | --- |
| **Result** | A completed immutable envelope containing author data and framework metadata, including identity and historical provenance. It is distinct from an attempt and from the reference that locates it. | Result History & Publication; [RES-003](execution.md) |
| **Reference** | A scoped pointer to one exact retained snapshot. It is not payload, a “latest” alias, or a request to refresh/recompute missing data. Superseding a result does not retarget its reference. | Result History & Publication; [RES-002/006](execution.md) |
| **Historical provenance** | The original observations and exact dependencies supporting a result's execution. Later current verification must not rewrite it. | Result History & Publication; [RES-003/007](execution.md) |
| **Acceptance evidence** | Evidence of why a retained result is acceptable under the current bindings and policies. It is recorded separately from the result's original provenance; a past acceptance is not permanent validity. | Reuse Resolution decides; History records; [RES-005/007](execution.md) |
| **Candidate** | A retained result being considered for reuse. Its existence is not proof of current compatibility, source acceptance, or unchanged consumed facts. | Reuse Resolution; [REUSE-001](execution.md) |
| **Memoization** | The author's explicit choice to retain and reuse work across runs when the required evidence remains acceptable. It adds durability and reuse policy; `tracked()` alone does not provide it. | Reuse Resolution with History; [DOM-4](domain.md), [REUSE-001](execution.md) |
| **Compatibility version** | A per-memo positive integer, default 1, controlling which history is eligible, including validated rollback. It is independent of automatic implementation evidence and local reactive revisions. | Reuse Resolution; [REUSE-008](execution.md) |
| **Finality** | The outcome of the current optional definition finality hook for an eligible result and applicable inputs. True permits retention without source refresh for this resolution; absence supplies no shortcut. It is not a permanently stored “final” state or a substitute for other current source-acceptance policy. | Reuse Resolution applies the author's current policy; [REUSE-002/003](execution.md) |
| **Retention** | An explicit outcome accepting the eligible previous result and preserving its exact reference. Returning fresh equal data instead creates a distinct result. | Reuse Resolution interprets the outcome; History preserves the snapshot; [RES-004/006](execution.md) |
| **Publication** | The consistency boundary that makes a completed result authoritative while preserving claim ownership, allocation, and immutable history. A partial write or finished sub-request is not completed publication. | Result History & Publication; [ARC-007](architecture.md) |
| **Request key** | A fresh opaque key the caller supplies and saves before starting one top-level normal request. One request may admit several distinct direct invocations. Resolution derives each History-scoped *attempt key* from the request key plus the complete structural invocation descriptor; History persists the allocation and its outcome. A request key is neither an attempt identity nor a cache key. A normal new request uses a fresh key; a previously allocated derived attempt key cannot be used with different intent or silently served as a current hit. | Caller supplies; Reuse Resolution derives attempt keys; History persists them; [explicit recovery request](../plans/m3-contribution-analysis.md#explicit-recovery-request), [PUB-004](execution.md) |
| **Recovery** (of an admitted execution) | Takes a saved request key and the current declared invocation. It recomputes intent without author callbacks and reports the identified execution's exact durable outcome: committed success, absent, incomplete, or unsuccessful. Different intent rejects. It never automatically executes incomplete work and grants no current acceptance to a new request. The term covers only this named execution recovery; broader operational recovery is outside M3. | Run Supervision exposes the entry; Reuse Resolution recomputes intent; History reports the outcome; [explicit recovery request](../plans/m3-contribution-analysis.md#explicit-recovery-request), [PUB-004](execution.md) |
| **Resource observation** | A reported quantity, unit, and attribution of actual work. It remains meaningful even if no successful result is published. Missing usage is unknown, not zero; observed usage is not necessarily a final bill. | Resource Accounting; [ACC-001/002/005](operations.md) |

### One example across the terms

“Assess PR” is a **step definition**. Calling its current **binding** for PR 42
is an **invocation**. Resolution may reuse an eligible **result** without a new
body execution. If new work is needed, its **attempt** can use **frames** to
capture the title and prompt configuration it consumes. Successful publication
produces an immutable result addressed by an exact **reference**.

Later, a label-only change can leave the consumed title unchanged. Current
**acceptance evidence** explains why the earlier result remains usable, while its
**historical provenance** still describes the original execution. A changed
tracked prompt can require another execution. Neither the step's display name
nor a process-local tag decides that correspondence.
