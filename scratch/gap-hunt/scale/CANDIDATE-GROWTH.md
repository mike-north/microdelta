# Candidate history growth: quantified target concern

Evidence worker: Codex (gpt-6.1-sol) for Mike North. Production baseline c5802da. No production changes or provider calls.

## Classification and consumer need

A restarted source resolution with a valid newest candidate needs to establish that candidate's eligibility and run the current finality policy. DOM-1 asks to minimize unnecessary work; DOM-3 is a normative scale target. Neither specifies constant-time metadata lookup, a maximum candidate count, or a concrete SQL budget. This is a quantified target concern, **not a demonstrated acceptance-contract violation**. There is no invented O(1) requirement or minimal red acceptance test.

History's `findCandidates` intentionally returns all eligible envelopes. Returning N envelopes is expected work for that API. The avoidable-cost question is at its consumer: Resolution selects the first eligible source candidate and breaks, after History has eagerly constructed every candidate envelope. A future design could preserve full-history enumeration while giving Resolution a bounded traversal surface; that is a design question, not a prescribed fix.

## Exact exercised path

`packages/resolution/src/resolution.ts:1369` calls `history.findCandidates`, then its eligibility loop breaks on the first valid candidate. `packages/history/src/durable/index.ts:747` performs `statements.candidates.all(...).map(envelopeOf)`. `envelopeOf` at line 460 checks each exact result with `resolveResult`, decodes provenance, and executes a dependency-envelope query even when that result has zero dependencies. The candidate SQL at line 182 returns matching results newest first.

The fixture seeds normal allocated/staged/published attempts through real durable History, copying the first real source result's valid provenance and payload. It closes the session, constructs a fresh Resolution/Tracking/composition over the same SQLite file, and resolves Ada's activity. The newest candidate is valid. It is reused exactly with no misses or admission. This isolates metadata enumeration; it does not invent a stale-data failure or force older candidates to be evaluated.

## Measured window and results

The measurement window begins immediately before one `session.resolve` call and ends when it returns. Store opening, writer acquisition and seeding are excluded. SQL statement counts include candidate discovery, metadata validation, consumed leaf loading and one acceptance write/readback. Each case has no previous acceptance records, separating this from #159.

| Published results | Same subject/version: eligible rows | Total SQL calls | Exact-reference calls | Dependency-envelope calls | Local request ms |
| --- | --- | --- | --- | --- | --- |
| 100 | 100 | 215 | 104 | 100 | 26.70 |
| 500 | 500 | 1015 | 504 | 500 | 115.45 |
| 1000 | 1000 | 2015 | 1004 | 1000 | 229.43 |
| 100 (99 unrelated) | 1 | 17 | 5 | 1 | 1.32 |
| 500 (499 unrelated) | 1 | 17 | 5 | 1 | 1.30 |
| 1000 (999 unrelated) | 1 | 17 | 5 | 1 | 2.03 |

The eligible-row denominator is independently asserted using History's intentional all-candidates API before closing the seed session. Actual SQL calls are counted by the existing observation wrapper over real Node SQLite. The fixture does not expose SQL row counts per arbitrary role: the table reports verified eligible result rows and executed statements, not an invented total-row count. Every dependency list in this corpus is empty. Each resolve returns zero root-payload cells and one scalar cell. Same-subject requests scale as 2N+15 executed statements in this corpus; unrelated-history requests remain 17.

Times are single local wall-clock samples on macOS Node 24.22.1. They show material impact in this bounded fixture, not a portable latency guarantee, throughput benchmark, CPU attribution, Linux qualification, or memory bound.

## Semantic controls and replay

`packages/core/test/gap-hunt-dx-candidate-growth.test.ts` has seven passing Jest tests: six cardinality controls assert full History enumeration, exact newest reuse, zero misses and no admission; the seventh publishes version 2 and then proves rollback to the exact older version-1 reference. No history truncation or pointer rewind is introduced.

From the fixture checkout, after the normal generated package build:

```sh
npx tsc -p packages/core/tsconfig.test.json
npx eslint packages/core/test/gap-hunt-dx-candidate-growth.test.ts
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-dx-candidate-growth.test.js
```

Strict compilation and type-aware lint passed. Exact execution output: `logs/candidate-growth.log`; lint: `logs/candidate-growth-lint.log`. No new issue is proposed without supervisory assessment of an accepted bounded consumer constraint or target prioritization.
