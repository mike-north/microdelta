# M4 independent-process acceptance (issue #88)

Implementation base: `64cfc7f` (head of #102, stacked on #101). Local runs used
Node v24.14.0 on macOS with SQLite through better-sqlite3 12.9.0 via Machine's
Node adapter. Node 20 and 22 run only in the repository CI matrix. Dates are
UTC. This record supports the supervisor's final M4 decision
([#89](https://github.com/mike-north/microdelta/issues/89)). It does not
declare M4 accepted.

## What was proved, and how

`packages/core/test/m4-acceptance` is an end-to-end suite over the actual
workspace alpha path and the production SQLite History backend. It follows
the M3 harness (`packages/core/test/acceptance`):

- **Independent processes.** Each step writes the world file and spawns
  `node worker.js <job>`. The worker imports the *built* `microdelta`
  package and composes the analysis afresh from the job's variation, so
  declarations, callbacks, helpers and input objects are newly allocated. It
  opens the workspace over the scenario's store file and makes one fold
  request through the facade's `resolveFold` entry operation. That request
  settles discovery, gates and every member first. The worker then reads the
  exact results it settled; some jobs also make check-only requests first.
  Nothing survives between steps except the SQLite file and the world file.
  There is no shared closure, test-only cache or in-memory reset.
- **The plan's composition shape** (`analysis.ts`), through the facade's
  `authoring()`:
  - a keyed discovery source (`collection: { identity: 'key' }`);
  - a gated fanout template built once against a symbolic member;
  - per member, an `activity` source that reads its member's `key`, and a
    nested `summary` memo that calls `activity` and then the supplied
    `assessor` slot once per authored PR (derived PR number, PR record
    forwarded from the activity result);
  - a strict fold `report` over the summaries.

  Variants swap rubric implementations or inputs, the key choice and the
  threshold. Others declare deliberately broken summaries: an observed
  untracked read, a function argument, or a result-created operation. The
  remaining variants use a report body that drops exclusions, or mutate
  every author object after composing.
- **Reversed later processes.** Every later process registers helpers,
  composition steps, templates and supplies in reverse. It sees the upstream
  listing in reverse profile order. The listing order reaches a run only when
  discovery's policy lists again.
- **External world.** A per-step world file stands in for the GitHub API. It
  holds the contribution example's acme/widget data (including out-of-window,
  pending and never-discovered records) and the current policy answers: listing
  revision and completion status, activity finality, injected summary
  failures and admission decisions. Upstream records reference contributors by
  account id, so a designated key can be renamed without changing activity.
- **Evidence.** Author helpers write one line per body synchronously:
  discovery check, activity check, assessment (PR number and rubric), summary
  and report (with the entries it received). A run observer records every
  lifecycle phase, and the admission port records every request. The parent
  inspects History candidates and exact reads through History's real authority
  on the same file. Every expected statistic, score, sentence, key, coverage
  and body count is written by hand in `expected.ts` and the tests, from the
  plan's fixture rules. None is captured from output.
- **No instrumented host.** M4's obligations are composition, reuse and
  readiness, not commit-boundary kills. The worker therefore runs over the
  unmodified Node Machine, without M3's resolve-hook preload.

## Exit criteria and named tests

The suite has four files (`keyed`, `nested`, `topology`, `fold`). Each planned
evidence name is a `describe` block. Test names are abbreviated below.

| Exit criterion | Planned evidence (tests) |
| --- | --- |
| TEST-1/2: cold, complete exit, fresh processes, reversed registration and order | `keyed-cold-and-restarted-report`; every later process in every case |
| A-05 nested cutoff: child input, code or source changes, equal versus changed selected output | `nested-equal-output-cutoff` (child input, equal output), `nested-changed-output` (child input, changed output), `supplied-assessor-swap` (child code B equal, C changed), `custom-key-correspondence` (child source rechecked, equal output) |
| A-06 binding failure | `binding-and-argument-misses`: missing slot, ambiguous slot, unreconstructible argument, argument derived after an observed untracked read, plus an unchanged control |
| A-07 keyed collections | `discovery-insert-delete-reorder`, `duplicate-and-missing-identity`, `custom-key-correspondence` |
| A-08 fixed topology | `frozen-template-topology` (factory once, mutated builder, result-created operation), `tracked-gate-instances` |
| A-11, M4 portion: one failed, one pending, one successful, open discovery | `strict-fold-readiness` (both tests), `strict-fold-coverage`, `closed-empty-population` |
| TEST-4 item 3: new PR and changed listing restart discovery; keyed work survives | `discovery-insert-delete-reorder` |
| TEST-4 item 5: child refresh with equal assessment keeps the parent | `nested-equal-output-cutoff`, `supplied-assessor-swap` (B) |
| TEST-4 item 6, M4 portion: complete members finish; strict report never treats missing evidence as an empty success | `strict-fold-readiness`, `closed-empty-population` |
| M4 exit: discovery closure and changed current source hooks | `strict-fold-readiness` and `closed-empty-population` (listing status); `discovery-insert-delete-reorder` (listing revision) |
| M4 exit: illegal topology rejection | `frozen-template-topology` |

## Outcome rows of the plan

| Plan row | Test | What it asserts, by hand |
| --- | --- | --- |
| Cold run, complete exit, unchanged restart | `keyed-cold-and-restarted-report` | Cold run: discovery 1, activities Ada/Ben/Cy, assessments 101, 102, 103, 201, 202 and 301, summaries 3 and report 1. Statistics are Ada 3/2/5 score 5, Ben 2/1/3 score 3, Cy 1/1/1 score 2, with M3 sentences. Restart: discovery and every activity run `finality` with zero bodies and zero admissions. Every summary, the report and each assessment's single History candidate keep their exact references; fold acceptance follows the three cold summary references |
| A new contributor appears | `discovery-insert-delete-reorder` | Dot's in-window PR 401 is added. Discovery relists, and only Dot's activity, assessment 401 and summary run (Dot 1/0/0, score 1). Admitted member work is Dot's alone; Ada, Ben and Cy keep their references. The report reruns with miss `changed-membership` |
| A contributor disappears; discovery order changes | `discovery-insert-delete-reorder` | Cy's in-window records are removed. Cy is no longer a member, no member body runs and the report reruns over Ada, Ben and Dot. Cy's summary stays the only candidate and reads exactly. A reorder alone relists discovery and runs no member or report body; the report reference is kept |
| Duplicate key; record without designated identity | `duplicate-and-missing-identity` | The diagnostic has reason `duplicate-key` with key `person:ben`, or `missing-key`, plus collection `contributors`, template `contributor`, identity `key` and a message pointing to the custom key. The only admission is discovery's own check. No gate outcome or member body; the fold fails as rejected. A corrected listing reconnects every member and the report with zero bodies |
| Custom key selected | `custom-key-correspondence` | Members are `gh:1001`, `gh:2002` and `gh:3003`; the summary subjects use them. After a reversed restart that renames every designated key, activities recheck (they consumed `key`) with equal output. Zero assessment, summary and report bodies; exact references kept |
| Rubric changes, scores unchanged | `nested-equal-output-cutoff` | Rubric wording input changes: six assessments rerun and each gets a second History candidate. Zero activity, summary and report bodies; summaries and report keep their exact references |
| Assessor output changes a consumed score | `nested-changed-output` | Only PR 201 reads the merged-bug score, so only assessment 201, Ben's summary (`changed-child-output`, score 4) and the report (`changed-member-output`) run. Ada and Cy keep their references |
| Assessor slot bound to B instead of A | `supplied-assessor-swap` | B scores equal: six B assessments run, and every summary keeps its reference with no miss (no correspondence change); the report is kept. C scores open PRs 0: six C assessments run, Ada (4) and Ben (2) rerun with `changed-child-output`, Cy is kept and the report reruns |
| Missing or ambiguous slot; unjustified or unreconstructible argument | `binding-and-argument-misses` | Missing and ambiguous: check-only reports `missing-binding` or `ambiguous-binding` with distinct details. Each member fails `unbound-step` with a distinct message. No summary `execute`, body, child work or admission; nothing retracted. Unreconstructible and unjustified: check-only reports `unreconstructible-argument` or `unjustified-argument` with distinct details. Each summary runs exactly one ordinary `execute` and republishes equal output; zero activity and assessment bodies; the report is kept. The unchanged control is `reusable` with no misses |
| Template factory, builder mutation, result-created operation | `frozen-template-topology` | Factory invoked once per process. Mutating arrays, the factory's record, the threshold (99), window and rubric after composing changes nothing: same topology, zero bodies, same report. A result-created operation fails each summary `execution-failure` with a `DefinitionError` cause before any admission names it. No summary or report is published; the standard composition has the same topology |
| Gate threshold changes | `tracked-gate-instances` | At 2, Cy is `skipped` and no Cy work is admitted. At 1, same topology, and only Cy's activity, assessment 301, summary and the report run. At 0, no gate flips and no member work runs; the report reruns because it consumes the threshold it states. Back at 2, Cy is skipped with zero bodies, the report from threshold 2 is reused, and Cy's publication is not retracted |
| One fails, one pending, one succeeds; discovery open | `strict-fold-readiness` (A-11) | Ada publishes. Ben is `pending` (refused `summary/person:ben`); Cy `failed` (`execution-failure`, injected cause). The fold fails with `failed [person:cy]`, `cancelled []`, `pending [person:ben]` and open discovery. No fold body, admission or lifecycle; nothing is published for the report, Ben or Cy |
| Repair the failed member | `strict-fold-readiness` (both tests) | The A-11 repair runs Ben's work and Cy's summary only; Cy's activity and assessment are reused. Ada's bodies stay at zero and the report publishes once. In the waiting test, closing discovery runs only discovery and the report |
| Closed zero-member population | `closed-empty-population` | A closed empty listing succeeds with coverage `{ required: [], skipped: [], closed: true }` and an empty report. An open empty listing waits (keyed, open). A listing refused by admission is `pending` discovery, also waiting. Neither publishes or rewinds the report; the closed report is reused when discovery closes again |

The "waiting" half of the readiness case is its second test. With Ben pending
and discovery closed, the fold waits on `pending [person:ben]`. With Ben
complete and discovery open, it waits on open discovery alone. Coverage
independence is `strict-fold-coverage`: a body that reports no exclusions
still yields coverage `{ required: [ada, ben], skipped: [cy], closed: true }`,
cold and reused, and the reuse follows the two exact summary references.

## Commands

```sh
npm run build
npm run test:unit --workspace microdelta        # includes .test-build/test/m4-acceptance
node --experimental-vm-modules node_modules/jest/bin/jest.js \
  --config packages/core/jest.config.mjs --runInBand .test-build/test/m4-acceptance/   # from packages/core
node packages/core/test/m4-acceptance/controls/m4-mutation-controls.mjs   # on demand
```

The suite is wired into `npm test` through the facade's existing `test:unit`.
`tsconfig.test.json` emits every `test/**/*.ts`, and Jest runs every emitted
`*.test.js`. The CI matrix (`core (20)`, `core (22)`, `core (24)`) runs
`npm test`. The directory is named `m4-acceptance`, not `acceptance/m4`,
because the M3 control runner selects its suites with the Jest pattern
`.test-build/test/acceptance` and fails closed on any foreign suite.

## Test-first record and honest classification

The suite, harness and composition were written against the assembled path
before any run, with every expected value written by hand. No runtime package
was changed.

- **First run** (base `164d9d2`, the #102 head at the time, log
  `pr88-first-run.log` in the work record): 17 of 20 passed and 3 failed. All
  three were wrong test assumptions, not defects:
  - Missing and ambiguous slot, 2 tests. The check-only miss detail reads
    `call 1: callable slot assessor has no current binding` (or `has 2 current
    bindings`). I had expected the wording of the resolve failure message,
    `…has no current implementation`, which is a separate diagnostic. The tests
    now assert both, each with its own wording, so the diagnostics are shown
    to be distinct.
  - Gate lowered, 1 test. I expected the report's miss to be
    `changed-membership`. The fixture's report states the threshold it
    consumed, so its own evidence changes first and the miss is `changed`.
    The resulting membership is still asserted through coverage.
- **Preservation, not RED.** Every other assertion passed on its first run.
  The M4 components (#82–#87) were already merged into the stack. These
  assertions are preservation evidence of the accepted components through the
  assembled path, in independent processes; they are not RED.
- **Discrimination is shown by negative controls** (below). Every control and
  its predicted cases were written before the control ran, and every
  prediction held on the first run.

## Negative controls

`node packages/core/test/m4-acceptance/controls/m4-mutation-controls.mjs`
plants one wrong behavior at a time into the emitted Resolution or Definition
builds, which the worker processes load through the built facade. It reruns
the four M4 suites and judges each run fail-closed with the shared
`control-outcome.mjs`, then restores the bytes. A control fails the run if any
case it names still passes. Run at `164d9d2` with the first suite, and again
after rebasing onto `64cfc7f`: **PASS, 19 of 19 rejected** both times, with
identical failing counts; baseline and restored 20/20.

| Planted defect | Target | Tests failing | Predicted cases, all failing |
| --- | --- | --- | --- |
| An eligible source never consults its current finality hook | resolution | 18 | `keyed-cold-and-restarted-report` |
| A strict fold ignores its recorded membership fact | resolution | 1 | `discovery-insert-delete-reorder` |
| A strict fold does not compare the member facts it consumed | resolution | 2 | `nested-changed-output`, `supplied-assessor-swap` |
| A nested parent does not compare the output it consumed from a call | resolution | 2 | `nested-changed-output`, `supplied-assessor-swap` |
| No equal-output cutoff: a re-executed call always misses its parent | resolution | 3 | `nested-equal-output-cutoff`, `supplied-assessor-swap`, `custom-key-correspondence` |
| An argument derived after an observed untracked read is treated as justified | resolution | 1 | `binding-and-argument-misses` |
| An unreconstructible argument is rebuilt instead of missing the parent | resolution | 1 | `binding-and-argument-misses` |
| Open discovery is treated as closed | resolution | 3 | `strict-fold-readiness`, `closed-empty-population` |
| A refused member fails the fold instead of leaving it pending | resolution | 2 | `strict-fold-readiness` |
| Fold coverage omits skipped members | resolution | 2 | `strict-fold-coverage`, `tracked-gate-instances` |
| A closed empty population waits instead of completing | resolution | 1 | `closed-empty-population` |
| Duplicate member keys are silently collapsed | definition | 1 | `duplicate-and-missing-identity` |
| A record without designated identity is not reported as a missing key | definition | 1 | `duplicate-and-missing-identity` |
| The custom key is ignored in favor of designated identity | definition | 1 | `custom-key-correspondence` |
| An ambiguous supplied slot silently binds its first implementation | definition | 1 | `binding-and-argument-misses` |
| A missing supplied slot is not refused when the parent opens | definition | 1 | `binding-and-argument-misses` |
| A frozen member builder accepts a result-created operation | definition | 1 | `frozen-template-topology` |
| Composition keeps author input objects by reference | definition | 1 | `frozen-template-topology` |
| A gate answering false still requires the member | definition | 2 | `tracked-gate-instances`, `strict-fold-coverage` |

Every planned evidence case is rejected by at least one control.

## Final gates

Run sequentially by the implementer after rebasing the suite onto `64cfc7f`
(Node v24.14.0, macOS); the record's own later edits change no code:

| Command | Result |
| --- | --- |
| `npm run clean` | exit 0 |
| `npm run build` | exit 0 |
| `npm run check` | exit 0 |
| `npm test` | exit 0. Facade Jest 367/367 in 30 suites, including the four M4 acceptance suites (20 tests; `jest --listTests` lists `.test-build/test/m4-acceptance/{keyed,nested,topology,fold}.test.js`). Facade tsd and controls pass. All other workspace suites, the experiments and the example pass |
| M4 negative controls | PASS 19/19; baseline and restored 20/20 |

## Limits: what is and is not proven

- **No M5 claims.** A-11's retry, quota waits, cancellation mechanics and
  middleware breadth are M5, as are concurrency and fencing between workers.
  Here "pending" is only an admission denial in the current run. The
  `cancelled` member and fold statuses exist in the typed outcomes but are not
  exercised. Processes run sequentially on one host and one SQLite file with
  the enforced single writer.
- **No commit-boundary kills.** M4 composition is not killed mid-publication.
  The M3 kill and recovery evidence covers the History publication protocol
  the same path uses. Recovery of a keyed or fold request key is not
  exercised here.
- **Failure injection.** A summary failure is an author error keyed by
  display name in the world file. Admission decisions come from the world
  file. No owner code is altered outside the on-demand controls.
- **Reading of two plan rows.** "Rubric text change" (`nested-equal-output-cutoff`)
  is a change to the rubric input's wording, which is a child *input* change.
  "Binding B" (`supplied-assessor-swap`) is a change of the supplied
  implementation, which is a child *code* change. Together they cover A-05's
  input and code variants; a changed child source is covered by the custom-key
  case.
- **Flip-free threshold.** The plan says "a threshold edit that flips nothing
  reruns nothing". It also says the report states its threshold. Through
  this report, a flip-free edit therefore runs no member work but does rerun
  the report, because the report consumed the threshold. The fold component
  suite (`packages/core/test/fold`, #86) shows the fold-level statement with a
  report that does not consume the threshold.
- **Discovery order.** A reversed listing reaches a run only when discovery's
  policy lists again. The reorder case forces that with a new revision; the
  unchanged restart keeps the previous listing, as its policy requires.
- **Scope of the facade path.** The suite uses the facade's fold, check and
  exact-read operations. The members entry operation (`resolveMembers`) and
  per-instance `resolve` are covered by the component suites
  (`packages/core/test/keyed`, #85), not here.
- **Linked component proofs (narrower scope, not substitutes).** Witness
  parsing, unsupported witness and argument versions, and argument-list idioms
  are in `packages/core/test/nested` (#84). Promise gates, refusal
  dispositions, correspondence renames and run-level failures are in
  `packages/core/test/keyed` (#85). Stored fold evidence, direct fold requests
  and skipped-entry reads are in `packages/core/test/fold` (#86). The example's
  own CLI tests are in `examples/contribution-report/test` (#87). Generated
  declaration boundaries are in the tooling and fixture checks.
