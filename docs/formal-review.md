# Using models to improve implementation review

TLA+ is useful where interacting states and failure paths make an important
correctness question difficult to assess with examples alone. Select such a
question before building or expanding a model. CML is retired; API Extractor
reports and the compiler/import/declaration gates remain the API and
encapsulation mechanisms. Lean work is dormant until a concrete problem makes
it an appropriate tool. The owning [experiment decisions](spec/experiments.md)
record this policy and distinguish it from historical results.

## Local model and executable evidence

For a selected protocol, record its state, transitions, invariants, assumptions,
and modeled bounds. Check the intended model and a meaningful faulty control.
Preserve the counterexample and explain the property it challenges. A successful
finite check is evidence within those bounds and abstractions.

An agent then reviews two relationships, using the active contract as authority:

| Comparison | Required evidence |
| --- | --- |
| Model to implementation | Each affected transition/invariant mapped to actual code, guards, writes, transaction boundaries and recovery behavior; explicit abstraction differences |
| Model to tests | Each affected invariant and relevant counterexample mapped to named tests and actual assertions; confirmation those tests run in normal CI |

Classify items as aligned, divergent, specified but missing, insufficiently
tested, or ambiguous. A useful report cites the model, implementation and test
locations together, explains the triggering case, and distinguishes a code defect
from missing coverage or a model assumption. Do not create a defect merely to
justify modeling. An existing test name or a passing suite is insufficient
without inspecting the assertion that checks the property.

The supervisor evaluates the findings and stages bounded corrections. Software
corrections follow the repository's tests-first discipline, with negative cases
that exercise the relevant failure or interleaving. The resulting implementation
tests run in ordinary CI. Recheck the local model and both mappings when affected
transitions, invariants, bounds or assumptions change; unrelated edits do not
require a proof-tool run. Record what was actually checked and what remains
outside the evidence.

## Current publication scope

The [publication contract](spec/execution.md), [EXP-7 model](../experiments/exp-7/README.md),
and [EXP-3 protocol](../experiments/exp-3/protocol.md) provide the current example.
Review ownership/expiry/takeover, fence matching, durable allocation, stage versus
complete visibility, atomic publication/rollback, lost acknowledgment, stable-key
recovery, and retained exact-reference reads. The missing-fence configuration is
a control that permits a stale publisher; compare it with both the implementation
guard and the test's assertions about the rejected write and surviving state.

The model abstracts successful publication as one atomic transition. Real SQLite
rollback and process-kill/reopen tests are independent evidence for the concrete
implementation. The finite model does not establish unrestricted concurrency,
liveness, power-loss safety, arbitrary clock behavior or provider exactly-once
execution. EXP-3/EXP-7 evidence also does not establish a completed production
runtime; new production ownership requires renewed correspondence review.

## Copilot's role

[Repository instructions](../.github/copilot-instructions.md) request an extra
Copilot review. [Publication instructions](../.github/instructions/publication-review.instructions.md)
apply to EXP-3, EXP-7, History and the governing execution contract. They prompt
both alignment comparisons when the change affects the modeled protocol.
Maintain those paths when implementation ownership moves or a new area gains a
model; a broad path match alone does not justify a new model or a local run.

Custom instructions guide a nondeterministic reviewer. Their presence does not
prove the requested comparisons happened or that a tool ran. The supervisor must
inspect actual findings, request a focused local audit when needed, and record
unverified relationships honestly. Follow [delivery conventions](../ENG_TEAM_INSTRUCTIONS.md)
for review completion, feedback disposition, required checks and merge authority.

GitHub supports repository instructions in `.github/copilot-instructions.md` and
path-scoped instructions under `.github/instructions/*.instructions.md` using
`applyTo` patterns. Its current documentation says review reads instructions from
the PR head, allowing these instructions to be evaluated in their own PR. See
[GitHub's review customization documentation](https://docs.github.com/en/copilot/tutorials/customize-code-review)
and [supported instruction types](https://docs.github.com/en/copilot/reference/custom-instructions-support).
