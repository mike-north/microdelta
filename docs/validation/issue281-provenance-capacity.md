# Source-provenance capacity investigation (#281)

**Pass for the conditional capacity hypothesis on the pinned Node runtime.** The unchanged cold listing source's exact MDS1 JSON body at N=150,000 is predicted to require 564,696,554 UTF-16 code units. Node v24.14.0 / V8 13.6.233.17-node.41 (darwin arm64) reports `buffer.constants.MAX_STRING_LENGTH = 536870888`. The body alone exceeds that limit by 27,825,666 units. This is arithmetic, not a full-size allocation or a successful qualification. No qualification retry ran; TEST-5/M7, physical I/O and transient heap acceptance remain unproved.

The failed worker's original stack already identified `JSON.stringify → Value.encodeSnapshot → History.storeRecord(request.provenance)`, after payload encoding and before this stage call's SQL. This investigation supplies the previously missing size evidence. It does not replace the original failure evidence or claim the failed run retained 600,003 observations.

## Evidence and method

Accepted source baseline: `52845228b48fd82f38b77936f6ecfa3bba1128b3`. The external required local manifest identifies the three accepted private database copies, accepted reports and expected hashes. Private paths, raw cells, lineage identifiers and local artifact digests are deliberately retained outside this public record. The protocol is [experiments/provenance-capacity/PROTOCOL.md](../../experiments/provenance-capacity/PROTOCOL.md).

Each database matched its manifest hash **before opening and after closing**. The unique accepted cold phase was selected from the hash-verified lineage receipt; its hash-verified domain receipt supplied the exact listing locator and matching identities. Only that result and scope were selected, one row per database. Actual selected rows were listing version/publication/result 1, format `microdelta.resolution.provenance` version 1; these values were observed after receipt selection, not guessed. Connections used `mode=ro&immutable=1`. Larger cells stayed in SQLite; the only returned canonical cell was N=12 under an SQL CASE byte cap of 1 MiB.

| N | Observations | MDS1 UTF-16 units | UTF-8 bytes | JSON body units |
| ---: | ---: | ---: | ---: | ---: |
| 12 | 51 | 46,575 | 46,575 | 46,570 |
| 1,000 | 4,003 | 3,733,553 | 3,733,553 | 3,733,548 |
| 10,000 | 40,003 | 37,456,556 | 37,456,556 | 37,456,551 |

SQL `length(TEXT)` and `length(CAST(... AS BLOB))` were returned separately. A SQL ASCII-surface check passed for each complete selected cell; ASCII makes their SQLite character counts, UTF-16 units and UTF-8 bytes equal. That equivalence is specific to this source. Independent Unicode tests distinguish BMP, astral and escaped lone-surrogate behavior.

The N=12 cell decoded through the newly generated sibling Value package. Every root field, own-key order, binding, address, selection, operation, encoded scalar fact and fingerprint matched a separately reconstructed tiny shape. The independent counter matched 46,575 in both units, and actual generated `encodeSnapshot` recreated the exact retained text. Reconstruction used mathematical shape fixtures only; no source callback, phase worker or qualification harness ran.

The independent source-only proof derives retained order as implementation, rows kind, rows length, then row kind/key/score/unread for each numeric input index: **4N+3**. Repeated loop guards deduplicate; output construction adds no observer-owned values. The exact tiny validator checks order and complete contents, so count/size alone cannot bless missing evidence. Source-derived count and variable-width coefficients reconcile with all three scalar measurements.

## Exact amplification accounting

For d(x), ordinary decimal width with d(0)=1:

`L(N) = 3691*N + 2083 + 12*sum(d(i), i=0..N-1) + 2*sum(d(j), j=1..N) + d(N)`.

L includes the five-unit MDS1 prefix. Four row observations each repeat the index in top address, selection address and encoded selected fact: twelve index widths per row. The key string and score each contribute one one-based ordinal width. The length fact contributes d(N) once. Implementation/fingerprint digests have fixed hexadecimal widths. Selected facts nest MDV1 JSON inside MDO1 JSON, then inside MDS1 string quoting; the counter includes those escaping layers.

The fixed coefficients come from bounded one/two-row mathematical scaffolds using the independent counter. Generated Value totals match at N=1/2/8/32/100 (5,789 / 9,494 / 31,724 / 120,955 / 373,850). All retained N=12/1000/10000 scalar totals match exactly, including index/ordinal digit boundaries. Full-size calculation uses digit-width groups and checked arithmetic, without constructing observations, a wire tree or a canonical string.

The complete N=12 transport partitions exactly as follows. Property contributions include their entry/key/wire scaffolding; record/array separators are separate.

| Component | Canonical units |
| --- | ---: |
| Bindings | 3,262 |
| Top addresses | 9,922 |
| Selections, including repeated addresses | 16,240 |
| Kind / operation / encoding version | 4,217 |
| Nested encoded facts | 6,724 |
| Fingerprints | 4,488 |
| Observation record/array scaffolding | 1,486 |
| Other root fields and MDS1 prefix | 236 |
| Total | 46,575 |

## Reproducibility and outcomes

Toolchain: Node v24.14.0, npm 11.18.0, TypeScript 5.9.3. Value source SHA256 `ed97675905e092a0cc55524dcd87d82715f5c1fdda173ae0f1dbafa42f9efe6c`; this tree's generated Value implementation SHA256 `1db4da31c675c7634ddaa756b16b20cd7b49b8b72162d45f32a063a435ae501f`; generated alpha declaration SHA256 `780957074e9406d812295d816851984ea1f75c0604f16e369ce639991ac09ab1`. Sibling imports use generated declarations and this tree's own dependencies.

Commands: `tsc -p experiments/provenance-capacity/tsconfig.test.json`; `npm run test:provenance-capacity`; `eslint experiments/provenance-capacity`. The local immutable diagnostic command ran through its external deadline/RSS watchdog, followed by bounded Node analysis with `--max-old-space-size=512` and a 120-second parent timeout. Exact private commands, SQL, identities, raw RED/GREEN logs and receipts are retained in the required local handoff. No private database is a repository test dependency.

Initial helper Jest outcome: 21 expected unimplemented failures and 13 passing rejection controls. New guard/model tests also failed on unimplemented stubs. Generated-codec comparisons then caught a missing ordinary-record closing delimiter; implementation was repaired with unchanged assertions. Focused strict compilation, type-aware lint and 37 tests subsequently passed; one later measurement-regression test retains the observed scalar constants. Omitted-observation, changed repeated selection address, reordered observation, wrong row identity/format/cardinality/cap, unsupported domain and unsafe arithmetic controls reject. UTF-8-as-UTF-16 differs on Unicode controls. The helper deliberately rejects boolean/null and broader Value features not present in this provenance.

Diagnostic terminal exit 0: 0.54 seconds, nine real RSS samples, 184,172,544-byte sampled peak and process high-water RSS, under the 2 GiB ceiling. New primary output files totaled 50,684 bytes; no new database copy was created. A macOS address-space-limit setup attempt failed before any database access and is not credited as an enforced bound. The final external watchdog terminates/reaps its own child on deadline, RSS excess or missing RSS observation. Tiny substituted-child controls passed normal exit, one-second deadline kill/reap, and one-byte RSS-threshold refusal/kill/reap; none allocated near a runtime limit. Sampling is not a claim to observe every transient heap event.

## Failure atomicity and next boundary

Existing durable-History unsupported-payload/invalid-tag tests and publication SQL rollback/exact-reference tests remain credited. The new real-History test supplies a valid payload/tag with unsupported provenance content (`bigint`). It initially **passes** existing behavior: prior results/current/dependency rows remain identical; failed staging stays allocated/noncompleted with no staged cells; exact prior reads remain valid; allocation is not reused; a distinct valid provenance control stages/publishes normally. No product RED or runtime seam was manufactured. This tiny TypeError witness does not reproduce a giant-string RangeError under every engine condition.

The source shape/count/width rule is proved from pinned source and exact tiny content; larger retained records supply whole-cell ASCII/count/length calibration. The 150,000 total remains conditional on that unchanged ordinary dense cold input and normal completed capture; it is not a measured failed full-size cell. On those premises, a complete MDS1 string cannot represent this provenance on the pinned runtime. Reducing temporary wire-tree allocation or joining chunks into the same final string cannot remove that ceiling.

The smallest compatible repair direction is to remove the single-string requirement at the **Value snapshot transport / History persistence boundary**, preserving every observation and Resolution's opaque versioned provenance ownership. Keep the logical MDS1 content and its observable ordering; decide separately whether segment persistence can retain its version or needs a new transport tag/schema, how readers stream/reassemble safely, and how old single-cell rows remain readable. History must not parse/prune Resolution evidence, and Tracking must not drop reads. No chunking/compression/schema/API repair is selected or implemented here. Root owns a separately scoped design/repair issue and any later requalification release.
