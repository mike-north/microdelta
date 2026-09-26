> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Analysis CLI, fan-out, and incomplete results

**Status:** requirements capture and design exploration, 2026-09-13. The CLI
experience is a new user requirement. The policies, syntax, event model, and
package placement below are proposals, not selected or implemented APIs.

**2026-09-15 update:** the user has now selected continuing independent siblings
after isolated member failures as the default. The original candidate discussion
below is historical where it calls this default unconfirmed. Preview envelope,
freshness, throttle, and retained-value error behavior are also now recorded in
[decisions](../decisions.md). Retry and partial-fold policies remain undecided.

**Later 2026-09-15 update:** explicit folds over all settled outcomes or selected
successes are now required, including aggregate updates after failed members are
repaired. Retry support is also required, with rate limits as the motivating case;
precise retry policy/defaults and APIs remain undecided. The initial exploration
below must be read with those decisions, not as a renewed question about whether
these capabilities are supported at all.

Retries must also be represented in tracing, as explicitly required by the user:
logical operation, individual attempts, retry reasons, scheduled waits/reset
times, and final outcomes must be correlated with the step/member. Request
attempts and full step retries are distinct, and costs must not be duplicated
when rolled up. See the retry-tracing entry in [decisions](../decisions.md).

Cancellation support is required, with first-Ctrl+C soft stopping and a second
interrupt escalating toward forceful shutdown. Exact stop boundaries remain
open. See [cancellation and billing](cancellation-and-billing.md)
for provider research and the proposed distinction between finishing active
memoized steps and promptly cancelling avoidable work after discovering a flawed
prompt. Partial requests are not durable step results; local abort and confirmed
remote cancellation must be distinguished.

## Confirmed requirement

**Latest trial-mode decision:** provide first-class author-defined trial mode,
with reusable trial-only filters and limits encoded in the program. Authors
define their subsets; automatic subset optimization and semantic coverage
inference are not required. Protect full-analysis data during iteration; a
separate trial storage environment is the recommended default, pending final
storage semantics. Earlier references below to reuse when expanding scope do
not authorize automatic trial-to-production cache sharing. See the corresponding
entry in [decisions](../decisions.md).

**2026-09-15 scoped-execution priority:** the user validates analyses by selecting
one team, executing the real pipeline end to end, inspecting quality and actual
cost, then widening fan-out. This is a primary workflow for making mistakes cheap
to correct. See [decisions](../decisions.md) for the requirement and proposed
scope, reuse, membership, and reporting checks. Lower concurrency alone does not
provide this workload restriction. Dry-run permissions remain unselected.

The user also selected an execution-plan view, analogous to database query
planning, to pair with that scoped execution. Show declared stages, dependencies,
filters, fan-out boundaries, and known versus unknown instantiated work; explain
reuse only to the degree it has been validated. Plan inspection and actual
limited execution are complementary capabilities. Exact syntax and permitted
planning-time discovery remain open.

The subset can itself be assisted by planning: the user wants low-cost exposure
to meaningful analysis cases, such as ensuring a staff engineer is present for
leadership analysis. Explore recommendations using plan structure, input metadata,
and declared coverage goals. Empty-but-valid execution does not establish useful
trial coverage; show remaining gaps and uncertainty. Exact semantic inference
from arbitrary step code and guaranteed minimum-cost selection are not promised.

Running an analysis should provide an excellent CLI experience: visible progress,
confidence that caching behaves as expected, and first-class presentation of
fan-out. The user also wants aggregate accounting affordances, such as token
counts and dollars spent. Fan-out failure and the dependent fold must be designed
together with the authoring surface, rather than left to incidental exceptions.

This adds product scope beyond the original core-only handoff. It does not select
a terminal library or put concurrency, provider retries, or rendering into core.
Core must expose enough execution evidence for an observer; helpers can describe
groups and apply author-chosen policies; the CLI can present both.

## A terminal experience to design toward

Illustrative snapshot, not actual execution or a selected command:

```text
Assess pull requests                           RUNNING   00:42
├─ Load pull requests                          served from cache
├─ Assess PRs · fan-out                        983 / 1,000 settled
│  920 cached · 60 executed · 3 failed · 12 running · 5 queued
│  ├─ PR #412  executed · title changed
│  ├─ PR #538  failed · provider timeout · attempt 1
│  └─ PR #611  running · reviewing chunk 4 / 9
└─ Summarize                                   waiting for complete assessments

This run: $1.84 reported · 126,400 tokens reported · usage incomplete
3 failures · 12 active requests · inspect a member for cache evidence
```

The counts partition the 1,000 members: 920 + 60 + 3 are settled, with 12 running
and 5 queued. “Settled” means finished with an outcome, not successful. If the
source is still being enumerated, show “983 settled · 1,000 discovered · total
unknown,” rather than a false percentage. Nested fan-outs get expandable group
rows, bounded samples, and aggregate counts rather than one terminal line per
record. A member can contain a subtree of steps; its success is not synonymous
with one provider call or one cache hit.

Proposed cache evidence vocabulary:

- **Verifying:** comparing recorded dependencies; not yet a cache hit.
- **Served:** recorded reads match; no body execution for this invocation.
- **Executing:** no stored result, changed read, revision change, or other concrete
  reason. Show the available reason and address without loading full values.
- **Waiting:** another claimant owns the work; do not count this as local execution.
- **Failed / refused / cancelled / not started:** distinct outcomes, with counts
  and a path to the relevant member. Cancellation is not a successful value.

For example, inspection could say: “PR #412 / assess: body changed; rubric.prompt
unchanged. Downstream headline fingerprint unchanged; summary served.” This is
verification evidence, not a prediction that equal outputs will occur. A compact
first-run/unchanged-run/one-field-change demonstration should make the cache
contract understandable without learning the storage schema.

TTY rendering should retain a concise final report. Redirected output should use
readable append-only messages or an explicit machine-readable event mode, with no
cursor controls. Keep result output and diagnostics on separate streams. The
precise commands, key bindings, default verbosity, and exit codes remain open.

## Two independent failure choices

| Choice | Candidate policies | Meaning |
| --- | --- | --- |
| Sibling execution after failure | Finish independent members; stop scheduling new members | Controls how much additional work is attempted. Already running work still needs an explicit drain/cancellation policy. |
| Input accepted by the fold | Complete successes; explicit settled outcomes; author-defined minimum coverage | Controls what the result means. Finishing siblings does not authorize a partial fold. |

**Recommended baseline:** require complete successful input for an ordinary fold.
For independent analyses, finishing siblings with bounded concurrency is a useful
candidate default; stopping new work is a useful alternative when failures suggest
a shared problem or further spend has little value. Neither sibling default is
confirmed. Infrastructure failures that prevent trustworthy publication/accounting
must not be disguised as ordinary per-item failures and allowed to continue blindly.

A strict group with any failed/refused/cancelled/unstarted member cannot supply a
complete collection. The fold does not execute, and its previously stored result
is not relabeled as the current result. Successful **memoized** members retain
their independently committed results. Unmemoized steps keep their normal behavior;
group membership does not grant durability. A failed strict group is not an atomic
rollback of successful members or provider charges.

If a downstream step was already started on an incomplete stream, it is a streaming
or incremental consumer with its own contract, not this strict barrier. The design
must not silently switch between the two meanings.

## Authoring exercises

These snippets deliberately hold field loading undecided. Names and signatures
are pseudocode candidates; they are not typechecked or package exports.

### A. Ordinary complete collection

```ts
// fanOut owns bounded scheduling; assess supplies each member's computation.
const assessments = await fanOut(prs, assess, {
  label: "Assess PRs",
  concurrency: 12,
});

// Receives a complete collection or is never called.
return summarize(assessments);
```

This is the approachable baseline: an ordinary data pipeline, plus a labeled group
for progress. Rejection carries a group report with failed member identities,
success counts, and unfinished counts. A label is presentation metadata, not a new
durable identity input. The existing member-step/source-collection identity rule
still governs the fan-out result.

Here `concurrency` sketches a bounded live-member window. Resource permits are
separate: rev 9 §6.2 guards actual fetches, and claim waiters hold no fetch permit.
Nested groups must not deadlock by holding every parent permit while awaiting
children that need those same permits. API naming for these two bounds remains
open; the single option in these short snippets does not settle resource policy.

### B. An explicitly partial report

```ts
const batch = await fanOut.settled(prs, assess, {
  label: "Assess PRs",
  concurrency: 12,
});

// The fold sees typed outcomes and coverage, never an accidentally shortened list.
return summarizeAvailable(batch);
```

The candidate batch is a lazy/addressable collection, not necessarily an eagerly
allocated array of all results. Each outcome carries its member identity and a
discriminant, such as `success`, `failed`, `refused`, `cancelled`, or `notStarted`.
Successful outcomes contain result handles; failures contain structured error
details. Coverage reports expected/discovered members, whether enumeration is
complete, successful count, and counts by missing-outcome category. Duplicate
source occurrences need separate occurrence addresses without changing durable
member identity; this is an unresolved collection-address detail.

`summarizeAvailable` deliberately handles the incomplete cases. A useful output
could be “997 of 1,000 PRs analyzed; three unavailable,” including the missing
identities in a machine-readable result. Dropping failures through `.filter()`
without carrying coverage into the result is a dangerous default for analysis.

An application may accept this partial result as successful, but the terminal must
still label it partial. Default exit behavior should make incompleteness visible
to automation; an explicit application policy can opt into partial success.

### C. A domain threshold

```ts
const batch = await fanOut.settled(prs, assess, { concurrency: 12 });
requireCoverage(batch, { fraction: 0.99, requiredMembers: criticalPRs });
return summarizeAvailable(batch);
```

Here the author selects the analysis policy. The library should not invent “99%
is enough.” An unknown final denominator cannot satisfy a percentage threshold.
A threshold that passes still produces a partial result when members are missing.
The acceptance policy and the fold's reads must participate in normal change
verification; changing a threshold cannot silently reuse an incompatible report.

### D. Stop further scheduling

```ts
const assessments = await fanOut(prs, assess, {
  concurrency: 12,
  onFailure: "stop-scheduling",
});
return summarize(assessments);
```

After an observed failure, enqueue no new members. Await the already running
members' settlement, report their outcomes, and then reject the strict group.
This makes lifecycle ownership explicit and avoids returning while sibling work
quietly continues spending. Providers still need author-supplied timeouts. A
separate cooperative-cancellation option can request aborts, but cannot promise
to reverse a bill or prove that remote work stopped. A later forced process exit
leaves claim expiry as the recovery backstop, with potentially unknown charges.

Scope cancellation to work this caller owns. Detaching a CLI observer or one
consumer must not abort a shared field load or somebody else's claimed execution.
Core draft MT-6 already specifies non-cancelling shared loads; the viewer sketch
§5 similarly detaches listeners without stopping shared server work. CLI Ctrl-C
semantics need their own decision, consistent with those ownership boundaries.

“Fail fast” alone is too ambiguous: quick notification, stopped scheduling,
cancelled active work, and early return are four different behaviors. The CLI
can report the failure immediately while the group drains active members.

## Repair, caching, and the fold's dependencies

Retry belongs to an explicitly chosen helper/application policy, not core. Rerun
the same analysis after repairing the cause: successful memoized members can be
served if their recorded reads still verify, and failed or invalid members can be
attempted. This is conditional cache reuse, not a promise that only previously
failed members execute despite changes to inputs, revisions, or dependencies.

A retry of a timed-out paid call may incur another charge. An abandoned attempt
is bookkeeping; it does not tell us that the provider did no work. Automatic
retry limits, backoff, classification, and provider idempotency belong to the
author's policy. UI “retry failed” must describe which current identities it will
attempt and then rebuild the group's coverage from current verified results.

Every retry re-enters normal verification, gates, and claim acquisition; it must
not overlap another still-held execution or bypass a refusal. A retry policy is
not permission to discard prior attempt costs.

For a partial fold, **membership and outcome availability are dependencies** in
addition to successful fields actually consumed. Suppose 997 successes produce a
partial summary. When three failures become successes, the fold must reconsider
the collection; it cannot hit cache solely because the original 997 values match.
Conversely, an unread successful field changing must not force a fold that consumed
only headlines, provided membership and coverage stayed unchanged.

Do not turn a caught exception into a permanently memoized successful member value
as the default settled implementation. Preserve the member's failed execution;
construct the outcome collection at the helper boundary. If an author explicitly
models a domain failure as a durable value, that is a separate application decision.
Observable error detail that a fold reads needs defined fingerprint semantics;
volatile stacks/attempt timestamps should not silently become whole-collection
dependencies. The precise outcome collection schema and verification addresses
remain open alongside the existing trace/collection findings.

## Accounting that earns trust

**2026-09-15 clarification:** the accounting facility is resource-agnostic.
Named quantities associated with execution roll up to the analysis job; money is
one instance alongside tokens, API quota consumption, and metered data volume.
The cost-specific presentation below illustrates this broader mechanism rather
than restricting it. Preserve units and resource scopes, distinguish cumulative
snapshots from increments, and do not sum remaining-quota/reset observations as
if they were consumption. See [decisions](../decisions.md) for the selected
direction and remaining reporting/durability questions.

**Observed-data boundary:** accounting aggregates evidence available to the run,
not a reconstructed provider bill. Preserve usage actually received from failed
or cancelled work, but do not require discovery of unreported charges through
third-party billing APIs. Label totals as observed/reported consumption and known
reporting gaps as such. Missing observations are neither numeric estimates nor
proof of zero consumption; they do not block useful aggregation.

Observed counts and currency estimates are also distinct. The user's
[missing cached-token breakdown scenario](../scenarios/observed-usage-and-estimated-cost.md)
shows how accurate token observations can yield a substantially incorrect cost
estimate when billing inputs are missing. Keep estimates and their assumptions
separate from observed monetary amounts.

Proposed accounting dimensions should remain separate:

| Display | Meaning |
| --- | --- |
| This run's reported cost | Unique executing attempts' reported deltas, including failed/abandoned attempts; cache hits add zero new execution cost. |
| Historical recorded cost | The reported cost of stored results inspected or served; useful context, not this run's bill. |
| Estimated future cost | Explicitly labeled estimate with its basis; not guaranteed spend or claimed realized savings. |
| Coverage of usage reports | Which finished/active attempts lack complete usage; unknown never means zero. |

Keep units and currencies explicit. Input/output/cached tokens can be distinct
provider-reported metrics. Dollars may be reported or calculated from a recorded
pricing basis; do not silently price every provider with one rate. Cumulative
provider updates must be normalized so they are not repeatedly added as deltas.

Attribution uses an execution-attempt identity plus stable usage-event identifiers
or sequence numbers. A root total adds exclusive attempt costs once. Parent group
inclusive totals are views, not additional charges to add to the root. Replayed
events, nested groups, retries, and multiple consumers of one claimed execution
must not double count. Work owned by another run is shown separately from spend
attributed to this run. A terminal disconnect does not erase already recorded
attempt costs; unreported usage remains unknown.

Exact live totals across crashes are not guaranteed by the current draft, which
accumulates body reports and records generation cost on finalization/abandonment.
Durable incremental usage reporting would require an explicit contract extension.
The CLI must distinguish live observed totals from durably recorded totals until
that choice is made. Reporting telemetry is never grounds to retry paid work.

## Observable structure without changing computation

Proposed observer data includes run/invocation/group/attempt IDs, parent links,
member identity and occurrence, lifecycle transitions, concrete verification
reasons, author-reported progress, and metric updates. Durable result identity
remains separate from a particular invocation or display label. Ordinary steps
still work outside a fan-out helper; only the helper supplies group topology and
scheduling policy. Collection events should come from the helper, not inference
from coincident asynchronous calls.

Observers do not change result fingerprints or control paid execution. A renderer
failure must not make a successfully committed result look failed and trigger a
rerun. Core lifecycle correctness cannot depend on a terminal being attached.
Bounded event buffering, coalesced refreshes, aggregate counters, and paged detail
are needed at 150,000 members; an unbounded per-event in-memory log is unsuitable.
If event detail is dropped, make that observable and reconcile counts from a
snapshot rather than claiming exact counts from an incomplete stream.

Terminal refresh timers may update elapsed-time displays; they must never call
`progress()` to renew leases. Lease extension continues to require actual changed
body progress. Unknown progress is “running; last report 2m ago,” not an invented
completion percentage or a definitive diagnosis that the provider hung.

## Validation scenarios to write before implementation

1. Cold run, identical rerun, then one consumed field changes: assert actual body
   call counts and matching CLI reasons; ensure explanation does not load values.
2. One member fails among 100: strict fold is never invoked; committed successful
   memoized members remain usable; failure and incomplete coverage are visible.
3. Rerun after repair: valid members are served, failed members execute, strict
   fold receives all 100; changed dependencies can legitimately add executions.
4. Partial fold at 99/100 followed by repair: coverage changes trigger verification
   and recomputation as appropriate; a changed unread field alone does not.
5. Stop-scheduling with concurrency four: no new members start after observed
   failure; all active tasks are owned until settlement; no unhandled rejection.
   Nested fan-outs make progress without holding fetch permits while waiting
   for claims or creating a parent/child permit deadlock.
6. Cancellation/timeout: no false successful values or rollback claim, reported
   failed-attempt cost retained, unknown remote charges labeled unknown.
7. Nested fan-outs and repeated consumers: members and attempts counted at their
   respective grains; usage updates/replayed events do not inflate root totals.
8. Growing/failed source enumeration: no invented total or passing percentage
   threshold; strict fold remains blocked; discovery errors appear in coverage.
9. Slow/broken renderer and redirected output: computation unchanged, bounded
   buffering, clean result stream, durable completed outcomes still discoverable.
10. Scale fixture with 150,000 members: bounded concurrency, live handles and
    display state; rendered member samples do not force whole-payload loading.

These are future acceptance cases, not passing test claims. No runtime or CLI
implementation is added by this document.

## Source constraints and remaining decisions

- Rev 9 §2.5: member-grain fan-out, collection-grain fold, bounded identity path;
  an expensive whole-collection fold reruns as one step. Decompose to obtain
  partial re-evaluation; error handling does not add automatic incremental reduce.
- Rev 9 §4–5 and §6.1–6.2: helpers own fan-out/fan-in policy and eventual worker
  seam; live-subtree windows and fetch permits are distinct bounds.
- Rev 9 §6.5–6.6: honest progress, prompt claim release, abandoned cost retained,
  and no core retry/reconciliation. See core draft RP-4, CL-3, WR-6, FH-1/FH-2.
- Rev 9 §8 and core draft EX-1–EX-3: existing explanation/tracing/cost foundations;
  they do not yet specify this live group experience or exact live accounting.
- The informative viewer sketch §2 illustrates a complete reduce barrier; §7–8
  discuss partial presentation and leave tolerance declarations unresolved. This
  supports the strict-default recommendation but does not settle helper policy.

Source copies: [rev 9](../source/incremental-analysis-deep-design-rev9.md),
[core draft](../source/core-package-spec.md), and
[viewer sketch](../source/analysis-explorer-viewer-sketch.md).

Next authoring decisions: sibling policy default; explicit partial-fold shape;
whether cancellation belongs in the first version; outcome/coverage verification;
live versus durable usage reporting; and packaging of helpers/CLI. Keep these
separate from field-loading syntax while exercising them in the same analysis.
