# Standalone inspection and CLI checkpoint proposal

**Standing: proposed.** This document preserves the full issue-167 inspection
proposal and adds a narrower first-delivery proposal under
[CLI-001–004](../spec/operations.md#cli-and-read-side-delivery), [A-16](../spec/acceptance.md#preview-observation-cases), and
[M6](../milestones.md#m6--usable-cli-and-inspection-checkpoint). The first
delivery is not adopted here as a runtime contract or as full issue-167/M6
readiness. The owner-selected product scope and the engineering mechanisms below
have different standing: scope is recorded by the linked owner decision, while
the storage and execution details remain a proposal for review.

## First delivery: exact-execution progress and terminal observation

The owner selected one executable that starts the first concrete contribution
report workflow and provides separately permissionable read-only progress and
terminal observation. The concrete workflow and GitHub adapter belong to #240;
the first CLI does not introduce a reusable pagination framework. Rich history,
preview, dependency/reuse explanation, resource browsing, and the broader command
family below remain deferred full-checkpoint work. The realistic contribution
report scale remains in scope; no reduction follows from this proposal. The
foreground-versus-detached lifetime and interrupt behavior remain explicit human
choices. This proposal therefore does not imply that every CLI choice is settled,
that #240 is implementation-ready, or that issue 167/M6 is complete.

### Meaning and ownership

Supervision owns execution identity, run-progress meaning, transition ordering,
and the narrow publisher/reader contracts. The concrete report assembly owns
strict report classification: generic fulfillment of an author body or a
framework run result is not itself report success. Only the assembly may classify
the required search, detail, and summary outcomes as a strict report result.
Machine supplies existing host storage capabilities and owns no report or run
semantics. No seventh owner and no generic History operation-journal reader are
introduced.

The current ARC-003 rule says persistence adapters implement ports owned by
History or Accounting. This bounded Supervision-owned observational projection
requires an explicit architectural clarification: ARC-003 should allow a narrow
Supervision progress-store adapter for this read-only observation purpose, while
the progress meaning and invariants remain with Supervision. That clarification
is proposed, not already accepted; the existing six contexts and all their
invariants remain in force. See [ARC-003](../spec/architecture.md#arc-003--contract-dependency-direction).

### Record and storage proposal

Use a dedicated per-execution progress file containing one bounded latest
snapshot, with an explicit locator returned for that execution. The observation
identity is freshly allocated and distinct from public `runId`, which may repeat
across executions. Creation must be unique and must fail or retry on collision;
it must never overwrite another execution's record. One file is created per
execution, not per PR, and it retains no per-event or per-PR ledger. The record
contains only bounded framework lifecycle/progress facts and the concrete
assembly's strict terminal classification; it excludes author values, arbitrary
error objects, and unbounded event detail.

This replaces the consultant's proposed global many-run catalog with TTL, row
budgets, capacity rejection, and cleanup service. The accepted selected-execution
question requires no recent-run enumeration or global index, and no governing
requirement currently requires TTL, a row cap, or automatic cleanup. These
owner-managed output artifacts have no automatic deletion; readers never clean
up. If a future concrete contract requires TTL or bounded aggregate capacity, it
must identify the requirement and show the conflict with owner-managed artifact
lifetime before adding those policies. One artifact per execution is not one per
PR and is independent of the full workload scale.

The selected host path is the existing Machine SQLite capability opened in
DELETE-journal mode for publication and the existing read-only SQLite opener for
inspection. Each read returns one coherent latest snapshot. Do not reuse History's
WAL operation journal: it has no current write-free reader, and adding a generic
WAL reader is unnecessary for this selected-run query. Do not open writable
History as a read fallback. Machine's pathname and journal-lifetime contract
continues to apply. A hot journal that requires recovery is explicitly
unavailable/recovery-required to a read-only caller; the reader never recovers,
falls back to writable access, or reports fabricated liveness.

### Publication, ordering, and failure behavior

The initial record is durably published before analysis starts; failure to
establish it prevents start. Ordinary updates are sampled/coalesced in memory,
with a proposed maximum of one write per second; initial and terminal snapshots
are forced. Keep at most one newest pending ordinary snapshot, never an event
backlog. Mid-run observation failures are contained and cannot alter dispatch,
retry, admission, or report outcomes. They must be surfaced to the starter as
observation degradation. Terminal persistence uncertainty is reported separately
from report failure and never causes automatic re-execution.

Each update is bound to the exact execution identity. Stale revisions, updates
after terminal closure, terminal-to-nonterminal regressions, and late updates
after explicit artifact removal are rejected; a new execution gets a new
identity. Reads distinguish missing, corrupt/unsupported, recovery-required or
otherwise unavailable, recorded nonterminal, and recorded terminal states. A
nonterminal record is only the latest persisted observation; its timestamp does
not prove a process is alive, and process disappearance does not turn it into a
terminal result.

Supervision publishes terminal state only after execution has drained and the
concrete report assembly has completed required durable report publication and
strictly classified its result. The report and observation projection are
separate commits: report success with uncertain progress finalization remains
report success plus observation-finalization uncertainty. A lost acknowledgment
may leave a committed terminal snapshot; exact readback or idempotent terminal
retry may resolve that uncertainty without rerunning the report.

The read-only executable accepts only the explicit locator and observation
permission. It loads no analysis callbacks and exposes no start, dispatch, retry,
claim, cancellation, schema-initialization, mutation, or cleanup capability.
Its structured output must carry only the bounded snapshot and explicit read
state; final field names and framing remain to be selected. Viewing cannot change
execution. Foreground display may consume the live observer in the starter, but
independent read-only observation still uses this persisted exact-execution
projection. Detached lifetime and interrupt semantics remain pending human
decisions.

### Required implementation proof

Before implementation, add behavioral tests from this proposal and observe RED.
The bounded child issue draft is at `/tmp/first-cli-progress-implementation-issue.md`;
it is not filed, claimed, or an authorization to implement. At minimum, the
tests must prove:

1. Repeated public `runId` values produce distinct execution locators; duplicate
   creation cannot overwrite; stale and post-terminal updates cannot change the
   latest record.
2. Initial publication failure starts zero analysis work. Ordinary update
   failures do not alter retry, dispatch, or admission. A final write uncertainty
   is distinct from strict report failure and does not reexecute the report.
3. Fresh-process readers observe a coherent whole snapshot, invoke no author or
   control callbacks, perform zero writes, create no files or sidecars, and never
   fall back to writable storage. Missing, corrupt/unsupported, busy/unavailable,
   recovery-required, nonterminal, and terminal results remain distinct.
4. Generic fulfilled execution with a failed, pending, cancelled, or incomplete
   required report stage cannot become strict report success; a completed empty
   search remains distinct from failed or open discovery.
5. Ordinary writes remain bounded by the sampling interval and one latest
   pending snapshot regardless of event/PR count; initial and terminal snapshots
   are forced. No retained record or pending queue grows with per-PR event count.
6. Terminal publication follows drain and required report publication. A crash
   before terminal publication leaves nonterminal/unknown state; a hot-journal
   reader reports unavailable without attempting recovery.

These tests establish only the selected exact-execution observation path and
strict first-report outcome; they do not establish the full M6 read-side family,
plan inspection, historical activity, interrupt/control delivery, or M7 scale
qualification. Preserve realistic workload and bounded-memory/restart evidence
in the #240 acceptance path as separately governed.

## Purpose and boundary

An operator or library consumer should be able to ask what a selected analysis
has recorded, what remains uncertain, what work is waiting or settled, and what
resource evidence is available. Inspection answers from retained owner evidence;
it does not make the analysis current by running it. A separate explicit run
operation carries execution policy and authority.

The proposed composition is a small `microdelta` facade inspection opener that
combines owner-defined read ports for a caller-selected existing store and scope.
It may project coherent answers across owners, but it creates no seventh owner
of domain truth. Definition owns declared structure; Tracking owns semantic
observations; Resolution owns acceptance and freshness meaning; History owns
retained attempts, exact references and integrity; Supervision owns progress and
stop intent; Accounting owns usage and qualified resource reports. Materialization
loads selected immutable values, and Machine supplies host capabilities. The
facade adds no authority merely by presenting their evidence together.

Keep three capabilities distinct:

- A **finite reader** answers bounded queries over retained state and has a
  closeable local lifetime.
- An **observation** attaches to changes, prompts rereads, and can outlive a run;
  its thin signals are not result events or proof of currentness.
- **Run control** requests execution effects through Supervision. A reader or
  observation alone never grants this capability.

Do not add an inspection mode to `IWorkspace.run`: that composition exists for
authoring and execution, and inspection should not carry authority it must ignore.
The opener should not load analysis registration modules or callbacks. Its
selected store, analysis/environment scope, and exact evaluation/reference are
explicit inputs; it must not search arbitrary stores, choose an implicit latest
success, or verify against live sources.

The six ownership boundaries and dependency direction are defined by
[ARC-001–003](../spec/architecture.md#arc-001--six-contexts-one-owner-per-invariant);
the facade's generated declaration tier remains governed by
[PKG-003](../spec/package-boundaries.md#pkg-003--release-tiers). This proposal
does not promote project-private alpha ports into a public API.

## Consumer questions and evidence

| Consumer question | Proposed evidence path | Required interpretation |
| --- | --- | --- |
| What evaluations or attempts are retained for this scope? | Owner-provided bounded enumeration and history reads | State coverage and identity. An empty page is not proof of no older evidence when enumeration is incomplete. |
| What value belongs to this exact evaluation, and did refresh fail? | Read current/stale status and error, then load the selected exact reference | Keep unavailable, selected `undefined`, zero and empty values distinct. Missing verification is unknown, not success. Never retarget to a newer result. |
| Did it fail and later recover while I was away? | Bounded recent-activity read, separately from latest status | Show retained coverage and gaps. Latest success or signal count/order cannot reconstruct activity. |
| Why was work reused, executed, refused or left waiting? | Recorded acceptance, dependency, input-difference and supervision evidence | Explain only owner-recorded reasons. Candidate verification differs from accepted reuse; equal fresh publication differs from explicit retention and acceptance without a source request. |
| How much work remains? | Recorded discovered and settled counts, waits, and discovery closure | While discovery is open, total is unknown; 80 settled of 100 discovered is not 80% complete. A stale observation does not prove a process remains alive. |
| What resource use or limit evidence exists? | Accounting usage/gap query plus separate qualified retained reports | Sum usage deltas only under their owner semantics. Remaining reports are observations, not usage or a guaranteed current balance; absence/expiry does not resolve unknown usage. |
| What did the declared plan contain, and what runtime work is known? | Safely inspectable recorded definition descriptor plus separately recorded runtime population | Describe the declaration as recorded, not current source code. Do not import callbacks to rebuild it. Separate known runtime work from unknown cardinality and conditional work. |

Each combined answer should retain its selection, owner and evidence coverage.
Owner reads can have different revisions or timestamps; a combined display must
not imply an atomic cross-store snapshot. Exact references preserve value
selection if another evaluation publishes while inspection is in progress.
Selected-load instrumentation should prevent unrelated large values from being
loaded for a narrow query.

## Candidate command and output shape

One small command family could be spelled `microdelta inspect` with views for
status, history, result, explanation, resources and plan. It would require an
explicit store and scope; an exact reference is required when the desired
evaluation is not otherwise identified. Enumeration precedes selection when
identity is unknown. This family and spelling are proposals only. Owner-reserved
choices remain unresolved: exact commands and arguments, store selection,
public read owner and lifetime, output shape, streams, and exit behavior.

Proposed stream principle: requested evidence goes to stdout; diagnostics,
progress and observation-health messages go to stderr; machine output has no
banners or terminal decoration. A finite query yields a complete report, while
follow mode is explicitly incremental. Whether the output is human-readable
with stable JSON or human-only is unanswered. If stable JSON is selected, its
versioned envelope must preserve absent versus present-undefined values; framing
(JSON document or JSON Lines), exact schema and exit numbers remain open. A
prose format must not be advertised as a stable machine protocol.

Proposed exit principle: success means the requested evidence was read and
reported successfully, even when its domain answer is failure, mixed, pending,
unknown, or no value. Invocation errors, inaccessible required stores, corrupt
or unsupported evidence, read failures and local interruption are command
failures. Exact numbers and category mapping remain unselected. A credible rival
is to return nonzero whenever the selected analysis failed or is unknown, which
helps shell gating but conflates query success with analysis success and makes
historical inspection look like a promise of present validity. If chosen, that
policy must define precedence for mixed states or offer a distinct assertion
operation; it is not implied here.

Add follow mode only after the observation contract is selected and available.
It should perform an initial read and then reread after thin invalidations, with
baseline/attach race handling in the library. Feed health remains distinct from
the last retained sample. Mid-follow read failure must be visible and cannot
silently replay old data as live. No callback-bearing preview body, provider
refresh, author policy or generic incremental query engine is implied.

## Read lifetime, plan evidence and alternatives

The proposed finite opener accesses existing storage, checks supported schema
and logical identity, and closes idempotently. It does not create or initialize
stores, migrate schemas, acquire/renew/release claims, recover work, sweep,
evict, accept results, publish, dispatch or retry. Queries after close fail
clearly. Closing observation ends local queries and signals but does not cancel
execution or erase consumer-owned state. The chosen #165 lifetime must govern
escaped or lazy values; finite CLI formatting may finish selected reads before
closing, but that implementation pattern does not settle library lazy-view
semantics.

Plan inspection is mandatory for the full CLI-002 checkpoint. A recorded
Definition descriptor/read seam is needed to inspect safely in a fresh process
without callbacks. It must say what declaration it describes and its coverage;
the recorded declaration descriptor belongs to Definition. Resolution supplies
the selected, validated keyed population and its coverage evidence, using
Definition's keying rules. Supervision reports operational progress and closure
from those owner-supplied facts; its progress records do not replace the selected
population evidence. The facade composes these distinct facts without selecting
a persistence mechanism or a retained-member policy.
If descriptor evidence is absent, report that gap as an unmet capability rather
than fabricating a plan from History rows. Do not narrow the issue to only the
easier finite query slice or silently defer plan inspection.

Credible alternatives were considered. Exposing every context reader directly
to CLI code may be smaller, but makes each client reconstruct scope, freshness,
coverage and error precedence and gives library consumers no shared composition.
Adding reads to `openWorkspace` reuses a familiar name, but couples inspection to
the authoring/execution composition and its History initialization. A single
reader that also exposes cancellation or repair is convenient but carries
authority unrelated to detached viewing. The proposed facade reader is a
composition boundary, not a new domain authority; if it cannot remain thin, use
owner readers directly and make the duplicated interpretation cost explicit.

Current storage facts constrain, but do not select, the solution. Machine has a
read-only SQLite opener for supported rollback-journal stores; its Node reader
refuses WAL and has no query-snapshot transaction. History currently defaults
to WAL, so a no-write, compatible History opener and separate-process proof are
missing. Do not change journal mode, use immutable-file mode against an active
writer, or claim no-side-effect cross-process behavior from same-process reads.
Accounting's `openDurableAccounting` is writable/initializing; usage reads need
a narrow owner opener separate from that authority. Existing report reading
from #166 and preview projection from #216 are useful bounded inputs, not a
complete CLI or permission to adopt #165 proposals. The current/recent preview,
enumeration, independent observation and lifetime requirements of #165 remain
dependencies. A-16d's after-run inspection and A-16e's sustained/trailing
signals also remain full-checkpoint obligations.

## Interrupts and full-checkpoint reconciliation

For detached `inspect --follow`, a proposed first interrupt stops the local
observation loop and releases local readers; a second may expedite local process
exit if cleanup is still pending. Both leave the observed run untouched. A
finite query uses local interruption too. The display should state that
inspection stopped and no run stop was requested. These local cleanup intents
do not fulfill RUN-014's soft/hard execution-stop requirement.

M6 requires both run supervision and inspection. A-13/M6 acceptance requires a
separately explicit run-control composition: first signal requests soft stop,
second requests hard stop, while a separate inspection process can still read
the run afterward. Requested, delivered, local stopping, provider cancellation
requested/confirmed and remote unknown remain distinct. Process exit alone
proves no remote termination or billing cutoff. A detached control command
would additionally need an explicit target and supported delivery/acknowledgment
path; none is implied by a reader. The issue owner must reconcile this command
scope or choose a larger controlled command cut before full acceptance. A
read-only slice can be useful partial delivery, but cannot be reported as issue
167 complete or M6 accepted.

## Test-first handoff and acceptance boundary

When software work begins, write failing Jest behavior tests and generated
declaration `tsd` tests first, based on CLI-001–004, A-13, A-16 and the scenarios
above. Use a deterministic provider-free fixture installed into a fresh process,
with no private source aliases or analysis registration. Instrument body,
source-policy, dispatch, retry, claim and write ports to reject calls. Probe
opening as well as querying; verify files and store evidence do not change,
including for missing stores and unsupported layouts. Include a writer/process
boundary where supported and fail honestly otherwise. Select an exact reference,
publish another result concurrently, and verify the selected read does not
retarget. Instrument selected-load counts to exclude unrelated payloads.

Seed success, failed attempt, prior stale value plus refresh failure, absent
value, unknown validity, equal-value verification versus retention, reuse
without source request, refusal/cancellation/not-started, required-input and
discovery waits, owner waits, scheduled retries, nested mixed coverage, and
known/gap usage with qualified, expired, zero and missing reports. The owner-wait
fixture must preserve its recorded reason; the scheduled-retry fixture must
preserve its reason and eligibility, then show one actual execution when shared
consumers become eligible rather than duplicate executions. Keep plan declaration
coverage distinct from Resolution's selected validated population/coverage and
Supervision's operational progress, both before and after runtime discovery.
For aggregate coverage, carry forward A-16g as a full-checkpoint dependency and
acceptance case: a member moving buckets replaces its prior contribution once,
established removal disappears, and unfinished rediscovery does not treat an
old member's temporary absence as removal. This case awaits #165's retained-
member and aggregate policy choices; it selects no retained-union rule here.
For follow, cover baseline race, coalesced
failure/recovery, equal-data metadata changes, read failure, coverage gaps,
completion followed by continued inspection, and detach without run
cancellation. Assert local interrupts cause zero run-control writes; separately
prove ordered soft/hard run intents and honest remote state. Verify selected
stream and exit decisions for broken stores and mixed/unknown answers after
those product choices are made.

These are proposed acceptance checks, not checks run by this documentation
change and not evidence of runtime support. Passing existing projection or
report tests, documenting the plan, or implementing only finite inspection
would not establish full issue-167 or M6 acceptance. The issue remains
unclaimed and not implementation-ready until its reserved decisions,
dependencies and acceptance scope are reconciled.
