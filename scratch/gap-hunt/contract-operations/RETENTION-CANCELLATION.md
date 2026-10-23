# Retention and supported waiter cancellation follow-up

This follow-up has3review items:2 bounded delivered behaviors with executable evidence, and1 unresolved future policy/mechanism item. It does not extend a claim to every RES006/ACC008/RUN014 paragraph. No selected Proposal or archived/historical text contributes to this denominator.

## Durable retention currently refuses deletion

The complete `IDurableHistory` interface (`packages/history/src/durable/contracts.ts:565–650`) exposes allocation, staging, publication, abandon-with-retained-evidence, recovery, reads, acceptance, promotion, journal and close; it has no cleanup, deletion or reclamation operation. The facade and Supervision similarly expose no cleanup/reclamation authority. `close()` releases the connection and is not deletion. Public memory Store operations do not establish a durable reclamation policy.

`history/src/durable/schema.ts:39–58,252–259` installs unconditional update/delete refusal triggers over immutable history and delete refusal over retained mutable-state tables. These statements have no Accounting/currency predicate. Accounting has its own immutable durable evidence. This structurally prevents the current backend from treating zero/unreported money as permission to remove retained results. It is not evidence of a future selective cleanup algorithm.

Reused exact assertions, freshly run by name:

1. durable-history/durable-history: **stored results and acceptances are immutable in storage** executes DELETE FROM history_results and DELETE FROM history_attempts, plus mutations of result/index/acceptance facts, and asserts immutable/foreign-key refusal; exact result remains consistent.
2. acceptance/integrity-io: **a superseded summary stays exactly readable beside its successor** runs independent worker processes and reads both exact old/new payloads after current output changes. Supersession does not delete or retarget the saved old locator.
3. accounting/node-conformance: **recorded facts cannot be updated, deleted or replaced in storage** rejects deleting reports/request attempts and replacing existing evidence.

These existing tests are stronger evidence than another test that mirrors the trigger list. They cover unconditional current deletion refusal and superseded exact references. They do not exercise a currency-sensitive cleanup decision because no supported durable cleanup API exists. The residual should therefore read: *current retained facts cannot be deleted through supported authority; any future cleanup policy must establish the paid/unknown-currency and retained-reference prohibition before introduction*. Do not label the absent cleanup operation a product defect or invent a generic delete predicate to test.

## Supported M5 cancellation ownership

Existing workspace/writer-wait assertion **a hard stop ends a waiting run at once with stopped and leaves the holder untouched** starts a separate run waiting on a live writer, hard-stops only that waiter, asserts stopped and the same holder lease. It does not drive active work on the holder.

New **gap-hunt-durability-waiter: stopping another run demanding the same subject leaves its active owner live; the result later reuses** uses one workspace/store/environment/composition and the same memo target. Owner work enters an explicit bound helper and waits at a test barrier; the other run waits for the writer. Hard-stopping only the waiter returns typed stopped with bodyCalls1. The owner resumes with stop:none, publishes, and a later run reuses its exact reference with bodyCalls still1. This proves actual owner completion survives another caller's cancellation under the selected M5 serialized writer protocol. It does not create simultaneously shared in-flight work or a cancellable subscription.

Tracked-capture lint rejected the initial inline test memo's mutable hidden captures. The fixture was changed to an explicitly bound helper, preserving the strict check. No lint suppression or production change. The new behavior assertion passed on its first executable run.

RUN014's general shared-consumer clause and its open ownership/propagation mechanism remain unresolved beyond this supported lease-wait boundary. We must not silently infer that a single run exposes per-waiter cancellation, detach semantics, or a work-owner reference count. Existing same-run calls share the run stop controller; stopping the run is not cancelling only one consumer.

## Temporal evidence refinement

The earlier selected audit added all-five-mutations expiry checks; broader existing concurrency/interleavings **W4** already tests independent-process allocate/renew refusal exactly atT and successful allocate atT-1, then successor acquisition atT. **W3** tests cross-process high-water resurrection refusal. These were in the preexisting broad evidence corpus; this follow-up inspected their exact expectations but did not rerun the concurrency suite. Avoid describing endpoint equality itself as entirely previously untested: the new focused case extends the explicit mutation matrix to stage/publish/release.

## Validation

Strict TS compilation and type-aware lint of the new fixture pass. New waiter case1/1 passes (waiter-owner.log). Named existing controls4/4 pass across4suites with80unselected cases skipped (retention-boundaries.log); the fourth is the existing waiting-run stop assertion. These are focused runs, not another full-suite claim.

```sh
npx tsc -p packages/core/tsconfig.test.json
npx eslint packages/core/test/gap-hunt-durability-waiter.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-durability-waiter.test.js
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/durable-history/durable-history.test.js packages/core/.test-build/test/acceptance/integrity-io.test.js packages/core/.test-build/test/accounting/node-conformance.test.js packages/core/.test-build/test/workspace/writer-wait.test.js --testNamePattern 'stored results and acceptances are immutable|superseded summary stays|recorded facts cannot be updated|hard stop ends a waiting run'
```

No production fixes, issue edits, provider calls or reclamation policy changes.
Implementer: Codex worker (gpt-6.1-sol).
