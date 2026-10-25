# Controlled roster plan

**Standing:** proposed engineering direction for issue #170, not an accepted
requirement or delivery claim. This plan elaborates TEST-3/4 and the application
outcomes recorded in issue #170; it does not amend normative library requirements.

**Scope:** one example-owned deterministic provider adapter and a bounded bridge
from its page advances to immutable collection snapshots. The bridge uses multiple
normal consumer requests in one `workspace.run`. The full per-person nested
fanout/fold requires a separate scoped-composition prerequisite. No runtime proof
of either assembly is recorded here.

## Requirements, support, proposal, and proof

The following are **accepted requirements** owned by
[TEST-3/4](../spec/acceptance.md#weekly-roster-workflow),
[RUN-003–005](../spec/operations.md#run-003--readiness-is-scoped-to-the-consuming-calculation),
[RUN-010–015](../spec/operations.md#run-010--strict-and-outcome-folds-have-different-contracts),
[RUN-016–019](../spec/operations.md#trials-and-environment-protection),
[CMP-1–9](../spec/composition.md), [REUSE-002–005](../spec/execution.md#reuse-002--current-finality-hooks-are-authoritative), and [M7](../milestones.md#m7--full-roster-workflow-and-scale-acceptance): readiness is scoped to required consumers; a member may proceed while discovery remains open; complete folds wait for truthful closure; stable identity and current source acceptance govern reuse; abstract topology is declared before data; required retry rejection gracefully stops the whole analysis; and the full roster plus CLI and scale checks remain distinct gates.

**Inspected support** is narrower. Collection results already distinguish open
and complete membership, and one request resolves one immutable source result
before keying it. A later request can select a newer snapshot. Normal concurrent
requests share writer acquisition with separate request/pass scopes, and started
operations keep one run alive until they settle. These facts support feasibility;
existing tests use a fake resolution port or exercise lifecycle, not the proposed
page/member bridge. Current templates and folds are flat at the composition
level; there is no declared per-person nested collection/fold. These observations
are not promises of assembled behavior.

**Proposed direction for review:** one controlled example adapter; cumulative
immutable membership-and-coverage snapshots installed between serialized consumer
passes; page-advance acquisition may remain pending during a pass; and a fixed,
two-level scoped-composition capability is a separate prerequisite to the full
roster. The proposed tradeoff is application-managed snapshot passes in one run;
a native streaming source contract and multiple analysis runs are not selected.

**Unexecuted proof:** synthetic adapter negatives, held-page same-run behavior,
capacity controls, restart/reuse, cross-person nested fanout, trial/environment
behavior, crash/retry cases, CLI inspection, and M7 scale qualification remain
to be implemented and evidenced. A proposal or source inspection cannot close
those gates.

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

- PR A can be assessed when its own accepted evidence is ready, even while page
  two is pending. A strict person summary still waits for that person's closed
  corpus and accepted member outcomes.
- Person A's strict summary can complete while person B's discovery stays open,
  provided A's scope is closed and settled. A team summary requiring both waits.
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

## Same-run snapshot bridge

Declare separate page-advancement and collection-snapshot source slots before
execution. A page advance returns one validated page receipt through an admitted
source attempt; it does not claim a complete person corpus. The run coordinator
verifies that receipt and installs a new immutable cumulative snapshot containing
both membership and coverage. The collection source for a consumer pass returns
that selected snapshot immediately; it does not await the page source's pending
promise.

The bounded schedule is:

1. Start one fresh `workspace.run`; initialize one traversal coordinator per
   selected person. All provider sends use the existing supervised operation
   protocol and eventual #213/#227 acquisition contract.
2. Await and validate the first page receipt. Install snapshot S1, then start the
   next admitted page request and allow it to remain pending.
3. Resolve a consumer pass against S1. PR A's assessment publishes while the
   page-two release latch remains closed. The person's strict summary does not
   enter its body or publish while coverage is open.
4. When a page completes, queue the receipt. Do not mutate a snapshot already
   selected by a pass. Install S2 only between passes, then start the next pass.
   For the first proof, serialize consumer passes to avoid duplicate assessment
   of one PR; fanout work inside a pass still follows Supervision.
5. When one person's coverage closes and its outcomes settle, its strict summary
   may proceed independently. A team requiring another still-open person waits.
   A failed page never installs a complete snapshot.

This is one live application invocation and one `workspace.run`, with distinct
admitted page requests and multiple ordinary resolution requests. It is not one
collection-source invocation streaming multiple results. The application pins
each pass to one immutable membership-and-coverage epoch; ordinary parallel
request writers may still participate in the same run. Bound held-page tests:
the store's writer lease is not continuously renewed during one slow request.

**Required identity proof, not existing-support claim:** against the landed
acquisition contract, show that retrying page P retains P's logical operation
binding and consumes its finite same-run allowance, while advancing P to Q creates
a distinct logical acquisition. Both occur with the same frozen composition and
without putting cursor/page progress into expensive member inputs. Request overlap
alone does not prove this mapping; #213/#227 integration must establish it.
A new consumer pass or deferral pass remains in the same run and cannot replenish
allowance; only an explicitly new analysis run starts fresh allowance. Unknown
usage remains unknown.

Membership and stable PR fields form member inputs. Cursor, page ordinal,
snapshot generation and traversal progress stay in source metadata and coverage
evidence, not in assessment bindings. A new source snapshot can therefore preserve
eligible expensive references when the member's consumed evidence is unchanged.
Use ordinary source acceptance and nested validation; do not create synthetic
inputs to invalidate work whenever pagination changes.

Provision enough configured send permits and member lanes for the held-page
positive control: the pending page must not occupy the only send permit and block
PR A's assessment. Include a one-permit waiting control to demonstrate truthful
capacity behavior. Do not bypass supervised sends. A known Retry-After wait uses
Supervision deferral; it must not hold a network request permit or be simulated by
an unresolved promise. A person-local failure may be represented in explicit
coverage/error reporting and independent people may continue when Supervision
allows. Catching failure cannot clear execution taint, override stop policy, or
turn partial display into a completed strict fold. Pending acquisitions must be
tracked and settled through Supervision.

On page failure, a fresh authorized run starts discovery at the root; it does not
restore a JavaScript continuation. It rediscovers A and normal current resolution
may retain A's eligible exact result. A pass cannot reset same-run retry authority.

## Separate scoped-composition prerequisite

The full workflow needs a fixed declared employee template containing the PR
collection/template and a strict person fold. The employee population can close
while a given person's PR population remains open. The organization/team consumer
depends on declared person outcomes. Factories run once against symbolic members;
HR data instantiates only declared result scopes and never creates operations.

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

Begin evidence with two symbolic employees and two PRs, changed registration
order after restart, renamed-binding miss, independent closure, cross-person
failure/wait, and equal-child cutoff. A tiny fixed structure is enough; no generic
recursive graph API is implied. Do not dynamically build graph topology from HR
results. Do not use `run.read` plus copied values as a substitute for nested
dependency capture. Do not adopt #176's public DSL or use its experimental
surface as an established authoring contract.

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
| TEST-4.9 CLI | After #167, inspect held page, wait, failure, success and restart with rejecting dispatch ports; show status, exact references, explanations/history and resource observations without starting work. #165/#166 apply only to surfaces actually consumed. |
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

Current dependencies are separate: #213 allowance work and #220 classification
work are in flight; #214 owns recoverable exhaustion; #167 CLI remains required
for the full M7 inspection gate; #213/#220 alone do not prove exhaustion or
rejection handling. #152 manual result recovery is not a prerequisite. #165/#166
remain separate observation gates only if the application consumes those
surfaces. #176/#178 do not establish an adopted public authoring API. Do not copy
retry policy into the adapter or treat neighboring work as delivered.

The supervisory owner may turn these into bounded issues after review; this plan
does not file or claim them:

1. Example-only synthetic adapter: frozen revision manifest; range cap bisection;
   stable qualified IDs; closure and all listed pagination/duplicate/conflict
   negatives; fresh-root recovery. No core changes or real-provider guarantee.
2. Existing-API one-collection bridge: tests first; held page two in one run,
   member result before release, strict fold blocked, capacity-positive and
   one-permit controls, concurrent normal requests through the real facade,
   retry-P identity versus advance-to-Q identity, failure/new-run reuse and generation pinning. This does not
   close full #170.
3. Scoped-composition contract and contained component implementation: Definition,
   Resolution, and Supervision owner seams; two-person fixed structure, restart,
   independent closure, trial/adequacy boundaries, cross-person failure/wait, and
   equal-output cutoff. No public DSL or arbitrary recursive graph scope.
4. Roster application assembly: consume landed retry work and prove TEST-3/4
   plus CR-2/4/5 above, including #214 exhaustion behavior. #220 classification
   alone is not CR-2 evidence. Full CLI evidence waits for #167.
5. Independent adversarial review, repository checks, then the normal supervisor
   and Copilot review gates. These are later actions, not plan acceptance or merge
   authority.

TEST-5/6 scale and memory qualification remains a separate M7 gate. Measure
repeated cumulative snapshots, keying/serialization and source reads honestly;
small synthetic evidence proves no bounded-memory or O(1) claim. Real-provider
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
they do not execute the proposed page/member bridge. These paths describe inspected
support at the pinned baseline, not current acceptance or assembled proof.

No adapter, bridge, nested-composition, application, CLI, or scale execution is
claimed. The provider manifest remains hidden test-oracle data, not adapter input;
no real-provider snapshot-consistency claim is made. Proposed status and every
unexecuted proof boundary remain explicit.
