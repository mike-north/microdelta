# PR201 changed-document follow-up

Exact source `4c4934ea61ba6294894c80089423e21adecabdda` still fails the literal fresh-sibling manual recipe with **TS6053: alpha-import-only.ts not found**. An explicit copy of the unchanged fixture input then makes the compiler and runtime probe pass. The new link commands are correct from the consumer directory, but the missing input step remains. The owner has changed neither the input setup nor the official test expectations at this head.

Compared with prior source `f4211e3d925ed8aaedc313ac468d49a13149826c`, only `docs/private-alpha-workspace-consumers.md` changes: two link commands lose their misleading `../consumer/` prefixes. All compiler/package/fixture/test source is byte-identical. Prior finding and executed controls remain at `gap-hunt-review-201@62edd3fce225a664470aca650c180e50486446f4`; this follow-up preserves that pushed evidence.

The bounded probe made a new exact source archive and an empty sibling. It extracted the guide's JSON and JavaScript fences, executed its two literal link commands, and invoked the compiler. No TypeScript input was synthesized before the negative. Only after observing TS6053 did it copy the named fixture and rerun compiler/runtime as a control. Captures record all three outcomes.

This reused the earlier independently executed compiler/generated-package build after verifying all814 original source files byte-for-byte and recording the existing emitted-file hashes. It was not a fresh install/build or repetition of the original15-command workload. The literal gap is independent of declaration closure; the compiler fails before checking that closure. No product edits, new issue, remote feedback or Linux execution was performed.

## Clean-checkout default replay

```sh
python3 scratch/gap-hunt/review-201-repair/reproduce.py
```

The final helper now creates an exact temporary4c4934e archive, installs the lockfile and builds packages, then runs only the literal negative and explicit-copy compiler/runtime controls. It writes all logs/receipt to a newly printed temporary output directory, never the tracked captures. Every subprocess has an explicit timeout: Git/archive60seconds, install/build900seconds each, guide setup30seconds, probes60seconds, Node version30seconds. On macOS only, an installed26.5 Command Line Tools SDK is selected command-locally when present; no global environment is edited.

That default command was executed once on macOS arm64 Node24.22.1. Fresh npmci/build:packages both exit0; literal guide input still givesTS6053; explicit copy yields compiler0/runtime0. All814 archived source files remain byte-identical. `captures/default-bootstrap/` retains the normalized install/build/probe logs and exact seven-command receipt. No full15-command repetition or Linux runtime is claimed.

The earlier qualified-reuse run remains preserved in commit `e3605f4` and the original capture files; it is separate from this later fresh-bootstrap proof. The current default runner no longer requires BUILD_CHECKOUT or writes captured evidence in place.

Attribution: Codex worker GPT-6.1 Sol executed this bounded follow-up for Mike North. No human execution/review claimed.
