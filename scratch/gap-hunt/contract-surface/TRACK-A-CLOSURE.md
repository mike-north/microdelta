# Track A: seven-file claim closure

Codex worker (gpt-6.1-sol), operating for Mike North. Baseline c5802da; later fixture commits through b1b42c3. This is an assertion-level closure ledger for `docs/spec/{README,domain,architecture,package-boundaries,experiments,reconciliation,validation}.md`. The preserved 245 paragraph/row inventory remains `clause-map.json`; this ledger groups clauses only when the same concrete assertion checks the stated outcome. A shared ID or a whole suite count is never the assertion.

**Verified** below means the stated current bounded outcome was executed and passed. It is not downgraded merely because inputs are finite. **Gap** means an observed divergence. **Unproved** names a concrete claimed outcome without evidence in this pass. **Target** means not delivered in the selected current surface. **Process** means a workflow/review obligation, not runtime behavior. **Historical/mechanism** means evidence about the dated artifact or bounded candidate only. No whole-file green status is claimed.

## Executed evidence keys

Paths in the following tables are repository-relative; source line anchors identify the actual test assertion, not just an ID comment. Logs are under `scratch/gap-hunt/contract-surface/logs/` unless qualified.

| Key | Executed command/result and durable output |
| --- | --- |
| G | Declaration/wiring/trim tooling 34/34: `gates-tests.log`; actual generated fixture build and `check:imports`, `check:declarations`, `check:wiring` pass in `build-fixtures.log`, `imports.log`, `declarations.log`, `wiring.log` |
| Q | Context-boundary/quality/API/formal-retirement tooling 41/41: `additional-foundation.log` |
| P | All 11 packages configured strict compiler and type-aware lint pass: `check-packages.log` |
| O | Machine Node 83, Materialization 34, History 44, Accounting 54, Supervision 193, including their tsd/public gates: `owner-contracts.log` |
| R | Explicit workspace and Resolution suites 130/130: `workspace-resolution.log` |
| W | Facade external-operation 15/15: `workspace-operations.log` |
| E | Executable contribution example 8/8 across processes: `example-matrix.log` |
| X | Bounded mechanisms EXP1=24, EXP2=28, EXP3capability=5/publication=16, nested=12, EXP4=59, EXP8=73 and their type gates: `experiments.log` |
| D | Selected local docs/anchors/source-map/scenario uniqueness4/4: `doc-structure.log` |
| F | Synthetic externalconsumer 3/3: `scratch/gap-hunt/consumer-dx/logs/jest.log`; current generated-alpha tsd in `scope-tsd.log`, `authoring-matrix-tsd.log`; array/source/gate process matrix 1/1 in `authoring-matrix.log` |
| C | Deterministic acceptance/array amplification failures in `scratch/gap-hunt/scale/logs/{acceptance-test-failure,array-test-failure}.log`; bounded 100k timeout/final state in scale FINDINGS.md and named logs |
| T/V/B | Contracts worker's executed semantic Tracking73/Value50/Definition281 evidence, recorded by that worker; source anchors are identified below. These are shared evidence, not this worker's runs. |

Short source labels below denote owning test files: `source-policy` and `summary-validation` are under `packages/core/test/resolution/`; `scope` and `admission-observers` under `packages/core/test/workspace/`; `composition` and `template` under `packages/definition/test/`; `observer` under `packages/tracking/test/`; `navigation` under `packages/value/test/`; `materialization` and `nested-view` under `packages/materialization/test/`; `completed-results` under `packages/history/test/`; `supervision` and `accounting/summary` under their owner packages' `test/` folders. G/Q tooling names are under `tooling/`. Numbers after these labels are test source line anchors. X anchors refer to the named experiment's test files and corresponding executed experiment log.

## README: authority, process and actual checkout claims

| Clause/current claim | Concrete assertion/evidence | Closure |
| --- | --- | --- |
| SPEC-1 one active authority; links are readable | `doc-structure.test.mjs:23` checks selected local targets/anchors; `:49` resolves every source-map target. Archive notice and authority text reviewed | Verified artifact consistency; authority/conflict resolution is Process |
| SPEC-2 target/proposal/experiment/deferred are distinct | This ledger preserves the categories; EXP2 async-getter and EXP5/6/7 limits below remain explicit | Process/review; no runtime assertion can adopt a proposal |
| SPEC-3 outcome-first tests and durable semantic comments | New issue probes assert independent expected values/references before fixes; no fix supplied. Current comment/lint enforcement Q, e.g `tooling/quality-gates.test.mjs:83` rejects unexplained suppressions | Current checks verified; historical tests-first order and semantic adequacy of every comment unproved Process, not runtime gap |
| SPEC-4 independent-process/fault evidence differs from model/memory/compiler | E launches separate Node processes; X publication kills at named pre/postcommit boundaries; G tests generated type fixtures separately | Verified evidence separation for named runs; no model→runtime inference |
| SPEC-5 foundation/checks and experiment gates; no active CML/dormant Lean | `tooling/foundation-wiring.test.mjs:23,155` detects missing checker wiring; `formal-tool-retirement.test.mjs` exercised in Q rejects retired CML script references | Verified current wiring; historical sequencing and paid/publication authorization are Process |
| Artifact conventions: stable IDs, relative links, source-map, explicit JSON expectations | D checks unique definitions, local targets, mapped artifacts and distinct scenario IDs/expected outcomes | Verified selected artifacts; reuse-cases JSON remains specified-not-executed |
| Current public HistoryStore preserved; private alpha owner paths and generated surfaces | G `declaration-boundaries.test.mjs:117,125,165,232` compiles normal Store/conformance consumers and closed views; F consumer imports the facade API using required owner declaration mappings; facade-only path mapping fails as recorded in #154 | Verified bounded package surface; external durable alpha remains unsupported intentionally |
| Current selected Value/Tracking/Materialization components | ARC002/004 rows below; selected reader requests and output detachment tested | Verified within supported domains; output reuse composition gap listed below |
| Current durable authority/current source/direct child/admission/observer/recovery workspace | R source-policy 91/116/152; summary-validation94/134/208; workspace admission88/158/228; E recovery/restart tests | Verified named outcomes; not a full unbounded runtime guarantee |
| Current Node injected context/snapshot/SHA | O Node Machine13/25/44/83/112; Q host confinement; G portable generated consumers | Verified current Node contract |
| Dated M0.5/M1/M2/M3/M4/M5 acceptance links | D verifies reachable local record paths, not historic merge/CI or every fault rerun | Historical acceptance records; no new milestone decision inferred |
| General CLI, distributed/multiwriter and full scale absent | No CLI/extra-host constructed; C 100k bounded run did not complete | Target, not a failed delivered CLI promise |

## Domain: outcomes and distinct axes

| Clause | Concrete executed assertion | Closure / concrete residual |
| --- | --- | --- |
| DOM-1 retained analyses survive complete process exits | E `keyed-cold-and-restarted-report` asserts zero bodies and exact references in a new process; F authoring matrix asserts exact summary reference after exit | Verified current restart lifecycle |
| DOM-1 cost is author-selected, not LLM/network/time classification | F deterministic TypeScript synthetic assessor/bisection and E deterministic scoring use the same memo lifecycle; no pricing classifier exists | Verified bounded CPU/local work; real nondeterministic/provider execution not performed, not required to prove these fixtures |
| DOM-2 implicit scoped context with environment and cancellation/resource facilities | R `workspace/scope.test.ts:37,48,213,243,296` asserts context across await, outside/closed rejection, composition rejection, concurrent envs and volatile-runid reuse; W operations 122/152 usage+environment; F scope-tsd compiles currentRun/currentExecution APIs | Verified delivered implicit lookup. Storage/services are composition/helper supplied, not a service container field; no interface form mandated |
| DOM-2 ordinary nonmemoized work observable | R `workspace/admission-observers.test.ts:274` asserts ordinary assembly every run/no reference; O `supervision.test.ts:637` asserts begin/end/no memoization | Verified |
| DOM-3 selected storage-backed reads load only needed content | O `materialization/nested-view.test.ts:163,182` asserts exact requested paths and no avatar/notes/unread fields; `:213` comparison performs no payload read; `materialization.test.ts:155,232` fingerprint only vs positive payload control | Verified supported synchronous reader. General async access/cache eviction/prefetch remains Target |
| DOM-3 admitted fanout memory and enormous sources | F open snapshots allow early members; C1k/10k all member outputs succeed, independent fold arithmetic succeeds | Concrete unproved: admitted fanout memory bound as corpus cardinality grows. 100k discovery failed to complete in 30min; no correctness/throughput result |
| DOM-3 no needless storage/materialization amplification | C acceptance rows1,2,3 vs expected1,1,1; array validation work1323→5043 for20→40 while encoder20→40 | Gap #159/#160, separate from selected-read correctness |
| DOM-4 identity/content/readiness/source acceptance/admission/cost separate | R source-policy116 fresh-equal distinct vs152 explicit retain exact; summary134 new source/unread preserves parent; admission88 hit before deny; F open 2→closed4 preserves first 2; W unknown/no port/env usage controls | Verified tested distinct axes; no inferred cost-based identity |
| DOM-5 non-goals | No partial JSstack/closure serialization/purity/native class/distributed behavior claimed | Explicit exclusions, not missing current acceptance |
| DOM-6 unread/consumed/title/implementation/selective reference behavior | R summary-validation 134 unread source edit,157 consumed edit onlyown summary,181 called formatter edit,196 uncalled helper edit,208 changed child impl+equal output cutoff,381 intermediate profile rebound; source-policy 91 current hook | Verified bounded worked behavior; unrelated member reference preserved explicitly |
| DOM-2/ordinary authoring broad route | F custom key1red2green and generatedtype checks: source+custom key compiles, declaration rejects no-string-identity schema; optional phantom identity control succeeds actual member work | Gap #168 under settled COL1/CMP4 alternative; CUSTOM-KEY-PICKUP.md. Scalar root #156 excluded from new audit |

## Architecture: owned invariants and current seams

| Clause / actual invariant | Concrete executed assertion / port check | Closure |
| --- | --- | --- |
| ARC001 six peer owners, not seven/nine contexts | `tooling/package-architecture.mjs` six context entries reviewed; Q `context-boundaries.test.mjs:29,58,78` allowed edges/absent roles/forbidden bypasses | Verified package enforcement + responsibility review; not inferred from package count |
| ARC001 Definition graph/bindings ownership | B `composition.test.ts:127,139,164,480,498,514,539` freeze/no execution/fresh alloc+reorder/label independence/missing/ambiguous | Verified listed binding invariants |
| ARC001 Tracking grammar/capture/comparison ownership | T `observer.test.ts:326,340,352,548,557` supplied fact comparison/membership/identity/presence/implementation; no store in fixture | Verified component boundary |
| ARC001 Resolution acceptance/current policy/cutoff ownership | R source-policy 91/116/176/204/217/231; summary134/157/208; admission88/133 | Verified bounded acceptance phases; materialized-output cases Gap #164 (input/member/argument) |
| ARC001 History claims/publication/reference/acceptance ownership | O exact reference `completed-results.test.ts:66`; X publication166/194/263/278/335/430 named atomic/crash/fence/lost ack controls; R source-policy152 separate acceptance | Verified exact outcomes; realcurrent backend broader fault qualification is durability worker evidence, not inferred from prototype |
| ARC001 Supervision lifetime/admission/stop/status ownership | O `supervision.test.ts:320,324,356,379,487,533,739,801` outside/await/isolation/closure/lease/admission/status distinctions | Verified bounded supervisor contract with injectedservices |
| ARC001 Accounting units/ack/dedup/gaps ownership | O `accounting/summary.test.ts:35,55,69,97,119,138,157` complete/unknown/known units/estimates/units/per request/per operation | Verified bounded component. W122/152 assembly attributes to environment/run; not inventing provider bill |
| ARC002 Value canonical addresses/fingerprints separate fromconsumption | V `navigation.test.ts:30,42,101`; Xexp2 `value.test.ts:51,60,72,79,128,137` PropertyvsIndex/holes/order/snapshot/independentdigest/unsupportedreject | Verified supported value semantics |
| ARC002 numericobjectkeys alias; symbols explicitreject; frameworkbrand not userdata | X exp2 value51/137; Vnavigation101; T observer533 position/length and548 presence/keyoperations | Verified chosen cases; no logicalmemberidentityfromposition |
| ARC002 Materialization immutableviews+port-basedselectedloading/noeligibility | O nestedview163/213/263/439/461 and materialization 155/354/544 show exact reader/readonly/output/projectioncapability | Verified selectedreader/observer boundary; no freshnessdecisionport supplied |
| ARC003 directed contracts/reverse injection/no private bypass | Q context29/71/78/98/156; G declarations436/465; W122 injectedAccounting; O history machine12 injected failure | Verified approved edges and exercised injection. General CLI/provider adapters Target |
| ARC003 inspection never computes | R admission 158 check only no writes/no admission; W inspection/usage retains observed operations; E recovery/check tests | Verified current inspection/check surfaces; no shippedgeneral CLI claim |
| ARC004 Tracking independently usable/no wrapping memoization | T observer 52/68 standalone capture;557 two ordinary calls/called impl only; X exp1 restart99 serialized facts/no live tokens | Verified bounded independent Tracking. Arbitrary closures explicitly excluded |
| ARC004 changedcalled implementation automaticinvalidation; fingerprintnotlocator | R summary181/196; B composition498 renamedfunction/label same correspondence; R source-policy176 changed retrieval rejects before hook | Verified |
| ARC005 fixed graph vs runtime instances/gates; no result topology | B template 116/150/164/180 factory once/builders closed/copied frozen; composition164 no execution; Xexp4restart215/226 topology unchanged ongate flip | Verified bounded templates/gates; no result created graph |
| ARC005 no label/ordinal/live identity locator; honestmissing/ambiguous | B composition 480/498/514/539/598/622; R summary461 missing child slot yields miss without guessed reuse | Verified bounded reconnect |
| ARC005 no arbitrary serializationofunrelated branches | Current real tests use declared precedence/configured window; scale independent wide/deep arithmetic passes | Concrete unproved: scheduling parallelism/memory invariants beyond named configured single writerfixtures. No arbitraryglobalO1 guarantee |
| ARC006 retained candidate is not current validity | R source-policy 91 every later hook,176 impl before hook,204 inputs before hook,217/231 bad hooks fail; summary208 childvalidation/cutoff | Verified bounded current policy andhierarchy; #164 avoidable rerun remains Gap |
| ARC007 one Historyconsistencyowner; exact immutablefreshvsretain | OHistory 66 exactold; R source-policy116/152; summary340 rollback oldwithout pointer rewind; X publication263/278/335/482 | Verified named completion/reference/fence outcomes; no competingauthority found by edge checks |
| ARC008 binding catalog fakes and persistence free observation | B compositionfresh catalog tests480/514/539; T observer fixture standalone no History | Verified isolated component seams |
| ARC008 fake current facts/source policies/child resolvers | R fixture world.remote/check/finality controlled values; source-policy 91/217/231; stop resolution-port142–166 scripted execution; broad R composes real History/Tracking/Definition | Current facts/policies/execution doubles verified. Concrete unproved: separately isolated child resolution outcome seam. Existing callback surrogate may satisfy intent; ARC-008-REVIEW.md, no confirmed runtime bug |
| ARC008 History deterministic crash/stale holder; supervisor fake clock/admission/execution; Accounting ack/gaps; selected materialization | X publication named kill controls; O supervisor fixture fake ports; O Accounting summary+write failuretests; O Materialization nestedreader requests | Verified named component/fake outcomes; prototype fault evidence is not fullcurrent backend qualification |
| ARC008 tests first/assemblydoes not replace unit | O and E/X/R reported separately; no fixesin this audit | Process historical order not audited; no runtime failure inferred |
| ARC009 shapedAPIs+checks govern; no parallelCML | G surfaces/consumerchecks; Q API47/61/73/86 andformal retirementcounterexamples | Verified current mechanicalchecks; boundary changeupdate sequencing/human review Process |
| ARC010 Machine portable host only, Node first, invariant owners unchanged | Q context98/127/156/190/213/248 tests runtime imports/globals/native/ambient confinement withtest exceptions; G portable consumer400/426 | Verified current boundary. Historical scaffold paragraph not a current nonconformance claim |
| ARC010 capability failure semantics+Node conformance+injection | O Node Machine13/25/44/65/83/112 digest/await/nesting/concurrent/errors/snapshot/unsupported; O history machine12/34 injected failure/reentrancy | Verified named host capabilities. No speculative host/capability required |

## Package/API enforcement: all current mechanical outcomes closed

| Clause | Exact assertion(s), executed G/Q/P | Closure |
| --- | --- | --- |
| PKG001 settled names/coarse boundaries/own-source typecheck/siblings declarations | G declaration82 realpackages/views;382 approvedownermaps; Q context29/78; P11 packages | Verified mechanical facts; package granularity semantic judgment reviewed |
| PKG002 TS access/#privacy/tier separate | G151 ownuntrimmed internal vsunexported;165 public only;181 real JS runtime imports | Verified testedtype/runtime-resolution distinctions; no runtime privacy inference |
| PKG003 internal underscore, alpha/private, beta opt in/public default; types/exports agree | G151/158/165/173 four actual consumers; Q API47 unclassified/internal names; G181 runtime package exports | Verified fixture distribution/type boundary; no actual beta/public publication performed |
| PKG004 own/sibling/external resolution; build before consumers; no fallback/deep alias | G151/158/165/173/181;299 missing producer/testsource alias;345 inherited alias bypass;436 wrong tiers/edges;465 alpha closure | Verified positive/negative intent diagnostics |
| PKG005 every export classified/closed trimmed views/report drift/import analysis | Q API47/61/73/86/106; G232 all actual views closed; Q context78 imports | Verified current mechanical enforcement. Human API report review Process |
| PKG006 shaped checks selected/CML retired/structural not behavioral | Q formal retirement script/lifecycle negatives; API report comparison control; R/O behavioral outcomes independently reported | Verified active gatepolicy and separate evidence |
| PKG007 fixtures 1–4 actual four tiers + hidden leaks | G151/158/165/173/232; negative boundaries checked for intended reason | Verified current fixtures; test before-configuration historical order Process |
| PKG007 fixture 5 bypasses/missing producer | G299/326/345/436/465/550; Q context78 reexport/source/deep/facade/unknown | Verified |
| PKG007 fixture 6 ownership/signature/tag/edge changes | Q API73/86/106 report counterexamples; Q context29/78 edges | Verified |
| PKG008 strict production/test/experiment real type program | Q quality57/65/73 per three scopes;109 new location fails closed;128 exact optional/index/declaration;152 type-contract files; Pactual packages | Verified configured current commands |
| PKG008 required checkers/producer/source bypass; four consumer views; clean CI wiring | G foundation23/155; declarations299/550; Q quality119 nested experiment; G four views above | Verified wiring+fresh generated checks. Historicalbefore M1andremote CIrun not asserted |
| PKG008 validation deliberate breaktag/import/typed lint then restorepositive | Q API86;context78;quality65/73; G positive consumers | Verified local mutation controls; historical scaffold paragraph is not a current claim |

## Experiments: candidate evidence does not become full-runtime proof

| Clause | Concrete executed assertion(s) | Closure |
| --- | --- | --- |
| EXP0 bounded fixtures/fake paid work/repro/results/counterexamples/limits | X commands+bounded decision documents; current gap fixtures preserved with exact expected failure logs | Verified current artifact/replay presence; tests first/adoption sequence and recommendation quality Process |
| EXP0 foundation prerequisite | G/Q/P present; formal retirementcontrols active | Verified current checks; historical before-experiment order not audited |
| EXP1 bindings/implementation/version/rollback candidate | X exp1 restart37 fresh allocations + reorder exact references;75 rollback without rewind;89 rollback still checks input;99 serialized facts, no live state; protocol tests invoked X | Verified bounded mechanism. Real Rsummary94/340/364 independently checks analogous current outcomes |
| EXP2 values/order/snapshot/address/unsupported candidate | X exp2 value33/41/51/60/72/79/128/137/162/186 exact semantic cases | Verified bounded mechanism; supportedcurrent Value/Tracking evidence above |
| EXP2 selected/fingerprint/output/projections candidate | X exp2 materialization41 zero payload + positive;52 unread avoidance;63 emitted fields;139 uniform one fact;159 visited coverage;167 getter rejection | Verified bounded mechanism; async preparation116 is a bounded candidate and was rejected as a general getter answer. General cache/prefetch Target |
| M3 nestedreader selecteddecision | X nested12 plus O nestedview163/182/213/461/593 single leaf/array positions/no payload/output fact/async storage invalid | Verified bounded synchronous exact reader; publication/scale/cache/projection index explicitly outside mechanism |
| EXP3 pre/post-commit kills/allocation/staging/fence/lostack/oldrefs/schema | X publication104/120/138/166/194/209/224/263/278/292/335/430/482/529/535/541 | Verified single-writer SQLite candidate only. Broader backend/power loss/liveness not established by this prototype |
| EXP4 nested recipes/cutoff/graph/keys/gates/folds | X restart57 current hook + exact;76/86 equal vs changed output;184 duplicate before work;195 custom key;215/226 gate flip;242 frozen builder;250/260 changed correspondence;271/308 states/open work;329 persisted no-live tokens | Verified bounded mechanism. No-string-identity authoring Gap measured separately; arbitrary closure soundness excluded; deeper nesting/general pending reads/tolerant folds outside this mechanism |
| EXP8 stop/drain/defer/usage/remote state/observer/private events | X restart105 before T no admission/after T retry + sibling reuse;180 sleep without lease;199 hard abort unknown/no replay;227 soft drain;246/277 intent/effect unknown;290 acknowledgement lost/usage once;304/324 pre/postcommit;336 observer failure;346 duplicate report | Verified fake-provider mechanism; M5 current O/W cover their adopted bounded pieces. No arbitrary JS forced abort/general paid-provider proof |
| EXP5 retirement standing rule | Q formal retirement rejects active CML scripts including lifecycle; source archive paths D | Verified standing policy; retired pilot historical, not a runnable gate |
| EXP6 dormant Lean standing rule | Q formal-tool guard/current package checks show no active Lean gate; no Lean installed/rerun | Verified current dormancy; old theorem historical, no fresh proof claim |
| EXP7 selective model review conditional policy | No new model question selected; durability worker owns any current model-to-code review; no old model run reclassified here | Conditional process, not missing required routine checker; old finite evidence historical |

## Reconciliation and historical validation

The 23 explicit supersession rows and 17 preserved original target rows are **active cross-references**, not 40 new independent runtime claims. Their surviving current outcomes are covered by the owning rows above (subject/binding, observation, cutoff, exact publication, explicit retention, supervised work, accounting, package edges). Their CLI/explanation/dry run/distributed/150k scale entries are target/deferred scope. Examples in these rows are not adopted API spellings. D checks their local references/source-map; this does not make source-map coverage a runtime proof.

Scaffold migration 1–5, artifact provenance/archive handling and model claim limits are **Process/artifact policy**. G/Q verifies current package checks and no source alias/CML bypass; D verifies selected links/source-map/scenario format. Whether every historical migration commit obeyed sequence, comment quality or review is unproved process; no retroactive runtime claim follows.

`validation.md` is entirely **historical M0 evidence dated 2026-09-26**. Its 119 defining IDs, 19 scenario suites and four tooling tests are historical reported counts, not rerun claims. D independently reran selected current four checks; those pass, but neither repeats the whole historical scope nor executes reuse-cases.json. No CML/Lean/TLA/CLI/package extraction/restart proof is inferred from this record.

## Concrete remaining closure work

1. **Observed gaps, current code:** #159 acceptance acknowledgement readback amplification; #160 repeated root-array validation; #164 materialized-output current facts input/member/argument rerun; custom key-only declaration gap; known scalar root #156 and other workers' correctness issues remain outside this new matrix. Passing generic rows above do not waive these cases.
2. **Unproved delivered property:** DOM3 admitted fanout memory bound as corpus grows. 100k was capped at 30 minutes, one attempt/zero completed results; no proof either way of correctness/memory bound. Candidate history growth is separately measured by gap-hunt-dx-candidate-growth.test.ts: 100/500/1000 eligible results require 215/1015/2015 SQL statements; unrelated-history controls remain at 17. See scale/CANDIDATE-GROWTH.md; this is not acceptance-history readback.
3. **Open seam evidence:** ARC008 separately isolated child resolution outcomes; known fake facts/policies/execution controls are real and pass. Need concrete accepted seam test or interpretation, not a new interface by name or mock count.
4. **Target scope:** cache eviction/reclaimable materializations/prefetch/general async storage (DOM3), general CLI inspection/preview/adapters, broader distributed/worker/backend qualification andfull scale acceptance. Current bounded APIs do not claim delivery of these.
5. **Process only:** historic tests-first/adoption sequence/human API and comment review. Current mechanical checks and all new probe outcomes are executed; an unreviewed historical sequence cannot be completed by inventing a runtime test.

No row is left “partial” merely for lacking a mathematical proof. Remaining items name an observable outcome, an explicit undelivered capability, or a specific process/seam evidence gap.

Follow-up pickup links: #168 explicit custom keys; #169 async source declaration gap (direct/template fresh/retain); #170 unlabelled M7 controlled discovery workflow target. Async source compiler evidence and independent runtime controls are in consumer-dx/ASYNC-SOURCE-PICKUP.md; M7 diagnostic and conditional criteria are in consumer-dx/M7-WORKFLOW-PICKUP.md. Neither is a completed M7 acceptance claim.
