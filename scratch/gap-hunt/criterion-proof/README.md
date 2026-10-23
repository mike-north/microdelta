# Pinned criterion proofs

Expected passing evidence against unchanged production source `f43c5872987573d9b98a19f41c324b4d9336894c`. These are bounded synthetic tests, not a product red-to-green cycle or a capacity qualification.

From a clean checkout of the published evidence branch, run this one command (no manual overlay copying):

```sh
python3 scratch/gap-hunt/criterion-proof/run.py
```

The runner requires Node/npm and Python, installs locked dependencies, builds generated package declarations/runtime, compiles strict core tests and the standalone alpha consumer test, runs four new tests plus three selected existing tests, and runs type-aware lint for the new files. It requires the baseline as an ancestor and verifies that only the four explicit test/config overlays and this evidence directory differ from that baseline; production source, lockfile and other configuration must match exactly. It verifies overlay hashes, refuses tracked modifications before/after, and checks actual Jest pass counts (2 + 2 + 3), not just exit status. Fresh outputs land in a newly created system temporary directory printed at startup, so committed evidence logs remain unchanged. The committed `results` directory records the original pinned-source validation; `published-run-validation` records validation of this final evidence-branch runner. No provider calls, product edits or full suites occur.

| Criterion | Direct bounded assertions |
| --- | --- |
| CR-3.1 | `operations/criterion-boundaries.test.ts`: journal operation/request and Accounting intent exist at provider entry before forwarding request. Separate existing kill-before-send/intent-failure proofs are described below; this same-session read alone is not independent-process durability. |
| CR-6.2 | Same file: two real lanes, reverse completion, exact canonical member key/status tuples, peak sends two. |
| CR-5.1 / CR-5.4 | `observation-followup/source-policies.test.ts`: same report, independent daily/quiet boundaries, policy correction at unchanged observation refreshes one source while retaining the other and equal-consuming parent. |
| CR-5.5 / CR-4.5 subpart | Same file: time-accepted source remains open and strict fold waits despite all known members succeeding; actual closure then executes a valid record-returning fold once. |
| CR-4.4 | Existing acceptance/source-policy tests selected by `a false current answer enters the check` and `fresh equal data twice yields`; existing resolution/summary-validation test selected by `a fresh source changing only unread fields`. These prove new child exact refs/readability, retained parent/body zero, current acceptance naming current child and original provenance retaining historical child. |

Additional existing proofs inspected (not rerun by this bounded runner): `operations/processes.test.ts:126-140` SIGKILL before send and independent-process pending identity/unknown usage/no replay; `operations/boundaries.test.ts:321-363` non-durable Accounting intent refusal; `m5-acceptance/stop.test.ts:102-130` exact stopped body/send identities, no durable assessment publications, deferral wake cleanup. The scale fixture's Promise instrumentation measures only permits-module lane/permit waits; no all-wait or universal capacity claim follows.

Observation is an ordinary explicit authored input in these tests. No public observation API, provider lag, external exhaustion protocol, coverage UI, or full M7 bridge is assumed. See `REMAINING-CRITERIA.md` for finite next discriminators versus owner/design choices.
