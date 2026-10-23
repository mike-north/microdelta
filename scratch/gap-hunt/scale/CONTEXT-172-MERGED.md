# #172 reproduces after merged #171

Production source: actual merged runtime `f43c5872987573d9b98a19f41c324b4d9336894c`, independently fetched from origin/main and checked out in new owned worktree `gap-hunt-review-172-main`. No production source was copied or changed. Reproduction files are byte-identical copies from DX evidence commit `04ff7ee680f48e6436abb92153601cec7ec1a828`; `context-172-merged-fixture-hashes.json` records source/copied SHA-256 for all nine files. This branch contains only those reproduction files and evidence.

The fresh worktree had no node_modules or generated builds. On Node `v24.22.1` / npm `11.12.1`, the default clean command independently installed and built packages, strictly compiled the consumer against generated alpha declarations, ran type-aware ESLint, and reproduced the existing failure:

```sh
node scratch/gap-hunt/scale/repro-context-component.mjs
```

Result: exit **1**, semantic controls **1 pass**, retention **1 fail** (`growth 200`, required `<=4`). Log `context-172-merged-red.log` contains the complete install/build/check/test output.

The identical external-isolation control, with the now-independent build reused:

```sh
CONTEXT_COMPONENT_ISOLATED=1 GAP_HUNT_REUSE_BUILD=1 node scratch/gap-hunt/scale/repro-context-component.mjs
```

Result: exit **0**, **2/2 pass** (`context-172-merged-green.log`). The semantic control preserves await, nested capture/rejection, concurrent capture, caller ALS and rejection of detached reads inherited from a closed frame. This is an external workaround control, not a library repair.

Additional raw census processes use the exact compiled consumer with `CONTEXT_RUNS=300 CONTEXT_BATCH=100 CONTEXT_CONFIRM=1 node --expose-gc scratch/gap-hunt/scale/dist/context-consumer.js component`, with `--isolated` added for its control. Plain counts: **102 → 202 → 302**; isolated counts: **2 → 2 → 2**. Every immediate/GC/immediate confirmation equals its corresponding first census. Both runs complete **100/200/300** observations and retain no capture or observer across iterations. Raw outputs are `context-172-merged-{plain,isolated}-census.log`.

The merge changes Tracking's selected container-kind evidence; the reproduction reads a scalar leaf. Inspection confirms the only Tracking source diff from the original baseline is in local/lazy container navigation, and Node Machine source is unchanged. This explains why equivalence was plausible; the actual fresh install/build and red/green executions, rather than that inference, establish continued reproduction.

`context-172-merged-runtime.json` pins production commit, fixture commit, lockfile, emitted consumer, Tracking implementation and Node Machine implementation hashes. Original component fixture, compiler/Jest/ESLint configurations and bootstrap helper remain byte-identical. Output logs remove ANSI color escapes and trailing whitespace only. No issue/PR edits, publication, paid calls or runtime fixes were performed. This verifies the merged runtime on Node 24 only; earlier Node 26 evidence is not relabeled as a merged-runtime rerun.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.
