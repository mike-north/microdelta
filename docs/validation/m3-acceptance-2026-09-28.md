# M3 independent-process acceptance (issue #58)

Implementation base: `efec33c` (default branch after #57). Local runs used Node
v24.14.0 on macOS with SQLite through better-sqlite3 12.9.0 via Machine's Node
adapter. Node 20 and 22 are exercised only by the repository CI matrix. Dates
are Pacific. This record supports the supervisor's final M3 decision
([#50](https://github.com/mike-north/microdelta/issues/50)); it does not declare
M3 accepted.

## What was proved, and how

`packages/core/test/acceptance` is an end-to-end harness over the actual
workspace alpha path and the production SQLite History backend:

- **Independent processes.** Each step spawns `node --import register.js
  worker.js <job>`. The worker imports the *built* `microdelta` package, composes
  the analysis afresh from the job's variation (declarations, callbacks, helpers
  and input objects are newly allocated), opens the workspace over the
  scenario's store file and runs one caller command through the facade's alpha
  entry operations: `resolve`, `recover`, `check`, ordinary report assembly and
  exact `read`. Nothing survives between steps except the SQLite file, the
  external world file and the caller's saved request-key files. There is no
  shared closure, test-only cache or in-memory reset.
- **External data.** A per-step world file (standing in for a live GitHub API)
  holds raw acme/widget activity, including out-of-window, pending and
  unselected records. The declared source adapter applies the contribution
  example's attribution rules; the world also holds the current finality and
  check-policy answers.
- **Instrumentation that observes or interrupts, never replaces.** A Node
  module-customization resolve hook redirects exactly one import: the built
  facade's `@microdelta/machine-node`. It goes to a test module that re-exports
  the real Machine and clock and wraps the real Node SQLite capability. The
  wrapper forwards every statement and transaction unchanged, records each
  statement's role tag and any author-payload cells returned, and can SIGKILL
  the process immediately before or after the commit of the N-th transaction
  containing a chosen role. Owners and the facade API are unchanged.
- **Traces that survive a kill.** Author helpers (source checks, finality hooks,
  summary bodies) and a run observer write one JSON line per call or event
  synchronously to fd 1.
- **Independent assertions.** The parent inspects durable state through
  History's real authority on the same file. It checks exact reads, envelopes and
  dependencies, acceptances, candidates, current pointers and the writer holder.
  Expected statistics and sentences (`expected.ts`) are derived by hand from the
  M3 plan and attribution rules, never captured from output.

## Cases and named tests

| Obligation | Tests (suite) |
| --- | --- |
| TEST-1/2 cold and complete restart | *a cold process publishes both sources and summaries once and assembles the ordered report once*; *an unchanged restart runs current finality, no summary bodies or checks, keeps exact references and assembles once* (`restart`) |
| TEST-2 reorder and display labels | *reversed registration and invocation order keep each member's own exact results and evidence*; *renamed display labels after restart do not change correspondence or reuse* (`restart`) |
| A-02 unread / consumed / helpers | *changing only unread labels and avatar…*; *Ada's consumed merged-status change reevaluates only Ada…*; *Ada's consumed review change…*; *a changed called formatter reevaluates both summaries…*; *a changed uncalled helper adds no dependency…* (`changes`) |
| A-02 version and rollback | *version 1 to 2 misses, rollback to 1 retains the old exact result without rewinding the latest pointer, and changed-input rollback misses* (`changes`) |
| A-04 rebinding and provenance | *a replaced profile with an equal name keeps the summary, a later name change invalidates it, and original provenance still resolves the old profile* (`changes`) |
| A-03 current finality and checks | *an accepting current hook runs once per member in every new process…*; *a false current answer enters the check…*; *an absent finality hook enters the current check in every new process*; *a changed current finality hook is what runs…*; *a changed source implementation is not excused by an accepting hook…* (`source-policy`) |
| A-03/A-10 retain vs fresh equal | *an explicit retention keeps the exact source reference…*; *fresh equal data twice yields two distinct exact source references…* (`source-policy`) |
| A-10 exact references | *a superseded summary stays exactly readable beside its successor*; *a missing reference, a reference from another store and a wrong-scope reference fail without retargeting or recomputation*; *an author mutating the eligible previous result changes no stored data* (`integrity-io`) |
| Selected IO, metadata-only validation | *cold summary bodies read only the consumed scalar leaves…* (7 leaves, 0 root payloads); *eligible restart validation is metadata-only…* (only the two hooks' own `profile.id` leaves); *a consumed change reads only the re-executed summary's consumed leaves…* (6) (`integrity-io`) |
| Basic A-19 | *eligible hits are served before a denying policy is ever consulted*; *a refused cold miss leaves no attempt, body, source work or result, and strands no writer*; *source work required to validate a cached summary obeys its own admission*; *check-only reports the source boundary and starts no work, admission or write*; *a pre-execution observer failure stops only that call and leaves no attempt*; *a post-commit observer failure is a diagnostic beside the committed result…* (`admission-observers`) |
| A-09 kill boundaries (real summary invocation) | killed before the writer acquisition commits; before the summary allocation commits; after it commits; before and after the summary staging commits; immediately before the publication commits; after it commits (`crash-recovery`) |
| Recovery after lost acknowledgment | *killed after the summary publication commits (lost acknowledgment)…*: recovery through `workspace.run(…).recover` with the caller-saved key returns the exact committed result, runs no body, check or finality hook, presents no admission, writes no acceptance, and works while the killed holder's lease is unexpired; a changed formatter under the same key is rejected `wrong-intent`; recovery is repeatable; a later fresh normal request runs the current finality hook and not-final check and reuses the committed result (`crash-recovery`) |
| Absent / incomplete / unsuccessful | absent after pre-commit kills of acquisition and allocation; `incomplete` after the allocation, staging and pre-publication kills, where the same saved key is refused `invalid-request` rather than resumed and a fresh request executes under current policy; *an unsuccessful summary attempt is reported as such by recovery and is never re-executed automatically* (`crash-recovery`) |

Each kill test asserts the process ended by SIGKILL with no result, the author
work done before the kill (from the trace), the durable state on reopen, and
that the old exact result is intact. That state is: completed candidates, the
latest pointer, no partial result, and the writer holder where relevant.

**Linked component proofs (narrower scope, not substitutes).** History's crash
matrix, fencing and stale publish/renew/release holders are in
`packages/core/test/durable-history/crash-recovery.test.ts` and
`durable-history.test.ts` (#55). Wrong-scope *dependency* targets and malformed
provenance integrity are in `packages/core/test/resolution/summary-validation.test.ts`
(#56). The in-process workspace suites are in `packages/core/test/workspace` (#57).

## Test-first record and honest classification

The harness and all suites were written before any runtime change (`b6dd0a7`,
logs `first-*.log` in the work record).

- **Preservation, not RED.** Against the delivered `efec33c` behavior, every
  runtime assertion passed on its first run: restart 4/4, changes 7/7, source
  policy 7/7, crash/recovery 7/7, admission/observers 6/6, integrity/IO 5 of 6.
  No runtime repair was needed. These assertions are preservation evidence of
  the accepted components through the assembled path, not RED.
- **One wrong test assumption, preserved and corrected.** The first
  *another store* case gave both scenarios the same logical store identity. Its
  locator therefore validly named this store, and the read succeeded. Logical
  identity, not file location, defines a store. The case now uses a distinct
  logical store.
- **Discrimination is shown by negative controls** (below). Their first run
  found two issues, both fixed in `7a7d762`:
  - My *memo admission refusal ignored* control was broken: it introduced an
    undefined variable, so all tests failed for an unrelated reason. It now
    plants a real refusal-ignoring defect.
  - *A normal request resumes an incomplete key* survived: the same-key request
    tripped the source's own key check first, which masked the summary's. The
    test now makes the committed source final, so the summary's key check is
    what is exercised. It then fails under the control (4 tests).
- **Regression found by the full gate.** Adding the own-package `microdelta` →
  untrimmed mapping made tsd see alpha names as public, and the facade's
  public-tier negatives failed. tsd now resolves `microdelta` as an external
  consumer does (`2b51b39`); a planted wrong `expectError` still fails it.

## Negative controls

`node packages/core/test/acceptance/controls/acceptance-mutation-controls.mjs`
plants one wrong behavior at a time into Resolution, History and Supervision
emitted builds, which the worker processes load through the built facade. It
reruns the six acceptance suites, judges each run fail-closed with the shared
judge, and restores the bytes. Final run at `2b51b39`: **PASS, 12 of 12
rejected**; baseline and restored 38/38.

| Planted defect | Acceptance tests failing |
| --- | --- |
| A source candidate skips its own implementation/input validation | 1 |
| An eligible source never consults its current finality hook | 15 |
| A false current finality answer retains | 21 |
| Consumed child output facts are not compared | 13 |
| Candidate lookup ignores the compatibility version | 1 |
| Check-only proceeds to source work | 1 |
| A memo admission refusal is ignored | 1 |
| A normal request resumes a key whose execution is incomplete | 4 |
| The recovery intent ignores the current declaration | 1 |
| An incomplete attempt is reported as absent | 4 |
| A selected scalar read also loads the whole root payload | 3 |
| Recovery takes the writer lease | 6 |

## Final gates

Run sequentially by the implementer at `2b51b39` (Node v24.14.0, macOS);
the later commit adds only this record.

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 |
| `npm run check` | exit 0 |
| `npm test` | exit 0. Tooling 291/291 (including the pack, isolated-install and typecheck artifact test). Facade Jest 186/186: durable History 44, Resolution 73, workspace 31, acceptance 38. Facade tsd and controls judge pass. All other workspace suites and the example pass |
| Acceptance negative controls | PASS 12/12; baseline and restored 38/38 |

## Status reconciliation

The spec entry point, milestones, M3 plan, package map and facade README now
say the same things. The M3 components and assembled path are delivered, with
this independent-process evidence. M3 acceptance remains #50. The `@alpha`
declaration tier is project-private and separate from package publishability:
only user-authorized `0.0.0` namespace-bootstrap placeholders without runtime
code were published, and no M3 implementation release exists.

## Limitations

- **Single host.** Processes run sequentially on one host and one SQLite file
  with an enforced single logical writer. Concurrent workers, power loss,
  distributed time and M5 retry/cancellation/accounting are not claimed.
- **Kill boundaries and occurrence counting.** Kill points are History commit
  boundaries selected by statement role and occurrence within one deterministic
  summary invocation, and occurrence counting relies on that deterministic
  order. The traces and durable state assert which work had run. Exactly-once
  external work before a commit is not claimed.
- **Short leases in tests.** Kill tests use a 300 ms writer lease and wait past
  it before a normal request; recovery is shown while the lease is still held.
- **Read evidence.** Read evidence counts payload cells returned by production
  statements in the worker; it is not a memory or scale measurement (M7).
- **Failure injection.** A summary body failure is injected by environment
  variable into the author helper, which stands in for an author error; no owner
  code is altered.
- **Out of scope.** TEST-3/4 roster fanout, A-05 general parent cutoff,
  general folds and nested arguments remain M4.
