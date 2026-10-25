# Controlled roster plan

**Standing:** proposed engineering direction for issue #170, not an accepted
requirement or delivery claim. This plan elaborates TEST-3/4 and the application
outcomes recorded in issue #170; it does not amend normative library requirements.

**Scope:** a first usable controlled contribution report, targeted for delivery
within 24 hours of the owner's direction. That is a target, not a delivery claim
or permission to weaken correctness. One example-owned deterministic adapter
completes each person's paginated search and returns its count and stable PR IDs;
only then does the application fan out detail retrieval and assessment. The full
TEST-3/4 workflow and TEST-5/6 qualification remain separate, larger gates. No
runtime proof of the first delivery or full M7 assembly is recorded here.

## Requirements, support, proposal, and proof

The following are **accepted requirements** owned by
[TEST-3/4](../spec/acceptance.md#weekly-roster-workflow),
[RUN-003–005](../spec/operations.md#run-003--readiness-is-scoped-to-the-consuming-calculation),
[RUN-010–015](../spec/operations.md#run-010--strict-and-outcome-folds-have-different-contracts),
[RUN-016–019](../spec/operations.md#trials-and-environment-protection),
[CMP-1–9](../spec/composition.md), [REUSE-002–005](../spec/execution.md#reuse-002--current-finality-hooks-are-authoritative), and [M7](../milestones.md#m7--full-roster-workflow-and-scale-acceptance): readiness is scoped to required consumers; a member may proceed while discovery remains open in the full target; complete folds wait for truthful closure; stable identity and current source acceptance govern reuse; abstract topology is declared before data; required retry rejection gracefully stops the whole analysis; and the full roster plus CLI and scale checks remain distinct gates. For this first delivery, each employee's search completes before detail fanout. This sequencing choice does not amend the full RUN-003–005 requirements.

**Inspected support** is narrower. Collection results already distinguish open
and complete membership, and one request resolves one immutable source result
before keying it. A later request can select a newer snapshot. Normal concurrent
requests share writer acquisition with separate request/pass scopes, and started
operations keep one run alive until they settle. These facts support feasibility;
existing tests use a fake resolution port or exercise lifecycle, not the proposed
completed-search/detail composition. Current templates and folds are flat at the
composition level; there is no declared per-person nested collection/fold. These
observations are not promises of assembled behavior.

**Accepted first-delivery choices:** search/discovery is one completed step that
returns a count and stable PR IDs; detail retrieval starts after that step closes.
Provider pagination remains internal to search. Page-by-page downstream streaming
is not required for the first delivery. Use fixed shared limits and provider
cooldowns with cancellation and bounded retry ceilings. The advanced adaptive
policy and sophisticated discovery-order fairness recorded for future work in
#239/#238 are deferred from this delivery; this does not satisfy full A-12l or
the former full RUN-019 target.

**Proposed engineering direction:** keep the adapter and application example-owned.
The first integration requires a fixed two-level composition: completed per-person
search result to PR detail fanout to a strict person summary. The exact library
seam remains to prove and select. Do not introduce a generic paginator, dynamic
graph, page-triggered readiness bridge, or a new persistence authority.

**Decision basis and unexecuted proof:** first-delivery scope follows the owner
comments on [#167](https://github.com/mike-north/microdelta/issues/167#issuecomment-6404318056),
[#170](https://github.com/mike-north/microdelta/issues/170#issuecomment-6404529235),
and the M7 priority record
([#170](https://github.com/mike-north/microdelta/issues/170#issuecomment-6404360409));
the advanced-rate deferral is recorded in
[#239](https://github.com/mike-north/microdelta/issues/239). Synthetic adapter
negatives, completed-search/detail composition, restart/reuse, cross-person
nested fanout, trial/environment behavior, crash/retry cases, narrow CLI, and
full M7 scale qualification remain unimplemented and unevidenced. Held-page
same-run behavior is a full-target streaming question, not first-delivery proof.
A proposal or source inspection cannot close those gates.

## Meanings and consumer answers

A **discovery traversal** is a fresh attempt to establish a selected person's
current PR population. Cursor and range state is temporary traversal progress.
A **discovered member** is a PR identified by stable provider/repository-qualified
identity and validated against the selected query. A **collection snapshot** is
an immutable membership view paired with coverage evidence for one pass. A
**closed person corpus** means the adapter has evidence that the selected query
is exhausted; it does not mean only that known members finished. A **consumer
pass** resolves members against one pinned snapshot. Multiple passes can use the
same run and its retry authority. An **assessment input** is evidence that can
change expensive assessment output; traversal progress is not such an input.

This model answers the required consumer questions directly:

- The first delivery completes each person's search before starting its PR detail
  fanout. Person A's strict summary may complete while person B's search stays
  open, provided A's search and required details are closed and settled. A team
  summary requiring both waits.
- A certified closed empty corpus may produce no contributions with no model
  send. Failed, capped, or open discovery cannot be presented as empty success.
- After a failed page, an authorized new run rediscovers from the root; current
  stable identities and consumed evidence determine which completed PR work is
  reusable. Old rows and cursor positions do not establish today's membership.
- A refreshed assessment can have equal summary-consumed output. The current
  source acceptance and child provenance remain visible while ordinary nested
  validation may retain the exact parent summary reference.

See [RUN-003–005](../spec/operations.md#run-003--readiness-is-scoped-to-the-consuming-calculation), [CMP-1–9](../spec/composition.md), and [REUSE-002–005](../spec/execution.md#reuse-002--current-finality-hooks-are-authoritative) for the normative outcomes and ownership.

## Controlled adapter contract

The adapter and synthetic fixtures belong to the roster example. They own
provider-specific traversal, cap handling, continuation validation, duplicate
checks, and closure evidence. The application owns current HR parsing, explicit
trial selection, `[start,end)` creation-time scope, assessment schema and tracked
assessment inputs, deterministic ordering, and report policy. Definition &
Binding owns fixed declarations; Reuse Resolution owns current acceptance and
consumed-output validation; Run Supervision owns admission, retry, stop, and run
lifetime; History owns exact results and publication; Accounting owns reported
usage; Machine supplies host capabilities. The adapter does not own any of those
framework authorities.

The synthetic service guarantees a fixed qualifying set for a query naming
provider, account/repository, employee, interval, filters, and frozen revision.
The adapter can observe only page responses and the selected consistency metadata
exposed by that contract, such as query/revision identity, continuation or terminal
evidence, and a promised total when the provider supplies one. It has no access to
the fixture manifest or another complete-set oracle. The independent test harness
holds that manifest privately and compares it with the adapter's reported members
and coverage. An application-generated enumeration ID, unchanged cursor, total
alone, page ordinal, or quiet time is not a source-consistency guarantee. This is
a synthetic provider contract and says nothing about real GitHub's snapshot
consistency; a provider lie outside the stated guarantee is outside this claim.

Each PR uses an opaque stable provider ID qualified by provider and repository.
Employee identity comes from the validated HR ID. Time interval, range, cursor,
page number, and snapshot generation are not member identity. Equal timestamps
remain distinct PRs. Creation-time filtering uses one declared integer precision
and the half-open interval `[lo,hi)`.

For a capped interval, split only at a strictly interior midpoint into
`[lo,mid)` and `[mid,hi)`, and recurse within the same query and frozen revision.
A minimum interval that remains capped is unresolved coverage: refuse closure.
Never treat a truncated parent page as an exhausted leaf. Every uncapped leaf
must have validated query/revision identity, bounded well-formed pages, explicit
continuation and terminal evidence, and consistent expected coverage. Closure
requires every planned leaf to terminate and distinct IDs/counts to satisfy the
adapter-visible provider contract. Only the independent harness compares the
reported set and coverage against the hidden fixture manifest.

The adapter must preserve these negative distinctions:

- An empty page with a valid continuation stays open; a full page is not terminal.
  An empty terminal page closes only when the response contract certifies it.
  Certified empty root results differ from unvisited or failed queries.
- Repeated cursor, cursor cycle, nonadvancing offset, repeated page under a new
  cursor, malformed/truncated response, changed query/revision, or changed
  promised total refuses closure. An explicit author maximum is incomplete.
- Identical duplicate IDs at legitimate overlapping boundaries may coalesce.
  Conflicting data/version for one ID in a frozen traversal fails consistency;
  never choose last-write-wins. Repeating an entire page is pagination failure.
- Records may move pages on a fresh traversal. Stable PR subjects preserve
  unaffected eligible assessments; old page state does not validate the new
  traversal. Repartitioning within one frozen traversal is accepted only when
  its source contract still proves the set; otherwise restart or report incomplete.

After failed or inconsistent traversal, the next authorized discovery begins at
the root with fresh observation and volatile cursor state. It revalidates current
membership; retained results are candidates for ordinary resolution, never a union
that makes yesterday's rows today's complete population.

## Completed search and detail fanout

For each selected employee, the adapter owns a fresh paginated search. The search
step either returns a complete result containing the count and stable, qualified
PR IDs, or returns an explicit failed/incomplete outcome. No detail request starts
from an individual page. After successful search completion, the application
fans out current detail hydration and assessment by stable PR identity, then
builds a strict summary from the complete required set. The composition must not
turn a capped, failed, or still-open search into a successful empty corpus.

Provider cursors, page ordinals, and range splits are traversal state, never PR
identity or assessment input. A new traversal begins at its root. Stable PR
subjects and consumed evidence determine reuse across a fresh process and changed
page boundaries/ID sets. A fresh search that changes IDs updates membership;
old rows or cursors cannot establish today's closure. An explicitly certified
empty search may produce a no-contributions result without detail or model work.

This boundary removes the first-delivery need for page receipt publication,
page-triggered downstream admission, and held-page same-run snapshot coordination.
It does not remove truthful closure, stable identity, retry/stop/fence, usage, or
strict-fold requirements. The richer live streaming behavior remains a future
capability and must not be represented as delivered by this report.

The minimum composition proof is two employees with two PR IDs each: complete
search returns count and IDs, details fan out only after completion, and each
strict person summary sees exactly its complete accepted set. Then restart in a
fresh process with unchanged inputs and prove exact eligible reuse; change the ID
set/page boundaries and prove valid keyed work is retained while new/removed
members update the summary. A failed search followed by a fresh authorized search
may reuse work retained from an earlier successful traversal; the failed search
itself never authorizes detail fanout or counts as empty.
This is a bounded fixed composition, not a generic recursive graph API.

## Separate scoped-composition prerequisite

The full workflow needs a fixed declared employee template containing completed
PR search, PR detail fanout, and a strict person fold. The organization/team
consumer depends on declared person outcomes. Factories run once against symbolic
members; HR data instantiates only declared result scopes and never creates
operations. The first delivery does not require page-streaming readiness across
the detail fanout.

This is a **bounded two-level prerequisite**, not an assertion that current flat
composition supports nested fanout. Its design must specify:

- Definition & Binding: frozen nested structure, parent/member addressing,
  restart correspondence, and behavior for changed registration order, renamed
  binding, or missing/ambiguous scope. Structural paths use stable employee and
  PR keys, never cursor or generation. State whether PR identity is scoped to a
  person; cross-person sharing is not implied.
- Reuse Resolution: resolve each scoped population and current accepted children,
  then apply ordinary membership/status and consumed-content cutoffs to its
  strict fold. Application code cannot treat an old current reference as proof
  of acceptance.
- Run Supervision: independent scope readiness, bounded work, retry/stop and
  reporting. Open B must not consume all capacity indefinitely or block A's
  ready fold. The framework does not hardcode HR, employees, or teams.
- Keep Tracking, History, Machine, and Accounting in their accepted invariant
  roles. Do not add a store, publisher, context, or History freshness policy.
- Decide the narrow relationship to M5's composition-level outcome fold. Do not
  silently convert that existing step kind into a member or child fold.

Begin evidence with two symbolic employees and two PRs each, changed registration
order after restart, renamed-binding miss, independent closure, cross-person
failure/wait, and equal-child cutoff. A tiny fixed structure is enough; no generic
recursive graph API is implied. Do not dynamically build graph topology from HR
results. Do not use `run.read` plus copied values as a substitute for nested
dependency capture. Do not adopt #176's public DSL or use its experimental
surface as an established authoring contract. Page-triggered downstream execution
is explicitly outside first-delivery acceptance; full M7 must still map any
remaining RUN-003–005 obligations honestly.

## First-delivery acceptance outcomes

These numbered outcomes define the owner-selected first report slice. They do
not claim full TEST-3/4, full M6 inspection, or M7 completion. Runtime work must
write behavioral tests first against these outcomes and the unchanged governing
contracts.

1. **Completed search and strict summary:** for each selected employee, a fresh
   paginated search returns a truthful count and stable, qualified PR IDs before
   any detail request starts. Detail fanout covers that completed set; the strict
   summary runs only after all required details settle. Certified closed-empty
   search yields no contributions; failed, capped, repeated-cursor, or incomplete
   search cannot yield a successful empty report.
2. **Identity, change, and restart:** a fresh process with unchanged source data
   runs current source checks and reuses exact eligible assessment/summary
   references. Changed page boundaries preserve eligible work by stable PR ID;
   changed membership adds/removes the right report members; changed consumed
   evidence reexecutes only affected work. A failed traversal followed by a fresh
   authorized search may reuse results from an earlier successful traversal,
   never treat the failed traversal as complete.
3. **Nested composition and closure:** two employees each have a complete search
   returning multiple PR IDs, detail fanout, and a strict person fold. A's settled
   summary can finish while B's search is open; a team fold requiring B cannot
   complete. Prove this fixed two-level composition on the actual runtime, not a
   test-only resolver or SDK hand assembly.
4. **Provider controls:** fixed configured shared limits apply to the selected
   logical service scope; contextual provider cooldown is a floor for later sends;
   finite retry ceilings and cancellation while waiting prevent further sends.
   Exercise exhausted required acquisition and rejected further retries through
   #214's applicable soft-stop/drain boundary; no fabricated result or unapproved
   send is allowed. Preserve current stop, durable-intent, fence, possible-send,
   and unknown-usage rules. No adaptive regrouping, inferred quota, or
   cross-process coordination is part of this slice.
5. **Trial, CLI, and truthful outcomes:** explicit trial selection performs no
   expensive work for excluded people and cannot contaminate production scope.
   The executable exposes separately permissionable run-start and read-only
   progress observation. Observation cannot start/retry/cancel/claim/write or run
   author callbacks. Failure, wait, cancellation, coverage, and usage remain
   visible; no strict success or zero corpus is fabricated.
6. **Application-specific CR outcomes:** retain CR-2 provider timing/budget/auth
   negatives, CR-4 observation/cutoff/revision cases, and CR-5 independent
   settling policies in the matrix below. These remain in first-report acceptance;
   generic retry classification does not prove them.

The completed-search decision removes page publication and page-triggered detail
admission from first delivery. It does not amend full-target RUN-003–005 or claim
page-streaming behavior is implemented. Progress-only CLI observation does not
satisfy the full historical TEST-4.9 inspection requirement.

These are first-delivery sequencing boundaries only. The normative page-two
readiness requirements in RUN-005, shared-rate fairness/adaptive requirements in
RUN-019 and A-12j/l, and broad CLI-001–004 contracts remain unchanged and open
for their full target. This proposal neither replaces those contracts nor claims
their acceptance evidence.

## TEST-3/4 evidence map

The complete acceptance stays in [TEST-3/4](../spec/acceptance.md#weekly-roster-workflow).
Every application proof should record exact references, source-hook counts,
assessment and summary body counts, actual sends, coverage, and usage outcomes.
This map makes no completion claim.

| Case | Required proof in the assembled workflow |
| --- | --- |
| TEST-3 product | Quoted CSV; malformed/duplicate employee ID rejection; explicit trial IDs; exact half-open time boundaries; current HR policy; schema rejection; PR-identity order; certified closed zero corpus returns no-contributions without model work, while open/failed zero remains incomplete. |
| TEST-4.1 cold | Selected employees reach required stages; excluded employees cause zero expensive sends; selected scope is visible. |
| TEST-4.2 restart | Independent process performs current source hooks and retains exact eligible expensive references with no corresponding body sends. |
| TEST-4.3 pages/new PR | Fresh traversal with changed boundaries/ordinals retains old eligible PR work and assesses a new PR once; adapter negatives never falsely close coverage. |
| TEST-4.4 consumed changes | Unread-label-only change retains assessment; consumed diff/review/prompt/model/helper change reevaluates affected work only. |
| TEST-4.5 equal child | Refreshed child with equal summary-consumed output lets parent retain exact reference while current acceptance and provenance remain distinguishable. |
| TEST-4.6 independent people | Keep B discovery open while A closes; A executes or retains exact prior summary while team requiring both waits. Combine another person's source failure with B's quota wait and successful A; partial display marks coverage/errors and never claims strict full success. |
| TEST-4.7 trial | Widen explicit selection; reuse eligible independent members only under allowed environment/store policy; change aggregate membership; prevent accidental production reuse or trial contamination. Cross-environment reuse requires recorded promotion. Include no-staff and single-point adequacy limits from RUN-018. |
| TEST-4.8 cancel/crash | Stop/kill after A commits and B remains incomplete; completed results stay readable, incomplete body has no reusable partial result, usage stays unknown when unreported; a new run restarts discovery and reuses eligible children. |
| TEST-4.9 CLI | Full historical test: inspect execution, references, waits, history and resources without work. First-delivery CLI is narrower: separately permissioned run-start and read-only progress observation. It does not satisfy this full row; #165/#166 apply to consumed surfaces. |
| TEST-4.10 retry/unknown usage | Consume #213/#227 allowance and #220/#224 classification once delivered, plus #214 recoverable-exhaustion work. Lost response may retry within the same run; exhaustion supplies no result and preserves incomplete coverage. Exhaustion alone is distinct from rejection: rejecting further retries for required input invokes whole-analysis soft stop/drain under RUN-014, without fabricated summary or extra sends. A new run has fresh allowance and ordinary reuse. Unknown usage remains unknown. #152 is not a prerequisite. |

Do not label observational partial display as an accepted completed fold. A caught
failure cannot clear taint or make full success. Strict folds await closure and
accepted outcomes; explicit partial reporting preserves failure and coverage.

## Additional issue #170 application outcomes

TEST-3/4 do not subsume the separate provider timing and source-finality criteria
in [issue #170](https://github.com/mike-north/microdelta/issues/170). Keep CR-2,
CR-4 and CR-5 visible in the application evidence matrix; the proposed adapter
and application handoff must not be considered complete after TEST-3/4 rows alone.
These remain controlled, application-specific acceptance outcomes, not universal
retry or finality rules for the library.

| Issue criterion | Required controlled evidence |
| --- | --- |
| CR-2 provider rate backoff | Through the existing Supervision operation identity, classify a retryable 429 or selected rate-classified 403, while authentication, non-rate failure and ambiguous transport outcomes do not become rate retries. Under a fake clock normalize Retry-After seconds and HTTP dates; send no earlier than the maximum applicable provider not-before and selected local backoff (including reset evidence when the provider contract supplies it). If delay exceeds chosen delay/attempt/total-wait budgets, preserve a truthful deferred/failed outcome; never shorten the provider minimum. Prove same-operation persistence through close/reopen, lease release during the wait, cancellation preventing a later send, zero sends just before threshold and a permitted retry at threshold, plus structured timing and truthful usage gaps without raw private headers/bodies. #220 generic classification does not prove this provider-specific timing/application evidence. |
| CR-4 observation and cutoff | Same observation, source revision and cutoff may resume eligible evidence without refetch. Reusing an observation identity with a changed cutoff must reject or explicitly invalidate; it cannot relabel prior evidence. Advancing observation refreshes provisional sources. A future close/merge cannot make an item terminal at the earlier cutoff, and an item created after cutoff cannot enter historical coverage. Include equal refreshed child output with current acceptance/provenance retained and parent body/reference reuse when its consumed output is unchanged. Keep observation identity, cutoff, Tracking observation and read-only preview distinct. |
| CR-5 independent settling policies | In one controlled report, a quiet-period source and daily source can become final at different times under their own current policy. Quiet-period finality requires terminal state, complete relevant coverage and no relevant activity within its selected interval; open items, recent comments/reviews, future activity and incomplete coverage stay provisional. Daily evidence uses an explicit inclusive closed-day boundary and clips closed/provisional coverage to report bounds. Advance observation to reveal late arrivals. Revise one source's settling policy and prove its affected old finality is revoked while unrelated source evidence remains independently eligible. No global lag or elapsed quiet time substitutes for provider exhaustion. |

These rows are acceptance targets from issue #170's CR-2/4/5, not results. Their
explicit tests, source-hook counts, send times, coverage and reuse outcomes belong
in the final application assembly evidence. The current library mechanisms and
#220 do not establish these provider-specific application outcomes by themselves.

## Dependencies, exclusions, and handoff candidates

Current dependencies remain separate: #213 allowance work, #220 classification,
#214 recoverable exhaustion, and #167 CLI are not made complete by this plan.
#152 manual result recovery is not a prerequisite. #165/#166 remain observation
gates only for surfaces the application consumes. #176/#178 do not establish an
adopted public authoring API. Do not copy retry policy into the adapter or treat
neighboring work as delivered.

The supervisory owner may turn these into bounded issues after review; this plan
does not file or claim them:

1. Example-only synthetic adapter: completed search result with count and stable
   qualified IDs; range cap bisection; closure and pagination/duplicate/conflict
   negatives; fresh-root recovery. No core changes or real-provider guarantee.
2. Fixed two-level composition: tests first for completed search → detail fanout
   → strict person fold, with two people, restart, changed IDs, independent
   closure, cross-person failure/wait, trial boundaries, and equal-output cutoff.
   No page-triggered readiness bridge, public DSL, or arbitrary recursive graph.
3. Fixed shared admission/application integration: bounded configured limits,
   provider cooldown floors, finite retries and cancellation through existing
   Supervision/History/Accounting ownership. Align #238/#240 handoffs to this
   owner-selected first scope. Keep advanced async/adaptive rate regrouping and
   sophisticated discovery-order fairness in their existing issue records; do
   not implement or claim them as first-report prerequisites. This does not
   close full A-12j/l or RUN-019.
4. Roster application assembly: prove the numbered first-delivery outcomes plus
   CR-2/4/5 below. #220 generic classification alone is not CR-2 evidence.
   The first CLI requires #167's run-start/progress scope; full TEST-4.9 history
   and resource inspection remains open.
5. Independent adversarial review, repository checks, then the normal supervisor
   and Copilot review gates. These are later actions, not plan acceptance or merge
   authority.

TEST-5/6 scale and memory qualification remains a separate M7 gate. Measure
the 150,000-subject target, selected payload loads, fingerprint CPU/I/O, storage
contention and in-flight work; also prove narrow-consumer and changed-projection
outcomes. A first-slice workload sample is preliminary and does not satisfy these
criteria. Small synthetic evidence proves no bounded-memory or O(1) claim. Real-provider
consistency, paid traffic, provider credentials, manual recovery, another host,
release changes and package publication are outside this plan.

## Evidence basis and limits

The active requirements are in [SPEC-1 and the reading map](../spec/README.md),
[ARC-001/005/006/008](../spec/architecture.md), [CMP-1–9](../spec/composition.md),
[RUN-003–005 and RUN-010–019](../spec/operations.md), [REUSE-002–005](../spec/execution.md),
[TEST-3/4](../spec/acceptance.md#weekly-roster-workflow), and [M7](../milestones.md#m7--full-roster-workflow-and-scale-acceptance).
Issue-specific CR-2/4/5 outcomes are recorded in [issue #170](https://github.com/mike-north/microdelta/issues/170).

Repository support observations are pinned to baseline commit
`5353ff3112379d48edfa5f9cdcdb0bbc6a978fb2`. The relevant implementation paths
are [collection source shape](../../packages/definition/src/collection.ts),
[request-local population resolution](../../packages/resolution/src/resolution.ts),
[concurrent request/writer scopes](../../packages/supervision/src/supervision.ts),
[workspace run lifetime](../../packages/core/src/workspace.ts),
[admitted operation attempts](../../packages/supervision/src/operation-engine.ts),
[flat template declarations](../../packages/definition/src/template.ts), and
[composition-level folds](../../packages/definition/src/fold.ts). Existing
support controls include [writer-wait tests](../../packages/supervision/test/writer-wait.test.ts)
and [workspace lifetime tests](../../packages/core/test/workspace/scope.test.ts);
they do not execute the proposed completed-search/detail composition. These
paths describe inspected support at the pinned baseline, not current acceptance
or assembled proof.

No adapter, bridge, nested-composition, application, CLI, or scale execution is
claimed. The provider manifest remains hidden test-oracle data, not adapter input;
no real-provider snapshot-consistency claim is made. Proposed status and every
unexecuted proof boundary remain explicit.
