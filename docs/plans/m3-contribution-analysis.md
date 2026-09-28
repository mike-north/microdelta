# M3: durable repository contribution analysis

Status: M3 implementation plan for [issue #51](https://github.com/mike-north/microdelta/issues/51),
grounded in the confirmed user example on 2026-09-27. M2 is accepted. The M3
component and assembly issues (#52–#57) are accepted; the independent-process
acceptance evidence (#58) is in the [M3 acceptance record](../validation/m3-acceptance-2026-09-28.md),
and M3 as a whole is not yet accepted. This plan applies the active specification and
does not replace it. [Issue #50](https://github.com/mike-north/microdelta/issues/50)
is the final M3 acceptance gate. Implementation readiness is governed by acceptance of this plan and each
prerequisite issue; the dependency table records that sequence.

## Consumer outcome and full target

Given repository-identifying input, produce a repository report organized around
its contributors: discover relevant pull requests and review activity, associate
that activity with contributors, produce each contributor's summary, and combine
those summaries into one report. The data-driven population naturally requires
fanout and fan-in. The source API and attribution rules are not yet selected.

M3 uses explicit fixture repository identity `acme/widget`; ambiguous repository
search or provider-specific URL resolution is outside this runtime proof.
The user confirmed that the same contribution-summary theme continues through M3
and M4. Each contributor output includes statistics and a written assessment
produced by a deterministic TypeScript template string populated with those
statistics. No language-model call is needed. Fixture choices are specified below. Do not call PR counts a measure of
contribution quality.

## M3 slice within the existing milestone

Use two explicitly selected fixture contributors to exercise repeated member
invocations and their stable structural correspondence. Compose the fixed source
and summary relationships before execution. Use nonmemoized configuration/helpers,
a retained activity source and a memoized summary for each selected contributor.
Assemble the repository report with an ordinary nonmemoized helper from the two
results. The report identifies the selected scope; it is not presented as complete
repository coverage.

This preserves the full product example while keeping dynamic contributor
discovery, general fanout templates and strict collection folds in M4. Cached outer
summary cutoff after a child reruns to equal output remains A-05/M4; the ordinary
M3 report assembly does not claim to prove that behavior.

Start with controlled source fixtures and deterministic summarization so counts,
references and failures have independent expected outcomes. No paid provider or
live GitHub API choice is needed to prove the runtime. The real authoring path must
use the selected durable History implementation, not a test-only persistence facade.

## Outcomes to prove before implementation

| Scenario | Required evidence | Governing gate |
| --- | --- | --- |
| Cold run then complete process exit/restart | Required current source checks occur; eligible summary bodies do not rerun and retain exact references | TEST-2, A-02/A-03 |
| Unread activity field changes | Corresponding summary can retain when its other obligations pass | A-02 |
| Consumed activity field changes for one contributor | Affected summary reevaluates; unrelated eligible contributor summary retains | A-02 |
| Current source policy or tracked summary helper changes | Current policy/implementation is evaluated; stored acceptance does not bypass it | A-02/A-03 |
| Compatibility version changes and returns | Filter candidates by version, then validate current evidence; retain old history | A-02, REUSE-008 |
| Reverse explicit contributor invocation order after restart | Stable member bindings preserve each contributor's own result and observations | A-02, CMP-6 |
| Referenced author identity changes but consumed name is equal, then new name changes | Value-only reuse follows the current path; original provenance remains intact | A-04 |
| Source explicitly retains versus fetches fresh equal data | Retain preserves the exact reference; fresh data creates a distinct result | A-03/A-10 |
| Kill at the selected publication boundaries | Recovery exposes no partial completed result; previous results remain readable | A-09, PUB-004 |
| Missing exact reference or wrong store scope | No silent retargeting or recomputation | A-10 |
| Basic admission refusal or observer failure | Eligible hits remain usable; refused work is not claimed; committed success survives observer failure | Basic A-19 |

SQLite with an enforced single active logical writer follows the selected PUB-004
contract. It is not evidence of concurrent worker safety. Tests use independent
processes and deliberate kill points rather than resetting an in-memory cache.

## Planning sequence

1. Use the confirmed statistics-plus-template-string output; make one concrete
   example of input activity and expected output before writing implementation.
2. Trace the fixed authoring path across Definition, Tracking, Reuse Resolution,
   History and Materialization; preserve owner boundaries and existing public APIs.
3. Stage dependency-ordered GitHub issues for the authoring/binding contract,
   durable result/reference/publication ownership, current source validation and
   reuse, basic admission, then the separate-process acceptance harness. Exact
   issue boundaries follow the owner-contract review; the reviewed dependency queue is recorded below.
4. Implement contained issues test-first in isolated worktrees, with supervisor
   review and exact-head gates. Accept M3 only after the required process-boundary
   outcomes pass; extend this example into data-driven fanout/fanin in M4.

## Governing repository documents

- docs/milestones.md: M3 and M4 scope and exits.
- docs/spec/acceptance.md: TEST-1/2, A-02/03/04/09/10 and basic A-19; related full
  roster workflow TEST-3/4 remains broader product acceptance.
- docs/spec/composition.md: CMP-1/4/6/7 fixed graph and current correspondence.
- docs/spec/execution.md: exact references, immutable history, current acceptance,
  explicit retention, version filtering and selected PUB-004 publication protocol.

## Confirmed output example (illustrative statistics)

A contributor result can contain structured counts and a sentence such as
`Ada authored 3 pull requests and submitted 5 reviews.` The counts and text must
agree, and fixture attribution rules must explain how each count is derived.
Exact metric names are not frozen by this illustration. Changing a tracked
assessment template/helper is an implementation-change case for A-02; unchanged
statistics do not erase that dependency. M3 uses two explicitly selected
contributors and ordinary final report assembly; M4 expands discovery and fanout.

## Authorized scenario enrichment

The user authorized additional usage detail where it helps exercise the intended
capabilities. Interpret the reference to M2 as exercising its completed building
blocks through the M3 durable path; do not reopen M2 or move general M4 collection
composition into M3. No further product clarification blocks this bounded plan.

Use fixture records with stable contributor/PR/review identities, an author profile,
PR status, review activity, and deliberately unread metadata such as labels and
avatar URLs. Choose and document simple attribution/counting rules. Example output:
`Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.`
Keep structured statistics alongside the text so independent expected fixtures can
check both. The final report explicitly identifies the two selected contributors
and the configured fixture scope; do not imply all-contributor coverage.

Useful variations within the fixed M3 path:

- Change an unread label/avatar: no summary invalidation from that field alone.
- Change consumed merged status or review activity for one person: its summary
  reevaluates; the other eligible contributor retains its exact result.
- Change the actually called tracked formatter: reassess affected summaries even
  with unchanged statistics. Changing an uncalled helper alone adds no dependency.
- Replace a referenced author profile with another having the same consumed name,
  then change the replacement's name: follow current binding/path correspondence,
  preserve original provenance, and distinguish value-only from identity reads.
- Reverse the two explicitly declared contributor invocations on restart: stable
  structural member identities preserve correspondence. This does not promise
  arbitrary source-array reordering is invisible to code that consumes its order.
- Have a current source check explicitly retain its result, or produce fresh equal
  data: preserve the distinct reference/publication semantics in the evidence.
- Kill during publication and deny an admitted miss: demonstrate that the ordinary
  authoring path composes M2 observation/materialization with M3 persistence and
  lifecycle boundaries, rather than hiding a separate fixture-only cache.

Application calculations may iterate their bounded fixture activity data normally;
that is not a claim to general framework fanout or durable loop reconstruction.
Final report assembly is ordinary nonmemoized work. Memoized parent equal-output
cutoff, discovery closure, dynamic population changes and strict general folds
remain M4 tests, using this same theme.


## Concrete fixture decisions

These are application fixture policies, not framework-wide rules. Use repository
`acme/widget`, UTC window `[2026-01-01, 2026-04-01)`, and two fixed contributor
keys `person:ada` and `person:ben`. No discovery is needed to declare these two
members. Source records include nested profile data, PRs and reviews; do not
replace them with precomputed summary counts solely to fit existing ports.

A source fixture selects unique authored PRs created in the window and unique
submitted reviews by the selected contributor in that window. Pending reviews
are excluded; duplicate IDs and attribution inconsistencies are fixture errors.
A current merged status determines the merged subset; the reporting window is
based on PR creation, not an invented merge-time restriction. Fixture activity is
human activity; there is no claim to a repository-wide bot or alias policy.

- Ada has PRs 101 and 102 merged, PR 103 open, and five submitted reviews.
  Expected statistics: authored 3, merged 2, reviews 5.
- Ben has PR 201 merged, PR 202 open, and three submitted reviews.
  Expected statistics: authored 2, merged 1, reviews 3.
- Profiles have an upstream identity, display name and unread avatar URL. PRs
  include unread labels. Stable contributor correspondence is separate from a
  mutable upstream profile reference, making the A-04 equal-name rebind meaningful.
- The formatter handles singular/plural deterministically. Ben's sentence is
  `Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.`
- The ordinary report identifies repository, window and selected contributor keys.
  It orders displayed summaries by those stable keys even when invocation order
  is reversed. It does not claim a discovered complete population or a cached fold.

A cold run executes each source body and summary once. On unchanged restart,
current source acceptance is still established; eligible summary bodies execute
zero times and retain exact references. Ordinary report assembly executes once
per run. Source check/fetch counts depend on the explicit current policy variant;
no single stored finality bit stands in for those variants.

## Owner contracts to implement

| Owner | Meaning and responsibilities | Boundary that must remain intact |
| --- | --- | --- |
| Definition & Binding | Frozen declared inputs, supplied helpers and source/summary slots; unique current correspondence by structural path and explicit member key; permitted call edges | No storage, cache acceptance, source calls or paid work during composition/lookup; no name/hash/ordinal fallback |
| Machine / Node adapter | Injected synchronous SQLite statement/transaction host operations and the concrete clock capability needed by History's lease protocol | No schema, subject, attempt, lease or publication policy; Node imports stay in Node adapter |
| Result History & Publication | Versioned durable records, exact reference resolution, attempts, writer fences, allocation, staging, atomic publication, candidate lookup and separate acceptance records | One consistency authority; no contextual source freshness or cache eligibility policy; existing public row Store stays compatible |
| Tracking & Observation | Actual consumed input/output and called-helper implementation facts; scoped capture and comparison | No persistence or source policy; parent observations do not absorb a child's internal implementation/reads merely because it invoked that child |
| Materialization | Immutable access to selected stored result data and its observation bridge | No candidate selection or freshness; metadata-only lookup must not silently load payload |
| Reuse Resolution | Candidate eligibility, current source validation, current binding and selected-output comparison, honest miss, execution through injected admission and History ports | No private History rows or guessed argument reconstruction; finality is current policy, not stored permission |
| Run Supervision | Scoped run/environment, ordinary invocation lifetime, admission and observer positions | No context argument through every author helper; no bypass of Resolution or History; M5 retry/cancellation breadth remains deferred |
| Facade assembly | Compose owner implementations into the actual workspace authoring path | No seventh domain authority; no fixture-only alternate cache API |

New M3 cross-package surfaces are intentionally project-private `@alpha`
declarations. That declaration tier is separate from package publishability:
workspace packages carry public publish metadata, and only user-authorized
`0.0.0` namespace-bootstrap placeholders without runtime code have been
published; no M3 implementation release exists. Existing public Store
exports/signatures remain unchanged.
The runnable example must clearly use the real workspace authoring surface through
its generated alpha declaration consumer; it must not advertise an unpublished npm
installation or a stable public API. Publication/release-tier promotion is separate.

## Selected execution contract

The following decisions specialize the existing requirements for M3. They do not
relax the normative target or promote the alpha surface to a public API.

### Candidate eligibility and current source policy

1. Reconnect the unique current declaration and direct bound inputs, and select
   history by logical store, analysis, environment, complete opaque subject and
   positive-safe-integer compatibility version. Definition lookup never executes
   an author body. Missing or ambiguous correspondence produces a distinct miss.
2. Validate the candidate's own actually called implementation and consumed input
   evidence. A changed retrieval body cannot be excused by a finality hook. The
   fingerprint belongs to the author's function, never a uniform runtime wrapper.
3. Only for a still-eligible source candidate, invoke the **current** finality hook
   if provided. True retains the exact reference without refresh. False or no
   hook enters normal source check/retrieval; neither means automatic retention
   or necessarily a full fetch. Cold or incompatible candidates have no previous
   result eligible for retention and do not invoke a finality hook.
4. Check/retrieval may explicitly retain that eligible previous reference or
   supply fresh data. Source outcomes use a framework control envelope around
   payload data, so every supported payload remains distinguishable from retain.
   Retention targeting another, missing or ineligible reference fails. Fresh equal
   data is still a new publication; ordinary object identity is never a control.
5. A summary candidate must validate its recorded direct source invocation under
   the current declaration/policy, including beneath an otherwise unchanged
   summary. Compare only the source facts the summary actually consumed. A new
   source reference alone is not a content change. Current acceptance records
   name the current child; original summary provenance keeps the historical child.
6. A changed/unavailable/incompatible/ambiguous fact is never an equality result.
   Missing current binding or unjustified child arguments yields an honest miss;
   missing exact historical data or wrong scope is an integrity error, not a miss
   silently repaired by execution. Do not replay the summary body as validation.
7. After validation can no longer reuse, obtain admission before acquiring a work
   claim, allocating an attempt or running its body. An ordinary run can grant
   source work needed during nested validation independently of the summary miss.
   Denial is a typed outcome. Check-only evaluation stops when source execution
   would be needed and reports downstream uncertainty.

This selects the previously unspecified phase order in REUSE-002 consistently
with REUSE-001/008. A test changes the source body while the current hook would
return true: the hook runs zero times for that invalid candidate, and admitted
source execution produces a new result. A separate unchanged candidate test
proves the hook runs again after every process restart. Hook failure is failure
of current validation, never a successful acceptance or permission to ignore it.
Within one top-level resolution, the same direct invocation may share its already
established current result; that memo is run-local evidence, not durable finality.

### Nested materialization and evidence ownership

The source-to-summary path must support ordinary nested record reads and indexed
array loops over exact retained data. M3 extends the selected synchronous SQLite
path; arbitrary asynchronous getters remain unsupported. A navigation read of a
container obtains just its shape and a lazy view. It does not observe every child,
its identity, or a whole serialized subtree. Scalar, presence, length, key-order
and explicit-output observations retain their Value/Tracking meanings.

Fingerprint validation remains metadata-only. Selected reads must never decode
an entire source blob to answer a single property, and fingerprint lookup must
never fall back to payload I/O. The production History representation therefore
needs independently addressable selected content and indexed evidence alongside
its immutable result envelope. A bounded test-first nested-access gate precedes
adoption: prove unread sibling content is neither read nor observed, changed
consumed content invalidates, and unprefetched nested reads work.

The navigation port returns a tagged scalar selected fact, record shape or array
shape (including length), scoped to the exact reference and structured address.
Shapes are transport metadata, never fabricated `ISelectedFact.fact` objects or
semantic whole-container reads. An optional History reader capability preserves
scalar-only implementations. A selected scalar uses the existing MDO1 encoder;
array length becomes an observation only when read. Intermediate container kinds
must agree with Property/Index address semantics during validation. The owning
issue proves this contract before dependent History/Resolution code becomes ready.
Sparse holes/present undefined, supported prototype lookup, key order and all
existing supported Value semantics remain intact; M3 does not silently narrow
its persisted domain to the handful of fixture fields. History owns generating
and checking its index from the canonical payload, rather than accepting opaque
caller-authored metadata as automatically truthful. This is a local mechanism gate, not a
second persistence authority or a general M7 memory/eviction proof.

### Direct invocation evidence and fixed relationships

For each of the two fixed members, composition declares an activity source and
summary and permits only that summary's activity edge. Member keys are explicit
structural correspondence, not display names or call ordinals. All declarations
and inputs are copied/frozen before a run; later mutation or replacement of an
author's builder arrays cannot reconnect a historical call.

M3 source and summary calls have no runtime positional arguments. Repository,
window and contributor inputs are current declared bindings. The durable direct
child witness contains its structural callable slot, member key, the explicit
empty-arguments form, prior exact result reference and the output binding used
by the parent observations. Empty arguments are a positive, checked form of
justified correspondence, not missing argument evidence. Reject unknown witness
versions and argument forms; do not guess general derived arguments. M4 adds
those only after EXP-4.

A declared child handle routes through Resolution and creates a child capture.
It returns an ordinary immutable `{ data }` carrier whose `data` is the selected
view. Authors use `const { data: activity } = await calls.activity()` and then
`activity.profile.name`. Returning the tracked proxy directly from a Promise
would probe `then` and create an accidental observation. The carrier avoids
that probe without reserving a valid author-data field. Top-level run outcomes
expose exact references for inspection; child references remain in framework
witnesses unless an explicit identity-observation operation is requested.
Ordinary tracked helpers execute inside their caller's capture. The parent owns
its author implementation, local input/helper observations, child-call witness
and consumed child-output observations. The child owns its implementation and
internal observations. A generic invocation thunk is not the author function's
implementation evidence. Current correspondence is resolved by Definition, not by
function hashes. The typed capture checker must recognize canonical declared
handles and actual author callbacks, with forged brands, unrelated same-spelled
APIs, unsupported callbacks and raw captured closures as negative controls.

### History, host operations and durable records

Add a distinct alpha durable History authority; leave the public row Store API
and its memory backend compatible. The authority accepts injected SQLite and
clock capabilities and owns every SQL statement and schema/lifecycle decision.
Machine's portable SQLite port provides bound values, statement rows, close and
synchronous immediate transactions with rollback on throw. Its Node adapter
opens the file with the selected WAL/full-synchronous/foreign-key/bounded-busy
configuration. Node APIs and native-driver imports stay in that adapter.

Persist a production schema identity/version distinct from legacy Store and
EXP-3. Unknown versions or incomplete schemas reject before work. Define logical
store identity separately from filesystem location; reopening a moved file with
its same logical identity does not invent a new store. Exact opaque locators
encode a version, logical store, analysis, environment and immutable result key;
History validates every component, never consulting a current pointer to repair
an exact lookup. Subjects remain complete opaque author strings with no hidden
step-name prefix.

Each completed envelope contains its exact reference, scoped subject and
compatibility group, supported Value encoding identity, immutable payload/selective
content and fingerprint index, and immutable provenance. History stores a
versioned canonical provenance payload and explicit exact dependency references;
Resolution owns interpretation of its invocation/observation schema. This avoids
forbidden History imports from Definition or Tracking. History verifies reference
integrity and atomic storage, not contextual freshness. Separate acceptance rows
retain current verification evidence without rewriting a completed envelope.
Attempts retain allocation identity, outcome and available failure/interruption
evidence whether or not they produce a result.

One durable logical-writer lease protects the store. It is held across the run's
writes, with each work attempt separately allocated after admission. Writer
ownership authorizes storage mutation, not author execution. A valid hit can write
its acceptance record without allocating/claiming execution; a refused miss must
not acquire a new execution claim or leave writer ownership stranded. Evidence
must distinguish the database writer lease from an admitted work attempt. Every
ownership-sensitive mutation checks holder, increasing fence and unexpired lease
inside its transaction. Allocation commits before staging; staging alone is never
a completed result. One publish transaction installs exact content, indexed
fingerprints, provenance, completed state and the current pointer together. No
reclamation is added. Version-group rollback selects retained history without
rewinding the latest publication pointer.

A stable attempt key addresses recovery of one admitted execution, not a broad
subject-level cache. Recovery first checks its durable outcome; committed success
returns its exact reference without repeating the body. A different intended
execution must use a different key. The integration fixture persists the key
outside the killed process and repeats that same recovery request after lost
acknowledgment. Do not claim exactly-once external work before publication commit.
History receives an opaque recovery-intent digest supplied by Resolution and
rejects a reused key with different intent. Resolution builds it from the complete
current declaration/input/version/argument description for that admitted request;
this recovery identity is distinct from the smaller semantic reuse evidence.
Recovery returns the result of that identified past execution; it is not a grant
of acceptance for a different current invocation.

The Node clock supplies finite integer UTC epoch milliseconds. History persists
a database-wide time high-water and evaluates holder operations at
`max(hostNow, persistedHighWater)` within the transaction. Backward wall movement
can delay expiry; a forward jump can expire ownership early. Neither can allow an
old fence to publish after a successor acquires. This conservative local-clock
policy is not a distributed time or liveness claim. Test rollback, forward jump,
lease expiry and successor operations explicitly.

Record kill/reopen outcomes at acquire, allocation, staging and either side of
publish commit, plus stale-holder rejection. This proves the selected single-file
process-termination scope, not concurrent workers, hardware power loss or M5.

### Explicit recovery request

Run Supervision exposes two distinct alpha entry operations: normal current
resolution and recovery of a named admitted execution. Before starting a normal
invocation, the caller supplies and durably saves a fresh opaque `requestKey` in
the run invocation options. The example harness writes it to its own request file
before launching the worker. This is a real consumer option, not a test hook or a
subject-derived cache key. Ordinary helpers receive no additional parameter.

Resolution derives each admitted attempt key canonically from the request key
and the full structural invocation descriptor (including the fixed member and
source/summary slot). M3 deduplicates the same direct invocation within that
one top-level request; it has no general looping argument forms. The authority
scopes the key by logical store/analysis/environment/subject. Resolution also
records the complete current declaration/input/version/empty-argument intent
digest described above. The caller need not fabricate History's digest or attempt
ID. Allocation publishes the key/digest relationship durably before execution.

A separate `recover` operation receives the saved request key and current declared
invocation descriptor; Resolution recomputes its intent without invoking author
callbacks and asks History for that exact attempt. A completed matching attempt
returns its exact past success with a recovery outcome. It does not run source
hooks, write a new current acceptance or claim that the result is acceptable for a
new request. Different intent rejects; absent/incomplete/failed attempts return
explicit recovery state and do not execute automatically. An ordinary new run
uses a fresh request key and performs normal current resolution, including current
source policy. Reusing an allocated key for different execution is a conflict;
it cannot silently serve old work as a current hit.

The acceptance harness must recover a committed summary through this public-to-
the-workspace alpha operation after process death before acknowledgment. It must
also prove different-intent rejection and that a subsequent normal new request
still invokes current policy. This caller-persisted request boundary supplies
M3's lost-acknowledgment proof without promising a durable scheduler, general
resume workflow, provider idempotency or automatic retry of incomplete work.

### Supervision and actual consumer path

Run Supervision owns scoped run lifetime, admission and observer positions.
Resolution receives an execution-admission port; History's writer consistency
remains independent of that policy. Facade assembly supplies host-backed scoped
context through a narrow structurally injected port, so Supervision need not
import Machine or thread a context parameter through ordinary helpers. Looking
up runtime context during composition or outside a live run fails explicitly.

After publication, observer errors become diagnostics alongside committed success.
They must not turn that success into a retryable execution failure. Pre-execution
observer errors prevent only the affected call from proceeding. The framework's
verify/admit/claim/execute/publish/release sequence is inspectable and cannot be
replaced by author middleware. Nonmemoized report assembly is visible ordinary
work; it has no completed-result identity or hidden memoization.

The checked-in example imports generated alpha declarations through the real
workspace facade and runs the same owner implementations as acceptance. It does
not import private sibling source or use a test-only persistence cache. Fixture
source adapters replace external GitHub calls, not framework behavior. Independent
subprocess tests rebuild the declarations and inputs, assert exact sentences,
body/check counts and references, and exercise crashes through this assembled path.

## Authoring shape and worked walkthrough

Definition exposes generic declarations for current inputs, helpers, fixed member
slots, retained sources and memoized computations. The facade supplies the
Tracking-aware callback context. An illustrative member declaration is below;
spelling remains alpha, but the ownership and call behavior are selected.

```ts
// Both members and their activity -> summary relationships exist before run.
'person:ada': {
  activity: source({
    subject: 'activity:acme/widget:2026-Q1:person:ada',
    finality: ({ previous, inputs, helpers }) =>
      helpers.acceptActivity(previous, inputs.config),
    run: ({ previous, inputs, helpers }) =>
      helpers.checkActivity(previous, inputs.config, 'person:ada'),
  }),
  summary: memo({
    subject: 'summary:acme/widget:2026-Q1:person:ada',
    children: ['activity'],
    run: async ({ inputs, helpers, calls }) => {
      const { data: activity } = await calls.activity();
      return helpers.summarize(activity, inputs.config, helpers.format);
    },
  }),
}
```

This fragment is explanatory, not a compilable command or current public API.
`person:ben` has its own source and summary with corresponding complete subjects;
there is no repository-wide eager source substituted for those two records.
`checkActivity` returns an explicit fresh-data or eligible-retention envelope.
The fixture adapter is a declared source helper whose implementation is tracked;
external data is governed by the source's current acceptance policy. `summarize`
and `format` are tracked ordinary functions; the implementation traverses actual
activity records with indexed loops. Author callbacks take current typed bindings
at their boundary, while ordinary helper signatures contain only domain inputs,
not storage/run context. Source policy sees an immutable eligible previous result
carrier or absence; it cannot mutate stored data. Composition must validate the
explicit child edge without invoking `run` to discover it.

On the cold run Ada's summary misses, obtains admission and allocates its attempt.
Its declared activity call independently resolves, obtains source admission,
fetches fixture data and publishes source SA0. Reads of name, status and review
fields produce summary observations bound to that exact child. The summary
publishes TA0; Ben independently produces SB0/TB0. Ordinary report assembly returns
the two expected sentences in key order.

After complete exit, a new composition can register Ben first. Definition still
reconnects Ada's source and summary slots. Resolution validates TA0's own code and
inputs, resolves the direct activity witness and validates SA0 under current
policy. With accepting current finality, SA0 needs no refresh. Indexed selected
fingerprints satisfy TA0's consumed facts without source payload reads or summary
execution; TA0 is retained with new current acceptance evidence. Ordinary report
assembly runs and reads the small summary output it needs. A later fresh source
SA1 changing only unread avatar/labels still permits TA0; a consumed merged-status
change produces TA1 while eligible TB0 remains. This is M3's minimal source-child
cutoff, not the general memoized multi-level parent-cutoff gate in A-05/M4.

## Planned evidence names

The integration suite names below define independently asserted outcomes; they
are planned tests, not claims that the current checkout already implements them.

| Planned case | Independent assertion |
| --- | --- |
| `cold-and-restarted-report` | Exact Ada/Ben stats and sentences; source/summary once on cold, summary zero after restart, report once each run |
| `current-finality-under-cached-summary` | New process runs current hooks; false/absent follows check policy; changed source implementation skips finality and cannot retain |
| `read-unread-and-called-helper` | Unread fields/uncalled helper preserve exact summary; consumed status/called formatter miss only their dependents |
| `compatibility-rollback` | Version filter plus current evidence; old exact reference retained without pointer rewind, changed-input rollback misses |
| `reordered-fixed-members` | Reversed calls preserve each member's own references and evidence |
| `equal-name-profile-rebinding` | New source profile ID/equal name retains summary, next new name invalidates, original child provenance still resolves old profile |
| `retain-versus-fresh-equal` | Explicit retention keeps SA0; fresh equal yields SA1; TA0 can survive equal consumed facts |
| `exact-reference-integrity` | Superseded reference stays exact; missing/wrong-scope target errors without retargeting or body call |
| `selected-node-io` | Nested access reads selected data only; eligible validation performs no source-payload reads |
| `publication-kill-boundaries` | Old or fully committed new state at each kill; no partial result; recovery key avoids repeating acknowledged publication |
| `admission-and-observer-boundaries` | Hits precede admission; denied misses have no claims/attempts; post-commit observer failures preserve success |

Component suites independently cover negative reader envelopes, unsupported
Value/encoding/schema versions, source retention failures, scope and fencing,
clock movement, declaration and capture enforcement, and generated API boundaries.

## Implementation queue and readiness

All items are initially backlog/Waiting on Project 9. Acceptance of this plan
makes only #52 and #53 ready; every other item waits for the accepted dependencies
in this table. A merged PR alone does not satisfy a dependency until its default
branch checks and owning issue acceptance are verified.

| Issue | Deliverable | Accepted dependencies |
| --- | --- | --- |
| [#52](https://github.com/mike-north/microdelta/issues/52) | Portable SQLite/clock host capabilities and Node conformance | #51 |
| [#53](https://github.com/mike-north/microdelta/issues/53) | Frozen direct bindings, declared handles and capture boundary | #51 |
| [#54](https://github.com/mike-north/microdelta/issues/54) | Nested selected-read mechanism, production ports and bounded SQLite proof | #51, #52 |
| [#55](https://github.com/mike-north/microdelta/issues/55) | Durable History authority, scoped references, indexed reader and crash recovery | #51, #52, #54 |
| [#56](https://github.com/mike-north/microdelta/issues/56) | Current source/summary resolution and direct-child validation | #51, #53, #54, #55 |
| [#57](https://github.com/mike-north/microdelta/issues/57) | Scoped Supervision/facade and executable contributor example | #51, #53, #55, #56 |
| [#58](https://github.com/mike-north/microdelta/issues/58) | Independent subprocess acceptance and dated evidence/docs | #51, #57 and its prerequisites |
| [#50](https://github.com/mike-north/microdelta/issues/50) | Supervisor final M3 acceptance and queue reconciliation | #51 through #58 |

Implementers own one contained issue/worktree and stop at a reviewable PR. The
supervisor owns contract decisions, substantive exact-head review, completed
Copilot findings, protected review status, merge and default-branch acceptance.
No implementation issue authorizes paid calls, package publication, release
changes or merging the human-controlled Version PR.
