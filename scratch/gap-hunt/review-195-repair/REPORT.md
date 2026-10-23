# PR 195 memo error-provenance verification

**PARTIAL** on production source `a13a3fd88ffe5ed24334f60af84316b31d98971e`.
The original author-created constructor case is repaired. Two supported memo
routes still let author text become the outer framework message after an author
mutates a genuine child failure. This is the same RUN-013 memo provenance/privacy
obligation, not a new callback scope or hostile-object claim.

From a disposable Node 24 checkout:

```sh
python3 scratch/gap-hunt/review-195-repair/reproduce.py
```

Exit zero means the precise mixed outcome below was reproduced; it does not mean
the product's remaining privacy assertions are green. No product fix is included.
The command writes captures to a printed temporary directory unless
`MICRODELTA_EVIDENCE_OUTPUT` is supplied.

## Observed result and acceptance mapping

| Evidence | Result | Meaning |
| --- | --- | --- |
| Frozen original issue190 regression, nine cases | 9 pass | Safe constructed-author error wrapping/cause identity, ordinary-error control, genuine child classification, and six opaque provider controls preserved |
| Owner's current expanded memo regression | 12 pass | Ordinary Error plus four constructed ResolutionError codes, genuine child and six provider controls pass |
| Existing author-error privacy suite | 6 pass | Selected source/body/policy/admission/observer controls stay green |
| New genuine-child mutation matrix | 1 pass, 2 fail | Unmodified child safe; mutate/rethrow and mutate/swallow expose exact synthetic author text |
| Frozen callback350805f matrix | 4 pass, 4 fail | Known separate issue194 residual, excluded from the PR195 memo verdict |

AC1/2's reproduced constructed-error repair passes: the public class alone no
longer bypasses the memo's execution-failure wrapper. The safe outer message names
the step and the exact constructed object remains cause. AC3's genuine child
classification and refusal to publish an incomplete parent remain effective, but
its runtime-provenance distinction still trusts an author-mutable Error object.
This leaves the same memo RUN-013 outer-message boundary incomplete. AC4's six
provider controls remain green: explicit failed versus unknown rejected-perform,
sibling progress, exactly one provider invocation, returned opaque cause identity,
zero conversion/getter calls, and no synthetic detail in their selected views or
store bytes. AC5's original nine-case ordinary regression, strict/type-aware
checks and generated-declaration consumer checks pass. No full repository-suite
claim is made.

## Minimal supported discriminator

`mutation.test.ts` is a strict generated-alpha consumer, with no private source
alias, cast, proxy, getter or malformed error object. A real child memo returns
unsupported nested callable data. Resolution creates the normal public
unsupported-result error and records that failed declared call. The parent awaits
`calls.child()` and catches its rejection. A bound author helper narrows that
ordinary value with `instanceof Error`, assigns its public `message` field a
synthetic string, and returns. The parent either rethrows the same caught error
or returns the supported record `{ amount: 0 }` after swallowing the rejection.
The author callback captures no error class or synthetic marker; mutation belongs
to the bound helper.

All code, message, identity, mutation count, completion and SQL-row observations
are logged before assertions. On both failing routes:

- outer code is `unsupported-result`, asserted before message privacy;
- outer message is exactly `SYNTHETIC-RELABELED-CHILD-8b42`;
- outer error is exactly the object the author helper mutated;
- helper mutation count is one;
- no completed result is returned, and real SQLite `history_results` count is zero.

The unmodified control keeps its safe generated child message and genuine
unsupported-result classification, executes no mutation, and also has no completed
rows. Thus the finding is outer-message exposure, while the failed-child
publication guard works. There is no claim here that author-path events, diagnostics
or store bytes leak; the zero-row census establishes nonpublication only.

## Source boundary

Resolution's `dispatchNested` failure path stores the first child error in
`frame.failed.error` before the author receives it. In the memo catch, the new
`runtimeFailure = failed?.error ?? ...` branch returns that same non-execution
ResolutionError. If the parent swallows instead, the existing post-body
`frame.failed` branch returns the same error. Neither freezes nor snapshots its
public presentation before author access. The two controls distinguish these
separate branches without proposing a representation or changing error APIs.

## Immutable historical evidence and separate callback scope

Four files are byte-checked against original proof
`49c47b79346e78ae9ef22f8985d254254200a14c` and callback proof
`350805fbfa423b8bfdfaeba4fe7ea3b8f7a51b3c`: both original test files and their
historical expected-red runners. The historical runners remain frozen and are
not invoked as the new acceptance oracle. The original nine-case TypeScript is
copied byte-for-byte to a uniquely named temporary Core test, strictly compiled
and linted, executed against current emitted Core and generated sibling packages,
and removed in `finally`. Its assertions and imports are unchanged. The callback
file is compiled untouched against generated alpha declarations and linted using
the repository's type-aware rules. The new mutation fixture uses the same generated
consumer boundary.

Callback failures remain source, supplied, strict-fold and outcome-fold
constructor cases, each with one helper call, exact authored outer error/message,
and zero failing-subject result rows. All four ordinary-error controls retain safe
outer text and exact boundary cause identity (including the extra safe supplied
memo caller wrapper). Owner issue194 explicitly owns these known callback paths;
they are reported as residual evidence, not additional blockers to memo-only195.

## Exact negative counterfactual and restoration

Only `packages/resolution/src/resolution.ts` is replaced with exact main
`5e3b2feba7191d6d643e571492730e5344b73b22` bytes, then packages are rebuilt.
The frozen original returns to exactly eight passes and its one named
constructor-message failure. Both child-mutation failures are present under that
old source too; this is an existing remaining hole, not a new regression caused
by the repair. A `finally` block restores exact current source and rebuilds.
The original nine cases return to green; the two exact memo mutation failures
remain, with the same recorded identities, code and no-publication outcomes.

The runner validates exact Jest test/suite counts, exact named failures, zero
runtime-error suites and the detailed original/callback/mutation observations.
Guard-only mode validates captures and rejects synthetic missing, load-error,
forged-load and wrong-count evidence:

```sh
python3 scratch/gap-hunt/review-195-repair/reproduce.py --check-logs PATH_TO_CAPTURES
```

Recorded platform and command exits are in `captures/receipt.json`. This is local
synthetic macOS/Node24 SQLite evidence, not Linux, whole-main, all-callback,
provider-network, release or deployment qualification. Supervisor owns independent
artifact review, publication, follow-up and acceptance. No issue or PR was posted
by this worker.

The committed capture completed all 21 expected command exits; its intentional
nonzero Jest exits retain ordinary safe-message assertions. JSON captures normalize
checkout paths. The final runner additionally applies that same path normalization
while capturing, without changing fixture behavior, assertions or source.
