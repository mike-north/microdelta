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
