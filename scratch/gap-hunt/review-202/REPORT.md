# PR202 / #157 bounded consumer qualification

Reviewed exact `09da3b0b05eaff0563faa70ba68c44107508ed7b`, base `e3e1920a1300b4205b5c417f98d1202e75f2d3ba`. **PASS for the bounded documentation and macOS existing-manager consumer controls.** Linux evidence is a qualified owner capture, not a runtime execution performed by this reviewer (`capturedThisReviewLinuxFalse: true`). No product fix or remote write was made.

The eight-file patch supplies the native-build guide, three onboarding links, a pinned published-package fixture, four documentation checks, and a bounded Linux evidence record. It changes no runtime, package export, driver version, engine range, trust default or release machinery. The guide identifies immutable published `microdelta@0.2.0`, public memory versus project-private alpha durable usage, targeted local `allowBuilds` plus `pnpm rebuild better-sqlite3`, and #154/#158 boundaries. All 31 local Markdown links inspected across the five touched guides resolve to files. The four documentation checks pass.

## Independently executed macOS controls

Node24.22.1, macOS arm64; manager versions10.34.7 and12.10.1. The exact original `0683c2e` fixture bytes are unchanged, SHA256 `b2becb9113b7ee62a2d984612000ce5c52299ec114eedece4de35eb370e7cfc7`. The existing exact pnpm12 executable was selected with `PNPM12_BIN`; its version was checked before execution. No new default pnpm12 launch was attempted after the documented AMFI denial.

For both independent disposable consumers:

- pnpm10 install exits0 and warns about ignored builds; pnpm12 install exits1 with `ERR_PNPM_IGNORED_BUILDS`. Each unapproved durable open exits1 with the missing-binding error.
- Public ESM memory smoke prints `public-memory-ok`.
- Consumer-local targeted approval/rebuild succeeds. Cold work calls the body once and publishes; a separate Node process calls it zero times and reuses an exactly equal completed-result reference.

The first run retained consumer inputs, raw install/unapproved/rebuild output and cold/restart JSON. A cleanup-only exported shell function copied disposable files immediately before delegating to `rm`; the fixture itself was unedited. `captures/receipt.json` and per-manager captures record the exact results. A second execution tested the supplied clean-archive replay command without that capture wrapper: all original assertions and4 documentation tests pass, and all816 archived source files remain byte-identical. The current evidence checkout also matches all816 pinned source files (`source-files.json`). Logs replace machine/temp paths with placeholders; hashes in the evidence manifest cover those normalized files.

## Linux and host-policy limits

The checked-in84-line Linux trace digest matches `7ea8e18d3c39ac08232adc523fffffb0bdba8bc8ecda16318bc144f0f6b621ca`. Its command/provenance identifies historical fixture source `c3c0409a4e10dac2765bda10015bf286a20624e0`, whose fixture digest equals the original pinned fixture, Linux arm64 Node24.14.0, and the reported official container image identity. The trace carries both negative checks, memory smoke, local rebuild and cold1/restart0 assertions. This establishes internal consistency of the owner-supplied Linux evidence, not independent Linux runtime proof or validation of the daemon/image identity by this reviewer. Earlier Linux npm/Node24/26 owner runs remain separate.

The owner-reported successful fresh pnpm12 launch on macOS24.14.0 does not erase the exact-path AMFI/security-policy rejection on the earlier24.22.1 host. This review covers the explicit existing-manager fallback only. No Node26, other architecture, cross-version same-store, whole-repository CI or publication claim is made.

## Replay

From a clean evidence checkout, with Node24.x, Bash, npm registry access and any required native build toolchain:

```sh
PNPM12_BIN=/path/to/existing/pnpm12.10.1 python3 scratch/gap-hunt/review-202/reproduce.py
```

This archives the exact reviewed source, runs the four docs assertions and unchanged original published-consumer fixture, checks every source file before cleanup, and uses no inherited repository build. It refuses an absent/wrong-version fallback. The path above is caller-provided, not portable configuration. No default denied-manager retry or host-policy workaround is included.

Attribution: Codex worker GPT-6.1 Sol prepared and independently executed these bounded controls for Mike North. No human or independent Linux execution is claimed.

Publication refinement: the final artifact renames its manifest to lowercase, reports the future replay host dynamically, and bounds manager-version/docs checks to30/120seconds. Static syntax and timeout/host-field inspection pass; these metadata/guard edits were not used to repeat the already completed consumer workload. Captured logs retain the actual earlier macOS execution.
