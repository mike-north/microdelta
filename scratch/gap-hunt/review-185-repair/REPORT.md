# PR185 inherited-isolation gate repair

Bounded PASS for exact `25b8f3f58f295ca3e985126546e79b223ce0ebd4`, following the earlier `aad9b93f23fb38b1cf1387e2f865c5490fc2b434` review. The three-file delta adds a child-environment helper, tests its copied-environment behavior, and uses it in the official lifecycle gate. No runtime source changes from the reviewed prior PR head.

The helper copies the caller environment, sets build reuse, and deletes `CONTEXT_COMPONENT_ISOLATED`; it leaves unrelated variables and the parent's object intact. This preserves the diagnostic's independently available external workaround while forcing the official gate to exercise the unwrapped library path.

## Executed evidence

Actual host: macOS27.0.1 arm64, Node24.22.1 and explicitly supplied Node26.12.0. The command installs locked dependencies and builds generated packages; it verifies all nine original fixture files byte-identical to `04ff7ee680f48e6436abb92153601cec7ec1a828` before execution. The original standalone reproduction and its semantic control are unchanged.

| Host/gate combination | Node24 | Node26 |
|---|---:|---:|
| Repaired runtime, original component |2 pass|2 pass|
| Repaired runtime, independent300-capture census |2→2→2 confirmed|2→2→2 confirmed|
| Repaired runtime, repaired gate with inherited flag1 |exit0,1 pass|exit0,1 pass|
| Exact old host, original component |1 semantic pass/1 retention failure;growth200|same|
| Exact old host, external diagnostic workaround |2 pass|2 pass|
| Exact old host, repaired gate default |exit1,0 pass/1 fail|same|
| Exact old host, repaired gate inherited flag1 |exit1,0 pass/1 fail|same|
| Restored runtime, original component |2 pass|2 pass|
| Restored runtime, repaired gate inherited flag1 |exit0,1 pass|same|

The exact old host is `471c1d47ef3dc0700e36d8da2adca7e02534570b`'s Node Machine source. The runner temporarily installs that source and rebuilds only the Node adapter; the remaining generated packages remain the current build. For a sensitivity control on Node24, the same old host with the exact prior `aad9b93` gate and inherited flag1 returns exit0/1 pass, reproducing the previous false-green boundary. The repaired gate is then restored. A finally block restores both product source and gate byte-exact, rebuilds the adapter, and requires the original component and inherited gate to pass again on both supplied hosts.

All24 recorded commands have expected exits; deliberate negatives remain failures. Captures include full original semantic+retention output, independent censuses, gate/helper TAP, builds and commands. Runtime source SHA256 `ef4093bd9085e1546397e20828bbb2ac6398e94b17cd8a41e843f806ade6eaee`; gate SHA256 `f51e654bada1bd65e7d0a84ac2e0fedc5efbe73452a1bd0790e2055f11e442f4`. Raw logs stay in ignored `local-results/`; committed captures replace checkout/binary paths with placeholders and trim trailing whitespace.

## Pickup and boundary

From this evidence commit on Node24 with normal native-build prerequisites:

```sh
python3 scratch/gap-hunt/review-185-repair/reproduce.py
```

The default covers Node24. Set `NODE26_BIN` to an existing Node26 executable to add the recorded second-host comparisons; no binary is provisioned automatically. This is focused verification of the inherited-isolation gate finding, not a whole-CI bypass claim. The unchanged broad owner suites were not rerun. Earlier runtime acceptance evidence remains separately qualified at its original pin; no Node22, Linux, universal heap/timing, publication or paid-provider claim follows. The hunt supervisor owns evidence assessment and public posting; the repository supervisor owns acceptance and merge.
