# Bounded original-fixture 100k diagnostic

**The fixed 100k run did not complete within 300 seconds.** It published the listing by 15 seconds, then retained only that result through the cap. No 100k member-correctness or throughput claim is established.

Exactly three distinct runtime executions ran, with no retries or extensions:

| Execution | Pin | Outcome |
| --- | --- | --- |
| Fixed size 100 control | `f46223193696b67499322bdf70260b85a6277564` | 100 succeeded; 96.695 ms resolution, 0.335 s process; normally closed, 548864-byte store; readable normal-flushed CPU profile, 132 samples / 585 nodes |
| Baseline size 100000 | `c5802daca4a0bb8ea91159854d84eddcfa5215b6` | 45.093 s, SIGKILL at 45-second cap, child confirmed gone; one attempt, no result committed |
| Fixed size 100000 | `f46223193696b67499322bdf70260b85a6277564` | 300.075 s, SIGKILL at 300-second cap, child confirmed gone; one attempt, one listing result, no member results; no normal close |

The caps are execution bounds, not SLAs. The later PR193 head `eee168b40d04785381a0c62f44e55f8a985dd4da` was not substituted for the executed pin. Earlier 30-minute 100k evidence remains unchanged.

## Phase evidence and limits

Baseline read-only snapshots through its cap show one attempt and zero results, nodes, edges, or addresses: the first listing had not committed. Two five-second external macOS samples near 10 and 30 seconds contain 438 and 439 main-thread samples. Native frames include property enumeration, descriptors, KeyAccumulator and regexp builtins, consistent with #160's repeated ancestor-array validation. ObjectGetOwnPropertyNames has inclusive branch counts 63/60/53 and 72/75/74. These are stack occurrences, not disjoint self-samples or CPU-time percentages. Anonymous JavaScript JIT frames prevent exact source-function attribution.

Fixed read-only observations at 15, 30, 60, 120, and 240 seconds and after termination show one listing result, 300003 nodes, 300002 edges and 300003 addresses. The listing had therefore passed the baseline's observed publication boundary. The helper skipped its conditional 30-second sample because publication had advanced. After the 60-second snapshot still showed no member attempt/result, the supervisor separately authorized one five-second external sample without changing the running helper or cap. It began about 88.464 seconds after launch. All 430 main-thread inclusive samples show `Statement::JS_all` into `sqlite3_step`. Its JavaScript callers are anonymous; exact SQL and source attribution remain unproven. The separate sample has its own receipt.

This establishes phase progress followed by incomplete later work. It does not establish causal timing improvement, current-main capacity, an exact bottleneck query, or general scale performance. RSS snapshots are sampled measurements, not peaks; native sample physical-footprint peaks use a different metric.

## Correctness gate and source integrity

Success requires normal exit, 100000 succeeded, normal store close, and an independent read-only audit of all listing keys/scores and every score subject/payload. `fix100k.py` implements that audit using exact fixture tagged-wire shapes independently of runtime decoding. The timeout prevented the full audit from running, so `fix100k.correctness.passed` is false. No partial result is promoted to complete correctness.

`collections.ts` is byte-exact from `88812f7aafcc18f4736f23dd7ae5c6d4e27de62f`. No TypeScript observational overlay or product edit was used. Heap 1536 MiB, lease 3600000 ms, original authoring/input/output semantics, and a fresh PID store were preserved. All 813 tracked fix files and 750 baseline files remained byte-exact before bootstrap, after build and after runtime. Each fresh worktree ran locked install, package build, strict fixture compilation and type-aware lint, all exit 0. Step 3 explicitly reused the verified fixed build; its helper compared tracked sources with the control receipt and hashed generated JavaScript before/after runtime.

## Reproduction

On macOS with Node 24, npm, Python and `/usr/bin/sample`:

```sh
python3 scratch/gap-hunt/100k-profile/reproduce.py
python3 scratch/gap-hunt/100k-profile/fix100k.py
```

The first command runs only the size-100 control and 45-second baseline diagnostic. The second runs only the 300-second fixed diagnostic. Defaults create fresh detached worktrees at the exact pins and perform bootstrap checks before runtime. Output and stores remain private for inspection. Neither command runs providers or publishes anything.

These clean default invocations were statically reviewed, not rerun after capture. Captured steps 1+2 used explicit fresh worktree/output options. Captured step 3 used `--verified-worktree` and a new output directory beside the earlier control receipt. The final change to `reproduce.py` adds only an upfront Darwin guard after capture; `fix100k.py` is the exact executed helper. The separately authorized post-listing sample was launched externally, so the default helper does not reproduce that supplemental sample automatically.

No 1k/10k repeat, full G, paid provider, product implementation, Linux runtime, package publication or release is claimed. Artifacts were implemented and captured by a Codex worker. Supervisory review and publication are separate.

## Capture integrity

`captures/` contains textual logs, receipts, source hashes, the normal-flushed control CPU profile and external native samples. SQLite/native binaries, node_modules and generated runtime distributions are excluded. Explicit private roots were normalized; raw bytes remain local. Receipt-internal SHA fields refer to raw originals. `summary.json.public_capture_files` maps raw and normalized SHA256; `manifest.json` governs public bytes and excludes itself and ignored compiler outputs. Historical step-1/2 environment receipts retain their contemporaneous `step3_fix100k_executed: false`; the final summary separately records step 3.
