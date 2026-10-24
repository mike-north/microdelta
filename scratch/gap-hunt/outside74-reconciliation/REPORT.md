# Finite outside74 reconciliation

Frozen runtime/source: `e3e1920a1300b4205b5c417f98d1202e75f2d3ba`. 58 historical DX paragraph rows and 16 operational rows are reconciled individually in [reconciliation.json](reconciliation.json). These are overlapping inventory units, not a whole-spec denominator.

Current execution: **270 passed runtime cases across 19 selected files**: 205 Jest cases in15 files and 65 Node cases in4 tooling files. The parser finds 229 real declarations; parameterized/dynamic declarations expand to multiple runtime cases. Every runtime case maps to exactly one assertion declaration and all declarations have an executed case in [runtime-assertion-index.json](captures/runtime-assertion-index.json).

75 genuine lexical anchors are carried separately (Machine21 and Tracking54) with previously executed exact runtime evidence and unchanged relevant source closures verified through this pin. They are not new execution. Machine historical execution had85 cases/8suites; Tracking54 used the documented historical root support overlay, so no pristine historical full-build PASS is inferred. See [carry qualifications](captures/carried-qualifications.json).

The lexical294 inventory remains untouched. Its218 selected-file strings are not a runtime denominator. Four split-call strings are false lexical anchors; the selection lists them. Newer genuine declarations and parameter expansion explain why runtime/declaration counts cannot replace lexical counts.

## Setup correction and boundaries

One fresh install and one package build preceded the15 Jest files and context gates. Initial declaration tooling failed6/23 because its generated fixture declarations were absent. This is an evidence-runner setup failure, excluded from product findings. A single build:fixtures then preceded only the affected declaration suite and the two remaining tooling files. No Jest/context rerun or product change occurred. Both execution stages record complete before/after source hashes and commands. The final clean-checkout runner includes that prerequisite; its complete revised sequence was not rerun after the correction. AST inventory was executed separately during the initial stage and is now included in the final recipe.

Node24/macOS only. No paid provider, Linux, publication or whole-suite execution. Selected tests intentionally mutate temporary fixture/source configurations and restore them; complete tracked source hashes match the frozen source before and after each stage. Logs replace checkout, executable and temporary host paths; private originals retain byte-identical raw evidence.

## Per-row decisions

Each row links its owner assertion inventory; evidence prose states which behaviors are relied on and names residual obligations. “Aligned” means bounded agreement, not exhaustive completion. No new product divergence was observed. Informative overlaps remain inherited; process chronology and scale remain insufficient evidence.

| DX row | Owner | Disposition | Evidence and residual |
|---|---|---|---|
| 0: docs/spec/domain.md:7 | DOM-1 | aligned | Cold/unchanged/reordered/renamed restart retains exact references; changed-input and code transitions cut off only eligible consumers. CPU-neutrality supplement independently covers ordinary CPU work. **Residual:** Hours-long operation and scale remain unmeasured. |
| 1: docs/spec/domain.md:13 | DOM-2 | aligned | Public scoped-authoring acceptance paths and lifecycle reject late closed-scope use, restore nested context and isolate concurrent environments. **Residual:** Clarity is a usability judgment; no general author study. |
| 2: docs/spec/domain.md:21 | DOM-3 | insufficient-evidence | Selected scalar paths and metadata-only restart validate bounded loading; no root payload read for the tested consumers. **Residual:** 150k-member source, ten narrow consumers, bounded cache and fanout measurements remain #159/#160/#173. |
| 3: docs/spec/domain.md:34 | DOM-3 | inherited | Glossary cross-reference supplies vocabulary to DOM-3; it is not another independent runtime obligation. **Residual:** Definitions must remain consistent with their owning contracts. |
| 4: docs/spec/domain.md:39 | DOM-4 | aligned | Fresh equal source has distinct identity while equal consumed output retains summaries; retention, acceptance and execution are asserted separately. **Residual:** Only exercised identity/content/readiness transitions are established. |
| 5: docs/spec/domain.md:59 | DOM-6 | aligned | Unread labels/avatar keep exact summaries; consumed merged/review changes reevaluate only Ada; changed called helper invalidates, uncalled helper does not. **Residual:** Example establishes bounded behavior, not arbitrary purity. |
| 6: docs/spec/domain.md:67 | DOM-6 | inherited | The paragraph explicitly limits the worked example: provider coverage and arbitrary purity are outside its claim. **Residual:** No provider validator or purity proof inferred. |
| 7: docs/spec/architecture.md:11 | ARC-001 | aligned | Source/import boundary gates reject forbidden context and facade edges; required package graph/build-order checks enforce the six-context arrangement. **Residual:** Tested forbidden edges do not independently prove every domain responsibility. |
| 8: docs/spec/architecture.md:18 | ARC-001 | aligned | Reordered registration and labels retain correspondence; missing or ambiguous current binding fails without child work. **Residual:** Definition ownership is also architectural judgment; only selected cases executed. |
| 9: docs/spec/architecture.md:19 | ARC-001 | aligned | Standalone local tracked cells/derived values and observer carried assertions validate operation facts without store/run. **Residual:** Not a universal observation-semantics proof. |
| 10: docs/spec/architecture.md:20 | ARC-001 | aligned | Current finality and source implementation changes, supplied-binding misses and equal-output nested cutoff are asserted. **Residual:** Selected resolution transitions only. |
| 11: docs/spec/architecture.md:21 | ARC-001 | aligned | History tests assert atomic publication, exact immutable scoped refs, fencing and corruption failures. **Residual:** Remaining arbitrary fault interleavings are unexamined. |
| 12: docs/spec/architecture.md:22 | ARC-001 | aligned | Lifecycle cancellation, asynchronous scope restoration and trial/production isolation compose through supervision. **Residual:** General retry/admission state-space is not exhausted. |
| 13: docs/spec/architecture.md:23 | ARC-001 | aligned | Usage acknowledges landed reports once and preserves unknown gaps on process kill; report IDs are scoped by operation. **Residual:** No real provider execution or universal reporting completeness. |
| 14: docs/spec/architecture.md:25 | ARC-001 | aligned | Generated alpha/public/beta/untrimmed consumer checks distinguish approved internal context contracts from public release exposure. **Residual:** Release tier is not runtime secrecy. |
| 15: docs/spec/architecture.md:30 | ARC-002 | aligned | Materialization readers validate exact scoped nodes, immutable output and supported facts before observation. **Residual:** Full Value canonical encoding domain is not reexecuted by this selection. |
| 16: docs/spec/architecture.md:35 | ARC-002 | aligned | Selected path observation distinguishes array index/property facts and refusal of unsupported facts. **Residual:** No independent full Value address conformance suite in selection. |
| 17: docs/spec/architecture.md:44 | ARC-002 | aligned | Metadata comparison reads no payload; projections canonicalize requested paths; immutable views detach output and reject invalid context. **Residual:** Scale/cache budgets remain unmeasured. |
| 18: docs/spec/architecture.md:52 | ARC-003 | aligned | Forbidden provider imports/deep/facade bypasses are rejected and injected assembly is exercised. **Residual:** Dependency tests establish selected arrows, not every port semantic. |
| 19: docs/spec/architecture.md:75 | ARC-003 | aligned | Usage injection and durable operation-scoped accounting survive acknowledgment loss and process kill. **Residual:** Persistence/read-side ownership is source-reviewed; full isolated Accounting contract roster is separate. |
| 20: docs/spec/architecture.md:85 | ARC-004 | aligned | Standalone cells/derived tracking executes without a store or run; carried observer tests cover tracked object operations. **Residual:** No dependency on assembled core inferred. |
| 21: docs/spec/architecture.md:91 | ARC-004 | aligned | Called helper implementation changes invalidate; uncalled helper is absent from dependencies; nested derived reads replay dependencies. **Residual:** Arbitrary function purity remains excluded. |
| 22: docs/spec/architecture.md:101 | ARC-005 | aligned | Topology tests exercise strict fold before consumer, keyed expansion and recorded ordering; malformed/missing keys fail before work. **Residual:** General fanout scalability remains open. |
| 23: docs/spec/architecture.md:107 | ARC-005 | aligned | Separate process restarts reorder registration and labels while retaining exact member refs; missing/rebound supplied slots fail. **Residual:** No real paid-call replay measured. |
| 24: docs/spec/architecture.md:114 | ARC-006 | aligned | Current hooks run each restart; source implementation changes suppress old finality; nested changed code validates consumed output before parent reuse. **Residual:** All resolution transitions are not exhausted. |
| 25: docs/spec/architecture.md:123 | ARC-007 | aligned | Writer fences/clock and atomic publication preserve durable history; crash boundary tests reject partial results and implicit reexecution. **Residual:** No formal exhaustive interleaving checker executed. |
| 26: docs/spec/architecture.md:128 | ARC-007 | aligned | Wrong-store/scope/missing refs fail without recompute; fresh equal refs are distinct; retained exact refs survive new acceptance. **Residual:** Selected integrity mutations only. |
| 27: docs/spec/architecture.md:136 | ARC-008 | insufficient-evidence | PR200 separately supplies independently reviewed typed fake-port seam evidence; this selected assembly execution complements it. **Residual:** A complete every-context/every-port contract-test roster and test-first chronology are not established by these 19 files. |
| 28: docs/spec/architecture.md:139 | ARC-008 | insufficient-evidence | Missing/reordered/renamed binding, local tracking, hostile History and lifecycle/accounting gaps have selected or carried assertion witnesses; PR200 adds isolated seam checks. **Residual:** Do not equate sampled witnesses with completion of every bullet or every injected fake contract. |
| 29: docs/spec/architecture.md:149 | ARC-008 | insufficient-evidence | Fresh-process assemblies pass and PR200 contributes isolated port evidence. **Residual:** Green tests do not establish that tests preceded implementation; process chronology needs historical red/green receipts. |
| 30: docs/spec/architecture.md:155 | ARC-009 | aligned | Negative context/import/declaration gates run against actual package surfaces rather than an alternative architecture model. **Residual:** Semantic responsibility still requires judgment. |
| 31: docs/spec/architecture.md:161 | ARC-009 | insufficient-evidence | Current surfaces and negative fixtures agree for the selected boundaries. **Residual:** The required sequence for each boundary change is historical process evidence and was not audited. |
| 32: docs/spec/architecture.md:169 | ARC-010 | aligned | Carried Machine runtime closure is unchanged; current context tests reject Node imports outside Machine Node. **Residual:** No additional host implementation or Linux runtime tested. |
| 33: docs/spec/architecture.md:178 | ARC-010 | aligned | Node built-in/global bypass negatives and portable-runtime positives pass. **Residual:** Test/build code is allowed Node access; not a Node-free tests claim. |
| 34: docs/spec/architecture.md:203 | ARC-010 | aligned | Current source gate plus previously executed unchanged Machine conformance closure supplies both kinds of bounded evidence. **Residual:** No full current Machine suite rerun or other-host conformance. |
| 35: docs/spec/package-boundaries.md:13 | PKG-001 | aligned | Required workspace/package wiring and actual generated facade consumer enforce settled microdelta naming. **Residual:** No naming decision reopened. |
| 36: docs/spec/package-boundaries.md:17 | PKG-001 | aligned | Current package graph and direct-edge negative fixtures enforce useful context boundaries. **Residual:** Whether another package would be useful is a judgment, not an unfulfilled future requirement. |
| 37: docs/spec/package-boundaries.md:22 | PKG-001 | aligned | Actual source and generated sibling tier resolution plus no-fallback config negatives pass. **Residual:** Selected fixture configurations only. |
| 38: docs/spec/package-boundaries.md:29 | PKG-002 | aligned | Own TypeScript consumer access checks exercise intended export/member visibility. **Residual:** Compile-time access is not a secrecy proof. |
| 39: docs/spec/package-boundaries.md:30 | PKG-002 | insufficient-evidence | Runtime import tests and private-closure declaration tests distinguish runtime availability from release-tier trimming. **Residual:** No dedicated arbitrary ECMAScript private-field attack proof is part of this selection. |
| 40: docs/spec/package-boundaries.md:31 | PKG-002 | aligned | Generated public/beta/alpha/untrimmed artifacts expose the intended tier and reject wrong-tier imports. **Residual:** Declaration exposure does not prove runtime security. |
| 41: docs/spec/package-boundaries.md:33 | PKG-002 | aligned | Public members under project-private APIs remain on approved generated tiers, not default public declarations. **Residual:** No implication of runtime secrecy. |
| 42: docs/spec/package-boundaries.md:40 | PKG-003 | aligned | Own untrimmed consumer sees internal exports; public and sibling consumers reject excluded APIs. **Residual:** Intentional tag meaning remains a review judgment. |
| 43: docs/spec/package-boundaries.md:41 | PKG-003 | aligned | Approved sibling alpha includes intended project contracts and rejects internal source fallbacks. **Residual:** No public alpha marketing channel inferred. |
| 44: docs/spec/package-boundaries.md:42 | PKG-003 | aligned | Separately selected beta consumer sees beta/public and rejects alpha/internal. **Residual:** Beta package artifact fixture only; no publication performed. |
| 45: docs/spec/package-boundaries.md:43 | PKG-003 | aligned | Default external consumer resolves public declarations and fails for excluded tiers. **Residual:** No package release/publication claim. |
| 46: docs/spec/package-boundaries.md:45 | PKG-003 | aligned | Default package type entry public only; sibling alpha selection and forbidden source fallback are explicit controls. **Residual:** No user alpha-channel claim. |
| 47: docs/spec/package-boundaries.md:55 | PKG-004 | aligned | Own untrimmed and sibling alpha consumers compile; source/internal/wrong-tier controls fail for intended reasons. **Residual:** Literal documentation setup gap remains separately reported by PR201 evidence. |
| 48: docs/spec/package-boundaries.md:68 | PKG-004 | aligned | Forbidden dependency edge, alternate path/source config, deep import and facade bypass negatives fail closed. **Residual:** Finite checked configuration space. |
| 49: docs/spec/package-boundaries.md:74 | PKG-005 | aligned | Actual generated rollups/API reports and exported-tier diagnostics run; excluded private closure controls reject leaks. **Residual:** All future exports still require intentional review. |
| 50: docs/spec/package-boundaries.md:79 | PKG-005 | aligned | Source import and API-report checker gate bypass negatives pass. **Residual:** Human API-change review chronology is not proven by executable gates. |
| 51: docs/spec/package-boundaries.md:85 | PKG-006 | aligned | Foundation and import/declaration gates select package/export enforcement. **Residual:** No alternative architecture model required. |
| 52: docs/spec/package-boundaries.md:95 | PKG-006 | aligned | Current foundation assertions enforce selected mechanism and retired alternate tooling is historical. **Residual:** Historical EXP-5 results are not current acceptance. |
| 53: docs/spec/package-boundaries.md:105 | PKG-007 | insufficient-evidence | Positive/negative fixtures execute for intended access and failures. **Residual:** Before-configuring ordering requires red/green historical receipts, not a green suite. |
| 54: docs/spec/package-boundaries.md:107 | PKG-007 | aligned | Real generated producer, own/internal, sibling/alpha, beta/public, wrong-edge and deep-source fixture assertions pass. **Residual:** Bounded roster; not arbitrary future configuration proof. |
| 55: docs/spec/package-boundaries.md:119 | PKG-007 | aligned | Declaration negatives inspect exact diagnostic causes and actual generated package consumers execute. **Residual:** The initial missing-fixture setup failure is excluded; corrected stage passes. |
| 56: docs/spec/package-boundaries.md:126 | PKG-008 | aligned | Strict/implicit-any, explicit-any/floating-promise, narrowing-positive and nested/new-program gate controls execute. **Residual:** No full workspace lint/typecheck or all experiment runtime reexecution claimed. |
| 57: docs/spec/package-boundaries.md:149 | PKG-008 | insufficient-evidence | Foundation tests deliberately break build/order/check/API/import/declaration and Node matrix gates. **Residual:** This finite selection is not all foundation commands in clean CI; test-first chronology and actual CI matrix runtime require separate receipts. |

| Operational row | Disposition | Evidence and residual |
|---|---|---|
| A-01 | aligned | Carried observer54 and current standalone track24 assert read/guard/pass-through/local-reactive behavior. **Residual:** A-01 does not imply all TRK-5 obligations. |
| A-15 | aligned | Current generated consumer/tier diagnostics and runtime imports pass after fixture setup correction. **Residual:** PR201 literal manual guide omitted copying its input; its TS6053 setup failure is separate from checked-in fixture pass. |
| A-17 | insufficient-evidence | Selected-node I/O tests measure consumed scalar reads and zero-payload metadata restart. **Residual:** 150k source / ten consumers and cache/fanout bounds unexecuted; #159/#160/#173. |
| A-20 | aligned | Prior Machine21 anchors and85 runtime cases carried through unchanged exact closure; current Node boundary checks pass. **Residual:** No Linux/other host or fresh current Machine execution. |
| EXP-1 | aligned | Restart/source-policy/changes assert retained exact results and invalidation under the accepted design. **Residual:** Historical experiment choice is settled; no new experiment decision run. |
| EXP-3 | aligned | SQLite immutable rows/scope/fencing/atomic publication and true process crash recovery pass. **Residual:** No exhaustive durability fault model proof. |
| EXP-4 | aligned | Strict fold/keyed frozen expansion and recorded-order topology assembly pass; PR200 isolated seams are separate evidence. **Residual:** No unrestricted dynamic topology or scale claim. |
| EXP-7 | insufficient-evidence | Historical formal-model work remains evidence in issues40/110. **Residual:** No current formal checker execution in this finite command set. |
| RUN-018 | insufficient-evidence | M3/M4/M5 realistic bounded acceptance examples execute. **Residual:** Representativeness requires trial/CLI/real-workload evidence; no generic representativeness claim. |
| TEST-1 | insufficient-evidence | Tests and intended outcomes are explicit and executed. **Residual:** Chronological test-first process cannot be inferred from green current tests. |
| TEST-3 | aligned | M3/M4/M5 fresh-process cases exercise real composed applications with exact refs and lifecycle outcomes. **Residual:** Private consumer examples and broader representative workload assessment are separate. |
| TEST-4 | insufficient-evidence | Source implementation/policy, keyed restart, usage crash and environment promotion variants execute. **Residual:** CLI/general trial and real provider variants remain outside this selection. |
| TEST-5 | insufficient-evidence | Bounded selected-path I/O behavior passes. **Residual:** 150k/ten narrow consumers performance fixture remains unexecuted; #159/#160/#173 and M7. |
| TEST-6 | aligned | Separate published local-filter restart proof and CPU-neutrality100000-additions supplement now supply bounded evidence; track24 supports local tags. **Residual:** Not fold/scale/timing/provider/Linux or complete TEST-6; assembled filter cannot be inferred solely from track24. |
| TEST-7 | insufficient-evidence | Source rows retain owner IDs and explicit links; current assertion index binds real declarations to runtime cases. **Residual:** Full spec unique-ID/link/consolidation and cross-document semantic audit is separate. |
| TEST-8 | aligned | Current strict/lint/import/declaration positive and deliberate-negative tooling checks pass. **Residual:** Full CI command chronology, all Node matrix runtimes and test-first process remain separately qualified. |

## Next evidence items

1. Scale/bounded-cache/fanout measurement:150k source and ten narrow consumers (#159/#160/#173; M7).
2. Complete every-context fake-port coverage roster; incorporate PR200 without equating its selected seams to universal ARC-008 completion.
3. Test-first red/green and boundary-change chronology; full clean CI command/matrix receipts. Current green fixtures cannot answer these process claims.
4. Current formal-model execution if EXP-7 is to be promoted beyond historical evidence (issues40/110).
5. Trial/CLI/representative real-workload and provider variants where explicitly required. No additional host implementation is implied.
6. Whole-spec ID/link/consolidation and semantic responsibility review. Current structural negatives supply bounded witnesses.

TEST-6 local filter and ordinary CPU memo evidence are already separate supplements, not a fresh missing item. PR201 literal guide setup incompleteness remains separately qualified; checked-in declaration fixtures pass here. No duplicate issue is proposed from a missing prerequisite.

## Replay

From a fresh Node24 checkout of this evidence branch, run `python3 scratch/gap-hunt/outside74-reconciliation/replay.py`. The runner rejects reused node_modules, verifies all pin-tracked source bytes, installs once, builds packages/fixtures once, compiles selected owners and runs only these19 files with explicit timeouts. It uses an installed SDK override only on matching Darwin hosts. The command is a portable recipe; Linux runtime has not been executed.

## Separate public supplements

- [fakePorts](https://github.com/mike-north/microdelta/blob/239c212aa87f73aa4b5c76e5f8855b84df6424d9/scratch/gap-hunt/review-200/REPORT.md)
- [localFilter](https://github.com/mike-north/microdelta/blob/9fdf8e8efcd379280e649fe3ba90fcb43e369a6d/scratch/gap-hunt/local-filter/REPORT.md)
- [cpuNeutrality](https://github.com/mike-north/microdelta/blob/0ae938a4b4518333ecfff69e8dc24e451049c8fe/scratch/gap-hunt/cost-neutrality/README.md)
- [literalGuideQualification](https://github.com/mike-north/microdelta/blob/62edd3fce225a664470aca650c180e50486446f4/scratch/gap-hunt/review-201/REPORT.md)
