# Resource report retention evidence — 2026-10-24

Issue [218](https://github.com/mike-north/microdelta/issues/218) implements the
narrow raw-report portion of [ACC-004/007/008](../spec/operations.md) and
[A-14a–f](../spec/acceptance.md#resource-state-report-cases). The
[implementation design](resource-report-design.md) records representation,
identity horizon, timing, ownership and the maintenance lifecycle.

## Test-first evidence

Before implementation, `npm run test:unit --workspace @microdelta/machine-node`
failed because `createNodeSqliteReader` was absent; after sibling declarations
were built, this was the only compiler failure. The report acceptance tests
then failed compilation because `openResourceReports`,
`openResourceReportReader` and `IResourceReport` did not exist. The later
rollback-journal refinement first failed with `Expected 1 arguments, but got 2`
for the journal-selection argument, before Machine gained that option.

Two fault-path refinements also recorded functional failures against the
implemented lifecycle:

- The error-observer containment assertion failed with `observer failed`
  (1 failed, 8 passed). The callback exception is now contained after retry is
  armed; the storage failure is delivered to the observer.
- The post-commit scheduling-read assertion failed with
  `schedule read unavailable` (1 failed, 9 passed). The previous bounded cleanup
  timer is now retained until its replacement is armed, and scheduling failure
  is reported separately from a successful durable acknowledgment.

The focused final report suite passed all 10 scenarios using:

```sh
npx tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --testPathPatterns resource-reports
```

## Acceptance mapping

| Contract | Executable proof |
| --- | --- |
| A-14a/f raw evidence | `resource-reports.test.ts`: distinct 93/90 reports alongside consumption 5; explicit zero/unknown; pool/window/account qualification; out-of-order arrivals; retained duplicate/conflict and unchanged observation/expiry |
| A-14b/e durability | Same suite: a separate Node process reads acknowledged evidence before expiry; injected failed commit emits no acknowledgment; wrong-store/foreign/empty storage is refused |
| A-14c expiry | Same suite: explicit provider validity overrides local fallback; omitted override defaults to one hour; half-hour inspection/redelivery preserves original expiry; exact boundary filters immediately; reopening three days later physically removes rows |
| A-14d eviction | Same suite: controlled injected timers physically delete rows at expiry; 20 repeated cycles remain empty after cleanup; idle writer polls notice reports from another closed writer; failed cleanup retries and close blocks queued callbacks |
| A-14d evidence isolation | Same suite: usage 5, an unknown request attempt, all usage attempts, and actual History completed-result/attempt evidence survive state eviction and foreign-file refusal |
| A-14e read-only boundary | `node-sqlite-reader.test.ts`: missing file remains absent; no mutation ports; existing file bytes and directory entries unchanged by inspection; committed reads work beside an active writer; bounded contention surfaces as `SqliteBusyError` |
| A-14e journal compatibility | Same host suite: DELETE/FULL/foreign-key configuration is checked; incompatible read-only/DELETE opens leave live uncheckpointed WAL database and sidecars byte-for-byte unchanged |
| Declaration boundary | Accounting/Machine `resource-reports.test-d.ts` and `sqlite-reader.test-d.ts`: nullable evidence and readonly declarations; readers have no recording, maintenance, dispatch, transaction or mutation authority |

## Full verification

The final source passed the required commands sequentially, each with exit 0:

- `npm run check`: strict compiler, type-aware lint, generated declarations,
  package boundaries and all workspace checks.
- `npm test`: complete tooling/workspace/experiment/example suite. Core passed
  90 suites and 1,073 tests, including all 10 report scenarios; Node Machine
  passed 9 suites and 90 tests. Accounting and Machine tsd suites passed.
- `npm run build`: all package/declaration, fixture, experiment and example
  builds.

`git diff --check` passed. Relative link targets in the changed README and
validation documents were checked and exist. Verification used no live provider
or paid calls.

The prepared PR body passed `npm run check:pr-metadata -- --body-file
/tmp/issue218-pr.md`; `node --test tooling/pr-metadata.test.mjs` passed all 23
checker tests.

## Proven scope and limits

Reports use a dedicated DELETE-journal file; existing additive and History
storage retain the default WAL behavior. Read-only opening never changes journal
mode or repairs a hot journal. Recovery may require the writable owner.
Rollback-journal readers can contend with a writer; failure is never interpreted
as absent or zero evidence. External journal-mode changes while handles are live
are unsupported.

Expiry removes stored rows and makes their SQLite pages reusable; it does not
promise file truncation or secure erasure. Persistent unavailable storage can
delay physical eviction, with failures reported and retried; read filtering
continues to exclude expired reports. Deduplication ends with physical expiry,
so caller identities and original observation timestamps must never be reused
or revised. Opaque account/provider labels must not contain credentials.

This evidence establishes local process persistence and failure boundaries,
not power-loss or distributed guarantees. No live provider, paid execution,
publication, CLI assembly, notification product or latest-balance reducer was
used or added. Independent exact-head adversarial review remains a separate gate.
