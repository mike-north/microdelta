"""Preserve executed test evidence without promoting literal-ID references to proof."""
import json,re
from pathlib import Path
root=Path.cwd(); out=Path(__file__).parent
results=json.loads((out/'jest-results.json').read_text())
tests=[]
for suite in results['testResults']:
 path=Path(suite['name']).relative_to(root).as_posix().replace('/.test-build/test/','/test/').replace('.test.js','.test.ts')
 for test in suite['assertionResults']:
  tests.append({'path':path,'name':test['title'],'fullName':test['fullName'],'status':test['status'],'id':len(tests)})
# These mappings were selected from the semantic outcomes and actual expectations,
# not from requirement IDs in comments. Every mapping remains bounded evidence.
rules={}
def bind(ids,files,meaning,residue='The named assertions prove the stated bounded outcome; other prose obligations are not automatically discharged.'):
 for rid in ids.split(): rules[rid]={'files':['packages/core/test/'+p+'.test.ts' for p in files.split()], 'provedOutcome':meaning,'residual':residue}
bind('RES-001','acceptance/restart','Renamed display labels and reversed registration retain exact member references.','Opaque-subject collisions across every scope/string variant are not all asserted here.')
bind('RES-002 RES-003 RES-006','acceptance/integrity-io','Superseded exact references resolve original data; wrong/missing/store/scope references fail; author mutation cannot alter stored payload.')
bind('RES-004 REUSE-004','acceptance/source-policy','Explicit retention keeps reference; fresh equal fetch creates distinct exact readable references.')
bind('RES-005','resolution/admission-recovery','Failed/refused attempts and recoverable committed results are distinct; observer failure preserves committed success.','Existing test explicitly discloses check-retention recovery reports unsuccessful; parent owns deduplication of this known gap.')
bind('RES-007','acceptance/changes','Path rebinding follows the new child while old historical provenance remains readable.')
bind('REUSE-001 REUSE-002 REUSE-003','acceptance/source-policy acceptance/changes','Fresh processes run current finality; changed implementation/input is not excused by a hook; consumed changes rerun affected work.')
bind('REUSE-005 REUSE-008','resolution/summary-validation m4-acceptance/nested','Changed child/helper code participates; equal consumed child output cuts off parent reruns; version rollback retains old exact references without rewinding heads.')
bind('REUSE-006 REUSE-007','m4-acceptance/nested resolution/summary-validation','Missing/ambiguous/unjustified derived correspondence causes an honest outer miss, with valid children reusable.','Current bounded supplied/direct-child paths only; arbitrary closure reconstruction is not promised/proved.')
bind('REUSE-009','acceptance/admission-observers resolution/admission-recovery','Hits precede gate; misses refuse before claims; check stops at unavailable source work without executing; committed success survives observers.')
bind('PUB-001 PUB-002 PUB-004','acceptance/crash-recovery acceptance/stop-publication m5-acceptance/writer','Reached kill boundaries preserve complete old/new state; stale holders cannot publish or affect successor; lost acknowledgment returns committed exact result.')
bind('PUB-003','acceptance/crash-recovery','Allocated incomplete attempts do not become completed results.','Full monotonic-allocation assertions are in Track B file-fed tests and durable-history component tests, not every failed journal subprocess here.')
bind('PUB-005 RUN-002','m5-acceptance/writer stop/stop workspace/writer-wait','Deadline reports holder; takeover fences; request permits guard sends; waiting lends capacity; independent members continue.','No 150k scale claim; multi-process write parallelism is deferred M7.')
bind('PUB-006 ACC-002 ACC-007','accounting/crash-recovery accounting/node-conformance m5-acceptance/usage','Durably acknowledged usage survives process death exactly once independently of result publication; failed/ambiguous writes issue no false acknowledgment.')
bind('RUN-001','m5-acceptance/lifecycle workspace/scope','Concurrent run/env contexts isolate; thrown frames restore parents; escaped operations fail after closure; new run ID alone reuses.','Lazy iterator return/error matrix is not separately established by these workspace tests.')
bind('RUN-003 RUN-004 RUN-005','m4-acceptance/fold m4-acceptance/keyed','Open snapshot listing permits ready members but holds strict fold; closed empty is distinct; rediscovery/reorder retains keyed work.','DX verified cumulative open snapshots in successive workspace.run calls: first two members execute before closure, later four-member snapshot retains first two exact results. Single-callback live streaming remains target work; no confirmed early-work defect.')
bind('RUN-009 RUN-010','m4-acceptance/fold m5-acceptance/outcome-fold outcome-fold/restart','Independent successful siblings persist; strict fold waits/fails honestly; outcome fold reports coverage, waits until settled and reconsiders repair.')
bind('RUN-011','operations/operations m5-acceptance/deferral','Sleep/exit durable not-before deferrals release writer and permits, resume same logical operation, and preserve earlier settled siblings.')
bind('RUN-012','m5-acceptance/replay operations/replay operations/operator','Lost non-idempotent response is never blindly replayed; safe/provider-key retries keep operation identity; operator settle/abandon unblocks according to outcome.','Result-bearing successful settlement deferred M6; provider-expired deduplication safety is adapter policy, not universal exactly-once.')
bind('RUN-013','m5-acceptance/privacy operations/privacy','Operation/request/step/member/run correlation is visible without planted provider/author values or payloads.')
bind('RUN-014 RUN-015','m5-acceptance/stop m5-acceptance/publication stop/drain','Soft drains admitted work with no default deadline; hard aborts/discards; committed boundary wins; unknown remote state is durable.','CLI first/second interrupt wiring absent with the CLI; shared-consumer cancellation ownership beyond bounded runtime not fully established.')
bind('RUN-016','m4-acceptance/topology m4-acceptance/fold','Tracked gate excludes member work and preserves explicit required/skipped framework coverage.','Exact HR role mix, author filter reuse, and declared per-person source caps are application acceptance obligations, not proven by three-person fixtures.')
bind('RUN-017','m5-acceptance/environments journal/environments m5-acceptance/lifecycle','Trial/production namespaces isolate; only recorded promotion admits trial results; concurrent contexts do not route globally.','External output destinations and cleanup remain unverified/target work.')
bind('ACC-001 ACC-003 ACC-005 ACC-006','accounting/node-conformance m5-acceptance/usage','Different units remain distinct; report deduplication and attribution rollups avoid doubles; missing attempt reports remain unknown; estimates retain basis and stay out of observed totals.','Current contract supports additive delta reports only; cumulative reports/corrections/resource state are not established.')
bind('ACC-008','acceptance/admission-observers operations/operations','Observer/gate distinction and explicit retry policy determine execution.','No complete add/remove accounting observer invariance matrix or deletion policy proof.')
bind('TEST-2 A-02','acceptance/restart acceptance/changes','Fresh independent processes rebuild declarations, change order/labels, assert hook/body counts and exact references.')
for rid,other in {'A-03':'REUSE-002','A-04':'RES-007','A-05':'REUSE-005','A-06':'REUSE-007','A-07':'RUN-003','A-08':'RUN-016','A-09':'PUB-002','A-10':'RES-006','A-11':'RUN-010','A-12':'RUN-012','A-13':'RUN-014','A-14':'ACC-007','A-18':'RUN-001','A-19':'REUSE-009'}.items(): rules[rid]=dict(rules[other])
missing={
 **{x:'Preview envelope/observation capability absent. Exact run.read supplies detached immutable author data; check supplies verification boundary, neither exposes latest stale value plus refresh-error/freshness status or throttled live updates. Target M6; no guessed API spelling treated as a contract.' for x in ['RUN-006','RUN-007','RUN-008']},
 **{x:'Usable CLI/plan/progress/explain inspection application absent; no package bin. Existing exact reads/check/recover/operation views prove bounded read isolation, not command delivery. Target M6; graph/CLI syntax remains unselected.' for x in ['CLI-001','CLI-002','CLI-003','CLI-004','A-16']},
 'ACC-004':'No nonadditive remaining/reset pool/window observation in Accounting alpha contract; IUsageReport explicitly accepts deltas only. resource-state.mjs shows why reusing that port yields 183 for successive balances 93/90. Missing target capability, not a defect in documented additive summation.'}
# Every requirement is explicit, including honest unexamined evidence boundaries.
blocks=json.loads((out/'clause-dispositions.json').read_text())['blocks']
blocks=[b for b in blocks if any(b['key'].startswith('docs/spec/'+n+':') for n in ['execution.md','operations.md','acceptance.md'])]
owners=sorted(set(b['owner'] for b in blocks if b['owner']))
reviews=[]
for rid in owners:
 rule=rules.get(rid)
 matched=[t for t in tests if rule and t['path'] in rule['files']]
 reviews.append({'requirement':rid,'classification':'specified-but-missing-target-capability' if rid in missing else 'bounded-aligned-with-residual-evidence-gap' if matched else 'evidence-gap-not-reviewed-to-assertion', 'meaning':missing.get(rid) or (rule['provedOutcome'] if rule else 'Not discharged by this operational audit. Owner-specific source/type/governance, full application, scale, or experiment evidence needs separate semantic review.'), 'residual':rule['residual'] if rule else 'No claim of complete coverage.', 'executedAssertionIds':[t['id'] for t in matched]})
# A paragraph/row is not discharged just because its enclosing requirement has tests.
(out/'clause-dispositions.json').write_text(json.dumps({'scope':'344 source blocks preserved; owner mapping is inherited from upstream inventory and may span tables. No owner-level match automatically discharges a block.','blocks':[{'key':b['key'],'owner':b['owner'],'text':b['text'],'disposition':'non-normative-or-unowned-review' if b['owner'] is None else 'see-owner-bounded-evidence-residual-unresolved','requirementReview':b['owner']} for b in blocks]},indent=2)+'\n')
(out/'requirement-evidence.json').write_text(json.dumps({'baseline':'c5802daca4a0bb8ea91159854d84eddcfa5215b6','scope':'Semantic outcome mapping, actual executed test names/status; no literal-ID grep promoted to coverage. References remain suite-granular and residual prose obligations explicitly open.','requirements':reviews},indent=2)+'\n')
(out/'test-execution-index.json').write_text(json.dumps({'passed':results['numPassedTests'],'failed':results['numFailedTests'],'suiteCount':results['numTotalTestSuites'],'tests':tests},indent=2)+'\n')
print(len(blocks),'blocks;',len(reviews),'owners;',len(tests),'executed test cases')
