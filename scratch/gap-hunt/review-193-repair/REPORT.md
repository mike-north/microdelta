# PR 193 finite array-publication verification

Production source `4f9bc2a54648e9802b47ab3d286cffb8ad2bc06f`, issue 160.
The immutable original regression is copied from
`abb9bab1987d18644093fb67dadb17c3ea9f94ce`. No production changes are made here.

Run from a disposable Node 24 checkout:

```sh
python3 scratch/gap-hunt/review-193-repair/reproduce.py
```

The runner installs locked dependencies, builds generated package declarations
and fixture packages, strictly compiles the facade tests, and preserves the
original regression as a separate derived ESM test. That derivation changes only
the historical support import and TypeScript emission; the frozen source remains
byte-identical. Captures go to a printed temporary directory unless
`MICRODELTA_EVIDENCE_OUTPUT` is supplied.

## Contract and acceptance

DOM-3 requires one semantic model for enormous datasets and narrow retained reads;
TEST-5 requires measurement rather than an unmeasured latency promise. This
issue selects one concrete publication-work regression, not full M7 delivery,
150,000-subject qualification, a throughput SLA or storage compaction policy.

1. **Bounded publication work.** The original 20/40 flat-record array regression
   runs unchanged and passes: matched encoding inspects `[20,40]` slots and real
   SQLite stage/publication inspects `[183,363]`. The latter satisfies the exact
   doubled-input bound. The owner's expanded suite also measures nested shapes,
   independent roots, and their matched encoding controls.
2. **Exact values and selected meaning.** Owner assertions compare root encodings
   and selected observation encodings against the independent Value oracle for
   sparse slots, present undefined, signed zero, NaN, array length, nested records,
   custom prototype inheritance/own/membership, and ordered record keys. Value's
   own prepared-snapshot cases also check null prototypes and complete root meaning.
   The durable History suite compares independently encoded fingerprints and
   selected facts after reopen over the existing accepted edge-domain corpus.
3. **Fail closed before completion.** Owner tests reject accessors, cycles, shared
   references, symbols, extra array properties and custom array prototypes while
   attempts remain allocated, never completed. Value's public opaque token rejects
   fabricated objects. Three independent supplements verify: replacing a previously
   prepared same source with an accessor rejects without invoking it while old
   facts stay exact; returned nested arrays/records/custom prototypes cannot mutate;
   and staging owns its data even if the caller changes it before publication,
   while a subsequent invalid reuse cannot publish and preserves the prior result.
4. **Preserved read and publication boundaries.** The affected durable History
   suite checks selected fingerprints/leaf reads without root payload cells,
   unrelated changes versus consumed changes, stable exact retained references,
   and atomic staging/publication. Its eight original process crash assertions
   execute through the documented file transport described below; assertions,
   lifecycle script, storage, fault schedule and production worker remain unchanged.
5. **Independent validation and ownership.** Flat and nested work controls and a
   later invalid independent payload prevent a process-global stale-validation
   shortcut. The supplemental same-object mutation adds the complementary repeated
   identity case. Source review confirms preparation is an owned immutable decoded
   snapshot held behind a Value-owned WeakMap token. History's index traverses that
   snapshot and observes prepared facts; it does not keep a trusted mutable source
   or move domain ownership into Machine. New alpha APIs have TSDoc and intentional
   generated declaration exposure; Value tsd checks the opaque type boundary.

## Negative counterfactual and restoration

The runner substitutes only exact History `selected-index.ts` bytes from
`7677ec4d61fd78efc63da28906175707e1391f12`, retaining the repaired Value module.
It rebuilds packages, then requires the original one-test regression to fail at
its cost assertion with `[1323,5043]`, expected upper bound 2646 and actual 5043.
Thus the historical per-address observation path is sufficient to restore the
specific defect; this is a narrower counterfactual than reverting the entire PR.
An arbitrary import/load failure cannot count as this evidence. A `finally` block
restores the exact current source, rebuilds, and reruns the original regression.

## Process transport boundary

The first unadapted preservation run had 33 durable tests pass and eight crash
seed launches SIGKILL with empty stderr, before planned fault points. Its log is
retained in `unadapted-host-launch-failure.log`; these failures are not counted as
publication proof or a product finding. This reproduces the already established
host argv-launch limitation documented by the earlier durability investigation.

`frozen/file-fed-harness.cjs` preserves that existing test-only adapter verbatim.
The local adapter changes only its wrapper path. It intercepts only an exact
lifecycle-worker launch, writes the identical synthetic JSON to a temporary file,
and starts a wrapper that reads it into the original argv slot before importing
the unchanged emitted lifecycle worker. Temporary transport files are removed.
No runtime source, database behavior, test assertion, timing or fault expectation
is changed. The eight crash cases still require their exact successful trace
prefix and planned SIGKILL boundary, rather than treating any SIGKILL as success.

## Verification scope

Captured commands and host metadata are in `captures/receipt.json`. Affected
checks include Value strict/type-aware checks and 60 runtime tests plus tsd;
History strict/type-aware checks and 44 runtime tests plus tsd;
facade strict/type-aware checks, test compilation, generated declaration checks,
the original and five expanded publication tests, the 41-case durable/crash
preservation suites, and three independent mutation/immutability controls.
This is source-pinned macOS synthetic SQLite evidence. Linux, full-main, full M7,
paid providers, publication and deployment are outside the executed boundary.
Supervisor owns formal review, publication, acceptance and merge.

The committed capture completed all 19 expected command exits. Exact log guards
validate eight Jest summaries and the specific old cost assertion; guard-only mode
`python3 scratch/gap-hunt/review-193-repair/reproduce.py --check-logs PATH`
rejects synthetic missing, load-error, forged-load and wrong-count evidence.
