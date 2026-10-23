# #157 pickup addendum: native build approval documentation

Consumer need: a fresh external ESM consumer must discover the local native-build prerequisite before durable open, with a targeted recipe reachable from the root getting-started, facade README and contribution example. This is documentation and a bounded acceptance fixture, not a pnpm defect.

Numbered acceptance criteria:

1. Document better-sqlite3's native build prerequisite and tested pnpm10.34.7/12.10.1 differences. Distinguish public memory-store support from project-private alpha durable usage.
2. Give consumer-local `allowBuilds: {better-sqlite3: true}` YAML plus `pnpm rebuild better-sqlite3`, or an equivalently verified targeted approval workflow. Do not recommend global bypasses or approving unrelated dependencies.
3. Preserve negative controls: unapproved pnpm10 install warns then durable open fails for missing bindings; pnpm12 install rejects ignored builds. Public ESM memory smoke succeeds. Do not misdiagnose these as #154 TypeScript failures.
4. After local approval, cold durable work executes once/publishes; a separate Node process executes zero bodies/reuses the exact reference. Include the fixture and captured command results in implementation evidence.
5. Link native Node support guidance tracked in #158 without claiming untested Node26 or Linux runtime support.

Clean evidence-checkout Linux acceptance command (repository root):

```sh
bash scratch/gap-hunt/contract-operations/verify-157.sh
```

The portable runner is self-contained, pins Node24.22.1, pnpm versions and published microdelta0.2.0, creates/removes disposable external consumers/stores, and never edits global trust settings. Prerequisites: fresh Linux user/container without inherited pnpm approvals, Node24.22.1/npm, Bash, network/npm registry access, and Python3/make/g++ if native prebuild fallback is needed. The caller supplies Linux for Linux acceptance; the same runner can execute on macOS and does not create a container. Optional argument selects10.34.7 or12.10.1.

Verification boundary: Linux execution is still required. See verify-157.log for the fresh macOS runner result; do not infer Linux support from it. Underlying macOS install/approval/cold/restart evidence is in `scratch/gap-hunt/portability/REPORT.md` at447d798. Evidence scripts are on the worker branch and must be carried into a clean evidence checkout before invocation; they are not claimed to exist on main.

Dependencies: #158 for support wording; #154 is independent. Out of scope: package publication, engine changes, driver changes, Node26 expansion, automatic build-trust relaxation and alpha promotion.

Fresh macOS manager download boundary: pnpm10 runner completed; a freshly installed pnpm12 executable was killed before package installation (137), so that run did not establish the expected approval rejection. Optional `PNPM12_BIN` selects an existing exact12.10.1 executable and the runner validates its version. This is an explicit environment prerequisite fallback, not a global trust change or an explanation of the kill. The default clean Linux invocation remains to be executed.

These checks diagnose the immutable published0.2.0 release. Any implementation documentation must state which published version it describes; no package mutation/publication is part of this pickup.

Fresh macOS fallback result: both manager versions passed unapproved negative controls, public memory smoke and approved cold1/published then independent restart0/reused exact reference. `verify-157.log` captures the result. This run used `PNPM12_BIN` pointing to the existing exact12.10.1 executable; it does not validate default fresh pnpm12 launch.

Owner Linux parity update: owner-linux-parity.md reports npm install/build/main test success on24.13.0 and26.12.1. Those npm runs do not exercise pnpm10/12 approvals, so the Linux pnpm acceptance boundary here is unchanged.
