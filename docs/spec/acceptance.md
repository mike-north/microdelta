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
| A-12 Retry/idempotency | Rate wait, exhaustion, lost response to mutation | Correlated attempts, correct key reuse, no unsafe blind replay | M5 |
| A-13 Cancellation | Soft then hard stop, provider unsupported, commit race | No unwanted future admissions, no partial success, honest remote state | M5/M6 |
| A-14 Accounting | Duplicate/lost acknowledgment, crash, unreported usage | Durable known observations exactly once; unknown not zero | M5 |
| A-15 Declaration boundaries | Own, sibling, public, beta, hidden-type leak, source bypass | API Extractor rollups plus real compiler positive/negative fixtures; missing declarations and forbidden source imports fail for the expected reason | M0.5 |
| A-16 Explain/CLI isolation and preview | Observe current, stale, missing and recent activity; coalesced signals and execution ending | A-16a–g below; no admitted computation/claims/writes merely by viewing | M6 |
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

## Preview observation cases

These are required outcomes for RUN-006–008 and CLI-004, not recorded passing
runtime tests. The [decision plan](../plans/preview-observation.md) distinguishes
accepted semantics from query/retention/lifetime choices still to specify. Use
controlled clocks and retained evidence, without paid providers or author callbacks.

| Case | Controlled input | Required assertions and limits |
| --- | --- | --- |
| A-16a — Value and failure | Successful zero/empty/selected undefined, no result, failed refresh with and without a prior value | Availability is separate from author data. Failed refresh preserves stale prior data plus error, or absence plus error. Verified read reports failure and never accepts stale fallback. Selected/wrapped undefined does not prove bare-root undefined publication support |
| A-16b — Mixed freshness | Current member A and retained stale B; B is later successfully verified with equal data; compare mere identity rediscovery | Stale means potentially stale, not proven wrong. Successful verification clears stale without requiring changed author data; identity alone does not substitute for required verification. No third fetched-but-unverified display category is introduced; source/downstream acceptance remains separate and is never fabricated by preview |
| A-16c — Thin push and recent recovery | Prior A, refresh failure, then equal-valued successful B before a coalesced notification; late attachment reads within the supported recent-activity window | Notifications contain no success/failure information. Current read presents B; retained recent-activity read reveals failure then success independently of signal order. Coalescing/delivery cannot clear that evidence. Test the selected ordering, retention and gap contract before claiming completion; no unlimited/lossless event history or fixed cursor API is implied |
| A-16d — Independent observation and client state | Keep preview open after run completion and stop; detach/reconnect only notification channel while consumer read state survives; separately close reader | Results/recent information remain inspectable after execution ends. Closing preview ends its observation without cancelling execution. Channel detach does not require cursor/cache erasure or a durable server session. Consumer persistence is neither required nor prohibited. Specify pending-callback and escaped-lazy-view behavior before implementation; neither disposal-flush nor lazy-load failure is selected here |
| A-16e — Sustained and trailing signal | Controlled clock sustains changes across throttle intervals then quiesces, while subscription remains attached; author data may stay equal while freshness changes | Periodic thin signals allow current/recent reads without waiting for quiet; a trailing coalesced signal follows quiescence. Equal data does not hide freshness/status changes on read. Signal counts/order do not claim event replay; timer/delivery invokes no execution or claim renewal. Pending signal behavior on disposal remains a separate design choice |
| A-16f — Read-only exact projection | Repeated reads and a separate inspection process with rejecting dispatch/source/retry/claim/write ports; instrument selected payload loads | Reads never invoke forbidden ports or load analysis callbacks. Stored views keep exact references and cannot silently follow later publications; selected fields avoid unrelated large loads. Missing current evidence is not converted to successful acceptance; no synthetic activity is created to make display current |
| A-16g — Aggregate membership | Update member into a different bucket, establish removal, then leave discovery unfinished with an old member not yet rediscovered | Replacement contributes once; established removal disappears from settled aggregate. Incomplete discovery cannot claim complete population or removal from absence-so-far. Retained-member inclusion policy remains to select explicitly; neither generic incremental-query engine nor premature deletion is implied |

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
no-paid-replay invariants across documents. No active document should direct an
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
