# Define and deliver the standalone read-only inspection checkpoint

Specified-but-missing target, P2, **M6 usable CLI/inspection checkpoint** (`docs/milestones.md:190–200`). **Leave unlabelled; not implementation-ready until owner decisions below are recorded.** Governing contracts: operations.md CLI001–004 and acceptance.md A16. This is not a regression against bounded M5 acceptance.

## Consumer need and evidence

A separate process must inspect retained values, attempts, acceptance/dependency evidence, errors, waits and observed usage without loading current analysis callbacks or starting work. Status must distinguish verification/reuse/execution, waiting, mixed outcomes and incomplete discovery honestly.

The raw installed-command discovery attempt reports `could not determine executable to run`; every package/root manifest lacks bin. The complete alpha workspace surface has run/close/logicalStore, with read/check/recover/usage/operation inspection inside a run requiring authoring/composition. Existing exact reads and check/recovery isolation are useful controls, but no standalone executable/public read-side checkpoint exists.

## Pinned reproduction

From a clean checkout of `e475049c3f858c270791581fb77f925e761363ce`, with Node 24.22.1/npm, registry access and the native prebuild/toolchain prerequisites:

```sh
bash scratch/gap-hunt/contract-operations/verify-cli.sh
```

The runner performs `npm ci`, builds package declarations and runs valid controls. Successful diagnostic completion exits 0: it confirms the reviewed baseline surface and is **not** a behavioral regression test that becomes green after implementation. Write behavioral tests first once the owner selects the contract. [Runner and captured macOS log](https://github.com/mike-north/microdelta/tree/e475049c3f858c270791581fb77f925e761363ce/scratch/gap-hunt/contract-operations) are pinned to that revision. This runner has not been verified on Linux; the separate owner Linux parity report covers earlier commits and different commands. No paid provider is called.
The diagnostic captures the raw npm command's legitimate failure as data; it does not manufacture an overall failing exit.

## Owner decisions

1. Select minimum supported commands/store selection, human versus machine output, stream layout and exit statuses for mixed outcomes, missing/corrupt/unsupported stores and unknown validity.
2. Select the public read-side owner and lifetime: how a process opens retained state independently of authoring/composition, and how live progress/stop intent is exposed without inspection authorizing work.
3. Set the minimum M6 seeded scenario and first/second interrupt behavior. Integrate the preview and resource-state decisions; if anything is deferred, show its absence explicitly rather than claiming the checkpoint covers it. No command spelling or toolkit is prescribed.

## Conditional implementation acceptance

1. Write tests first using the selected installed executable in a fresh process. Seed retained values, failed attempts, unknown validity, owner/input/discovery/retry waits and observed usage/gaps; assert selected output and exit behavior.
2. Negative controls throw on analysis callbacks, source hooks, dispatch, claim acquisition/renewal and writes. Inspection succeeds without those calls and never upgrades stale/unknown state to verified acceptance.
3. Explain only recorded evidence, distinguish fresh-equal output from retention, and report open discovery with discovered/settled counts and unknown total rather than a fabricated completion percentage.
4. Exercise stale values with refresh errors and mixed member coverage through the selected preview/state contracts. First/second interrupts convey distinct stop intent without claiming unsupported remote termination; malformed/unsupported stores fail according to the selected contract. Preserve existing exact-read and writer-free recovery controls.

Dependencies: the preview and nonadditive resource-state issues must be linked by the supervisor when their issue numbers exist, plus the selected public read-side owner. Full M7 provider workload/scale, new hosts, billing, automatic repair/re-execution and a GUI are excluded. This issue does not select a terminal toolkit.

## Attribution

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North, authored and ran evidence fixtures and drafted this issue; no CLI implementation is claimed.
Agent assistance: Worker inspected generated declarations/package manifests and ran executable-discovery/read controls. Supervisory filing and design decisions remain separate; no human implementation/review is claimed.
