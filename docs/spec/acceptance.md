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
| A-11 Failure/readiness | One failed member, one pending, one successful, open discovery | Independent siblings continue; strict fold waits/fails honestly | M4/M5 |
| A-12 Retry/idempotency | Rate wait, exhaustion, lost response to mutation | Correlated attempts, correct key reuse, no unsafe blind replay | M5 |
| A-13 Cancellation | Soft then hard stop, provider unsupported, commit race | No unwanted future admissions, no partial success, honest remote state | M5/M6 |
| A-14 Accounting | Duplicate/lost acknowledgment, crash, unreported usage | Durable known observations exactly once; unknown not zero | M5 |
| A-15 Declaration boundaries | Own, sibling, public, beta, hidden-type leak, source bypass | API Extractor rollups plus real compiler positive/negative fixtures; missing declarations and forbidden source imports fail for the expected reason | M0.5 |
| A-16 Explain/CLI isolation | Observe current, old, missing, uncertain downstream data | No admitted computation/claims/writes merely by viewing | M6 |
| A-17 Materialization/scale | Large unread payload, several narrow consumers, early-stop loop | Instrumented loads/memory; fingerprint-only positive control | M2/M7 |
| A-19 Admission/middleware | Budget refusal, cached hit, throwing observer, check-only miss | Hits served, misses refused before claims, committed success preserved | M3/M5 |
| A-18 Context lifecycle | Concurrent scopes, thrown nested frame, detached callback after close | No cross-run leakage; late use fails clearly | M2/M5 |
| A-20 Machine boundary | Direct Node built-in import/global in runtime outside Node Machine; new capability used by a context; unsupported/failing host operation | Source check rejects bypass but allows tests/tooling; Node implementation passes capability conformance and injected-context fixture; History/Accounting port ownership remains intact | M0.5 and each added capability |

Language-neutral [restart cases](artifacts/reuse-cases.json) define concrete
inputs and expected semantic outcomes for A-02/A-04/A-05. They are fixture data,
not executable tests or a selected stored record shape.

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
