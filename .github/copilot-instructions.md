# microdelta review guidance

Read `docs/spec/README.md`, then the owning contract and its acceptance cases.
Current user decisions and active contracts govern; archived designs and
experiment implementations are historical evidence, not competing requirements.

Review semantic correctness and consequential missing coverage first. Cite a
concrete changed path, the governing invariant, and a triggering example. Do not
infer correctness from passing tests, complete PR metadata, or another review.

- Preserve the six context owners and directed package dependencies. Machine
  supplies injected host capabilities; it does not own persistence or domain
  policy. Runtime Node access belongs in the Node Machine implementation.
- Treat API Extractor reports as intentional API contracts. Check declaration
  shape, release tags, encapsulation and generated-declaration consumers. A
  report update is not justification for expanding an API or exposing internals.
  Preserve compiler, type-aware lint, import and declaration-tier enforcement.
- Check that tests express intended outcomes and meaningful negative cases.
  Distinguish new coverage of correct behavior from a reproduced defect; do not
  manufacture an initial failure or accept tests that merely mirror code.
- Review durable intent comments: meaning, ownership, boundaries and invariants.
  Flag misleading contracts; avoid requesting temporary task narratives in code.
- Tracking records literal consumed facts. Tags/revisions are process-local;
  semantic addresses and fingerprints are portable evidence. Function-text
  equality does not prove binding identity or arbitrary closure soundness.
- Retained snapshots, current binding correspondence, source acceptance, and
  permission to execute are distinct. Do not collapse them into hash equality.
- CML is retired. Do not recommend maintaining a CML model. Lean is dormant until
  a concrete problem justifies it; do not request routine proofs or local runs.
- For changes affecting publication, fencing, retained history or their TLA+
  model, apply `.github/instructions/publication-review.instructions.md` and
  `docs/formal-review.md`. Compare model to implementation and model to tests.

Report actionable findings with evidence and scope. If an invariant needs a
local model run or deeper audit, identify that need and the exact missing
question. Never claim to have run a tool, proved correspondence, or established
unbounded correctness without evidence. Copilot is an additional reviewer;
the supervisor evaluates findings and retains merge authority.
