# Results, reuse, and publication

microdelta preserves completed work while deciding whether that work is acceptable
under the current analysis. An immutable historical result, its acceptance now,
and the attempt that performs new work are distinct facts. This separation lets
an analysis reuse expensive results without treating old policy decisions as
permanent or rewriting what originally happened.

**Status:** normative target contract, except passages labeled **Proposal** or
**Experiment**. This document does not claim that the current implementation
satisfies these requirements. Requirement identifiers are stable. Public API
spellings, storage records, and publication mechanics remain implementation
choices unless explicitly fixed here.

## Scope and ownership

[Architecture](architecture.md) defines the context dependency graph. **Reuse
Resolution** owns current eligibility, source-policy acceptance, nested
validation, and the decision to reuse or execute. **Result History & Publication**
owns immutable completed results, attempt history, claims, allocation, and the
authoritative publication boundary. One consistency authority owns claim,
allocation, and publication even if it has several internal modules. Storage
backends implement this authority's ports; they do not establish a competing
lifecycle.

Definition & Binding supplies current callable and argument correspondence.
[Tracking & Observation](tracking.md) supplies semantic observations and compares
the facts presented to it; it does not decide freshness or acquire claims.
Materialization loads selected stored data and bridges observations; loading an
exact reference does not itself authorize new computation. Resource Accounting
records work independently of whether a completed result is published.

[Experiments](experiments.md) defines the bounded work needed to select the
remaining mechanisms. [Acceptance](acceptance.md) supplies delivery gates and
evidence. Tests must be derived from these contracts before implementations are
written; the cases below are test obligations, not reports of passing tests.

## Result and reference requirements

### RES-001 — A subject is the author's complete opaque identity

Every memoized subject has a complete author-provided opaque string, unique in
its analysis scope. microdelta must not derive it from a display name, append hidden
display-name namespaces, or reinterpret its components. Display-name edits must
not alter reuse identity. Display names have no uniqueness requirement. A public
stable step ID remains unjustified unless a concrete need cannot be met by current
references/bindings. Nonmemoized work does not require an author subject;
framework snapshot identifiers are separate from subjects.

For example, the author may choose `pr:https://example.test/repo/pull/42` as the
complete subject. Renaming its displayed step from “Retrieve PR” to “Read PR”
must leave that identity unchanged. Two analyses may use the same subject text
without becoming the same scoped subject. A subject identifies a history of work;
it is not a reference to one exact completed result. The author must distinguish
PR evidence from a PR assessment in the complete subjects rather than return the
same URL for both and depend on a hidden step-name prefix. Subject strings compare
by exact string equality. Composition records common member lineage for grouping;
one reused subject may participate in several branches without an exclusive parent.

### RES-002 — A reference locates; a result contains data

A reference is a pointer or locator, never the result payload. The reference
model uses a kind discriminator and the locator information needed for that
kind; common resolution dispatches by kind. A completed-result reference must
identify one immutable snapshot and carry enough logical analysis/environment
store scope to resolve it without guessing the current environment.

The scope can be explicit or encoded in an opaque identifier; that encoding is
not selected. A reference need not contain a filesystem path or credentials.
Authorization and access to the addressed store remain necessary. A reference
to snapshot A must resolve A even after snapshot B becomes current. It must not
silently resolve the current pointer, refresh a source, or recompute missing A.

### RES-003 — Completed results are immutable envelopes

A completed result separates author data from framework metadata, including
its identity and historical provenance. Once published, the snapshot and its
meaning must not change. Giving author logic access to a previous result must
not let mutation alter its stored payload. Inspection and resolution must
preserve this isolation.

Provenance records the observations and exact dependencies supporting that
execution. A new verification may follow a different current dependency with an
equal consumed value; it must not rewrite the original result's provenance.

### RES-004 — Fresh equal output and explicit retention are different

Successful execution that produces fresh data creates a distinct completed
result, even when its content equals an earlier result. An explicit retention
outcome accepts the eligible previous completed result and keeps its exact
reference. Neither object identity nor payload equality may be interpreted as
that control outcome. The outcome must be distinguishable from every supported
author payload and identify the prior result being retained unambiguously.

A cold miss, an incomplete attempt, or a failed validation cannot become a
successful retention. A fresh equal-valued fetch may still permit downstream
reuse through comparison of consumed output. Its execution and resource usage
remain observable as new work.

### RES-005 — Attempts and acceptance records are separate from results

An execution attempt may fail, be interrupted, or finish without publishing a
new completed result. Preserve its available provenance, error/outcome evidence,
and acknowledged resource observations without fabricating a successful result
reference. An acceptance check that retains an existing result records the
current check separately from the old payload's provenance.

A local policy decision using cached data and a conditional network check can
both retain the same snapshot; their current work differs. Failed validation
must not advance successful-acceptance evidence. Exact record names and their
storage layout are not prescribed.

### RES-006 — Retained references remain valid

No deletion may break a valid retained reference, including references in result
dependencies, provenance, or history. Superseding a result is not permission to
delete it. Expensive or paid data is not implicitly disposable because it is no
longer current. An external saved reference requires an explicit lifetime
contract; absent such a contract, retain its target.

Dangling references violate the contract. Do not hide them by recomputing the
result or substituting a newer one. A future reclamation policy must demonstrate
referential integrity and the applicable retention contract before deleting
anything; no generic caller predicate overrides these requirements. Resource
quantity and paid-status classification are not defined by this document.

### RES-007 — Current acceptance does not replace historical truth

Persist current verification/acceptance evidence separately from immutable
historical provenance. Reuse can update evidence about the current binding or
dependency path without changing the retained result's exact reference.
Execution timestamps, diagnostics, and revision labels are not automatically
semantic compatibility inputs.

For example, a result originally read `pr.author.name` through author A. The
current PR points to author B with the same name. If that is the only consumed
fact, the result can remain accepted while current verification follows B.
History must still show the original observation through A. Reading identity
as well would create a different validation obligation.

## Reuse requirements

### REUSE-001 — Reuse is a current contextual decision

Resolution must establish the candidate's eligibility under the current scoped
subject, applicable definition and compatibility controls, current bindings,
observed inputs, and source acceptance policy. An old reference alone proves
neither present eligibility nor freshness. Exact historical reads remain valid
independently of whether a snapshot is reusable for current execution.

Memoized work may intentionally retain a nondeterministic observation, such as
an LLM output. The contract does not require all author calculations to be pure
or deterministic. Influences intended to invalidate reuse must enter through
tracked data/functions or explicit source, freshness, or compatibility policy.

### REUSE-002 — Current finality hooks are authoritative

Whenever resolution requires a finality decision for an eligible cached result,
evaluate the current optional definition hook against that result and current
applicable analysis inputs. This includes resolution beneath an outer cached
consumer. A previous true answer must not bypass the current hook after restart
or a later resolution.

True permits retaining that result without source refresh for this resolution.
False follows normal verification/retrieval policy and does not itself require
a full fetch. An absent hook supplies no finality shortcut. Without an eligible
completed result there is no result to retain.

Do not store a finality flag, state, callback answer, or equivalent assertion
used to skip the current hook. Ordinary diagnostic records may describe a past
decision; they are not authority for the next one. Hook naming, sync/async shape,
and invocation deduplication within a single resolution are not settled here.

### REUSE-003 — Source acceptance does not finalize downstream work

Finality expresses the author's policy for the relevant result and inputs. It
can follow intrinsic immutability, a deliberate terminal-state snapshot policy,
or stability relative to analysis inputs. microdelta must not infer that all fields
of a terminal entity are immutable or that a fixed time window proves collection
discovery complete.

A merged PR accepted by the current hook can avoid retrieval while a changed
prompt reruns its assessment. Widening an analysis window can revoke an earlier
exclusion. An immutable artifact does not make its mutable alias immutable.
Each case must honor separate consumed inputs and current policy.

### REUSE-004 — Source checks can explicitly retain after doing work

If normal retrieval/check logic runs, it receives absence or the last eligible
completed representation and may explicitly retain that representation after
its policy accepts it. Record the work actually done. Neither a validation
failure nor an unchanged comparison automatically authorizes retention; the
source policy must supply that acceptance.

For example, a conditional request that confirms unchanged data can retain
snapshot A with a new acceptance record and one observed request. A current
finality hook can retain A with zero source requests. A fresh fetch returning
equal data creates snapshot B. These are three different histories.

### REUSE-005 — Nested validation preserves the consumed-output boundary

Observed nested dependencies propagate implicitly and hierarchically. Authors
must not repeat child field lists at each parent. Validate the current child
invocation as needed, then compare the output facts the parent consumed. A new
child snapshot identifier alone must not invalidate a parent that consumed only
unchanged content. Explicit consumption of identity remains an observation in
its own right.

For example, child B produces a new snapshot with unchanged `headline` but changed
`details`. Parent A read only `headline`; A may retain its old result after B is
currently accepted. Flattening B's changed implementation or every internal
read directly into A's invalidation set would defeat this cutoff. The child's
own validity and the parent's observed output equality are separate decisions.

### REUSE-006 — Restart validation uses current bindings and justified arguments

Durable nested-invocation evidence must support correspondence to the current
declared callable binding, the current or justified retained arguments, the
prior exact child result, and the output observations needed for comparison.
Definition & Binding supplies the current correspondence. A saved result
reference, old process-local function object, display name, or execution ordinal
does not establish it.

Arguments can come from current bound references or retained values whose
validity is established under their governing inputs and implementation
evidence. A derived argument is not inherently invalid merely because it was
computed inside the previous parent execution. However, do not assume arbitrary
closures can be serialized or reconstruct an argument from its subject alone.

**Experiment:** select the durable binding/address and argument-evidence
representation. Named structural callable slots are a candidate mechanism, not
a requirement for globally registered public step IDs. Demonstrate separate
process reconstruction; unchanged in-process object identity is not evidence.

### REUSE-007 — Unproven reconstruction yields an honest outer miss

If current nested callable or argument correspondence cannot be established,
the outer candidate must not be reported valid. Mark it as a miss and execute
its body through the normal execution path if work is requested. Its nested
calls can still independently reuse valid results. Do not replay an expensive
parent body and describe that execution as cache validation.

A wholly valid outer candidate skips its body. A missing binding or unproven
derived argument cannot be silently matched to a similarly named operation.
Diagnostics must distinguish insufficient validation evidence from observed
changed content; both can require normal execution, for different reasons.

### REUSE-008 — Track implementations automatically and preserve explicit control

Calling a tracked function observes its implementation fingerprint and the
tracked reads/calls it performs. Relevant implementation changes participate
automatically in validation. This supersedes the earlier advisory-only source
comparison proposal. An implementation fingerprint is evidence, not a subject
identity, callable locator, or proof of semantic equivalence.

The author also retains an explicit compatibility control that can force
recomputation despite unchanged subject and observed inputs. Earlier histories
remain preserved. The version is per memoized step, a positive integer defaulting
to 1. It is a compatibility group, not semantic versioning. Changing it makes
other-version results ineligible; returning from version 2 to version 1 permits
reuse of retained version-1 results only after normal current validation.

Automatic implementation and input evidence still participate: rolling back the
number alone must not conceal incompatible current code or inputs. The exact
record/lookup protocol reconciling these controls is EXP-1 work. The settled
scope, integer representation, default and rollback permission are not open
questions. Tests must cover both explicit control and automatic evidence.

### REUSE-009 — Execution admission and protected lifecycle

A budget/execution gate applies after successful verification has had the chance
to reuse a candidate, and before new work is claimed. Refusal is a typed outcome
with no completed result or stranded claim; free valid hits remain available.
Observers cover both memoized and nonmemoized calls without authorizing work.
The framework owns an inspectable, non-removable lifecycle sequence around
verification, admission, claim, execution, publication and release. Author
middleware cannot interpose inside or bypass its consistency boundary.

A failing observer must not corrupt storage or make committed success appear
uncommitted and trigger paid reexecution. A pre-execution middleware failure is
contained to its call and is reported. Exact hook/stack API shape is implementation
work; observer capability does not imply an unrestricted execution wrapper.

Explicit check-only evaluation must not claim or execute a memoized miss. If
current source work or unavailable output is needed, report that boundary and
downstream uncertainty rather than predict exact future results or costs. Any
permitted nonmemoized evaluation is separately authorized execution; read-only
CLI inspection does not invoke it. Test budget refusal after reuse, immutable
framework lifecycle positions, throwing middleware and a new-subject plan stop.

## Resolution transition table

This table is authoritative for semantic outcomes. It does not specify a
database protocol, enum names, or a total ordering of independent work.

| Starting facts / event | Required next behavior | Result and history effect |
| --- | --- | --- |
| No eligible completed candidate | Execute normally when requested | Retention is unavailable; preserve the attempt |
| Eligible candidate; current finality hook returns true | Accept without source refresh for this resolution | Keep exact result; separate current acceptance |
| Eligible candidate; hook false or absent | Apply ordinary verification/retrieval policy | No automatic fetch or automatic retention follows solely from false/absence |
| Retrieval/check explicitly accepts prior result | Retain the exact accepted candidate | Record current work; preserve original provenance |
| Retrieval/check fails | Surface failure under the execution contract | No invented completed result or successful acceptance |
| Execution successfully returns fresh payload equal to old payload | Publish a distinct result through the publication authority | Old result remains; downstream content cutoff remains possible |
| Child currently accepted; all output facts consumed by parent equal | Continue parent validation | Parent can retain exact result if all its obligations pass |
| Consumed child fact changes | Parent candidate misses | Normal parent execution captures its current observations |
| Current child binding/arguments cannot be justified | Parent candidate misses with reason | No expensive validation replay; normal execution can reuse children |
| Current path targets a new entity with equal consumed scalar | Compare consumed facts under tracking rules | Retain if valid; update current evidence, preserve historical provenance |
| Tracked implementation or explicit compatibility control requires recomputation | Candidate is ineligible/invalid under the selected compatibility rule | Execute when requested; preserve old history |
| Exact historical reference is read after supersession | Resolve its original snapshot | No freshness check, current-pointer substitution, or implicit recomputation |

## Publication and recovery requirements

### PUB-001 — One authority decides publication

Claim acquisition, attempt allocation, and publication belong to one consistency
owner. It must define the authoritative point at which a completed result becomes
visible as published/current. Readers must never observe a current pointer to
an incomplete or missing completed result. Storage operations must implement
this contract together, rather than composing independently valid row mutations
without a lifecycle guarantee.

### PUB-002 — Every ownership-sensitive mutation is fenced

Renewal, publication, and release must check the current ownership precondition.
After holder A expires and B acquires, A must not publish over B, renew B's claim,
or release it. A stale holder's eventual work may supply history under the chosen
protocol, but cannot authorize a current-pointer change. Fencing applies across
processes and restarts, not only an in-memory lock.

### PUB-003 — Allocation never reuses an issued attempt identity

Allocation must be durable and safe under concurrency. An abandoned attempt,
failed attempt, restart, or permitted future reclamation must not make its
identifier available again. If the protocol exposes per-subject generation
numbers, their allocation must be monotonic and must not derive solely from the
current completed generation or a scan that forgets deleted history. The final
identifier representation is not prescribed.

### PUB-004 — Intermediate crash states have explicit recovery outcomes

The selected publication protocol must enumerate each persistent intermediate
state and its recovery, including death after acquisition, during allocation or
payload persistence, and around publication/current-pointer advancement.
Recovery must preserve reference integrity and retained attempt evidence without
claiming an incomplete payload is completed. Define ambiguous publication
acknowledgment handling so retry/recovery does not invent conflicting outcomes.

**Experiment:** choose atomic backend transitions or a recoverable publication
protocol and prove its bounded crash/race cases before treating backend ports
as stable. This document selects neither a transaction schema nor a lease-token
format. A model or table alone does not establish actual backend durability.

### PUB-005 — Contention and waiting report facts accurately

An acquisition result meaning “held” must correspond to an observed applicable
claim, not merely a failed compare-and-swap. Distinguish contention/retry from
ownership facts. A waiter does not gain the holder's execution permission or
renewal authority. After publication or claim termination, the waiting caller
must resolve against its own current arguments and policy; another caller's
completion is not blanket proof of reuse eligibility.

Exclusive claim protection is the default for memoized work. Two converging
callers must wait/reverify rather than deliberately pay twice. An explicitly
chosen duplicate-execution opt-out is a deferred extension; before it can be
used it must define allocation, retained attempts, fencing and publication
ordering without weakening these invariants. Lease expiry can still leave a
stale remote request running; fencing prevents stale publication, not an
unconditional exactly-once provider execution guarantee.

### PUB-006 — Acknowledged resource reporting survives failed publication

Execution accounting is independent of successful completion. The persistence
contract must identify when a resource report is durably acknowledged and retain
that report after process death, failed execution, or rejected publication.
Do not claim durability for an in-memory accumulator or an unacknowledged
fire-and-forget write. Missing final observations remain unknown rather than
being inferred as zero or a successful bill. Resource Accounting owns reporting,
deduplication, attribution, and gaps; publication must preserve that separation.

## Required validation fixtures

These fixtures supplement the cross-cutting gates in [acceptance](acceptance.md).
Run durable cases through separate processes and the actual selected backend;
closing and reopening an in-memory facade cannot establish restart correctness.

| Fixture | Assertions | Requirements |
| --- | --- | --- |
| Same subject, new display label; same subject text in another analysis | Display rename preserves history lookup; analysis scopes stay distinct | RES-001, RES-002 |
| Publish A then B; read saved A; mutate author-visible previous data | A still resolves exactly; mutation cannot alter storage | RES-002, RES-003, RES-006 |
| Local retain, conditional-check retain, fresh equal fetch | First two preserve A; third creates B; current work differs; cold retain fails | RES-004, RES-005, REUSE-004 |
| Finality hook corrected or input window widened after restart | Current hook runs and can revoke prior acceptance without metadata reset | REUSE-002, REUSE-003 |
| Restart, child implementation changes, new child output projection equal | Current child is revalidated/executed; parent body does not run if all its obligations pass | REUSE-005, REUSE-006, REUSE-008 |
| Restart with reconstructible derived arguments, then with unproven arguments | Proven case validates normally; unproven case honestly misses before normal execution | REUSE-006, REUSE-007 |
| Author A replaced by B with equal name | Value-only consumer may retain; identity consumer invalidates; old provenance stays intact | RES-007, REUSE-005 |
| Same inputs, changed tracked implementation; explicit compatibility change | Each selected control can affect reuse; old histories remain; interaction is recorded | REUSE-008 |
| Two holders with expiry/reacquisition and late A completion | A cannot renew, release, or publish over B; current pointer remains valid | PUB-001, PUB-002 |
| Process death at each selected protocol boundary | Recovery has one documented outcome per state; no partial completed result | PUB-001, PUB-003, PUB-004 |
| Abandonment, restart, and concurrent allocation | Issued attempt identities never repeat; generation numbers, if used, remain monotonic | PUB-003 |
| Contended acquire and waiter with different arguments | No fictitious held outcome; waiter re-verifies its own request | PUB-005 |
| Acknowledged resource report followed by process death | Report survives independently of publication; missing reports stay unknown | PUB-006 |

Diagnostics must identify the scoped subject/candidate and distinguish changed
observations, incompatible evidence, missing current correspondence, policy
acceptance/failure, stale ownership, and storage-integrity failure. Exact error
codes and user-facing formatting belong to implementation design. Avoid treating
all of these as an unexplained generic cache miss.

## Supersession and bounded remaining work

This contract replaces the earlier generation-ID-only nested comparison,
display-name-derived subject identity, persisted-finality proposals, and
advisory-only implementation comparison. Historical Store row shapes are not
constraints on the selected lifecycle. Earlier process-local tests do not prove
these durable guarantees.

The remaining execution experiments are current-binding/argument reconstruction,
compatibility interaction, and the concrete publication/fencing/recovery
protocol. Their deliverables must include counterexamples, selected mechanisms,
tests, and explicit limits. Reference encodings and public method names may be
chosen during implementation without reopening the settled semantic behavior.
