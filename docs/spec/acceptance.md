# Acceptance scenarios and evidence

Status: specification of required evidence, not a report of passing tests.
Requirement owners: [domain](domain.md), [architecture](architecture.md), [tracking](tracking.md),
[composition](composition.md), [execution](execution.md),
[operations](operations.md), [package boundaries](package-boundaries.md).

## Evidence rules

**TEST-1 — Outcome-first tests.** Tests precede software and derive expectations from
contract IDs, independent fixtures and observable outcomes. Do not mirror internal
implementation branches or count tests as proof of a feature. Record the initial
failure and passing command for experiments/implementation. Documentation checks
validate artifact structure and traceability separately.

**TEST-2 — Separate-process durability.** Process A writes; it exits completely;
process B recreates declarations, configuration and input objects against the same
durable store. Assert body invocation counts, exact result references, source-hook
calls and current verification evidence. Clearing a map or recreating a runtime
inside one process is not a substitute. Reorder declaration/member registration
and rename display labels. Nothing depends on surviving closures/tags.

## Required contract suites

| Suite | Input/counterexample | Required evidence | Gate |
| --- | --- | --- | --- |
| A-01 Observation semantics | Every TRK-5 row, changed guards, pass-through output | Exact changed/unchanged facts; no deep-read inflation | M1/M2 |
| A-02 Durable baseline | Unchanged, unread field, consumed field, helper code, explicit version, member reorder | Fresh-process invocation counts and references | M3 |
| A-03 Current source policy | Cold, final, false/absent hook, validated reuse, fresh equal fetch, hook change | Current hooks through cached consumer; no stored finality shortcut | M3 |
| A-04 Current path rebinding | Author changes ID with same name; then new author's name changes | First assessment retained, second invalidated, old provenance intact | M2/M3 |
| A-05 Nested cutoff | Child input/code/source changes, equal vs changed selected output | Child current validation; outer retained only on equal projection | M4 |
| A-06 Binding failure | Missing slot, ambiguous correspondence, unjustified derived argument | Honest miss/diagnostic, no paid validation replay | M1/M4 |
| A-07 Keyed collections | Insert/delete/reorder, duplicates/custom key, presence/enumeration/order | Stable member reuse, relevant aggregate invalidation | M4 |
| A-08 Fixed topology | One template, tracked gate, result-created node, mutated builder array | Runtime instances change; undeclared topology rejected before work | M4 |
| A-09 Publication and fencing | Kill every commit boundary; stale publish/renew/release | Old history intact, no partial current value, authorized publisher only | M3/M5 |
| A-10 Reference integrity | Supersession, fresh equal output, explicit retain, missing target, scoped stores | Exact retained pointers; no silent recompute/retarget/delete | M3/M5 |
| A-11 Failure/readiness | One failed member, one pending, one successful, open discovery | Independent siblings continue; strict fold waits/fails honestly; outcome fold reports settled statuses with coverage, never complete while unsettled, and reconsiders after repair | M4/M5 |
| A-12 Acquisition retry and rate admission | Lost response, current-run exhaustion, new-run reset, callback precedence, shared units/time, required-retry rejection | A-12a–h below: correlated attempts, no unapproved sends or fabricated result/usage, shared pre-send bound, preserved fencing/stop | Changed target after M5; new evidence required |
| A-13 Cancellation | Soft then hard stop, provider unsupported, commit race | No unwanted future admissions, no partial success, honest remote state | M5/M6 |
| A-14 Accounting | Duplicate/lost acknowledgment, crash, unreported usage | Durable known observations exactly once; unknown not zero | M5 |
| A-15 Declaration boundaries | Own, sibling, public, beta, hidden-type leak, source bypass | API Extractor rollups plus real compiler positive/negative fixtures; missing declarations and forbidden source imports fail for the expected reason | M0.5 |
| A-16 Explain/CLI isolation | Observe current, old, missing, uncertain downstream data | No admitted computation/claims/writes merely by viewing | M6 |
| A-17 Materialization/scale | Large unread payload, several narrow consumers, early-stop loop | Instrumented loads/memory; fingerprint-only positive control | M2/M7 |
| A-19 Admission/middleware | Budget refusal, cached hit, throwing observer, check-only miss | Hits served, misses refused before claims, committed success preserved | M3/M5 |
| A-18 Context lifecycle | Concurrent scopes, thrown nested frame, detached callback after close, repeated standalone fresh captures in a continuing caller | No cross-run leakage; late use fails clearly; completed captures do not retain a distinct host context per entry after observers/results become unreachable | M2/M5 and host lifecycle regression |
| A-20 Machine boundary | Direct Node built-in import/global in runtime outside Node Machine; new capability used by a context; unsupported/failing host operation; repeated host-context entry | Source check rejects bypass but allows tests/tooling; Node implementation passes capability conformance and injected-context fixture, preserves caller context and exact callback result while bounding completed-entry retention; History/Accounting port ownership remains intact | M0.5 and each added capability |

The A-18/A-20 heap-instance diagnostic is bounded to Node 24 and 26, where the
same synthetic standalone capture workload distinguishes per-entry growth from
an isolated-entry control. It retains the continuing caller, crosses task and GC
boundaries, and confirms each census. Node 22.22.1 showed per-entry growth with
both the ordinary and external-boundary controls; its host lifecycle result
remains unresolved and this repair's bounded-lifetime proof does not cover it.
Caller-context, isolation and late-use semantic tests still apply there. No
universal platform instance count or elapsed-time limit is specified.

Language-neutral [restart cases](artifacts/reuse-cases.json) define concrete
inputs and expected semantic outcomes for A-02/A-04/A-05. They are fixture data,
not executable tests or a selected stored record shape.

## Acquisition retry and rate admission cases

These are normative expected outcomes for RUN-011/012/014/019, **not recorded
passing tests**. They supersede the former A-12 external-mutation scenario for
current acquisition scope. M5/EXP-8 keep their historical result; the
[decision and handoff](../plans/data-acquisition-retries.md) identifies implementation
and compatibility work. Use fake providers, controlled clocks and barriers.

| Case | Controlled input | Required assertions and limits |
| --- | --- | --- |
| A-12a — Lost acquisition response | A paid POST-like data request without safety flags or provider idempotency loses its response; finite policy permits another attempt which returns valid data | One logical acquisition/binding, distinct request attempts, second request may run and supply the result; first usage remains unknown even when second usage is known. Do not require resolve/abandon or infer that either call was free. This does not qualify business-write replay |
| A-12b — Exhaustion and rejection | Required acquisition A exhausts; admitted sibling B has completed request 1 of a two-request body; operator rejects further retries for A | No further request beyond authority; exhaustion/failure diagnostics and incomplete required coverage visible; strict success cannot omit the input, tolerant status is not complete success. Rejection invokes whole-analysis soft stop: no new admission or retry, but B may issue its remaining first-attempt request under permits/rate/fence and publish. Hard stop/deadline escalation before that request prevents it and partial publication. Preserve completed results and usage; concrete controls below |
| A-12c — Run versus continuation | Exhaust a configured allowance; continue the same run through another pass or recovered bookkeeping; then explicitly start a new run after a repair | Continuation sends nothing beyond the existing allowance. New run starts fresh configured allowance without extra permission solely for historical exhaustion; prior attempts/costs/gaps remain inspectable, completed eligible children retain exact references. Known not-before times still apply. Inspecting/recovering a named result does not create an execution run or refill a counter |
| A-12d — Shared source classification | Matching custom policy returns each of immediate retry, delayed retry with duration, stop; a separate call has no matching custom policy; prior-attempt information drives a calculated delay | Custom match wins, no-match uses built-in defaults, no fourth callback outcome. Immediate retry still obeys allowance/stop/rate; delayed retry cannot dispatch early; stop permits no retry by that decision. Context-sensitive 404 is not universally retried or treated as permanent; genuine unchanged authentication/authorization failures cannot automatically retry. A provider-specific 403 rate signal is classified from context rather than treated as authentication failure merely by status. The callback does not grant allowance; history/API and concrete defaults must be specified by implementation |
| A-12e — Shared static rate bound | Concurrent paths/runs and retries use the same configured connection+limit; another limit is independent; clock is held at a boundary | Combined pre-send units obey the configured, documented window/burst rule; separate counters per caller cannot overspend it. Retry allowance reset cannot reset another caller's limiter. Denied allowance, future not-before and hard stop/deadline escalation prevent affected sends even with rate capacity. Soft stop blocks new admissions/retries but retains A-12b's admitted-step first-attempt drain under the same rate bound. No cross-process or provider-remaining-capacity claim; units are configured, not inferred billed quota |
| A-12f — Durability and stop | Kill after intent/before send, after remote processing/before response, and before publication; lose writer lease; exercise soft drain and hard stop while waiting | No send without required durable intent, no stale-fence write/publication or partial result. Soft stop prohibits new admissions/retries but preserves A-12b's drain; hard stop/deadline escalation prohibits further affected sends, including a queued permit/rate wait. Recovered in-flight attempts remain unknown until actual evidence; retry uses applicable run allowance. A tainted author's catch/return cannot publish success. Distinct actual usage reports count once each, duplicate deliveries once, missing reports unknown |
| A-12g — Legacy compatibility | Reopen representative version-1 pending/deferred/unknown/failed/resolved/abandoned records and existing alpha callers | Apply the documented compatibility choice without corrupting journal/block state, erasing audit/usage evidence, manufacturing data from a success assertion, or silently resetting a continuing run. Record old-to-new identity/tally treatment and generated API/type expectations before implementation; this case selects no migration or deprecation scheme |
| A-12h — Optional proactive pacing | Omit rate configuration for a source, then compare a user-configured lower limit; controlled provider emits a contextual rate signal and later permits work | Unconfigured successful acquisition uses normal permits/execution controls without a synthetic proactive cap, delay or configuration error. Provider rate signals (429 or a service-specific 403 rate response) apply matching custom policy or built-in defaults, finite allowance and known not-before; no premature retry, unlimited retries or revival after stop. A genuine authorization 403 still does not retry. A configured lower limit paces shared callers before a provider signal, without inferring capacity, a reserve percentage or dynamic quota. Omitted configuration does not bypass an existing not-before time |

**A-12b concrete drain controls.** B is already admitted and untainted, has finished
its first request, and still needs the first attempt of its second request. When
required input A's further retries are rejected, soft stop must allow that second
request once its permit, configured rate bound, durable intent and current fence
permit it. B can finish and publish under the existing commit boundary; no new
member C is admitted, no retry for A or B starts, and A supplies no result. In a
separate control, escalate to hard stop (directly or by the operator's deadline)
before B's second request: it must not send, and B cannot publish its incomplete
body. A stale fence likewise never gains publication authority from soft drain.
No default deadline, request-granularity drain or new cancellation policy is added.

Manual result injection, its validator/staging and idempotent submission are not
required controls here. Within-run approval batching/grant allocation is proposed,
not a prerequisite for A-12c. General schema validation of actual acquired results,
read-only inspection privacy and existing publication/Accounting gates remain.

## Weekly roster workflow

**TEST-3 — Product acceptance.** The end-to-end scenario starts with an organization,
fetches an HR roster, selects an author-defined trial population or full population,
discovers each person's PR references using fresh pagination, hydrates evidence,
assesses each PR and builds one person summary from the person's complete corpus.
Membership closes independently per person; one waiting person cannot block an
unrelated person's completed summary. Observation can show progress throughout.

```text
organization + environment + tracked time window/configuration
  -> current HR roster policy -> parse/validate -> population selection
  -> person fanout (stable employee key)
       -> fresh PR discovery (provider pages are traversal, not durable identity)
       -> PR fanout (stable PR identity)
            -> current source acceptance/hydration
            -> memoized assessment
       -> declared corpus completion + stable ordered compact assessments
       -> memoized person summary
  -> report and supervision
```

**Application fixture policies (not universal framework rules):** CSV parsing
supports quoted fields; malformed/duplicate employee IDs are errors. Use explicit
employee IDs for trial selection and PR creation time in `[start, end)`. Validate
model output against the chosen assessment schema. Use a deterministic sort by PR
identity before person summary. A closed, successful zero-PR corpus can yield a
no-contributions result without model work. Failed/open discovery cannot. The HR
source must have an explicit refresh/acceptance policy; do not infer finality from
an old roster. Provider validator coverage is an adapter obligation.

The exact memo constructor, previous-result handle, collection/fold signatures
and selection hooks are not frozen by this conceptual sequence. Old executable
roster callback examples remain historical API exploration, not the new runtime.

**TEST-4 — Mandatory run variants.**

1. Cold run: selected members reach all required stages; excluded members perform
   no expensive work. The selected scope is visible in output.
2. Fresh process, unchanged data: current source hooks run as required; eligible
   expensive results retain exact references.
3. Changed page boundaries/new PR: restart discovery from its current source;
   keyed old PR work survives cursor/ordinal changes; relevant person corpus changes.
4. Only unread labels change: assessment retained. Consumed diff/review/prompt/model
   or tracked helper implementation changes: affected work reevaluates.
5. Child refresh emits equal assessment: parent summary retained if that is all it
   consumed; provenance and current acceptance remain distinguishable.
6. One source fails, another waits for quota: complete people finish; strict
   summaries never treat missing evidence as an empty successful corpus. Explicit
   outcome-based partial reports label coverage and failures.
7. Trial widens: still-valid independent member work can reuse only within the
   allowed environment/store policy; aggregate membership changes. Trial results
   cannot satisfy a production scope by accident or contaminate its storage.
8. Cancel or crash: completed results remain readable; incomplete bodies yield no
   reusable partial result; unknown usage stays unknown. Resume through whole-step
   reevaluation/reuse rather than a claimed restored JavaScript continuation.
9. Inspect during/after execution: CLI status and explanation reveal outcomes,
   references, waits, history and resource observations without starting work.
10. Lose an acquisition response, exhaust its finite run allowance, and reject more
    retries for required input: no fabricated summary, whole-analysis graceful
    stop, preserved completed results/unknown usage, then a new run with fresh
    allowance and ordinary reuse. Manual supplied-result recovery is not a roster
    prerequisite; apply A-12a–h rather than the historical effect-settlement story.

## Large-data and alternate-cost acceptance

**TEST-5 — Scale measurement.** Retain a 150,000-subject synthetic workload as a
measurement target, not a latency promise. Measure peak memory, selected payload
loads, fingerprint CPU/I/O, storage contention and in-flight work. Ten consumers
reading different narrow fields must not require ten full corpus materializations.
Test an enrichment chain with only three changed member projections and assert
only those memoized members execute. Measure before adopting distributed workers,
work stealing, or adaptive storage/concurrency managers.

**TEST-6 — Cost neutrality and reactive consumers.** Include a CPU-expensive memoized
step, cheap leaves with an expensive aggregate, and a mutable in-process filter over
retained results. The filter can update local derived views without rewriting
stored snapshots. New processes use fresh reactive tags over the same retained
results. Storage-backed cached outputs reenter observation normally.

## Checking the specification itself

**TEST-7 — Consolidation gate.** Check every relative link, unique defining
requirement ID, machine-readable artifact syntax, decision-table coverage, and
supersession mapping. Review at least the identity/name, automatic implementation
tracking, no-stored-finality, exact-reference, alpha-sibling, fixed-topology and
no-paid-validation-replay invariants across documents. Acquisition retry is
separate from evaluating paid author work merely to inspect or validate a cache. No active document should direct an
agent to follow an archived API/schema. Leave baseline fixtures explicitly labeled.

Closing this gate means the specification is ready to guide M0.5, not that M0.5 has
passed. Log its evidence in [consolidation validation](validation.md).

**TEST-8 — Foundation gate.** From a clean checkout, run the named typecheck,
type-aware lint, test, declaration-generation/API Extractor, import-boundary,
and build commands in the same order used by CI. Record exact commands, versions,
and outcomes. Negative fixtures must prove that each check detects its intended
violation: a type error, type-aware lint failure, wrong release tag, absent
producer declaration, forbidden sibling source import, and direct Node access
outside the Node Machine implementation. Positive fixtures prove the own
untrimmed, sibling alpha, public default, and beta opt-in consumers work through
their intended resolution paths. Run Machine capability conformance tests on
the Node implementation for every capability present. If a capability has a
failure/unsupported mode, verify that outcome explicitly. Record any known
baseline violation as a failure; do not label the gate complete until repaired.
This evidence precedes runtime experiments and remains independent of the
retired EXP-5 CML result (see PKG-006).
