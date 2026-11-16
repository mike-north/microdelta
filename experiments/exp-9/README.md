# Issue 250 completed-search composition boundary

**Result: this tested dynamic composition cannot establish the required
current-detail behavior with the generated alpha facade.** This is a diagnostic experiment, not a usable
contribution-report feature and not a passing runtime-acceptance claim. The
consumer uses the generated `microdelta` alpha declarations and real durable
workspace. Its local fixtures and score rubric make the evidence deterministic.

## Question and scope

Can a completed per-person search of stable PR IDs compose with a separate
memoized detail lookup, assessment of that exact detail, and one strict
per-person summary, while preserving exact results across a fresh process and
reusing unaffected people when one ID disappears? Can a changed detail under
the same stable ID be accepted as current? Does a failed selected search after
successful global discovery remain a failure instead of becoming a successful
empty summary?

`test/analysis.ts` is the real-facade consumer. It declares a completed
composition-level contributor collection, a once-built keyed person template,
one member search source per person, a supplied per-PR detail slot, a supplied
assessor slot, a person summary, and a strict report fold. The detail and
assessor results are resolved through the runtime and the exact detail result
is forwarded into its assessment. No private package import, cast, external
fanout, or runtime modification is used. `test/process-entry.ts` opens a real
SQLite-backed workspace for each process and records body and reference facts.
The `searchFailures` fixture field injects failure in one selected person source
only; the global contributor listing remains valid.

The probe's intended current-detail assertion is that changing PR 101's merged
status from true to false changes Ada's score from 5 to 4, republishes only that
detail and its dependent Ada summary/report, and leaves Ben's and Cy's exact
summary references unchanged. The executable records this assertion as a
counterexample: it fails because the runtime reuses the detail, summary and
report under the unchanged ID, subject, supplied-step version and arguments.
The test then asserts and labels the observed stale score/reference. That
observation is not the desired contract and must not be treated as acceptance.

## Results

The generated-facade consumer provides positive evidence for these bounded
behaviors:

- Cold execution completes three person ID searches, six separate details,
  six assessments, three summaries and one report. The selected search IDs are
  Ada `[101, 102, 103]`, Ben `[201, 202]` and Cy `[301]`.
- A fresh process with unchanged fixtures runs no bodies and returns the exact
  same detail and summary references.
- Removing Ada's PR 103 changes only Ada's summary; Ben and Cy retain their
  exact summaries, and all five retained detail references are reused.
- If Ada's selected search throws after contributor discovery succeeds, Ada is
  failed, no Ada summary or strict report is published, and discovery still
  reports the complete roster. A valid empty roster is separately observed as
  a successful closed empty report.
- A completed Ada PR-ID search can also be certified empty while the valid
  roster remains Ada, Ben and Cy. Ada receives a successful zero-PR summary;
  only Ben's and Cy's three PR details and assessments execute, and the strict
  report succeeds. The injected empty result affects the selected PR search;
  contributor discovery continues to inspect the underlying fixture activity.

The standalone candidate's same-ID current-detail assertion fails. After the fixture revision changes
and PR 101 changes from merged to unmerged, all three activity checks execute,
but no detail, assessment, summary or report body executes. Ada's old detail
and summary references remain current from the facade's perspective; the
summary still reports score 5. This fails the probe's intended current-detail
outcome. The shipped contribution example files were restored unchanged from
their pre-probe baseline; this observation describes only the standalone
candidate composition.

## Owning boundary

The search is a `member.source`, which can declare current `finality`, but the
per-PR detail is a `suppliedStep` because its ID is a runtime argument. A
supplied step is memoized work with a fixed compatibility version, a run body,
and a call subject derived from its arguments; it has no source finality or
current-outcome hook. Here its stable subject and only semantic argument are
the PR ID. When that ID and binding remain unchanged, the body cannot inspect
the changed fixture on a cache hit. The enclosing summary memo can validate
called child outputs but likewise has no source-currentness hook.

Adding a global fixture revision to detail identity would invalidate
unaffected details. Computing a per-PR token from detail fields during the
completed ID search would move detail knowledge into search and weaken the
accepted search/detail separation; no provider response contract in this
experiment establishes that such a token is available from an ID search.
Inspection of a flat-root collection alternative suggests that each PR could
be a member source with current finality, while its strict fold spans the whole
PR collection. The generated declarations reviewed here expose no grouped
per-person fold or dynamic call from a person summary into a PR member source;
this inspection is a design boundary observation, not an executed experiment
covering every possible facade composition.

The missing responsibility is a bounded composition seam for per-PR current
sources nested beneath a completed per-person search and grouped into that
person's own strict summary. The source, keyed template and strict fold owners
remain the authorities for their individual responsibilities; this experiment
does not design or implement that seam. The result is a concrete
implementation-readiness gap for separate supervisor design and issue scope.

## Reproduction

Run from the repository root after the workspace packages are built:

```sh
npm run build:packages
npx tsc -p experiments/exp-9/tsconfig.json
node --test experiments/exp-9/test/composition-boundary.test.mjs
```

The observed run used Node **24.14.0**, TypeScript **5.9.3**, and the workspace
lockfile's Jest/TypeScript tooling. The experiment is intentionally standalone
and is not a CI acceptance gate; its green result means the diagnostic
observations reproduced, not that current same-ID detail freshness passed.

## Limits

This fixture proves the fixed Ada/Ben/Cy composition and process restart over
local SQLite, including distinct empty and failed Ada search outcomes. It does
not prove live provider pagination, count caps, provider
consistency, rate controls, retry integration, CLI delivery scope, or M7 scale.
