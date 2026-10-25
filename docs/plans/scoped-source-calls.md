# Scoped current detail calls for completed contribution searches

**Standing: Proposal for #252; no representation accepted or runtime delivery claimed.**
This gap-fill supports the first usable contribution report under #170/#240 and
its owner-selected 24-hour target. That target is not an implementation estimate.
Independent adversarial review and supervisory selection precede implementation.

## Purpose and governing boundaries

A person summary needs a completed PR search, then current detail for each selected
PR, then assessments, before a strict summary can be accepted. An unchanged PR ID
is identity evidence, not evidence that its merged state or review content remains
current. Search returns a completed count and stable IDs; it does not read detail
fields to manufacture a change token. Search completion certifies the population
for this evaluation under the adapter's actual pagination contract, not an atomic
remote snapshot or permanent closure of that query.

[Domain](../spec/domain.md) and [architecture](../spec/architecture.md) retain their
six owners. [CMP-1–7](../spec/composition.md) govern frozen possible edges,
structural correspondence and argument reconstruction. [RES-001–007 and
REUSE-001–005](../spec/execution.md) govern identity, exact references, current
source acceptance and consumed-output retention. [RUN-003–005 and
RUN-009–010](../spec/operations.md) govern local readiness, failure and stop.
The completed-search first-delivery shape does not replace the more general
streaming target in RUN-005. Page streaming, advanced fairness, broad inspection,
new hosts and full M7 completion remain outside this cut. Acquisition keeps the
[accepted simple retry/rate direction](data-acquisition-retries.md).

## Observed gap and alternatives

The #250 controlled probe at `c3cb66ecadd717e049619920157ceaaca98e6b04`
reproduced stale Ada output: changing PR 101's merged status and advancing the
observation revision with identical search IDs ran no detail, assessment or summary
body. Cold execution, fresh-process unchanged restart and removal cases passed;
those successes do not prove currentness. This is diagnostic evidence, not accepted
runtime delivery. No provider validator was demonstrated.

Current generated declarations expose these distinct capabilities:

| Candidate | Concrete limit against this consumer |
| --- | --- |
| Existing `stepSlot`/`suppliedStep` | Dynamic arguments and structural restart correspondence, but memo semantics; no source previous/finality/outcome contract. An observation revision on search cannot make the child detail memo current. |
| Existing person `member.source` | Current source policy at a person binding; no separately addressed dynamic PR calls beneath it. Fetching all detail here loses independent per-PR acceptance and retention. |
| Flat root PR template | Current sources per PR, but its strict fold covers all members. A person memo cannot select another template's PR bindings by key; `IChildDeclaration` does not admit a fold. A global fold supplies neither independent person exact references nor failure/closure boundaries. |
| Nested PR collection/template | Expresses per-person PR sets and strict folds, but requires nested membership, descriptors, discovery and fold lifecycle. Prefer only if this consumer cannot be expressed soundly with the smaller call boundary. |
| Grouped result mechanism | A global grouping callback with plain arrays merely moves manual orchestration outside tracked edges. A sound mechanism must expose independent group dependencies, completion, references and failures; that is additional composition machinery, not a free equivalent. |

**Preferred proposal:** introduce a distinct source-capable callable slot and
supplied source declaration. Preserve supplied memo steps unchanged. Reuse the
existing person template and its summary memo; declare a possible detail-call edge
once, instantiate dynamic calls while consuming the completed search. No runtime
topology factory and no nested collection API are needed for this bounded shape.
This preference remains subject to the decisions below and adversarial review.

## Proposed contract

**SCD-1 — Declaration and identity.** Definition & Binding owns a source-slot
kind, its parameter/result types, composition binding and author subject function.
A person summary declares both detail-source and assessor slots before graph
freeze. A slot has exactly one current implementation, with the existing distinct
missing/ambiguous correspondence failures. A source slot cannot bind a memo step
or vice versa. Call count and order are runtime instances, not graph mutations.

The slot binding computes the complete opaque source subject from derived argument
values, using a qualified stable PR identifier such as repository URL plus number.
It computes assessment subjects separately, so source and assessment never collide.
The structural witness locates the callable; the author subject names its scoped
history. Neither observation revision, page number, array index, display label nor
source response version becomes part of stable PR identity. A person's membership
of a PR is not source freshness. Shared source subjects across people must obey the
existing scoped-subject and unique-current-binding rules; accidental incompatible
bindings are rejected rather than silently namespaced or merged.

**SCD-2 — Arguments and capabilities.** Both source `run` and `finality` receive
tracked positional argument views, current applicable source inputs, and the
eligible previous carrier (always present for finality; optional for run).
The current policy may inspect the PR identifier, previous detail and tracked
observation policy inputs. The callable returns the existing source outcome
protocol, including fresh result and explicit retention of the eligible previous
reference. It cannot expose memo return semantics as implicit source retention.
The source callable has no child declarations in this cut; remote operations use
the existing supervised acquisition boundary. Assessment remains a supplied memo.

**SCD-3 — Current resolution.** Reuse Resolution first establishes current unique
binding, subject/version/implementation eligibility and consumed argument/input
evidence. Only an eligible previous source result reaches the current finality
hook. True explicitly accepts it; false or absent finality proceeds through normal
source policy and supervised acquisition. No stored true answer, unchanged ID,
previous child reference or earlier process's acceptance can bypass current policy.
A policy input revision requests reconsideration; it is not proof of provider change
or an invented conditional-request validator. With no validator or justified
finality, a current refresh can require a full fetch.

**SCD-4 — Durable parent validation.** Persist the source-call kind, current
structural slot correspondence, author subject basis, argument recipes, call order,
exact child result and parent's consumed output facts using CMP-6/7 witnesses.
Across a fresh process, validate the summary's own implementation and consumed
person/search/input facts first. If that prefix remains valid, reconstruct calls
in recorded order from current bindings/justified derived values; resolve each
current detail source, then compare consumed detail facts before deciding assessor
and summary eligibility. A changed earlier output invalidates the parent prefix;
execute the admitted parent normally rather than replaying obsolete later calls.
Unjustified/unreconstructible arguments produce an honest parent miss; they never
justify a stale child or require paid execution disguised as validation.

Current detail acceptance and downstream output equality are different decisions.
A fresh equal fetch has a new source reference and observed work; an assessor that
consumes only equal detail fields may retain its exact old reference. That in turn
can retain the person summary's exact reference. Consuming exact source identity
instead makes that identity change relevant. New acceptance records do not rewrite
immutable historical provenance. A single resolution may share current verification
for the same invocation, but later resolutions and processes reestablish acceptance.

**SCD-5 — Search membership and strictness.** Each person's search produces one
successfully completed value `{count, ids}`; count equals the number of distinct
qualified IDs. Duplicate/missing identity rejects before detail admission. This
adapter-level result represents certified exhaustion of the requested search;
truncated, failed or pending searches cannot return a successful empty value.
Detail calls begin only after that person's successful search completion. A changed
ID set invalidates its summary's membership observation and runs the summary body
under normal admission; surviving child calls can still reuse. Removed calls cease
to be required for the new summary, without deleting historical references. Added
IDs acquire current detail before assessment. Certified empty search permits the
normal zero-PR summary. No hardcoded roster or detached untracked orchestration.

**SCD-6 — Failure, waiting and stop.** A summary requires accepted current detail
and successful assessment for every current ID. A failed, deferred, missing or
waiting required child cannot become a successful strict summary or implicit skip.
Prior output remains historical/preview data, not a successful current summary.
Do not replace failure with an empty list. Detail failure for Ada prevents Ada's
new summary but does not block Grace's search, detail, assessment or summary.
A report fold requiring both successful people still cannot succeed until both
satisfy its declared requirements; that outer requirement is not a barrier on
independent person work. Stop prevents new admission under the existing protocol,
records interrupted attempts, preserves completed child work and does not certify
unfinished search or summary. Durable waiting/resumption follows existing run and
acquisition semantics; this proposal invents no continuation serialization.

## Exact consumer example

This is proposed authoring pseudocode, **not compilable existing API**. `sourceSlot`,
`suppliedSource` and source-slot binding spellings require selection. Other names
show semantic roles rather than promise new facade overloads. The roster is a
tracked application input; two people below are a fixture, not framework policy.

```ts
// Composition once: possible edges and separate subject histories are fixed.
const detail = sourceSlot<[QualifiedPrId], PrDetail>({ slot: 'pr-detail' });
const assessor = stepSlot<[PrDetail, Prompt], Assessment>({ slot: 'assessor' });
bindSource(detail, suppliedSource({
  // False in the mutable fixture; current policy must refresh even for equal IDs.
  finality: ({ args, previous, input }) => acceptsCurrent(args, previous, input),
  run: ({ args, previous, input }) => acquireDetail(args[0], previous, input),
}), { subject: ([id]) => `detail:${id}` });
bind(assessor, assessPr, { subject: ([detail]) => `assessment:${detail.id}` });

const people = keyedRoster(input.people); // fixture: Ada and Grace
const perPerson = template(people, person => {
  const search = person.source({
    // Fully exhaust pages before returning count and IDs; no detail-field reads.
    run: context => completedSearch(context.member, context.input.window),
  });
  return person.memo({ children: [search, detail, assessor], run: async context => {
    const completed = await context.call(search);
    const assessments = [];
    for (const id of completed.ids) {
      const current = await context.call(detail, id);
      assessments.push(await context.call(assessor, current, context.input.prompt));
    }
    return summarizeStrict(context.member, completed.count, assessments);
  }});
});
const report = strictFold(perPerson); // independent person results feed this consumer
```

Fixture: Ada initially has `repo#101, repo#102`, Grace has `repo#201`; next search
returns identical IDs but 101 changes from open to merged. Ada's search observes
count 2 before detail; current detail 101 changes, its assessment and Ada summary
rerun when they consume that change. Grace retains her exact summary if her current
required evidence remains acceptable. Next evaluation removes 102 and adds 103:
Ada consumes exactly 101/103, retains eligible 101 work, acquires 103, and does not
resolve 102 merely because the previous summary called it. A later certified-empty
Ada search consumes zero details and yields the application's explicit empty summary.

## Test map and implementation cuts

These are required tests **before software**, not passing evidence. Use generated
alpha facade declarations and independent processes; instrument hooks, source
bodies, assessment/summary bodies, exact references and admission events.

| Case | Assertion and contract |
| --- | --- |
| Cold; unchanged restart | All required work completes once; restart reconnects current source hooks and retains only explicitly accepted source references and equal downstream references (SCD-1–4). |
| Same ID, changed detail | Revision changes; identical search IDs; mutable 101 refreshes beneath cached Ada; consuming assessment/summary change. Zero detail execution plus stale Ada is failure (SCD-3/4). |
| Equal refreshed detail | Finality false; full fetch yields equal payload and new source reference; equal consumed facts retain assessor and summary exact references, with refresh work recorded (SCD-4). |
| Added/removed/reordered IDs | Changed membership reruns Ada; survivors reuse; removed child is not refreshed; reordered search is interpreted according to the application's observed ordering; stable identity never follows index (SCD-1/5). |
| Unaffected person | Grace retains her exact summary while Ada changes; no global fold identity/failure or closure barrier invalidates Grace (SCD-5/6). |
| Pending/failed/empty search | No detail before completion; failed/truncated/pending is not empty; certified empty enables zero-detail summary (SCD-5). |
| Required child wait/fail/stop | Hold or fail Ada 101; no successful current Ada summary; Grace completes; strict outer report remains incomplete; stop admits no new work and restart preserves completed children (SCD-6). |
| Correspondence/arguments | Missing/ambiguous/kind-mismatched slots reject; changed argument basis cannot reuse old child; unjustified recipes cause ordinary miss; fresh-process reordered registration reconnects correct IDs (SCD-1/2/4). |
| Policy/implementation changes | Changed retrieval implementation cannot be excused by true finality; changed prompt reruns assessment despite accepted terminal detail; stored finality true never bypasses current hook (SCD-3). |

Proposed bounded sequence after acceptance:

1. Definition/Binding and generated facade: tsd negative cases for source/memo slot
   mismatch, arguments, previous and outcomes; runtime mint/bind/freeze tests, then
   declarations and intentional alpha API reports. Preserve existing supplied steps.
2. Resolution and History seam: failing source-call restart/currentness fixtures,
   then source invocation lowering and CMP-7 reconstruction. Inspect invocation
   discriminants, witness codecs, provenance and schema readers explicitly. Reuse
   existing source outcomes and publication; do not silently reinterpret memo records.
   If witness encoding changes, version it and specify old records as readable but
   unsupported for this reuse path, or select an explicit migration with tests.
   Do not silently change the operation journal or tracking semantics generation.
3. Supervision integration: failing local failure/wait/stop and strictness tests,
   then connect source dispatch to existing admission, retry/rate and accounting.
   No new scheduling or inspection framework.
4. Generated-facade two-person controlled fixture: all cases above with fresh
   processes and no paid/live calls. Then adapt the first report consumer and narrow
   CLI start/progress path in separately scoped work. Run strict compiler/lint,
   Jest/tsd, API Extractor and package boundary checks for each affected cut; no
   casts/private aliases to evade a missing public contract.

## Decisions required before implementation

- **Select the mechanism:** source-capable callable is preferred; independent review
  must challenge whether existing argument recipes can reconstruct the example
  without a nested collection. API spelling is still open.
- **Confirm shared-subject scope:** source subject is PR evidence independent of
  person membership. Confirm how the current registry admits the same compatible
  callable invocation from two person instances without conflicting bindings; if
  unsupported, specify a bounded fix or explicit author-scoped duplication. Do not
  hide person prefixes in framework identity. The two-person disjoint fixture alone
  cannot settle this shared-PR case.
- **Select compatibility encoding:** inventory actual stored witness/dispatch forms
  before choosing additive record extension, versioned rejection or migration.
  Historical exact reads and journal recovery remain protected.

Acceptance of this proposal would establish only the bounded engineering contract.
It would not establish runtime readiness, a public stable API, close #250/#170, or
complete M7. Record supervisory selection and any required revisions here before
implementation issues claim readiness.
