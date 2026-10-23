# PR178 integrated-head focused verification

Reviewed source: `7a1c272c39b7d7e35e2cd9a0971d83312bde6ab3`. The merge adds only previously reviewed main changes to `6b3c9e5`, but the frozen worker uses the facade, which reaches changed Value code. A focused replay therefore rebuilds all packages and fixtures before exercising the unchanged occurrence witness.

Run from a clean checkout with Node24/npm:

```sh
python3 scratch/gap-hunt/review-178-repair/reproduce.py
```

The original six occurrence-support files remain byte-identical to the published earlier proof. The runner installs locked dependencies, builds packages/fixtures, checks strict compilation and occurrence lint, requires five positive cases, and removes only the emitted current recipe subject observation. That counterfactual requires four passes and the original stale swapped-subject failure, including reuse of the cold reference with no execute/publish events. Finally restores emitted bytes and requires five passes again.

Recorded Node24.22.1/npm11.12.1 on macOS arm64: positive **5/0**, removed-subject negative **4/1**, restored **5/0**, zero runtime errors; strict/lint, official tsd and origin tooling all exit0. Original receipts and command exits are adjacent under `captures`.

The replay also runs the official authoring tsd contract and origin tooling test, including its accepted-token mutant. It does not repeat the prior supplemental covariance mutation, broad experiment suite, or capture suite. Actual OS, architecture, Node and npm are captured dynamically. Results qualify this finite occurrence behavior on the recorded host; no Linux, full CI, or accepted-DSL claim follows.

Implementer: Codex contracts worker (GPT-6.1 Sol) for Mike North. Supervising Codex retains acceptance and publication authority.
