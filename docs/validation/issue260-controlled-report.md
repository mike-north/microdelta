# Controlled report acceptance evidence

Issue260 is **not yet accepted**. The standalone150000-distinct-PR cold
qualification at `9cc9bcd` failed when the default writer lease expired inside
one fold request; no full restart ran. Independent whole-head audit verified
AC1–7 for the selected controlled application; AC8 and final acceptance remain
unmet. The full combined baseline passed at `b4773c2`; loader-policy repair
passed at `9cc9bcd`. The bounded lease repair independently passed at `ce3bc7a`;
the separate failure-receipt repair at `e3dc64a` awaits independent review.
Parent240 retains all six criteria, including its
separately permissioned executable/progress criterion. CLI projection,
installation, launcher/lifetime decisions, full TEST-3/4 and TEST-5/6 remain
separate gates.

## Scope and frozen source

The report covers explicitly selected current HR employees' **authored PRs**,
with submitted reviews, conversation comments and inline comments attached as
assessment evidence. The [controlled application contract](../../examples/contribution-report/CONTROLLED_CONTRACT.md)
records the concrete REST subset, fixed backing dataset assumption outside the
wire protocol, explicit exact-cutoff historical content guarantee, and
unverified mutable-live-population limitation. Neither endpoint exhaustion nor a
local observation identity invents a provider snapshot or historical text.

The concrete application source is frozen at
`da858fc0e071cfadfdffba13ff15c50b0207c56f`; the independently reviewed workload
branch is `363018b0458d2c1bd0aeaaa1bd22e4f9b75d5414`. Their normal integration is
`0901ee6202f77c67802d576382fe5843754fd3dd`. The fixture relocation changes test
ownership and verification paths while preserving that application source. The
combined runtime candidate `b4773c2f488c0d61d421453f769e67df6ac8980c` passed all
repository check/test/build gates. The loader-policy repair at
`9cc9bcdcba9e71e0c0963df8828cb16c55f29418` changes only fixture import policy,
tooling tests and documentation. The later harness-only repairs are
`ce3bc7a499550f29e0954eec5f5e612a72411309` (qualification lease) and
`e3dc64a3cfa4bc1d31e15e29a57fe0e133eed09f` (bounded failure receipts).
Application and package runtime source, lockfile, population, permits/window,
fencing, retry and stop contracts remain unchanged. The final successful
workload receipt must identify the actual combined revision used, and the
final artifact manifest must fingerprint the generated declarations and runtime
inputs after the final build.

The [independent fixture role](../../fixtures/contribution-report/README.md)
owns synthetic providers, History/Accounting oracles, fresh-process workers,
workload measurements and generated declaration tests. Strict compilation maps
public owner roots only to generated alpha declarations; workers load public
package entries. Type-aware lint and import checks include the fixture. New
mechanical tests reject deep packages, owner source, aliases, encoded source
escapes and nonliteral module edges. The executable example's facade-only rule
is unchanged and its existing positive/negative controls remain passing.
The fixture role also excludes `node:module`/`module` access and explicit
`createRequire` dot/literal-computed access or destructuring, including the
demonstrated `process.getBuiltinModule` extraction. It enforces supported module
edge conventions, not a host sandbox or arbitrary runtime dataflow analysis.

## Current acceptance map

Test filenames below are relative to `fixtures/contribution-report`.

| Issue260 criterion; parent240 overlap | Concrete evidence and current result |
| --- | --- |
| 1 completed search, roster/schema/closure;240.1/4 | `protocol.test.ts`, `model.test.ts`, `evidence.test.ts`, and application completed-search/empty-population cases PASS. Independent exact counts precede details; positive1001-PR cap bisection, invalid/capped/nonterminal/continuation/identity failures, current HR selection, explicit empty trial and strict malformed assessment refusal are covered. The hidden manifest is outside the adapter. |
| 2 currentness/restart;240.2 | Application and `restart.test.ts` cases PASS: current hooks and exact source/assessment/person references across full process exit; repagination, added/removed membership, consumed versus unread change, equal refreshed child, prompt/model/helper inputs and compatible versus differing consumed person context. Failed traversal cannot close membership; a fresh root traversal reuses eligible older work. Prior source provenance remains readable. |
| 3 actual source/rate assembly;240.3 | Actual generated-facade search/discussion/detail/assessment operations PASS. Cold four-PR fixture sends24 GitHub requests plus4 assessments, observes4 acknowledged usage reports/40 tokens, and retains24 unknown GitHub usage attempts. Settled restart executes8 source hooks,4 search sends (2 when repaged),0 assessments and exact person references. Actual shared request/quantity gates, mandatory API+search union, independent access and same-process new-run shared cost are asserted. |
| 4 trial/failure/stop;240.4/2 | `restart.test.ts`, application handoff and `settling-failure.test.ts` PASS. Empty trial sends nothing; excluded Grace has no expensive body; widening retains eligible Ada only within trial; production does not import trial state. SIGKILL after Ada publication retains Ada and executes Grace's2 assessments on restart. Malformed model output publishes no Ada assessment/summary but preserves acknowledged billing and successful Grace. Lost model response exhausts finite allowance, leaves earlier Ada readable and usage unknown; a fresh run completes missing Ada work. |
| 5 CR-2;240.6/3 | `retry.test.ts`33 cases and `provider-controls.test.ts`22 actual-facade cases PASS. Seconds/HTTP-date/reset normalization, receipt-relative RFC850 century, safe integer timing, local/provider maximum, early timer wake, threshold, slow classifier publication and decision acceptance, cumulative wait, finite attempts, same-operation close/reopen, cancellation, deferred-only writer release/reacquisition, explicit operator soft/hard/deadline rejection, final stop/fence and definite-unsent rollback are covered. Source classifier stop remains distinct from operator rejection. Independent provider review PASS is accepted at `da858fc`. |
| 6 CR-4;240.6/2 | Evidence/model/application/restart cases PASS. Changed cutoff cannot relabel mismatched temporal basis. Future terminal events cannot establish earlier closure. Advanced observation refreshes provisional evidence; equal refreshed children record new source provenance while eligible exact parent/assessment references remain. |
| 7 CR-5;240.6/2 | `settling-failure.test.ts` independently final quiet/daily sources, advanced observation, per-policy changes, late arrival, open/recent/future activity; model clipped inclusive closed-day boundaries; temporal-basis negatives PASS. Advanced observation refreshes only the provisional source. Late relevant comment refreshes PR101 detail/assessment, retains unrelated detail and exact equal-score Ada summary, and leaves prior provenance immutable. No global finality follows. |
| 8 workload/privacy;240.2–4/6 | Public events/identities/progress/diagnostics/report versus synthetic credentials, headers, raw wire/model bodies, cursor and private assessment context PASS. Missing billing remains unknown. Workload fixture/measurement/tail/harness tests PASS, including required prolific-author capped-search behavior. **FAILED / qualification pending:** the150000-PR cold attempt at `9cc9bcd` expired its request writer lease; no full restart ran. Harness lease and partial-evidence repairs do not establish the required actual full people/subjects/evidence/payload/operation/send/memory/in-flight measurements. The500-PR smoke is not acceptance. |
| CLI handoff;240.5 remains open | `composeReport`, `evaluateReport`, `IReportRunOutcome` and generated declaration/tsd negatives PASS. Strict complete requires a succeeded framework fold; fulfilled incomplete execution has no report. No CLI framing or lifetime choice is selected. |

## Commands and receipts

Local receipts are retained under `/private/tmp` for supervisory inspection;
checked-in named tests and commands reproduce their behavioral expectations.

| Command / exact scope | Observed evidence |
| --- | --- |
| `npm run test:controlled-report` after relocation and CR-5 precision repair |157 Jest tests/12 suites plus generated declaration/tsd PASS; `issue260-combined-repaired-tests.log`. |
| `npm run check:imports` | Actual example and fixture boundary PASS; `issue260-combined-fixture-imports.log`. |
| `npm run check:fixtures` | Existing declaration-consumer checks plus strict fixture compile and type-aware lint PASS; `issue260-combined-fixture-check.log`. |
| `npm run test:tooling` after loader-policy repair |376 tooling cases PASS, including existing example controls, generated alpha paths, repository-gate/type-aware-lint enforcement and both loader regressions; `issue260-green-fixture-loader-repair.log`. |
| Loader-policy affected import/fixture/example checks | Actual `check:imports`, `check:fixtures`, `check:examples` and diff check PASS; `issue260-loader-repair-imports.log`, `issue260-loader-repair-fixtures.log`, `issue260-loader-repair-examples.log`. |
| Provider frozen `da858fc` focused tests |55 Jest cases plus strict example compile/lint PASS; author `issue260-green-rfc850-century.log`, `issue260-rfc850-check.log`; independent `issue260-provider-century-repair-review.md`. |
| Repaired `settling-failure.test.ts` |15 actual-facade cases PASS, plus strict fixture/import checks; `issue260-green-cr5-policy-outcome.log`, `issue260-cr5-repair-check.log`, `issue260-cr5-repair-imports.log`. |
| `npm run test:controlled-report:workload -- --smoke` after relocation |500 distinct PRs/2 people cold and fresh-process restart PASS,4.0s/3.7s measured locally; `issue260-combined-workload-smoke.log`. Cold3006 actual sends, restart1506 additional sends,0 restart assessments. This only verifies the bounded integration and measurement paths. |
| First full `npm run check` before relocation | Architectural RED:12 harness imports fell beneath the example facade-only rule; all other package/workspace checks passed. Preserved `issue260-full-check.log`; resolved by explicit fixture ownership and enforcement, not by weakening the example rule. |
| Combined `npm run check`, `npm test`, explicit `npm run build` | **PASS** at exact runtime candidate `b4773c2`; `issue260-final-check.log`, `issue260-final-test.log`, `issue260-final-build.log`. Source is unchanged by loader repair `9cc9bcd`; subsequent harness repairs have separately attributed checks. No repeated full baseline is claimed. |
| `npm run test:controlled-report:workload` at `9cc9bcd` | **FAILED** during cold phase; session20227, `issue260-full-workload-9cc9bcd.log`. No restart, retry or final receipt. Full cold+fresh-process qualification remains **PENDING**. |
| Actual-worker lease and bounded failure regressions |7 tests/2 suites PASS at `e3dc64a`; `issue260-green-workload-failure-receipt.log`. Strict fixture emit, type-aware lint, imports, syntax and diff checks PASS. Bounded tests do not qualify scale. |
| Current `npm run test:controlled-report` after harness repairs |164 Jest tests/14 suites plus generated declaration/tsd PASS; `issue260-harness-repair-controlled.log`. Current `check:examples` and `check:fixtures` PASS; `issue260-harness-repair-examples.log`, `issue260-harness-repair-fixtures.log`. Package baselines were not repeated. |

## Restored negative controls

Each mutation compiled before the named test failed its intended outcome
assertion; none was detected merely by setup/compiler failure. Exact source
bytes were restored after every control. The original receipts
`issue260-negative-*.log` and outcome summary `issue260-negative-controls.json`
remain available; all six relocated combined controls independently failed
their outcome assertions, then exact source restoration passed the combined
suite. Separate `issue260-combined-negative-*` receipts preserve that repetition.
The repaired combined suite at `b4773c2` passed157 tests plus generated tsd.

| Planted contract violation | Targeted outcome detection |
| --- | --- |
| `github.ts`: allow `incomplete_results:true` to close | Application `certified empty yields...`: expected failed strict fold, mutant succeeded. |
| `application.ts`: accept complete detail despite provisional quiet policy | Application `provisional current refresh...`: expected4 current detail bodies, mutant ran0. |
| `application.ts`: parent reads otherwise unread `fetched.data.labels[0]` | Same provisional-refresh test: changed unread label replaced exact person references. |
| `application.ts`: omit shared admission on GitHub source operations | Application `one configured fixed request gate`: a send violated the asserted minimum interval. |
| `application.ts`: label incomplete fold complete with fabricated empty report | Application `concrete execution handoff...`: expected incomplete, mutant complete. |
| `application.ts`: erase unknown usage and label it complete | Settling/failure `synthetic credentials...`: expected24 unknown attempts, mutant reported0. |
| Lost-model fixture: acknowledge fabricated zero usage for both lost model attempts while old GitHub gaps remain | `lost model responses...`: exact captured request-attempt identities were missing from unknown usage despite a still-positive unrelated total; `issue260-red-lost-model-specific-unknown.log`. Test bytes were restored before the157-case GREEN run. |

Independent CR-5 review also planted a late required-source failure after the
actual quiet/daily fetch for PR102/202. The former two policy tests still passed
while their current reports were incomplete. Strengthened assertions first
failed exactly at expected complete versus actual incomplete
(`issue260-red-cr5-policy-outcome.log`), then passed after exact application
restoration. All positive CR-5 runs now assert current strict success and
current-fold person references. Policy changes also require new affected-source
provenance and unrelated current acceptance/reuse; readable old History alone
cannot satisfy them. Lost-response assertions name both individual model
attempts before and after resume, independently from earlier GitHub usage gaps.

## Test-first and scoped review provenance

Outcome RED receipts precede runtime changes for protocol closure, roster/schema,
required evidence, actual facade assembly, currentness/context, strict handoff,
temporal basis, retry budgets/search association, scalar capture and provider
boundary repairs. The fixture-role tests observed3 forbidden-edge RED failures
before enforcement, then existing example controls plus new fixture tests passed.
The first full-check architectural RED remains preserved separately.

Independent adapter review PASS at `07d2372` and application/restart PASS at
`8a8cef1` remain scoped evidence. Provider `b223a4f` initially passed review, then
that disposition was explicitly superseded when three missing boundaries were
reproduced: zero `retry-after`, permissive JavaScript dates, and unsafe numeric
timing. `b057950` repaired them; review found the remaining RFC850 century pivot.
The receipt-relative correction at `da858fc` passed independent55-case review
and additional calendar/timezone/century probes. The workload branch
`363018b` passed its separate bounded repair review. CR-5/failure/privacy,
combined relocation/integration, full workload and final whole-head acceptance
remain separate supervisory review boundaries.

Combined review found that lexical `require` exemption admitted a Node
`createRequire` loader under named/aliased factory imports. A first intended RED
preceded excluding the factory's `node:module`/`module` entry through named,
aliased, namespace, default, dynamic, re-export, import-type and CommonJS edges.
A direct author probe then demonstrated the same capability through
`process.getBuiltinModule`. A second intended RED preceded the explicit
dot/literal-computed property and object-pattern/destructuring restriction.
Caller-supplied `require` parameters and plain payload keys remain allowed.
Receipts `issue260-red-fixture-create-require.log` and
`issue260-red-fixture-builtin-loader.log` preserve the failures; all376 tooling
tests and affected actual import/fixture/example checks pass after the bounded
repair. Its independent recheck passed at `9cc9bcd`; no universal bypass-proof
claim is made. The subsequent whole-head audit verified AC1–7 at that revision
while recording AC8 as failed/pending after the full attempt.

## Failed qualification and bounded harness repairs

The single full attempt used clean `9cc9bcd` and its historical postbuild
manifest `issue260-artifact-manifest-9cc9bcd.json` (SHA-256
`e4380a444c44b847ef86f2997a53f55b963c9554ad9712dfb7ac08320f591d62`).
The preserved tee log is `/private/tmp/issue260-full-workload-9cc9bcd.log`;
the failed durable directory is
`/var/folders/r4/j5y28vpj6258k4_0kn5f33s00000gn/T/issue260-controlled-workload-V1o1mN`.
Neither was repaired, resumed or removed. The root failure record is
`/private/tmp/issue260-full-workload-failure.md`.

Discovery closed over300 selected keys, with8 succeeded/292 pending and
`employee-009` first pending. Eight summary diagnostics directly identify the
request's writer lease as no longer current. Read-only partial Accounting
contains17136 operations/request attempts and2848 usage reports. History
contains2848 subjects each for assessment/detail/discussion,16 searches and8
summaries. The exact observed PR-ID set, route counters, phase elapsed and
RSS/heap receipt were not emitted and remain unavailable. These counts are
partial progress, not successful qualification.

The default30000ms lease expired inside one long fold request. Existing writer
guidance requires a lease exceeding the slowest request and renews at request
boundaries. `ce3bc7a` explicitly budgets the isolated qualification lease for
the existing12-hour parent timeout plus60000ms cleanup; longer dead-holder
recovery is accepted only for this store. A real worker regression crosses the
default lease after durable search publication and completes250 assessments.
Removing the actual workspace option compiles but fails at complete versus
waiting/`lease-lost`; exact restoration passes. A separate nine-person/window2
test completes one fold, confirming that the window bounds concurrency.
Valid RED/restored receipts are `issue260-red-qualification-lease.log`,
`issue260-red-qualification-lease-wiring-mutation.log` and
`issue260-green-qualification-lease-restored.log`. Independent lease review
PASS is recorded in `issue260-qualification-lease-review.md`.

`e3dc64a` replaces the whole-run failure dump with counts, one bounded first
pending key/reason and diagnostic, stop/floor state and actual route, payload,
concurrency and memory observations explicitly marked partial through return.
Parent failure artifacts retain measured elapsed/exit status and bounded child
evidence; missing child receipts remain `null` with a bounded stderr tail.
Both captured process streams have a1MiB limit. The actual worker still fails
under explicit lease expiry. Test-first RED receipts are
`issue260-red-workload-failure-receipt.log` (three intended outcomes) and
`issue260-red-workload-parent-receipt.log` (two). GREEN7-case and strict checks
are `issue260-green-workload-failure-receipt.log`,
`issue260-workload-failure-lint.log` and `issue260-workload-failure-imports.log`.
Independent failure-repair review remains pending. No new full150k run is
authorized by these repairs or their bounded tests.

No live/paid provider execution, credential inspection, external publication,
GitHub mutation, core API expansion, new persistence/retry authority or release
configuration is included. Examples and private test infrastructure require no
package release changeset.
