# Final local execution receipt

Executed in a fresh `git archive` of tree `84d278990c743766c463c5d310ab71faac8eb6d9` (the staged evidence snapshot before this receipt and final hash manifest).
Archive path is private OS temporary storage. No existing installation, generated package output, scratch dist or dependency directory was copied.

Command, from archive root with default output configuration:

```sh
sh scratch/fresh-docs-cursor/reproduce.sh
```

Exit: **0**. Node 24.22.1. `npm ci`, complete workspace build, strict TypeScript and type-aware lint succeeded. Jest: **3 suites / 6 tests passed**. Dropped-page, wrong-summary and unconditional-source-refresh controls all rejected (exit 1).

The command wrote to its default `.test-build/fresh-docs-cursor/run`; no tracked evidence log was overwritten. Every one of the **853** archived tracked files was SHA-256 checked before/after: **0 changed**. Before and after sorted JSON path-to-hash manifests both hash to `56268b62f67545ffab99baaffcdfdef1401144f6c820d6507c3f9e16e8b1b43b`. This is a byte-for-byte clean tracked-state check in an archive without `.git`; generated/untracked installation and build output is intentionally excluded.

The public `evidence/archive-*.log` files contain normalized captures of that run. Their raw/public hash pairs are in `evidence/NORMALIZATION.json`; raw captures remain private. The final branch is squashed onto the frozen base, so no earlier raw-log commit is published.

Tested harness file hashes (unchanged after archive execution):

```text
190bde877b0d4342aa653975c36b9ed0c8aa7d5768d5d79d7078401ab6d28c8f  scratch/fresh-docs-cursor/adapter.test.ts
acad97eecf4a070d0d48145e3f87f18e96d86893d24549d393f012bf0874a46c  scratch/fresh-docs-cursor/adapter.ts
ead8aa7908de1625174d0e84629dcbc35ea3dfc1b9b97f93a4d24b6e598d4252  scratch/fresh-docs-cursor/controls.mjs
c3fff8ac67b9f7f1c09c4953f13b8ed2af7721f2c3ca0bb1d36633ca70cf0903  scratch/fresh-docs-cursor/eslint.config.mjs
7c237bba5e2370e375e7b0ee4f2540d38ff6f8d8e9072630040ae04445da0b8b  scratch/fresh-docs-cursor/jest.config.mjs
8d3d44451e115342e934e16cea48e772415c01f9ff0de84d242cf488de87fe82  scratch/fresh-docs-cursor/normalize-logs.py
73b5d0cd884092a70ea6c6efa6f8f8523e887a9ef4690dcae9bc79062f23a50c  scratch/fresh-docs-cursor/pipeline.test.ts
e15915b68bbd9e5f127cbe439b6458b071f5675aff561fa8a18d1d65bb62e7bc  scratch/fresh-docs-cursor/pipeline.ts
3507b3feab29f82071fdf94385131eea1f344bfad152d3823716db564a4744df  scratch/fresh-docs-cursor/reproduce.sh
7b68330f9ec1130b4adb927d26c7140d62071efcdaa2bc9a7596e72716b32912  scratch/fresh-docs-cursor/source-pagination.test.ts
27f246e204c3b140f4ccc703e5c5c9d75c68ee0101daf0663fd4137539b32cdf  scratch/fresh-docs-cursor/source-pagination.ts
f0552e84302589b0dd01bc2a4f46fbe6c20e89df6bb131bdf2de5075c4d64ab8  scratch/fresh-docs-cursor/tsconfig.json
```

Only receipt, public evidence normalization and the final overall manifest were finalized after the tested tree. No tested TypeScript, configuration, control or reproduction script changed.
