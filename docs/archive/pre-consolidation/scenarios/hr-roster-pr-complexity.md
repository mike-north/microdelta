> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# HR roster to per-PR complexity analysis

**Captured 2026-09-16.** The user selected this concrete multi-step workload for
the next scoped-context authoring exercise. This is requirements and candidate
execution design, not implemented code or a chosen pagination API.

**Concrete example:** [roster authoring exercise](../exploration/roster-example/README.md)
contains the complete compile-checked program, executable callback policies, and
tests. Its validation table separates tested application behavior from pending
runtime guarantees.

## Selected discovery and retrieval design

The user confirmed that the following ingredients address the pagination and
per-PR retrieval problem exposed by this workload:

1. Start with the organization ID, retrieve the roster, and fan out over the
   selected roster rows using each person's GitHub username.
2. Run a separate non-memoized discovery step for each person's query. Traverse
   pages and admit discovered PRs to processing as their references arrive.
3. Resolve each PR's detail result under its stable URL identity. When an eligible
   cached result exists, ask the current definition's optional finality hook,
   using that result and current analysis inputs. Never read or write a database
   finality flag. A true answer permits skipping source retrieval for this
   resolution; later resolutions consult the hook again.
4. When retrieval is needed, provide the prior cached result, if any. The author
   can perform staged checks, then return either newly retrieved data or the
   explicit reuse outcome. Record work done during the attempt even when the
   prior payload is retained; preserve that payload's original provenance.
5. Run or reuse the per-PR complexity assessment according to its consumed
   evidence, prompt, and other dependencies. Source reuse does not suppress
   changes to those separate analysis inputs.
6. Once this person's discovery closes and required PR assessments complete,
   fold them into one contribution summary for that roster row. Different people
   can progress independently.

This is the selected behavioral design, not a claim of implemented pagination
or runtime support. The next concrete authoring example should demonstrate a cold
run, rediscovery with a newly added PR, zero source calls when the finality hook
accepts an existing PR, cheap validation followed by explicit reuse, and an input
change that changes the hook's answer. Page traversal, deduplication, completion,
and failure handling still need precise contracts/tests when the API is written;
they do not require reopening these settled cache/source boundaries. An HTTP
cache is an optional lower-layer optimization, not a prerequisite for this design.

## Requested workflow

1. Start with an organization ID in an internal corporate HR system.
2. A memoized step fetches a CSV roster of people in that organization.
3. Parse the roster and fan out over people, using each person's GitHub username
   from the CSV.
4. Retrieve that person's pull requests over a requested period, with pagination.
5. As each PR becomes available, make an LLM call using a complexity-analysis
   prompt. Return structured data representing the completed assessment.
6. Fold that person's PR summaries and complexity assessments into one IC-level
   summary for the corresponding roster row. The outer person fan-out remains:
   the output is one result per selected person, not one organization-wide fold.

Use the selected scoped analysis context for environment, cooperative cancellation,
and observed resource reporting. Every memoized step must supply the author's
identity function. Ordinary parsing/filtering calculations need not be memoized
and are not required to supply that callback under the recommended contract.

## Proposed division of work

**Selected boundary:** discovery is a distinct non-memoized step leading into
memoized per-PR retrieval. Discovery owns current membership and completion;
retrieval owns one URL-identified PR's accepted evidence and refresh/finality
policy. Metadata checks and additional evidence fetches can be ordinary phases
within retrieval. Give an intermediate result its own durable step only when it
needs independent reuse or recovery. Durable page reuse is not part of this
selected example; the pagination section retains the earlier alternatives and
their source-validity requirements.

The authoring direction is a cohesive step definition containing required
behavior and optional policy hooks. A class or an interface with callbacks can
express it; inheritance and exact lifecycle methods remain unselected.

```text
HR organization ID
  → fetchRoster [memoized; CSV text]
  → parseRoster [ordinary calculation; validated rows]
  → trial selection [ordinary author-defined filtering, when active]
  → person fan-out [employee key; GitHub username is a query input]
      → discoverPRs [non-memoized; paginated enumeration]
          → fetchPRPage [non-memoized; items plus continuation]
          → PR fan-out as items arrive
              → retrievePR [memoized by PR URL; explicit source acceptance]
              → assessComplexity [memoized; prompt + evidence]
                  → validated structured assessment
      → fold this person's PR summaries/assessments
      → summarizePerson [memoized if it calls an LLM]
          → one structured IC summary for this roster member
```

The exact API of `paginate`, its packaging, and its relation to collection/source
facilities remain proposals. Its justification is concrete: the plan knows the
page-fetch stage, the continuation relationship, and the PR-processing stage
before execution. Runtime discovers the page count, cursors, and PR instances.
There is no requirement to inspect an arbitrary loop to discover hidden steps.

CSV parsing must handle real CSV quoting/escaping and validate the required
columns; a comma/newline split is not an adequate example implementation. Establish
how invalid/missing GitHub usernames and duplicate employee rows are handled.
Surface exclusions/failures instead of silently shrinking the selected population.
No particular HR endpoint, GitHub endpoint/version, or CSV schema has been chosen.

Trial selection happens before excluded people's GitHub/LLM work is admitted.
Selecting fewer people does not implicitly truncate the histories of selected
people. An additional trial PR limit is an author policy, visibly a limited scope,
and must not be confused with exhausting the source's continuation chain.

## Pagination: recommended durable boundary

**Updated after the user's page-shift objection:** do not default to durable page
reuse. A page fetch can be memoized only under a source-specific validity contract
that makes such reuse sound. Separate discovering current membership from reusing
eligible work for stable PR identities. The earlier recommendation of a memoized
page fetch plus a pagination helper was too broad without that qualification.

| Candidate | Benefit | Cost or limit |
| --- | --- | --- |
| One memoized body fetches every page for a person | Small initial body and one completed person-level result | If it fails before completion, no completed page results are available for reuse through that boundary; returning only at the end delays downstream admission. Streaming partial output would require additional semantics. |
| Each page is a memoized step, orchestrated by pagination | Completed pages can be reused within an eligible enumeration; PR analyses can start as page items become available | Page identity, source freshness, continuation validity, duplicates, and closure must be specified. |
| Arbitrarily resumable function | Appears to preserve an interrupted loop's local state | Requires a separate durable continuation/checkpoint model that has not been selected. It is unnecessary to illustrate explicit page boundaries. |

With page-level memoization, recovery can rebuild the pagination traversal from
its initial request: serve completed valid page steps, read their saved continuation
values, then request the first missing page. This does not resume JavaScript at a
suspended line, and it does not require claiming that an incomplete page request
has a reusable result. A request whose response was lost may need repeating and
may have consumed unreported resources.

A continuation is not proof of permanent validity. Decide whether recovery resumes
the same logical enumeration, whether its continuation is still valid, and when a
new refresh starts. Do not reuse old cached pages forever merely because username,
period, and cursor match. An explicit durable enumeration identity or version is
a candidate for binding recovery to one traversal; its creation, lifecycle, and
retention remain to design. Do not silently use a fresh random ID per restart.

Likewise, a fixed time range alone does not establish a consistent remote snapshot.
If the provider cannot supply the required stable enumeration semantics, define
re-enumeration, duplicate handling, and the meaning of completeness honestly.
No current provider-specific pagination guarantee is assumed by this scenario.

### Added records change page boundaries

The user explicitly challenged page reuse when new records are added. For a
simple offset-like example, an earlier enumeration has pages `[A, B]`, `[C, D]`.
After X is inserted at the front, the pages become `[X, A]`, `[B, C]`, `[D]`.
Combining cached old page one with fresh page two repeats B and misses X.
Deduplicating by PR identity removes repeated B but cannot discover missing X.
This illustrates the issue without asserting a particular GitHub endpoint's
pagination behavior. Cursors also require their actual provider validity contract;
opaque cursor text alone does not establish snapshot consistency.

Revised recommendation: make membership discovery explicitly refreshable under
author/provider policy; retain per-PR evidence and assessments using stable logical
identity plus appropriate version/dependency verification. A refreshed PR set can
reuse unchanged eligible assessments and execute new/changed members. New or
removed members invalidate the corresponding person's fold through membership
dependencies. A cached PR identity is not proof its current evidence is unchanged.

Page reuse remains possible for a demonstrably stable snapshot or another
source-specific contract that establishes validity. Merely labelling local pages
with an enumeration ID does not freeze the remote source. Without such guarantees,
restart/revalidate discovery according to an explicit policy; even a fresh scan
over a changing source needs defined completeness/consistency semantics. Preserve
already completed eligible per-PR work across that rediscovery.

### Author-controlled cache access under exploration

**Settled retention outcome (explicitly confirmed):** retrieval can inspect its previous eligible cached
result and explicitly return a control outcome accepting that result, including
after partial validation work. Preserve the retained payload's provenance and
record the current acceptance activity and observed costs separately. A local
merged-state decision, successful remote revalidation, and a fresh fetch yielding
equal content must remain distinguishable. Exact return syntax and persistence
are open; merely returning the previous payload as fresh data does not satisfy
this requirement. A cold miss has no prior result to retain. A cheap point read
can lead to explicit reuse of the whole accepted snapshot, skipping further
diff/review retrieval under the author's declared source policy. microdelta does not
infer that a provider's timestamp covers every supplemental resource.

**Next authoring option:** the user proposed a class with a required identity
method for memoized work and optional finality/update overrides. Use the merged
PR hydration step as the first concrete class example, keeping scoped context.
The lifecycle/defaults and class invocation syntax remain open; this is a new
candidate to compare, not a finalized replacement for ordinary function wrappers.

**Author finality is now a required case:** for this user's analysis, a cached PR
observed as merged is accepted as final even if remote metadata later changes.
This locally decidable rule skips all subsequent source checks, including ETag
revalidation. It is the analysis's chosen input contract, not a promise of remote
immutability. A prompt/revision change can still rerun the LLM using the retained
PR data. Permit staged checks for non-final records and a deliberate way to
revise the acceptance policy; do not mandate one generic freshness strategy.

**Settled mechanism:** the current node definition's optional finality hook makes
that decision from the cached result and current inputs. Reevaluate it whenever
finality is needed; a previous true answer cannot skip later evaluation. No
database flag/state declares the result final. Changing the hook or time-range
inputs can change its answer without clearing stored finality metadata, because
there is none. A false answer proceeds through normal retrieval policy and may
still reach the explicit reuse outcome after further checks.

**Latest direction:** use the PR URL as logical PR identity, with remote source
validation separate from automatic local field fingerprinting. A fresh search
version can justify skipping hydration only if its contract covers the payload
being reused. Otherwise an adapter may conditionally GET the point resource using
its saved ETag; a 304 validates the retained representation, while a fresh response
supplies content to compare. This still performs a request. See the latest source
validation entry in [decisions](../decisions.md) for primary documentation and
the still-open source/cache API boundary.

An ordinary URL-keyed memo hit must not prevent required source validation from
running. A failed check leaves freshness unknown; it is not an unchanged result.
After refresh, downstream judgments depend on consumed field changes, not merely
on a changed ETag or a new hydration generation.

**Identity/content clarification:** the user subsequently questioned mixing these
concepts. A stable PR identity and a version/fingerprint are separate. URL plus
head SHA can identify a deliberate PR-version artifact; alternatively, URL alone
can identify the PR subject while a consumed head/version input invalidates its
cached hydration generation. Selected-field fingerprints then govern downstream
content-sensitive reuse. The callback must not silently become both identity
and freshness policy; see the latest entry in [decisions](../decisions.md).

**User's concrete target:** cache individual PR point reads/hydration while
repeating comparatively cheap search/discovery. Do not collapse this into a
proposal to cache only LLM assessments. The proposed hydration identity is the
PR URL plus head-commit SHA. Paging can change while that PR-version key remains
the same. Changed head SHA selects a different hydrated version.

Define the payload covered by that key. GitHub permits independent title, body,
and base updates ([official documentation](https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request));
unchanged head does not imply unchanged full PR metadata. Diff evidence also
requires a defined comparison base. Separate mutable fields, revalidate them,
or explicitly accept a bounded snapshot policy. Obtain the version before cache
lookup and validate the fetched data against it so a concurrent push cannot put
new-head evidence under an old-head key. No particular search payload is assumed
to contain all required version metadata without checking the selected adapter.

The user proposed a lower-level API through which an analysis author can explicitly
use the memoized cache in a way appropriate to the source. Explore that control
alongside the high-level memo wrapper, without assuming a universal pagination
helper can infer source validity. Exact operations and signatures remain open.

Such an API needs to preserve environment isolation, identity/version validation,
dependency recording, claim/publication ownership, and observed accounting. Raw
store-row mutation or an unconditional key-only hit is not an adequate substitute
for the memoized cache's correctness contract. The author can supply the remote
freshness/enumeration policy; the library remains responsible for its local
cache/lifecycle invariants.

## Identity candidates to make concrete next

Keep user identity functions distinct from input fingerprints and from tracing IDs.
The following are semantic examples, not a selected callback return format:

| Memoized work | Candidate logical identity | Inputs whose changes still matter |
| --- | --- | --- |
| HR roster | HR-system organization identity | Declared roster refresh/snapshot input; fetching once does not make remote changes detectable automatically. |
| PR page | Query identity, logical enumeration, continuation position | GitHub account/username, period, query options, provider continuation validity, and refresh policy. |
| PR evidence, if fetched separately | Provider/repository/PR identity with the chosen evidence-version policy | The revision or snapshot of PR content actually analyzed. |
| PR complexity assessment | Canonical PR identity, within the assessment step's namespace | Prompt/rubric, model configuration, and selected PR evidence/version. |
| Final IC summary, if memoized | HR employee identity plus analysis period, within the summary step's namespace | Required PR membership, consumed summaries/assessment fields, the person's relevant roster fields, and summary prompt/configuration. |

An employee's HR identity is a useful roster fan-out key; a GitHub username is
also a mutable query input. Do not silently equate the two identities. The same
PR might appear through multiple people: if the assessment uses only PR evidence
and a common rubric, its completed result should be shareable under a suitable
identity. If the prompt uses person-specific context, those semantics must be
represented in identity or dependency verification rather than ignored.

How the callback receives those inputs, its allowed async reads, and its namespace
with step name/revision still need a concrete signature. Required callbacks solve
who supplies semantic identity; they do not by themselves solve source freshness,
identity collisions, or dependency validation.

## Readiness and structured completion

This workload intentionally differs from the earlier **whole-person corpus**
judgment. Each complexity assessment depends on **one PR's complete required
evidence plus its prompt/configuration**. It need not wait for the person's final
page or the rest of the organization. If evidence for that PR is incomplete,
its assessment waits; discovery of unrelated later PRs does not block it.

If page items omit evidence required by the rubric, explicitly retrieve that
evidence before the LLM body is admitted. The required fields are an author
choice—title/body, changes, reviews, or another defined representation—not an
assumption that every pagination response contains everything needed.

An illustrative output shape to refine with the author:

```ts
interface ComplexityAssessment {
  readonly pullRequestId: string;
  readonly evidenceRevision: string;
  readonly complexity: 'low' | 'medium' | 'high';
  readonly rationale: string;
  readonly factors: readonly {
    readonly name: string;
    readonly explanation: string;
  }[];
}
```

This is a schema example, not a chosen scoring rubric. Validate the actual model
response at the adapter/application boundary before publishing a successful
memoized assessment. A TypeScript cast does not validate returned data. Malformed
output is a failed assessment; preserve any observed usage received for the call.
A completed assessment is not the same as completed person/organization discovery.

## Inner fold: one IC summary per roster member

The user added this final stage explicitly. Each person's inner PR fan-out feeds
that person's fold; it does not flatten everybody's PRs into an organization-wide
barrier. The resulting outer collection remains keyed by roster member.

Recommend a strict complete-input final summary for the first authoring example:
wait until that person's discovery closes and all required PR assessments are
verified, then aggregate and summarize. Another person's unfinished pages do not
block this result. This is consistent with the prior whole-person corpus boundary,
while the per-PR complexity calls themselves can execute as their own evidence
becomes ready. Do not repeatedly execute a paid IC summary as each page arrives.

The user has not specified the final summary's failure policy in this particular
scenario. An explicit partial-outcome variant is supported by the broader product
direction, but must report its selected coverage and failures; it must not silently
replace the complete-input fold above. Scheduled retries remain pending. A closed
zero-PR period is distinct from unfinished discovery; the author should decide
what an IC summary with no evidence returns and whether it needs an LLM call.

The fold can use ordinary TypeScript to prepare counts, complexity distributions,
and PR summaries. If its final narrative requires an LLM request, put that request
in a memoized `summarizePerson` step with the required identity callback. No
universal `fold` DSL or automatic inference of complexity aggregation is selected.
The same PR assessment may be shared across people when semantically appropriate,
while each person's membership and final summary remain separate dependencies.

Illustrative final output, with exact narrative/rubric fields still to choose:

```ts
interface IndividualSummary {
  readonly employeeId: string;
  readonly period: { readonly start: string; readonly end: string };
  readonly pullRequestCount: number;
  readonly summary: string;
}
```

An execution/result envelope carries completeness, scope, and failures. Returning
an object with this interface does not by itself prove full coverage or successful
source enumeration. Trial output describes the selected scope, not a fabricated
complete organization result.

## Test-first acceptance inventory

1. Required identity callback: omitting it from any memoized stage is a type or
   definition error; ordinary CSV parsing does not require it.
2. CSV with quoted commas/newlines parses correctly; missing required columns and
   invalid usernames follow an explicit visible policy.
3. Roster reorder keeps employee member keys stable. Trial filtering admits no
   excluded GitHub/LLM work and preserves selected people's full requested scope.
4. Page one produces PR A; page two is held at a barrier. Once A's evidence is
   complete, A's LLM analysis starts without waiting for page two.
5. Continuation exhaustion closes enumeration; an empty page with a continuation
   does not. A source error or an author-imposed cap is not successful exhaustion.
6. Page two fails after PR A's assessment completes. A rerun starts discovery
   from the first page, reuses A's eligible completed work, and traverses current
   pages again. No cached page or arbitrary request-level checkpoint is assumed.
7. If continuation expires or a fresh enumeration is required, follow the explicit
   restart policy and deduplicate PR membership. Previously completed eligible
   PR assessments can still be reused independently of page boundaries.
8. A PR moves between pages or appears through multiple people. Preserve occurrence
   membership while avoiding duplicate eligible assessment execution and accounting.
9. Same PR identity with changed consumed evidence or prompt is reverified and,
   where necessary, recomputed. Changed unread fields alone do not force it.
10. Invalid LLM output is not a successful memoized value. Other independent PRs
    continue; failed and pending outcomes remain distinguishable.
11. Cancellation stops new page/item admissions and requests supported cancellation
   of active work; completed PR evidence/assessments remain retained. Retry does not
    revive a cancelled run. Remote outcome may remain unknown.
12. A successful response reports tokens while another request fails without usage:
    aggregate observed quantities and expose the known gap without inventing spend.
13. Resume a trial traversal under a production-default process only after restoring
    the recorded trial configuration, or fail before issuing requests. Matching
    production cache keys do not become trial cache reads.
14. Two people have different pagination speeds. Early PRs are assessed for both;
    person A's final summary executes after A's discovery and assessments complete,
    while B is still discovering. Assert one final result per selected roster member.
15. Multiple pages arrive for A. No paid IC summary starts early or repeats for each
    arrival. A changed required PR assessment later re-verifies only affected
    person's summary dependencies under normal incremental rules.
16. Fail one required PR assessment. The strict IC summary remains unavailable as
    verified output; successful sibling assessments remain reusable. An explicitly
    selected partial variant must carry accurate coverage and failure information.
17. Insert X before cached page boundaries in the example above. Do not compose
    incompatible cached/fresh pages as complete membership. Assert that deduplication
    alone does not pass the test; discovery must find X under the chosen source
    policy while unchanged eligible PR assessments remain reusable.
18. Rediscover the same PR URL on a different page and resolve its existing cached
    evidence under the current finality/retrieval policy. A new head is changed
    source data under that stable identity, not a new logical PR identity.
    Change a consumed title or comparison base without changing head and verify
    the selected payload/freshness policy handles it explicitly. Race discovery
    against a newer head during hydration and reject mismatched publication.
19. Revalidate a cached point resource under stable URL identity: unchanged/304
    retains its data; changed content updates it; validation failure exposes
    unknown/error. Required checks execute despite a cached memo result. A change
    confined to fields unread by the LLM consumer does not rerun that consumer.
20. With a cached merged PR and the author's finality policy, rerun with zero
    metadata, conditional, or hydration requests for that PR. Change the LLM
    prompt and permit reassessment using the retained source data without a
    remote refresh. Non-final records still follow the author's staged checks.

These assertions are the next exercise's requirements, not tests already written
or passing. Use controlled paginated fixtures and an LLM response validator; no
live HR credentials or paid API calls are necessary for the design comparison.
