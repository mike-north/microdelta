# PR181 integrated source replay

Exact reviewed product head: `8bcd8ef9a4bea25d78285004cce2d3624443b705`. The delta from `76de1dd` exactly matches main `471c1d4` to `a0b539f`: Value presence implementation/test, Tracking observer test and changeset. The async-source implementation is unchanged, but this integration includes shared Value runtime changes, so this report records fresh execution.

From a clean checkout with Node 24 and npm, run:

```sh
node scratch/gap-hunt/consumer-dx/repro-async-source.mjs
```

The unchanged original command bootstraps with `npm ci` and `npm run build:packages` by default. Do not set `GAP_HUNT_REUSE_BUILD=1` for clean qualification. It compiles the four direct/template async fresh/retain type cases against generated declarations, runs tsd negative contracts and type-aware fixture lint, and executes the original two runtime tests. It exited 0 after a fresh install/build on macOS arm64 Node24.22.1: all four async cases accepted, type/lint controls passed, two runtime tests passed with zero runtime errors. All twelve original overlay/support files remain byte-identical to the manifest from prior review; tracked product files stayed clean. The captured output and machine-readable result are adjacent.

The repository product source is the exact reviewed head; this evidence commit adds only the twelve frozen public fixtures/support files and this report/result capture. To check that boundary, compare `git diff --name-only 8bcd8ef HEAD`: every path must be one of `original-overlay.json` files or under `scratch/gap-hunt/review-181-integrated/`. The original fixture uses generated declarations and built package runtime; it does not use sibling private source aliases.

The prior exact-parent declaration negative and broader 63-test review remain historical evidence at their original pins. They were not repeated here. No Linux, full repository, TrackG, provider, arbitrary async-source or #156 root-type acceptance is claimed. No product fix, PR approval or merge was performed.

Implementer: Codex contracts worker (GPT-6.1 Sol) executed and packaged this bounded review for Mike North.
Agent assistance: supervising Codex commissioned the integration check and owns acceptance/public comments.
