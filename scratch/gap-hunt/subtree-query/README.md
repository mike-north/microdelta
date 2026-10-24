# Selected subtree query work: finite discriminator

**The recursive production node query exceeds the predeclared finite VM-work bound.** A real-facade 10/20/40 matrix passes exact results and makes one node query plus one edge query per discovery; the work increase is inside the SQL statement, not repeated full-listing calls.

Frozen source: `f46223193696b67499322bdf70260b85a6277564`. A fresh owned worktree installed locked dependencies and built packages. The strict generated-alpha fixture wraps only the real Machine SQLite capability, through Jest factory injection before the real facade imports it. Every statement executes unchanged. Node 24.22.1, macOS arm64; Node SQLite 3.53.0, Python SQLite 3.54.1. No product edit, 100k rerun, tuning, provider, or fix was performed.

| Members | Node-query calls / rows | Edge-query calls / rows | Python node-query VM instructions | Edge-query VM instructions | Linear control |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 1 / 33 | 1 / 32 | 6691 | 1162 | 143 |
| 20 | 1 / 63 | 1 / 62 | 22201 | 2212 | 263 |
| 40 | 1 / 123 | 1 / 122 | 80221 | 4312 | 503 |

The bound was written in `PREDECLARED.md` before any matrix execution: `W(2N) <= 2*W(N)+500`, allowing necessary linear structure and fixed overhead. Recursive node work fails both doublings (allowances 13882 and 44902). Edge and simple-read controls pass. A deliberate node×node broad-scan control is rejected (3449/12239/46019). These are finite work counts, not timing thresholds or a universal complexity theorem.

## Evidence boundary

The real facade test passes once over each size with a fresh store: every member succeeds; body keys follow canonical order; source runs once; retained listing and score subjects/payloads match exact expected values; stores close normally. Discovery precedes the first member attempt. Publication, candidate, acceptance, metadata and member events remain separately counted. Expected rows are `3N+3` nodes and `3N+2` edges. All 813 tracked source files remain byte-exact.

`production-captures.json` contains actual prepared SQL, parameters, phase events, schema, listing rows, native Node query plans/version, and member checks. `sql-work.py` uses those unchanged SQL/schema/listing rows in a separate Python SQLite database and counts each VM instruction. Python results validate returned-row counts; full result/value integrity was independently checked through the actual Node facade. The Python engine is different: **these are not actual Node VM counts, full consumer timing attribution, or proof that this query caused the entire 100k timeout.** The actual Node plan nevertheless has the same recursive edge lookup using only `result_id`, followed by `SCAN s`; the existing `(result_id,parent_node,edge_kind,edge_key)` key's parent prefix is not used there. The edge-query plan uses result and parent. No query rewrite was selected.

The earlier large phase diagnostic stays separate in `c3357e604edc7cff7ebffe8aeb2bd95b1fbe91c1`: listing publication completed, then the run hit its cap; anonymous native SQL frames alone did not identify this query. The small control profile/source trace motivated this finite discriminator. This counterexample adds actual production SQL identity and bounded SQL-layer work evidence without upgrading the older profile's attribution.

## Reproduction and checks

```sh
python3 scratch/gap-hunt/subtree-query/reproduce.py
```

Default creates a fresh detached f462 worktree, installs/builds, compiles strictly, type-aware lints, runs one 10/20/40 facade matrix, then one SQL-work matrix. Expected exit **1** at the SQL-work discriminator; facade Jest is **1 passed**. No retry or query tuning occurs. The default runner was added afterward and statically reviewed, not rerun. Capture used the corresponding explicit install/build/compile/lint/Jest/Python commands. Initial fixture syntax and missing-output configuration failures ran zero cases and created no stores; they were fixed before the single matrix execution. The executed fixture, preregistered bound and SQL script are preserved unchanged.

Raw logs and receipts are in `captures/`. `manifest.json` governs included bytes; SQLite files, node_modules and generated distributions are excluded. Paths in setup logs are normalized, with raw hashes retained. The matrix has not run on Linux; a replay recipe does not establish parity.

## Dedupe and repair boundary

Live issue/PR bodies and searches were read on 2026-10-23 Pacific. #160/PR193 concerns publication-time repeated Value validation; this reads a published result. #173/PR196 concerns the later member dispatch queue; its patch does not touch discovery or selected SQL. #177 concerns promotion-aware candidate predicates; #159 acceptance acknowledgement. #164/PR187 is explicit-output revalidation correctness, not selected-read traversal cost. Searches for subtree/recursive work found no matching query-work repair; broad M7 qualification remains #170. These distinctions support a new contained History selected-read finding, subject to supervisory dedupe and review.

Any repair must preserve exact retained references, selected subtree boundaries, prototype/array semantics, fail-closed reconstruction/digest validation, and real facade outcomes. Its work gate must observe repaired production SQL/schema and reject a deliberate old-path negative; changing a frozen capture or plan string alone cannot close it. Direct actual Node work validation remains a repair-evidence requirement. No schema/index design, public API, batching obligation or author projection workaround is prescribed.

Implemented and captured by a Codex worker for Mike North. Supervisory review, GitHub filing/publication and merge decisions remain separate.

## Independent default-command follow-up

After the original `aca1c18` proof was frozen, the supervisor ran the unchanged default clean command exactly once. Locked install, package build, strict compiler, type-aware lint and the real-facade 10/20/40 matrix all exited 0; the SQL-layer discriminator exited the expected 1. All 813 tracked files stayed unchanged. SQL/parameters/plans, actual schema, listing node/edge data, member keys, Node engine version, Python VM counts and predeclared check results match the original capture. Compact normalized receipts/logs/results and full raw-capture SHA are preserved under `captures/parent-clean/`; the duplicate 2 MB capture stays private. This supersedes the earlier statement that the default runner had only been statically reviewed; no source, fixture, runner, query or bound was changed.

`query-schema-identity.json` independently verifies that the two measured SQL text blocks and two relevant table DDL blocks at f462 are byte-exact at later main `7f7e774`. Actual production capture hashes match those blocks. This is deliberately a query/schema qualification, not whole-file equivalence or an execution at later main. Original Python-versus-Node and large-timeout attribution limits remain unchanged.
