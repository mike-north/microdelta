# PR179 second repair verification

Exact source reviewed/executed: `88f9b35830bf3f35368e8685155e0d7284dad383`. **PASS for the two previously reported residuals:** encoded literal ESM source paths now reject, while a local parameter named require creates no module edge. This is bounded architectural source-check evidence, not universal checker conformance.

The new rule resolves ESM file targets through Node URL parsing and fileURLToPath; CommonJS retains filesystem semantics. Lexical scope definitions distinguish a local require callable from an unbound require loader. The complete head delta also carries the already-reviewed main Node22/24 policy integration; this review executes the final exact head.

Two frozen witness files from `gap-hunt-review-179-repair@907b945d558b7e058c9b0dffeb60295ec240a1b3` remain byte-identical. The residual matrix verifies Node import.meta.resolve sends the canonical and encoded spelling to the same History source target; both reject, while ordinary and encoded local paths pass: **4pass/0fail**. The lexical parameter witness produces zero errors. The original official boundary suite and new repair suite pass **14/14**, and `npm run check:imports` passes after an independent clean npm ci. The earlier broad original21probes/8matrix evidence remains at its original execution pins; those separate historical artifacts were preserved and not relabeled fresh here.

Sensitivity is verified by replacing only tooling/example-source-imports.mjs with its exact old e00d5f9 bytes: the unchanged residual matrix returns **3pass/1fail**, and the local require witness returns the original one-error false positive. A finally restores the exact current rule; both witnesses and the official import check pass again. Original config, fixtures and all other source stay unchanged. The runner verifies each frozen witness against its committed blob and validates its evidence-only allowlist before and after execution.

From a clean checkout with Node24/npm:

```sh
python3 scratch/gap-hunt/review-179-second-repair/reproduce.py
```

It installs its own locked dependencies, asserts the exact positive/negative/restored counts and exits0 only when all expectations hold. Raw outputs and commands are adjacent under captures; local rerun outputs are ignored. Existing original first-repair PARTIAL evidence remains truthful at e00d5f9/907b945.

Executed on macOS arm64 Node24.22.1. No referenced forbidden module was executed, no wholeCI bypass/pass or Linux execution is claimed, and no provider execution, product fix, approval or merge occurred.

Implementer: Codex contracts worker (GPT-6.1 Sol) executed and packaged this bounded verification for Mike North.
Agent assistance: supervising Codex commissioned the exact-head repair check and retains acceptance and public-comment authority.
