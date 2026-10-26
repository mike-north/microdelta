# Issue 260 controlled report evidence

This work record maps the concrete report to issue260 and parent240. It is not
full issue acceptance: remaining failure/policy cases, realistic150000-PR workload,
restored negative controls and full baseline
checks remain pending below. Parent240 retains its separately permissioned
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
| 4 trial/failure/stop;240.4/2 | `restart.test.ts` trial widening/environment isolation and SIGKILL after committed Ada/pending Grace; application incomplete typed handoff | PASS for named cases. SIGKILL receipt is written only after Ada publication; restart retains Ada and executes Grace's2 assessments. No partial Grace success; unreported request usage stays unknown. Additional loss/exhaustion/rejection/stop controls pending. |
| 5 CR-2;240.6/3 | `retry.test.ts`11 normalization/budget cases; `provider-controls.test.ts`20 actual facade cases, including Retry-After seconds/date/reset, provider/local maximum, threshold/reopen/cancel, finite allowance, explicit operator rejection and deferred-only lease release | Focused31 tests PASS. Source-policy `stop` is explicitly distinct from operator rejection. Budget excess keeps the provider floor; explicit operator soft stop drains the admitted sibling JSON/diff body, while hard stop/immediate deadline prevents the remaining send and partial publication. Focused independent review and final controls pending. |
| 6 CR-4;240.6/2 | Evidence future closure/merge and post-cutoff-content negatives; application changed-cutoff guarantee refusal; restart equal child/exact parent evidence | Named cases PASS. Same observation cannot relabel a prior mismatched temporal guarantee. Application observation remains distinct from a provider snapshot and Tracking observation. Remaining coverage/accounting pending. |
| 7 CR-5;240.6/2 | Model quiet/daily boundaries; independently retained discussion daily and detail quiet sources; comment-edit/future-activity negatives; default unverified temporal-basis refusal | Named cases PASS. Report-level independent policy/late-arrival cases still pending. |
| 8 workload/privacy;240.2–4/6 | Default semantic fixtures and checked-in no-live guarantee are present | PENDING mandatory standalone150000 distinct qualified PR cold+independent-process restart, measured people/subjects/evidence/payload/operations/sends/memory/in-flight facts and privacy assertions. Tiny fixtures do not replace this gate. |
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
