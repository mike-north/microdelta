---
applyTo: "experiments/exp-3/**,experiments/exp-7/**,packages/history/**,docs/spec/execution.md,docs/formal-review.md"
---

# Publication model alignment review

Use `docs/formal-review.md` when a change affects modeled publication behavior:
lease ownership/expiry, fences, allocation, staging, current pointers, retained
exact references, crash recovery, or stable-key retries. Matching a path is a
review prompt, not proof that an unrelated edit changes this protocol.

Start with `docs/spec/execution.md` (especially PUB-004). Read the relevant
transitions/invariants in `experiments/exp-7/Publication.tla`, its configurations,
and the assumptions in `experiments/exp-7/README.md`. EXP-3 is the currently
modeled experiment implementation; do not assume all History code implements it.

Perform two comparisons for affected invariants:

1. **Model to implementation:** identify concrete code paths, guards, durable
   writes and transaction boundaries representing each affected transition.
   Check live/current ownership at publication; prevent stale holders from
   mutating successor state; distinguish allocated/staged from complete;
   preserve exact retained references and monotonically allocated authority.
   Check recovery before commit, after commit and before acknowledgment.
2. **Model to tests:** inspect actual assertions, not just test names. Find
   executable cases for the affected invariant and the faulty-fence
   counterexample. Check state after rejection/rollback and after process
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
