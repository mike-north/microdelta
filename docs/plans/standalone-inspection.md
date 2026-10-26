# Standalone inspection and CLI checkpoint proposal

**Standing:** the owner-selected first product slice is run-start plus
separately permissionable read-only observation for the concrete contribution
report workflow. The common engineering contract is accepted under root's
supervisory selection in [CLI-005](../spec/operations.md#cli-005--bounded-exact-execution-observation)
and [A-21](../spec/acceptance.md#exact-execution-observation-cases). Its
mechanisms are not attributed to the owner's product-scope decision. The accepted
contract can be implemented after it is merged and its supervisor-owned child
issue is issued; this is not runtime delivery or full issue-167/M6 readiness.
This plan remains the proposal home for the broader standalone inspection and
full CLI-001–004/M6 checkpoint. Its remaining alternatives and open decisions do
not override the accepted CLI-005 contract or select starter lifetime and
interrupt behavior.

The owner-selected scope is recorded by the [#167 owner decision](https://github.com/mike-north/microdelta/issues/167#issuecomment-6404318056). The concrete workflow and GitHub adapter belong to #240. The owner clarification preserves the historical workload of roughly 150,000 pull requests and their review/comment payloads, without reducing scale or defining a fixed API-request count ([#240 clarification](https://github.com/mike-north/microdelta/issues/240#issuecomment-6405525087)). Generic TEST-5's synthetic-subject qualification remains a separate gate. The first CLI introduces no reusable pagination framework.

Rich history, preview, dependency/reuse explanation, resource browsing and the
broader command family remain deferred full-checkpoint work. Foreground-versus-
detached lifetime and interrupt behavior remain explicit human choices. The
selected observation slice does not imply #240 implementation readiness, full
issue-167 completion, M6 acceptance, or realistic-scale qualification.

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
prose format must not be advertised as a stable machine protocol. These
output-format and stream alternatives apply to the deferred full inspection
command family. The selected CLI-005 finite exact-locator reader returns one
versioned JSON document with no banners or prose framing; exact field spellings
remain implementation choices.

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

The broader proposed finite opener accesses existing storage, checks supported
schema and logical identity, and closes idempotently. It does not create or
initialize stores, migrate schemas, acquire/renew/release claims, recover work,
sweep, evict, accept results, publish, dispatch or retry. Queries after close fail
clearly. Closing observation ends local queries and signals but does not cancel
execution or erase consumer-owned state. The open output and lifetime alternatives
in this plan apply to the deferred full inspector and #165 preview semantics.
They do not qualify CLI-005: that selected finite reader exposes only `read` and
idempotent `close`, rejects reads after close, and closing it neither stops
execution nor deletes its owner-managed per-execution artifact. The chosen #165
lifetime still governs escaped or lazy preview values.

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
than fabricating a plan from History rows. This requirement remains part of the
full CLI-002 checkpoint; the owner-selected first delivery does not claim plan
inspection or satisfy that checkpoint.

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

The full M6 checkpoint requires both run supervision and inspection. A-13/M6
acceptance for that checkpoint requires a separately explicit run-control
composition: first signal requests soft stop,
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
