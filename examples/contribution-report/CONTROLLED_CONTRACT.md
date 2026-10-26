# Controlled contribution report contract

This example reports **authored PRs** for explicitly selected current HR employee
IDs, configured repositories, and integer-second creation interval `[start,end)`
clipped at the report cutoff. Submitted reviews, conversation comments and inline
review comments are evidence attached to those PRs. It does not establish a
reviewer-only contribution population or full TEST-3/4, TEST-5/6, or M7 acceptance.

The controlled service has a **fixed backing dataset throughout each traversal**.
That is a scenario guarantee outside the HTTP protocol. The test harness holds
the complete-set oracle privately; the adapter receives only REST-shaped
requests, responses, statuses and headers. No fixture manifest, synthetic GitHub
revision field, or invented remote snapshot token reaches the adapter.

## Concrete REST subset

| Required evidence | Wire basis and closure |
| --- | --- |
| Authored PR population | `GET /search/issues`, `is:pr`, explicit `repo:`, `author:`, inclusive `created:` second range ending at `end-1`; `sort=created`, `order=asc`, `per_page` at most 100, positive advancing `page`; `total_count`, `incomplete_results`, `items`, PR marker and qualified identity. |
| PR representation | `GET /repos/{owner}/{repo}/pulls/{number}`, repository and number correspondence, title/body, lifecycle timestamps and labels; a separate diff media representation is required. |
| Submitted reviews | Independently exhausted `/pulls/{number}/reviews`; pending reviews do not become submitted activity. |
| Conversation comments | Independently exhausted `/issues/{number}/comments`; preserve actual creation and edit activity independently from displayed creation-window membership. |
| Inline review comments | Independently exhausted `/pulls/{number}/comments`, separate from review summary bodies and conversation comments. |

Search's documented 1,000-result cap requires strict interior bisection of whole
second creation intervals. Capped parent membership is discarded; every child
leaf must exhaust, and the distinct child union must agree with the parent total.
A capped one-second leaf refuses coverage. Successful search returns the count
and ordered repository-qualified IDs before that person's detail work begins.

Every next Link must preserve HTTPS API origin, endpoint, unique semantic query
parameters and strictly advancing page. Equivalent parameter ordering is valid.
Numeric `/repositories/{id}` paths are accepted only when the application has an
explicit configured correspondence between that numeric repository identity and
the named repository. An arbitrary redirect or numeric ID confers no authority.
The adapter follows the validated Link. Full/short/empty pages alone never prove
terminality. Counts, continuation, distinct numeric/node/qualified identities,
and duplicate evidence must remain consistent across pages and split leaves.

These request/field choices follow GitHub's [search endpoint](https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests),
[pagination contract](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api),
and [pull request APIs](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request).
The example is one concrete adapter, not a generic pagination framework.

## Temporal evidence is separate from traversal completion

`complete` on discussion evidence means that every required endpoint traversal
terminated. It does **not** mean its current editable text existed at a historical
cutoff or that every review edit time is known. The review list supplies
`submitted_at`; review bodies are [editable](https://docs.github.com/en/rest/pulls/reviews#update-a-review-for-a-pull-request)
without an equivalent edit timestamp in that selected representation.

Discussion evidence therefore separately carries `contentBasis`. Its default is
`unverified`. A controlled harness may explicitly supply
`{kind:'controlled-as-of', scenario, cutoff}` only when that particular scenario
guarantees the selected content and relevant activity as of that exact cutoff.
The hidden fixture oracle must independently assert that guarantee. A mismatch
in cutoff refuses coverage. This assumption is external to REST and must remain
identified in the report/application evidence; neither a missing wire field nor
`complete:true` creates it. The application cannot use unverified historical
review text to establish quiet finality or a historical assessment.

Actual comment `updated_at` contributes recent/future activity before filtering
displayed events by creation time. Included content edited after cutoff refuses
historical reconstruction. A pre-window comment's unconsumed future edit remains
future activity; it is never clamped to cutoff. PR representations edited after
cutoff likewise refuse unsupported historical content. Future close/merge does
not establish terminality at an earlier cutoff.

## Limits of the controlled guarantee

Matching totals, stable sort, page ETags and a local observation identity cannot
certify an arbitrary mutable live GitHub population. Same-count replacements
can be unobservable across pages; the explicit mutation test demonstrates this
limit. Real mutable live population consistency and arbitrary historical content
remain unverified. A fresh authorized traversal starts from its root, never from
an obsolete cursor or a union with yesterday's membership.

Quiet-period and daily policies remain independent current acceptance policies.
Quiet finality requires terminality, exhausted relevant evidence, adequate
temporal/activity basis and no recent or future relevant activity. A closed UTC
day is inclusive and its coverage is clipped to the report interval. Neither
quiet time nor a daily label substitutes for provider exhaustion.

All request sends use existing supervised operations with explicit service/access
rate association. Finite allowance, durable not-before, shared process-local
admission, writer fencing, stop and unknown-usage semantics retain their runtime
owners. No live/paid provider access, credential inspection, CLI projection,
launcher, lifetime choice, publication or release automation is part of this
controlled application.
