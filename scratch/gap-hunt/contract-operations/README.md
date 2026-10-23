# Replay and review

From the built checkout with dependencies installed:

```sh
python3 scratch/gap-hunt/contract-operations/run-evidence.py
node scratch/gap-hunt/contract-operations/resource-state.mjs
```

The suite replay preserves actual exit status and writes fresh raw Jest JSON locally. `build-coverage.py` derives compact executed names/statuses and requirement mappings from it and the preserved clause inventory. The raw Jest file is deliberately excluded from this commit; the portable compact index and sanitized execution log are committed.

The second command is intentionally red: it shows that encoding remaining quota as the available additive consumption quantity produces183, not the latest balance90. Read REPORT.md before interpreting it: the missing capability is resource-state observation, not incorrect addition.

Review `requirement-evidence.json` with `test-execution-index.json`: assertion IDs join the two. Source files/named tests remain authoritative. The map records bounded outcomes and explicit residuals; it does not discharge every paragraph or count requirement-ID references as evidence. `clause-dispositions.json` preserves344 source blocks for follow-up semantic review, including nonnormative passages and upstream inherited-owner limitations.

Implementer: Codex worker (gpt-6.1-sol).

Additional focused probes:

```sh
node scratch/gap-hunt/contract-operations/inspect-surface.mjs
node scratch/gap-hunt/contract-operations/cli-consumer.mjs
node scratch/gap-hunt/contract-operations/preview-consumer.mjs
node scratch/gap-hunt/contract-operations/lazy-iteration.mjs
node scratch/gap-hunt/contract-operations/launch-probe.mjs
```

See HARNESS-LIMIT.md for unchanged journal-assertion replay with file transport, LIFECYCLE.md for strict Jest/type/lint commands, and ISSUE-*.md for grouped target findings. The CLI wrapper records npm executable-discovery failure as data; preview/lazy probes assert supported positive controls and record missing/ambiguous target boundaries.

#157/#158 local pickup addenda specify conservative documentation scope and self-contained `verify-157.sh` / `verify-158.mjs` commands. Linux runtime acceptance remains unverified; metadata checks do not establish native support. The three capability drafts require owner decisions before implementation pickup.
