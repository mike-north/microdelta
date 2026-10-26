# Issue 260 controlled report evidence

This work record maps the concrete report to issue260 and parent240. It is not
full issue acceptance: the realistic150000-PR workload, import-boundary harness
placement, full baseline checks and final independent review remain pending
below. Parent240 retains its separately permissioned
executable/progress criterion and all six criteria; CLI projection, installation,
launcher/lifetime choices, full TEST-3/4 and TEST-5/6 remain separate gates.

The implementation starts from prerequisite-containing commit
`1dc9c401510c4c6e686bd43b91fcb4e23d4cdb24`. Every new source imports the generated
`microdelta.alpha.d.ts` facade and built package exports through the example's
strict compiler configuration. Type tests import the emitted application
declarations, never a private sibling source alias. Generated artifact hashes
and the final exact revision belong in the final acceptance record.

The [controlled application contract](../../examples/contribution-report/CONTROLLED_CONTRACT.md)
specifies the concrete REST field mapping, authored-PR population, fixed backing
dataset assumption, default unverified historical content, explicit controlled
scenario/cutoff guarantee and undetectable mutable-live-population limitation.
The fixture-base scenario independently specifies four PRs101/102/201/202 split
evenly between Ada and Grace; each has one submitted review, one conversation
comment and one inline comment, with known unedited content/activity before the
selected cutoff. This explicit harness assumption supplies temporal basis;
traversal completion and `submitted_at` do not infer it.

## Acceptance map

| Issue260 criterion; parent240 overlap | Actual application tests/artifacts | Current evidence |
| --- | --- | --- |
| 1 completed search, roster/schema/closure;240.1/4 | `protocol.test.ts`, `model.test.ts`, `evidence.test.ts`; application `two fresh paginated searches complete before each person details and assessments`, `certified empty yields no contributions` | PASS in current local tranche. Positive1001-PR cap bisection, observable closure/identity/continuation negatives and hidden-oracle live-mutation limitation are explicit. |
| 2 currentness/restart;240.2 | `application.test.ts` current source hooks, provisional refresh, membership, prompt/model/helper and shared-context tests; `restart.test.ts` complete process exit, exact source/assessment/person references, consumed versus unread change, failed traversal/root recovery | PASS for named cases. A changed consumed PR101 value reruns one assessment and Ada only; unread changes refresh source but retain exact assess/person references. Remaining targeted controls and broader criterion accounting remain pending. |
| 3 actual source/rate assembly;240.3 | Application `search, discussion, detail and assessment all consume one configured fixed request gate`; `provider-controls.test.ts` narrow search/core union, independent access, new-run shared cost, quantity cost, final stop/fence/intent | Cold four-PR run:24 GitHub requests +4 assessment sends,4 acknowledged reports/40 observed tokens; absent GitHub usage reports remain gaps. Settled restart:8 source hooks,4 search sends (2 when repaged),0 assessments and exact person refs. Controlled-clock actual facade proves provider floors, full mandatory gate union and definite-unsent reservation rollback. Final restored negative controls remain pending. |
| 4 trial/failure/stop;240.4/2 | `restart.test.ts` empty/single/widened trial, exclusion and environment isolation; SIGKILL after committed Ada/pending Grace; `settling-failure.test.ts` malformed model output and lost model response; application typed handoff | Named cases PASS. Empty trial sends nothing; excluded Grace has no expensive body. SIGKILL restart retains Ada and executes Grace's2 assessments. Malformed assessment publishes no reusable Ada assessment/summary but preserves acknowledged billing and successful Grace. Lost response exhausts finite allowance, leaves previous Ada readable and usage unknown; fresh allowance completes only missing Ada work. |
| 5 CR-2;240.6/3 | `retry.test.ts`11 normalization/budget cases; `provider-controls.test.ts`20 actual facade cases, including Retry-After seconds/date/reset, provider/local maximum, threshold/reopen/cancel, finite allowance, explicit operator rejection and deferred-only lease release | Focused31 tests PASS. Source-policy `stop` is explicitly distinct from operator rejection. Budget excess keeps the provider floor; explicit operator soft stop drains the admitted sibling JSON/diff body, while hard stop/immediate deadline prevents the remaining send and partial publication. Focused independent review and final controls pending. |
| 6 CR-4;240.6/2 | Evidence future closure/merge and post-cutoff-content negatives; application changed-cutoff guarantee refusal; restart equal child/exact parent evidence | Named cases PASS. Same observation cannot relabel a prior mismatched temporal guarantee. Application observation remains distinct from a provider snapshot and Tracking observation. Remaining coverage/accounting pending. |
| 7 CR-5;240.6/2 | `settling-failure.test.ts` independently final quiet/daily sources, advanced observation, per-policy change, late arrival, open/recent/future activity; model clipping/closed-day boundaries; temporal-basis negatives | Named cases PASS. Advanced observation refreshes only the provisional source. Late comment refreshes affected PR101 detail and assessment, retains unaffected detail and exact equal-score Ada summary, and leaves historical provenance readable. Changing only quiet/daily policy leaves the unrelated source exact; no global finality follows. |
| 8 workload/privacy;240.2–4/6 | `settling-failure.test.ts` public events/identities/diagnostics/report versus synthetic credential/header/model/context secrets | Privacy case PASS; absent GitHub billing remains24 unknown attempts. PENDING mandatory standalone150000 distinct qualified PR cold+independent-process restart and measured people/subjects/evidence/payload/operations/sends/memory/in-flight facts. Tiny fixtures do not replace this gate. |
| CLI handoff;240.5 remains open | `composeReport`, typed `evaluateReport`, `IReportRunOutcome`, generated declaration/tsd negatives | Concrete inputs/outcomes only. Strict `complete` requires succeeded framework fold; fulfilled incomplete body has no report. No CLI fields/framing or launch/lifetime decision. |

## Test-first and independent review record

Outcome tests were observed RED before the corresponding runtime behavior:
empty adapter stub20 failures; malformed roster/schema/settling outcomes;
required PR/review/comment evidence; concrete facade assembly4 failures;
per-person consumed context; typed strict executor; unverified temporal basis;
independent review's edit-time, semantic-Link, reverse-ID and temporal-basis
mutation cases. The parent's private local receipts retain the exact RED logs;
the named checked-in tests reproduce the expectations independently.

Initial protocol tranche `87b0c9e` was independently reviewed at its immutable
commit. Repairs `de057d0`, `fb3c91f` and `07d2372` preserve actual edit activity,
semantic Link binding, identity bijection, separate temporal basis and captured
per-operation scalar identity across awaits. Follow-up independent review is
pending. This preliminary review does not accept the final report/scale scope.

The frozen actual-facade checkpoint passed5 suites/74 tests, including
fresh-process tests; generated application/facade tsd assertions passed. The
subsequent provider tranche adds31 focused cases, all passing locally.
Protocol-only repaired tranche passes58 tests with type-aware lint. Final counts,
full baseline checks, changed imports/declarations, meaningful restored negative
controls, exact output references and measured workload must be recorded before
issue acceptance or PR publication.

The first provider test draft incorrectly expected a source classifier's `stop`
decision to itself request whole-analysis soft stop. The owning retry contract
explicitly separates source classification from operator rejection. Those
expectations were corrected without a runtime change, then the separate accepted
soft/hard/deadline rejection boundary was exercised through the existing stop
controller. Likewise an unconfirmed usage-intent write's durable backoff remains
binding; reservation rollback is proven using an independent new source address
on the same shared gate, rather than bypassing that retained not-before time.

Independent provider review of `b223a4f` was superseded to repair required when
the author exposed three uncovered boundaries: zero selected delay must produce
`retry-now`, malformed JavaScript date strings must not establish rate evidence,
and unsafe seconds/conversion/addition must not produce a provider floor.
The corrected tranche has27 direct normalization/budget tests and22 actual-facade
provider tests passing, plus strict example compile/lint. Additional test-first
date cases reject calendar rollover, weekday mismatch and hour24, and preserve
supported obsolete HTTP forms with an explicit GMT interpretation. Direct429
status and independently valid reset evidence survive an invalid Retry-After.
The actual facade also proves an early timer wake cannot send early, cooldown is
published before a slow classifier returns, accepted local delay begins at the
decision boundary, and cumulative-budget refusal retains the provider floor.
These scoped repairs await independent re-review at their frozen revision.

## Restored negative controls

Each control below compiled before running the named test; every mutant then
failed its intended outcome assertion. Exact source bytes were restored after
each control, and all134 controlled Jest tests plus generated declaration/tsd
passed after restoration. These are behavioral detections, not compiler/setup
failures. Source paths below are relative to this example's controlled sources.

| Planted violation | Targeted test and observed detection |
| --- | --- |
| `github.ts`: allow `incomplete_results:true` to close | Application `certified empty yields...`: expected failed strict fold, mutant succeeded. |
| `application.ts`: accept complete detail despite provisional quiet policy | Application `provisional current refresh...`: expected4 current detail bodies, mutant ran0. |
| `application.ts`: parent reads otherwise unread `fetched.data.labels[0]` | Same provisional-refresh test: changed unread label replaced exact person references. |
| `application.ts`: omit shared admission on GitHub source operations | Application `one configured fixed request gate`: a send arrived5ms after its predecessor against the asserted minimum7ms. |
| `application.ts`: label an incomplete fold complete with a fabricated empty report | Application `concrete execution handoff...`: expected incomplete, mutant complete. |
| `application.ts`: erase unknown usage and label it complete | Settling/failure `synthetic credentials...`: expected24 unknown attempts, mutant reported0. |

The controlled-suite restored result is134 tests/8 suites plus generated tsd.
The first full `npm run check` discovered12 import-boundary violations solely in
the independent harness: History/Node oracle imports currently fall beneath the
example's facade-only rule. All other package/workspace checks passed. The
governing facade-only rule remains intact; the proper harness role/placement is
being resolved before repeating that gate. Repository test/build gates continue
separately; this record makes no passing baseline claim yet.

Reproduce after building prerequisite packages:

```sh
npm run build:packages
npm run test:controlled-report
npm run check:examples
```

No live provider, paid execution, credential inspection, external publication,
GitHub mutation, core API expansion or new persistence/retry authority is part of
this work. Examples and private workspace test wiring require no package release
changeset.
