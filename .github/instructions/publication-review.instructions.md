---
applyTo: "experiments/exp-3/**,experiments/exp-7/**,packages/history/**,packages/core/test/concurrency/**,docs/spec/execution.md,docs/formal-review.md"
---

# Publication model alignment review

Use `docs/formal-review.md` when a change affects modeled publication behavior:
lease ownership/expiry, fences, allocation, staging, current pointers, retained
exact references, crash recovery, or stable-key retries. Matching a path is a
review prompt, not proof that an unrelated edit changes this protocol.

Start with `docs/spec/execution.md` (especially PUB-004). Read the relevant
transitions/invariants in `experiments/exp-7/Publication.tla` (publication,
abandonment, acceptance) and `experiments/exp-7/WriterLease.tla` (writer lease,
waiting, takeover and clock high-water), their configurations, and the
assumptions in `experiments/exp-7/README.md`. The production durable History in
`packages/history/src/durable` is mapped to both models, action by action, in
the latest `docs/validation/m5-concurrency-*.md` record; EXP-3 remains the
historical experiment implementation.

Perform two comparisons for affected invariants:

1. **Model to implementation:** identify concrete code paths, guards, durable
   writes and transaction boundaries representing each affected transition.
   Check live/current ownership at publication; prevent stale holders from
   mutating successor state; distinguish allocated/staged from complete;
   preserve exact retained references and monotonically allocated authority.
   Check recovery before commit, after commit and before acknowledgment.
2. **Model to tests:** inspect actual assertions, not just test names. Find
   executable cases for the affected invariant and its known-bad
   configuration's counterexample, and the matching code mutation control:
   - every `WriterLease.tla` fault, and `Publication.tla`'s
     `abandon-completed` and `accept-moves-current`, has a control in
     `packages/core/test/concurrency/controls/controls.mjs`, run by
     `concurrency-mutation-controls.mjs`;
   - `Publication.tla`'s `omit-publish-fence` has its control ("publication
     ignores the fence") in
     `packages/core/test/durable-history/controls/history-mutation-controls.mjs`;
     the concurrency holder-guard fence control covers the same guard for
     every operation. Check state after rejection/rollback and after process
   restart, and completed-key retry's reference and body-call count. Confirm
   relevant tests run through the repository's ordinary CI commands.

Classify concrete gaps as divergent implementation, missing behavior,
insufficiently tested behavior, or an ambiguous model/contract. Cite model,
implementation and test evidence together. Recommend the smallest meaningful
assertion or correction; leave unsupported conjectures explicit.

TLC's finite safety result assumes its stated bounds, time model and atomic
publication abstraction. It does not prove SQL internals, arbitrary clocks,
power-loss durability, liveness, unbounded concurrency or exactly-once provider
side effects. Real transaction and process-kill tests supply different evidence.
Do not demand those excluded guarantees or pretend the model establishes them.

A changed transition, invariant, bound or abstraction may require a local model
run and renewed alignment audit. Request that follow-up with a concrete reason;
do not claim execution or model equivalence from inspection alone. CI runs the
implementation tests derived from this analysis, not TLC by default.
