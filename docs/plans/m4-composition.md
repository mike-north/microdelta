# M4: keyed contribution analysis with nested cutoff

Status: M4 implementation plan for [issue #79](https://github.com/mike-north/microdelta/issues/79).
M3 is accepted ([#50](https://github.com/mike-north/microdelta/issues/50)).
Mechanism choices come from the [EXP-4 decision](../../experiments/exp-4/decision.md)
([#78](https://github.com/mike-north/microdelta/issues/78)) and the owning
contracts it amended. This plan applies the active specification and does not
replace it. Implementation readiness is governed by acceptance of this plan and of
each prerequisite issue, as the dependency table records.

## Consumer outcome

Continue the contribution-summary theme confirmed for M3 and M4. Given repository
identity and a reporting window, **discover** the repository's contributors from
activity in the window, produce each contributor's summary, and combine every
required summary into one repository report. M3 proved the durable path for two
explicitly written members. M4 proves the composition that the real example
needs: a population that is data-driven, keyed and gated, summaries that call
nested memoized assessments through a supplied assessor, and a strict report
that is complete only when the whole required population is.

Everything remains deterministic TypeScript over controlled fixture data. No
language-model call, paid provider or live GitHub API is needed or authorized.
Assessment scores are a fixture rubric, not a measure of contribution quality.

## What M4 adds to the M3 slice

| Concept | M3 | M4 |
| --- | --- | --- |
| Population | Two members written out with literal keys | A discovery source yields a keyed collection; a fanout template built once is instantiated per member key |
| Member key | Author string on each explicit member | Designated identity by default; an explicit custom key; duplicates and missing keys fail before member work |
| Member inclusion | All written members | A tracked gate selects the required population; gated-out members are explicit `skipped` instances |
| Nested calls | Memo → sibling source, no arguments | Memo → memo, with justified arguments (EXP-4 argument recipe) and equal-output cutoff |
| Supplied behavior | Helper functions in callable slots | A supplied assessor **step** in a callable step slot, bound at composition |
| Report | Ordinary nonmemoized assembly of two outcomes | A memoized strict fold over the member collection with honest waiting/failure |

The M3 composition surface stays valid. Explicit members, direct source children
and the M3 witness remain supported. Stored M3 evidence remains readable; a new
witness version is additive and M3 records keep their meaning.

## Outcomes to prove before implementation

| Scenario | Required evidence | Governing gate |
| --- | --- | --- |
| Cold run, complete exit, unchanged restart | Discovery runs under its current policy; member summaries, assessments and the report retain exact references with zero bodies | TEST-2, A-02, A-07 |
| A new contributor appears in discovery | One new member instance runs; existing members retain; the report reruns because membership it consumed changed | A-07, TEST-4.3 |
| A contributor disappears; discovery order changes | Removed member no longer required; reorder alone executes no member body; report follows its consumed facts only | A-07, COL-3 |
| Duplicate discovered key; record without designated identity | Diagnostic naming collection and key and pointing to the custom-key option; no member work admitted | A-07, COL-1 |
| Custom key selected | Members correspond by the custom key across restarts and reorders | A-07, COL-1 |
| Assessor rubric changes, scores unchanged | Assessments rerun; summaries and report retain their exact references | A-05, F-04, TEST-4.5 |
| Assessor output changes a consumed score | The affected summary and the report rerun; unaffected members retain | A-05, F-05 |
| Assessor slot bound to implementation B instead of A | Child implementation change, not a parent graph change; cutoff rules above apply | CMP-3/6 |
| Missing assessor slot, ambiguous slot, unjustified or unreconstructible argument | Honest parent miss with a distinct diagnostic; no validation-only replay; children may still reuse | A-06, REUSE-007 |
| Template factory, builder mutation, result-created operation | Template built once; later builder mutation has no effect; a result-created callable/operation is rejected before any work is admitted | A-08, CMP-1/9 |
| Gate threshold changes | Instance set changes, topology does not; only newly required members run; the report reruns | A-08, CMP-8 |
| One member fails, one is pending, one succeeds; discovery open | Successful member publishes; the strict report neither runs nor publishes; it reports waiting or failed with member keys | A-11 (M4 portion), RUN-005/010 |
| Repair the failed member | The report reruns; unaffected member bodies stay at zero | RUN-010 |
| Closed zero-member population | A successful complete report distinguished from open or missing discovery | RUN-004/010 |

A-11's retry, quota-wait, cancellation and middleware breadth remain M5. In M4,
"pending" is a member whose required work was not completed in this run (for
example an admission refusal); it is never a terminal failure and never an
empty success.

## Concrete fixture decisions

These are application fixture policies, not framework-wide rules. Keep repository
`acme/widget`, the UTC window `[2026-01-01, 2026-04-01)` and the M3 counting
rules. Extend `examples/contribution-report/data/acme-widget.json` rather than
replacing it.

- **Discovery.** A contributor is discovered when they authored a PR created in
  the window or submitted a non-pending review in the window. With the current
  data that is Ada, Ben and Cy. Discovery reports a completion status; the
  fixture adapter can report `open` to exercise RUN-005.
- **Designated identity.** A discovered contributor record's designated identity
  is its stable `key` (`person:ada`). The custom-key variant uses the upstream
  profile `id` (`gh:1001`). A record whose designated identity is absent fails
  before member work; the example never uses array position as identity.
- **Gate.** Configuration `minimumAuthored` (default 1) is a tracked input. A
  member is required when its authored count in the window reaches the threshold.
  At 2, Cy (one authored PR) is `skipped` and listed as excluded by the gate.
- **Assessment.** Each authored PR in the window is assessed by the supplied
  assessor step through a nested memoized call whose argument is the PR number
  (a derived scalar) and whose PR data comes from the member's activity through
  a forwarded binding. Rubric A scores merged PRs 2 and unmerged 1 and explains
  its reasoning in text. Rubric B changes only the explanation text. A third
  rubric variant changes a score, used for the output-change case.
- **Summary.** Keeps the M3 statistics and sentence and adds the total assessed
  score; it consumes each assessment's `score` and never its explanation.
- **Report.** A strict fold over the member collection. It lists required members
  by key order with sentence and score, lists skipped members as excluded by the
  gate, and states repository, window and threshold. It never claims coverage
  beyond closed discovery.

Expected values are derived by hand from the fixture data, following the M3
counting rules. Ada: authored 3, merged 2, reviews 5, score 5 under rubric A.
Ben: authored 2, merged 1, reviews 3, score 3. Cy: authored 1, merged 1,
reviews 1, score 2.

## Owner contracts to implement

| Owner | Meaning and responsibilities | Boundary that must remain intact |
| --- | --- | --- |
| Definition & Binding | Composition-level steps; fanout templates built once with a symbolic member; keyed collection bindings with default and custom keys; gate declarations; memo-to-memo edges; supplied callable step slots; argument-bearing declared handles and the versioned nested invocation witness with its argument recipe; strict fold declarations over a template | No execution, storage or freshness decisions while composing or reconnecting; no name, hash, ordinal or remap fallback; runtime data may instantiate or gate declared work but never create, replace or reconnect it |
| Tracking & Observation | Gate observations; argument binding paths; keyed collection membership, member-field and order facts consumed by a fold | A parent never absorbs a child's internal reads; order and membership stay separate facts from member fields |
| Value / Materialization | Keyed member views and any projection evidence the fold consumes | No candidate selection; fingerprint-only validation performs no payload reads |
| Result History & Publication | Retains member, assessment and fold results with exact dependencies, as today | No interpretation of Resolution's witness; no new consistency authority |
| Reuse Resolution | Sequential nested validation in recorded call order; argument justification; equal-output cutoff; template instance resolution; gate evaluation; strict fold readiness; honest misses with distinct diagnostics | No guessed argument reconstruction; no validation-only parent replay; child validity and parent output equality stay separate decisions |
| Run Supervision | Independent member progress; typed member outcomes (succeeded, skipped, pending, failed, cancelled); strict fold waiting or failure | No M5 retry, wait or cancellation breadth; a pending member is never a terminal failure |
| Facade assembly and example | Compose the owners into the real workspace path; extend the contribution example and its separate-process tests | No fixture-only cache or alternate API |

New cross-package surfaces remain project-private `@alpha`. Existing public
declarations do not change.

## Selected execution contract

The EXP-4 decision and the owning contracts it amends are authoritative. This
section records how M4 applies them to the example.

### Nested invocation evidence

A memo's nested call records the structural parent and child slots, its position
in the parent's call order and an argument recipe for each argument. `forwarded`
arguments are resolved again from current bindings. `derived` arguments are
justified only when the parent's own recorded evidence is unchanged and every
earlier child call's consumed output facts are equal. `unreconstructible`
arguments always make the parent an honest miss. Under the tracked-influence
contract, a changed basis for a derived argument is already reported as changed
evidence or changed child output. The distinct unjustified-argument miss therefore
arises from an observed untracked read made before the call. M4 needs an explicit,
observed way to make such a read (EXP-4 modelled it as `peek`). Unobserved closure
influence remains outside the guarantee (CX-1). The child's history identity
includes its derived argument values; a forwarded argument is identified by its
origin, and the child observes it under an `argument` binding path. Validation
follows recorded call order, and a later call is never justified by content it
could not have seen. Unknown witness versions or argument forms are unsupported
evidence, not guesses.

### Templates, keys and gates

Composition builds each template's member steps exactly once against a symbolic
member and freezes them. A member instance is addressed structurally by template
slot, step slot and member key. The collection binding produces member keys from
designated identity or an explicit custom-key function; duplicates and missing
identities fail with a diagnostic before any member work. The gate is a tracked
author predicate over declared inputs and the member binding. Its result selects
whether that instance is required and is evidence for the fold's verification.

### Strict fold

The strict report receives one explicit keyed entry for every current member:
succeeded members with their result view, and skipped members with no data. It
runs only when discovery is closed and every required member has an accepted
result. A failed or cancelled required member fails it immediately, naming those
keys and still reporting pending keys and open discovery. Otherwise, open discovery
or a pending member leaves it waiting. Neither case runs the body or publishes.
A successful outcome carries framework-level coverage (required keys, skipped
keys, discovery closure) independent of what the body reports. The fold's consumed
membership, member fields and each member's included-or-skipped outcome participate
in its verification. The gate's raw reads are the instance's own evidence, so
repairing a member or flipping a gate outcome reruns the fold while unaffected member
bodies stay unexecuted, and a threshold edit that flips nothing reruns nothing
unless the body reads the threshold. The contribution report states its threshold
(fixture decision above), so in the example a flip-free threshold edit reruns the
report and no member work. The acceptance suite proves the flip-free case with a
report variant that does not read the threshold. A
skip or deletion never retracts an earlier member publication; a member's latest
pointer is not evidence that it is still required. Outcome (tolerant) folds are
outside M4.

## Authoring shape and worked walkthrough

This fragment explains ownership and call behavior. The spelling is alpha and
decided in the Definition issues; it is not a compilable command or public API.

```ts
const { source, memo, template, fold, compose, forward } = authoring<IInputs, IHelpers>();

// Composition-level discovery source: a keyed collection with designated identity `key`.
const contributors = source<IContributors>({
  subject: 'contributors:acme/widget:2026-Q1',
  collection: { identity: 'key' },
  run: ({ inputs, helpers, outcome }) => helpers.discover(outcome, inputs.config),
});

// Built once against a symbolic member; instantiated per discovered key.
const contributor = template({
  slot: 'contributor',
  collection: contributors,
  // key: (member) => member.id,            // custom-key variant
  gate: ({ member, inputs }) => member.authored >= inputs.config.minimumAuthored,
  steps: (member) => ({
    activity: source({ subject: member.subject('activity:acme/widget:2026-Q1'), run: /* as M3 */ }),
    summary: memo({
      subject: member.subject('summary:acme/widget:2026-Q1'),
      children: { activity: 'activity', assess: 'assessor' },
      run: async ({ calls, helpers }) => {
        const selected = await calls.activity();
        const activity = selected.data;
        const scores = [];
        for (let i = 0; i < activity.pullRequests.length; i += 1) {
          // Derived scalar argument plus a forwarded origin in the activity result.
          const { data } = await calls.assess(activity.pullRequests[i].number, forward.child(selected, ['pullRequests', i]));
          scores.push(data.score);
        }
        return helpers.summarize(activity, scores, helpers.format);
      },
    }),
  }),
});

const report = fold({
  subject: 'report:acme/widget:2026-Q1',
  over: { template: contributor, step: 'summary' },
  run: ({ members, inputs, helpers }) => helpers.render(members, inputs.config),
});

compose({
  scope, inputs, helpers,
  steps: [{ slot: 'contributors', declaration: contributors }, { slot: 'report', declaration: report }],
  templates: [contributor],
  supplied: [{ slot: 'assessor', declaration: rubricA, subject: (pr) => `assessment:acme/widget:${String(pr)}` }],
});
```

On the cold run the report's resolution asks for the current member collection.
Discovery runs under its current policy and keys Ada, Ben and Cy before any
gate or body. Each gate is evaluated in its instance's frame. Each required
summary resolves its activity source and calls the supplied assessor once per
authored PR; each assessment publishes under the slot's argument-derived subject.
Summaries publish, and the report receives explicit keyed entries and publishes
with coverage `{ required: [ada, ben, cy], skipped: [], closed: true }`.

After a complete exit, a new process may register everything in a different
order. The report candidate validates its own evidence, recomputes the current
membership-and-status fact from current discovery and gates, and validates each
member summary. Each summary validates its own evidence, then its nested calls
in recorded order. It revalidates the activity source under current policy,
reconstructs each assessment call (derived PR number, forwarded activity origin)
and compares only the consumed `score`. With rubric text changed but scores
equal, assessments execute and publish new results, while summaries and the
report keep their exact references.

## Planned evidence names

These planned integration cases define independently asserted outcomes. They do
not claim that the current checkout already implements them.

| Planned case | Independent assertion |
| --- | --- |
| `keyed-cold-and-restarted-report` | Exact Ada/Ben/Cy statistics, scores and sentences; all bodies once cold; zero member, assessment and report bodies after restart |
| `discovery-insert-delete-reorder` | New member runs once; removed member not required; reorder executes no member body; report follows consumed membership |
| `duplicate-and-missing-identity` | Diagnostic names collection and key and suggests the custom key; no admitted member work |
| `custom-key-correspondence` | Custom key reconnects members after reordered restart |
| `nested-equal-output-cutoff` | Rubric text change reruns assessments only; summaries and report keep exact references |
| `nested-changed-output` | Score change reruns the affected summary and report only |
| `supplied-assessor-swap` | Binding B is a child implementation change with the same cutoff behavior |
| `binding-and-argument-misses` | Missing or ambiguous slot, an unreconstructible argument, and an argument derived after an observed untracked read: distinct diagnostics, no parent validation replay, children reuse |
| `frozen-template-topology` | Template factory invoked once; builder mutation ignored; result-created operation rejected before admission |
| `tracked-gate-instances` | Threshold change skips or requires Cy without topology change; only newly required work runs |
| `strict-fold-readiness` | Failed, pending and succeeded members with open discovery: the sibling publishes; the fold fails, naming failed, pending and open state; with only pending or open discovery it waits; repair reruns only the fold |
| `strict-fold-coverage` | A successful report outcome lists required keys, skipped keys and closure independently of the body |
| `closed-empty-population` | Zero-member closed discovery is a complete report distinct from open discovery |

Component suites also cover witness parsing, unsupported versions and argument
forms, and generated declaration boundaries.

## Implementation queue and readiness

All items start as backlog. Accepting this plan makes the first items in the table
ready; every other item waits for its accepted dependencies. A merged PR satisfies
a dependency only after default-branch checks and acceptance of the owning issue
are verified.

| Issue | Deliverable | Accepted dependencies |
| --- | --- | --- |
| [#78](https://github.com/mike-north/microdelta/issues/78) | EXP-4 mechanism decision and owning-contract amendments | — |
| [#79](https://github.com/mike-north/microdelta/issues/79) | This plan | #78 |
| [#82](https://github.com/mike-north/microdelta/issues/82) | Composition-level steps, memo-to-memo edges, supplied step slots, argument-bearing handles and the nested witness | #79 |
| [#83](https://github.com/mike-north/microdelta/issues/83) | Fanout templates, keyed collection bindings, custom keys, gates and frozen-topology enforcement | #79 |
| [#84](https://github.com/mike-north/microdelta/issues/84) | Nested memo validation with argument justification and equal-output cutoff | #79, #82 |
| [#85](https://github.com/mike-north/microdelta/issues/85) | Template instance resolution, gates, typed member outcomes and keyed member reuse | #79, #83, #84 |
| [#86](https://github.com/mike-north/microdelta/issues/86) | Strict fold readiness, coverage and fold verification | #79, #85 |
| [#87](https://github.com/mike-north/microdelta/issues/87) | Facade assembly and the keyed contribution example | #79, #86 |
| [#88](https://github.com/mike-north/microdelta/issues/88) | Independent-process acceptance and dated evidence | #79, #87 |
| [#89](https://github.com/mike-north/microdelta/issues/89) | Supervisor final M4 acceptance | #78, #79, #82–#88 |

Implementers own one contained issue and worktree and stop at a reviewable PR. The
supervisor owns contract decisions, exact-head review, Copilot findings, the
protected review status, merges and default-branch acceptance. No issue
authorizes paid calls, package publication or release changes.
