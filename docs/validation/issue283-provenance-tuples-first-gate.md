# Private provenance tuple first gate

This EXP-0 package keeps the Resolution tuple candidate private. It does not wire
`provenanceRecord`, `readProvenance`, `resolution.ts`, acceptance/ending formats,
History, or qualification execution. Production integration needs the separate
supervisory release after independent first-gate acceptance.

## Meaning and boundaries

`packages/resolution/src/provenance-wire.ts` retains all eight observation fields
independently. Dense structural tuples spell property/index segments, selection
alternatives, observation kind, arbitrary outer operation, outer encoding version,
absent/present encoded fact and fingerprint. Semantic vectors retain occupied own
slots, including admitted holes. Top and selected addresses remain separate and
retain negative zero. Existing semantic readers retain authority over provenance
variants, witnesses, calls, membership and integrity; future generation/variant
classification precedes body interpretation.

The owner tests compose the private candidate with unchanged semantic readers.
They cover literal tuples, independent address/operation/kind distinctions,
variants 1–4, witness surfaces, legacy-admitted/normalized sparse end states,
compatibility precedence and malformed known-generation evidence. The candidate
is absent from package exports and does not import Value.

The private wire generation is 5; semantic variants remain 1–4 and Tracking
semantics remain 2. Each observation is exactly
`[bindingPath, topAddress, selection, kindTag, outerOperation, outerEncodingVersion, encodedOption, fingerprint]`.
Property/index segments are `[0,key]` / `[1,index]`. Selection alternatives are
`[0,operationTag,address]`, `[1,address]`, `[2,address]`,
`[3,address,traversal]`, `[4,keys]`, `[5,address]`, respectively selected,
implementation, materialized output, projection, collection order and untracked
read. Selected operation tags 0–5 mean value, own, membership, length, keys and
container kind. Projection traversal is `[0]` for exhaustive/complete or
`[1,keys]` for visited/incomplete. The independent observation kind tags 0–5 mean
fact, implementation, materialized output, projection, collection order and
untracked read. Encoded options `[]` / `[text]` distinguish absence from present
text, including the empty string. Structural tuple slots are dense; admitted
semantic vectors preserve occupied slots and holes.

The reader first checks format/wire generation, then Tracking semantics, then
semantic version. Unknown wire/Tracking generations and positive safe-integer semantic
versions outside 1–4 return unsupported before body interpretation. A missing, invalid or
nonpositive semantic version in a known generation is integrity damage; malformed
known tuples also throw the existing integrity classification. The existing
semantic reader then owns full provenance validation. The private codec does not
replace its kind/variant, witness, membership, correspondence or integrity rules.

## Actual-output accounting channel

The named owner test executable `provenance-cold-worker.ts` accepts only the
independently pinned dense ordinary cold source corpus, N≤100. It validates input
identity and its own emitted worker/codec identities, computes the actual private
codec output, and carries that exact output through the test-only JSON channel.
The channel checks its restricted domain, own data/prototypes/key order/slots,
negative zero exclusion, no shared/cyclic identity, explicit node/depth budgets,
exact raw byte preflight and postparse equivalence. Direct valid codec fixtures
with negative zero, sparse vectors or opaque witnesses are deliberately refused
by this smaller channel. Those exclusions are not production restrictions.

Assembly imports no private Resolution module. `cold-bridge.ts` verifies the
parent-selected population, input/worker/codec/output digests, high-water bound,
and independently reconstructed complete expected tuple. It then passes the
**actual parsed worker output**, rather than that expectation, to generated Value
`encodeSnapshot` and the independent MDS1 grammar counter. A mismatch stops the
diagnostic before a capacity result.

## Component model

`tuple-accounting.ts` counts a root with an empty observation vector, the three
fixed observation bodies, and each of the four repeated observation bodies.
Each subtree body excludes the five-unit MDS1 prefix. The root includes that
prefix once. Root and row array separators are counted explicitly.

Four row observations each retain their zero-based index in the top address,
selected address and complete encoded fact: twelve index-width occurrences.
The key and score retain the one-based ordinal: two ordinal-width occurrences.
The fixed length fact contributes the decimal width of N. With component-derived
constants A and B, the complete conditional canonical length is

`A*N + B + 12*sumDigits(0,N-1) + 2*sumDigits(1,N) + digits(N)`.

A and B are derived from the separate component ledger, never fitted from a
one/two-population difference or copied from the legacy model. One/two and other
tiny complete totals corroborate that ledger. Isolated four-observation rows
exercise decimal transitions through 99999/100000 without those populations.
Literal Value controls distinguish empty/present arrays, positive/negative zero,
escaping, UTF-16 and UTF-8. The 150000 prediction is decimal-group arithmetic only;
both body and prefix-inclusive totals must fit strictly below the actual pinned
Node maximum with positive separate margins.

The actual component ledger is:

| Contribution | MDS1 units |
| --- | ---: |
| Root with empty observations, including one prefix | 274 |
| Implementation observation body | 269 |
| Container observation body | 358 |
| Length observation body at N1 | 338 |
| One row's four observation bodies | 429, 501, 495, 505 |

Thus `A = 429+501+495+505+4-14 = 1920` and
`B = 274+269+358+338+2-1 = 1240`. The independent pre-author hand
ledger originally wrote 369 for the implementation observation even though its
enumerated terms `15+20+8+26+9+22+12+85+72` sum to 269. Its provisional B = 1340
therefore had a 100-unit arithmetic error. That original record remains preserved;
this explicit correction gives B = 1240 without fitting population differences or
changing the implementation. The later independent retained checker corroborated this corrected ledger.

## Bounded execution and preserved failures

Four cumulative roots remain immutable after their attempts:

| Root | Role | Files | Bytes |
| --- | --- | ---: | ---: |
| A, `issue283-tuple-diagnostics-IW4P6n` | rejected author attempt; six reusable inputs | 9 | 377255 |
| B, `issue283-tuple-fresh-h9TCds` | rejected second author attempt | 4 | 12192 |
| C, `issue283-tuple-complete-C1` | six accepted author outputs plus rejected partial held-outs | 19 | 454865 |
| D, `issue283-heldout-complete-D1` | four accepted fresh held-out outputs | 9 | 140821 |
| Outside forensic/review/status allowance | includes checker receipt | — | 49152 |
| **Charged total** | cap 1048576; remaining 14291 | **41** | **1034285** |

A/B stopped at N1 with unavailable RSS. Both children exited 0 and were reaped,
but their exact failing `ps` states were not retained; those causes remain unknown.
A separate 4624-byte forensic invocation completed with a positive sample,
independently confirmed owned zombie/RSS 0 and actual close. It gives no cohort or
capacity credit. C held-out default-sandbox failure retained only sampler-threw,
without its raw failing probe. A separate bounded same-sandbox probe demonstrated
current `ps` EPERM/undefined-stream behavior; the exact failed run cause remains
unproved. Its explicit escalated retry also failed; exclusive failure-file creation
masked the second primary trace, so that cause also remains unknown. C partial outputs 3/9 give no credit. All rejected files remain charged.
D reads only C's four validated cold inputs and creates four fresh owner outputs.

Fixed retention modules validate complete sealed inventories, current input bytes,
canonical roots, regular files, source identities and remaining allowance before
every write and owner launch. Aliases, symlinks, traversal, overwrite, substituted
plans and cumulative overflow refuse. The author A+B+C and held-out A+B+C+D
compositions share the original 1 MiB cap. D's prelaunch upper bound was 1044836
bytes, including output upper 109516 and metadata upper 41856. Outside allowance
covers 45018 observed/reserved bytes before the checker, 1955 future report-growth
bytes and up to 2048 checker-receipt bytes (49021 total within 49152).

Each cohort has one 120-second deadline across sequential children and a 2 GiB
sampled owned-child RSS ceiling. Children create no descendants. Missing/invalid
live RSS fails and kills/reaps. Host-boundary normalization preserves missing
streams as null, distinct from actual empty streams. Bounded raw first/last/failing
probes retain status, signal, error code, PID/PPID/state/RSS and kernel lookup.
Uncoordinated terminal controls require independently confirmed owned zombie/RSS 0
or exact no-match plus ESRCH, a prior positive sample and actual close.

Current prepare/owner/analyze children finish all application work and writes,
install a release handler, send ready and stay alive. Parent independently obtains
positive final OS RSS below the ceiling, dispatches release and pauses periodic
RSS for a bounded termination-only interval. Send backpressure is not success:
callback success and actual normal close are both required, in either order.
Deadline/output guards remain armed through close/reap. Release handlers exit
synchronously without further application work. This interval is unmeasured;
release is not an OS terminal witness or proof of zero Node internal allocation.
Released hangs, send errors, early close, malformed/duplicate ready, missing final
RSS and post-release output remain tested failures. Sampled RSS and process
high-water RSS differ; true transient heap peak and physical I/O are unavailable.

## Actual ten-output evidence and provenance

C completed 12 phases: preparation, four expected resource controls, six fresh
owner workers and analysis. Accepted owner workers had positive RSS, exit 0 and
reap. Its elapsed time was 647.696291 ms and parent high-water RSS 85426176 bytes.
D completed six phases with positive final RSS, confirmed release, exit 0 and reap.
Its elapsed time was 339.497875 ms, parent high-water RSS 80642048 bytes and
analysis high-water RSS 76136448 bytes. D final RSS in prepare/3/9/17/64/analyze
order was 70991872/58818560/60391424/60506112/69599232/76333056 bytes.

The independent checker reconstructed each complete semantic input, tuple,
canonical MDS1 value and digest without importing or executing owner/codec/Value.
It corroborated original actual Value results, the component ledger and decimal
arithmetic. ASCII cold fixtures make UTF-16 code-unit counts and UTF-8 byte counts
numerically equal; the columns preserve their different meanings. Digests identify
complete canonical MDS1 strings, not worker envelopes or tuple JSON.

| Cohort | N | UTF-16 code units | UTF-8 bytes | Canonical SHA256 |
| --- | ---: | ---: | ---: | --- |
| C | 1 | 3175 | 3175 | `bc436edb15fcdaf4c35c885fb8904baa3d1f22a7cdb54fc8ecbe0fe676190c3c` |
| C | 2 | 5109 | 5109 | `c79acf5d4e247da56669b328f19049009a22f003c00f82efba727758052304a8` |
| C | 8 | 16713 | 16713 | `6be3142b95223430404d38adbd243e9509c936bf7a408a74dfff9ed9d8249d02` |
| C | 12 | 24480 | 24480 | `20cac64817f2b08032dcd2c23dd876a206c56e9183ca537804d2ee98267f6666` |
| C | 32 | 63440 | 63440 | `7dffcb0b61ceae39a62c43eee57184f291a1fc0e9707f21c66688aa4c53b62a5` |
| C | 100 | 195907 | 195907 | `f0a1dddb2a584dda66989f94ded5739cd168954c4e07dd0148be655ff0595b6c` |
| D | 3 | 7043 | 7043 | `879658a10f806ca82b6923932937a0a954b1ece5b10d21674df2cad925fba3e2` |
| D | 9 | 18647 | 18647 | `078c113c71475aaceb915166a2a60d1123e9d472f9a34ecef650d34e61561e5e` |
| D | 17 | 34220 | 34220 | `28257775465fddc80928c1155f3900d0a679898de1dcb8d84f272b07a4dd07b5` |
| D | 64 | 125776 | 125776 | `0eeaa6d656e2633430b7b040846a53ce5564240088f997112628c9665f8b6ece` |

Original C source is committed as `7b1accbc4fb0797e4226ff990b538e8a4c8d71c8`.
Its manifest pinned 44 source/emitted identities but omitted already imported
`errors.ts` and `errors.js`. The original emitted errors-module hash is unavailable.
This is qualified original Value-execution evidence, not a complete historical
runtime-closure or fully frozen reproduction claim. All 16 original tracked source
pins match that commit. Current errors source matches original source SHA256
`4f2850418b7f5cfc4b413855b145a1add0abb41f437ce41f6433f0a5f1ca8b2e`.
The worker computation prefix is unchanged; current changes add an owner-local
release handler after computation. Old results are not attributed retroactively
to the repaired harness.

D pins the complete current 52-entry source/emitted set, including both preexisting
errors dependencies. Compared with the old 44, 30 capacity authorities remain
exact, ten harness entries changed, six harness entries were added and two
preexisting errors entries were newly pinned. Ordered current identity aggregate
SHA256 is `0991036824be1fb0adc33bf03065ad8b217656e328b427a4487eefe007cdcff2`.
All 52 identities and all A/B/C/D inventories remained unchanged across D and the
checker. Complete independent reconstruction corroborates the qualified original
six canonical values and fully pinned current four.

Node 24.14.0 reports `MAX_STRING_LENGTH=536870888`. Conditional N150000 arithmetic
gives body 299045711 and complete MDS1 299045716, with positive respective margins
237825177 and 237825172. This proves conditional representability under the exact
cold-corpus/schema assumptions and pinned Value grammar. No N150000 tree/string
was constructed or run. Full qualification, speedup, performance, TEST-5 and M7
acceptance remain unproved.

The separate checker completed once: exit 0/reaped, 0.07736 seconds, three positive
samples, initial RSS 16711680, final/peak sampled RSS 21954560, child high-water RSS
24166400 and parent high-water RSS 17727488 bytes. Release-to-reap was 0.582708 ms;
termination-only execution remained unmeasured. Its 1364-byte PASS receipt is
charged within the unchanged outside allowance.

## Receipts and reproduction

Artifacts are retained in the named `/private/tmp` roots. Hashes identify original
evidence; these machine-local paths are not portable prerequisites. Grammar,
ledger, bridge, watchdog and tests are tracked in this revision.

| Artifact | SHA256 |
| --- | --- |
| C `manifest-author.json` | `7c7b5ffae165c6d249b7e3a8b9c2c4d2732e38f56bcbc264687433c036d79255` |
| C `analysis-author.json` | `9cf8bfda4d7b4ab21187f11352d12087423247f3cf9e5f4e72eff283d6d9f066` |
| C `batch-author.json` | `cb9746d0037dc80a8b1b414d1f0949fe45ed960a535620a8938a5a903454e282` |
| D `manifest-heldout.json` | `19d27bfb1e408ea2db596d186f8f03cea299b30ee2c0fe5acf887c2ab915245d` |
| D `analysis-heldout.json` | `832d6fdc80a1153c17280d2069ea830be96548a93e67ad170f13a787537978ed` |
| D `batch-heldout.json` | `ae5330a77ec926229128fab33a468661d99c2c1c107f1d6a46de32704464dd6b` |
| Independent checker source | `9a1b37665092d0e2cdaab2b1c42c35d79d964784ed6c632b45efc96a51d5fe8b` |
| Independent PASS receipt | `52ee27bc3951d24b50190b8d9097ab5d2b862b5d50d22b35d7b94b6e1d609c37` |
| Independent canonical digest set | `1fe095eec477940d1d8e427d6c329dc063b240b41a8b5541288f6088806c5298` |

Behavior changes used explicit-outcome tests with observed RED/GREEN. Expanded
characterization checks already satisfied by the implementation were recorded as
passing, without manufactured RED. Final affected experiment checks passed strict owner/root
compilation, 13 Jest suites/91 tests and type-aware lint of all 13 affected files.
Owner codec/channel/worker tests separately cover semantic variants, sparse end
states, negative-zero/channel boundaries, generation precedence and actual output.
Full repository gates belong to the later integrated head.

From this checkout with its own installed dependencies and generated sibling
declarations, tracked focused checks use Node 24.14.0:

```sh
node_modules/.bin/tsc -p packages/resolution/tsconfig.test.json
node_modules/.bin/tsc -p experiments/provenance-capacity/tsconfig.test.json
NODE_OPTIONS=--experimental-vm-modules node_modules/.bin/jest --config experiments/provenance-capacity/jest.config.mjs --runInBand
```

`tuple-accounting.test.ts`, `cold-bridge.test.ts`, owner `provenance-wire.test.ts`
and `provenance-cold-channel.test.ts` hold literal/negative semantic and accounting
controls. `tuple-driver.test.ts`, `tuple-rss.test.ts`, `tuple-lifecycle.test.ts` and
both retention/composition suites specify resource and preservation contracts.
Actual diagnostic reproduction remains gated: emitted
`tuple-launcher.js FRESH_C author A A_SHA B B_SHA` creates an author composition;
`tuple-heldout.js FRESH_D A A_SHA B B_SHA C C_SHA` creates a held-out composition.
Entries live under `.test-build/experiments/provenance-capacity/src/`. They require
exact seals, current source/emitted pins, positive host `ps` access, fresh paths,
explicit per-attempt supervisory release and the same cumulative cap. Do not
replay or overwrite retained roots. The independent checker is separately authored
reviewer evidence, not a tracked production dependency.

The supervisor accepted this private first gate at clean revision
`4d2aeda97a7b055b29b9b49a87b9b219552b62bf` after the different-agent bounded PASS
(report SHA256 `afc7d19e6960d860287cb636e6d48b83043fbe8a5008cbb0ed77202acd3fd3c4`).
That acceptance covers the conditional representation proof and its stated limits.
Production integration was separately released afterward; its independent
[production evidence](issue283-provenance-production.md) does not relabel these
historical source identities, runs or qualified original results.
