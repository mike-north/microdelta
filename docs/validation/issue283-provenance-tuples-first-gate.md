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
semantic version. Unknown wire/Tracking generations and positive future semantic
variants return unsupported before body interpretation. A missing, invalid or
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
changing the implementation. Independent held-out corroboration remains pending.

## Bounded cohorts

`tuple-launcher.ts` invokes only named preparation, owner and analysis children.
Author populations are 1/2/8/12/32/100; reviewer held-outs are 3/9/17/64. The fresh
cohorts share one output directory, and both sealed failed directories remain
immutable. All three directories and a 48 KiB allowance for outside forensic/review/
status evidence count against the same cumulative 1 MiB cap. Every artifact is
individually bounded; writes preflight the remaining shared allowance. Author
worker outputs reserve 384 KiB for later held-outs/analysis/receipts, and held-out
worker outputs reserve 32 KiB for final analysis/receipts. All failed files are
checked against their independently pinned inventory before writes and afterward.
Only the six regular failed-attempt input JSONs are reused read-only, after exact
hashes and complete current expected cold-corpus bytes are validated. Every owner
worker runs again, including N1; old output or process receipts confer no success.
Held-out inputs are new. Root/entry symlinks, canonical root aliasing, overwrite,
traversal, incompatible input/output paths and input digest changes refuse before
launch/emission. The fixed three-root adaptation does not reset the artifact allowance.

Each cohort carries a single 120-second budget across sequential children. The
parent samples only its live owned child PID, stops on unavailable RSS or sampled
RSS above 2 GiB, and waits for child close before the next child. A positive
terminal witness distinguishes an exact owned PID/parent PID in zombie state
with RSS 0, or `ps` no-match plus kernel ESRCH, from a missing live measurement.
The OS state is independently rechecked, a prior positive sample is mandatory,
the deadline remains armed, and actual exit/close still decides completion. A
supplied marker or merely a later normal exit cannot waive unavailable live RSS.
Fixed children
create no descendants. Retained controls exercise actual normal completion,
deadline, a lowered RSS stop and unavailable sampling, including kill/reap.
Sampled RSS and process high-water RSS are separate evidence; true transient heap
peak and physical I/O are not measured. Compiler/repository checks are separate.

Focused preparation uses this tree's own dependency install and generated
package outputs. Compile Resolution owner tests and the experiment test project,
then run their Jest configurations and type-aware lint for changed TypeScript.
The emitted `tuple-launcher.js` takes a fresh empty local directory, `author`,
the original failed directory and its exact inventory fingerprint, then the second
failed directory and its exact inventory fingerprint. Omission refuses before any
plan or worker. Historical single-seal plans remain readable for preserving old
evidence; they do not authorize a fresh author CLI invocation. Only after
review run that executable with the fresh directory and `heldout`. A failed
cohort retains its closed-child receipt and is not resumed or retried implicitly.

Both original author attempts stopped operationally at N1 with unavailable RSS.
Their children exited 0 and were reaped, but neither receipt preserved the exact
failing `ps` state, so both original causes remain unknown. A separate bounded process test
then demonstrated the owned-zombie/exit-pending state; the tests-first correction
preserves live-missing failure controls. Both failed attempts remain rejected and immutable. One separately released N1
forensic invocation completed with a positive RSS sample followed by independently
confirmed owned zombie/RSS 0 and actual exit/close. Its 4624 retained bytes count
within the same external allowance; it confers no cohort or capacity credit.
The narrow three-root adaptation preserves telemetry and classification. Fresh
author/held-out execution remains subject to independent review and separate
supervisory release.

## Current author evidence

The separately released fresh author cohort completed preparation, four expected
resource controls, all six fresh owner workers and analysis. Every child closed
and was reaped; all owner workers had positive RSS samples and exited 0. Actual
worker output passed complete independent shape comparison, generated Value and
the independent grammar counter at each size:

| N | Actual complete MDS1 UTF-16 and UTF-8 units |
| ---: | ---: |
| 1 | 3175 |
| 2 | 5109 |
| 8 | 16713 |
| 12 | 24480 |
| 32 | 63440 |
| 100 | 195907 |

Node 24.14.0 reported `MAX_STRING_LENGTH=536870888`. Conditional arithmetic for
N150000 gives body 299045711 and complete MDS1 299045716, leaving respective
positive margins 237825177 and 237825172. No N150000 tree or canonical string was
constructed. Parent high-water RSS was 85426176 bytes; elapsed 647.696291 ms. These
are bounded experiment measurements, not qualification or performance evidence.

The author retained eleven files totaling 210355 bytes. Both failed roots plus
that directory and the unchanged 49152-byte external allowance total 648954 bytes.
All 44 source/generated identities were verified again after completion. The
actual author manifest SHA256 is
`7c7b5ffae165c6d249b7e3a8b9c2c4d2732e38f56bcbc264687433c036d79255`;
analysis SHA256 is
`9cf8bfda4d7b4ab21187f11352d12087423247f3cf9e5f4e72eff283d6d9f066`;
batch receipt SHA256 is
`cb9746d0037dc80a8b1b414d1f0949fe45ed960a535620a8938a5a903454e282`.

Independent held-outs, the separate checker, final clean revision and whole
first-gate acceptance remain pending. Production dispatch remains unchanged.
No qualification representability, performance or successful 150000 execution is
claimed by this document.
