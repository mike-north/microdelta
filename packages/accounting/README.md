# Resource Accounting

This package owns observed resource usage: which paid work was expected to
report usage, which usage reports were durably acknowledged, which estimates
were made and on what basis, and the summaries derived from those facts. Every
export is a project-private `@alpha` declaration; spellings are not a public
contract. See the [operations contract](../../docs/spec/operations.md)
(ACC-001 to ACC-008, RUN-017), the [architecture](../../docs/spec/architecture.md)
(ARC-001, ARC-003), the [EXP-8 decision](../../experiments/exp-8/decision.md)
(mechanism 4) and the [package map](../../docs/package-map.md).

It consumes only `@microdelta/machine` (the SQLite capability) and
`@microdelta/value` (canonical encoding of estimate bases). It never imports
Node, History or Supervision, and it never decides execution retry, budgets or
deletion of usage/History evidence (ACC-008). Separate raw resource-state reports
have Accounting-owned expiry and physical eviction.

## Facts

External operations and their request attempts belong to Run Supervision,
which mints their identities. Accounting records only the usage expected from
and reported for them; it never opens, settles or resolves an operation.

- **Usage intent.** `recordUsageIntent({ environment, operation,
  requestAttempt, attribution })` durably records that request attempt
  `requestAttempt` of external operation `operation` is about to be sent for a
  run, member and step attempt. Call it before the paid call and send only
  after it returns. A redelivered identical intent returns `duplicate`; a
  request attempt identity reused for another operation or attribution is
  refused (`UsageIntentConflictError`).
- **Usage report.** `acknowledgeUsage({ environment, operation, requestAttempt,
  report, quantities })` durably records observed deltas keyed by (operation,
  report) before returning `acknowledged`. A redelivery with the same request
  attempt and quantities is a `duplicate` and is never summed twice; a
  different report under the same key is a `conflict` and the first is kept.
  The same report identity on two operations is two reports. A report for an
  operation or request attempt with no usage intent in its environment, or for
  a request attempt of another operation, is refused
  (`UnattributableUsageError`).
- **Report identity must be stable.** Derive the report identity from the
  provider's response (its usage record or response identifier), never mint it
  per delivery. Deduplication rests on it alone: redelivering after
  `AccountingDurabilityUnknownError` with a fresh identity counts the usage
  twice.
- **Estimate.** `recordEstimate({ environment, estimate, attribution,
  quantities, basis })` records an estimate with its versioned assumptions. It
  is listed beside observations and never summed into them (ACC-006).

Quantities are nonnegative safe integers of an identifier unit such as
`tokens.input` or `usd.micros`. Units are never converted into one another, and
only equal units are summed (ACC-001). Reports are additive deltas; cumulative
snapshots and corrections are not modeled.

Operator resolution of an operation whose usage is unknown needs no other
Accounting fact. Usage the operator learns is acknowledged as an ordinary
report under an operator-namespaced report identity. An abandoned operation is
a Supervision and History fact, and Accounting keeps reporting its usage as
unknown, because unknown is never zero.

## Summaries

`summarizeUsage({ environment, run?, member?, stepAttempt?, operation? })`
returns the observed sums per unit, counts and estimates for one environment,
optionally narrowed. Its `status` is `complete` when every recorded request
attempt in scope has an acknowledged report of its own, and `incomplete`
otherwise, with the request attempts whose usage is unknown listed in
`unknown`. Another attempt's report never covers an attempt. A recorded request
attempt with no report is never read as zero (ACC-005), whether it is still in
flight or its process died on either side of the send.

A summary is a read: two single SQL statements (usage, then estimates) with no
transaction. Under WAL each sees one consistent snapshot without the write
lock, so a summary never blocks a write and another process holding the write
lock never makes a summary fail.

## Durability and write authority

Each write is one IMMEDIATE SQLite transaction that commits before returning
(ACC-007). If the write's work completed but the commit did not confirm, the
call fails with `AccountingDurabilityUnknownError` (whose `durability` is
`'unknown'`, a structural mark for consumers without an Accounting edge) and issues no
acknowledgment; redelivering the same fact resolves it (`duplicate` if it
landed, recorded otherwise). No write needs History's writer lease or fence:
each fact is keyed and idempotent, so a stale writer's late report is still
recorded, because the usage happened. Publication authority still requires the
fence.

A write waits a bounded time for another connection's write lock. If that wait
is exhausted, the write fails with `AccountingBusyError` and has done no work:
nothing was recorded, no acknowledgment was issued, and the fact can be
redelivered. Its `cause` is the host's typed `SqliteBusyError` from
`@microdelta/machine`, and `waitedMilliseconds` reports the wait. Accounting
names contention itself so that consumers without a Machine edge, such as Run
Supervision, can tell a busy store from a broken one.

## Storage

`openDurableAccounting({ sqlite, location, logicalStore })` opens (creating
when empty) a file holding exactly the `microdelta.accounting.durable` schema,
version 1, in the `accounting_` namespace, for one logical store. Every fact
table carries the environment in its key. Every row, including the identity
row, is immutable: triggers refuse `UPDATE`, `DELETE`, and any `INSERT` over an
existing key, which is what refuses `REPLACE`. Any other content, including
another owner's schema, is refused (`AccountingSchemaError`); Accounting keeps
its own file.

## Tests

Owner tests (`test/`) cover argument validation and the storage-independent
summary derivation, including the fold of one joined read; `test-d/` holds the type contracts and
`test/public-consumer.ts` checks that the public view exposes nothing. Node
conformance of the SQLite adapter and separate-process kill tests run in the
facade's assembly suite (`packages/core/test/accounting`), the only place
allowed to compose Accounting with the Node host. Its on-demand mutation
controls (`packages/core/test/accounting/controls/accounting-mutation-controls.mjs`)
plant one defect at a time into the emitted adapter and require a named test
to fail.

## Publication

The manifest carries the same publication metadata as its siblings but is
marked `private` until `@microdelta/accounting` is registered for npm trusted
publishing (see [releasing](../../docs/releasing.md#adding-a-new-first-party-package)).
Until then the release graph excludes it.


## Time-qualified raw resource reports

`openResourceReports` opens a **separate file** using injected SQLite and timer
capabilities. Its `record` port accepts an environment, stable report identity,
original observation time, explicit nullable qualifiers and allowed/remaining
quantities. It needs no usage intent or paid operation. A report is evidence of
what a source said, never a guaranteed current balance or permission to run.

Explicit `validUntil` takes precedence. Without it (`null`), local retention is
one hour from `observedAt`; `localRetentionMilliseconds` is optional. The
returned inspection record preserves `expiresAt` and its provider/default/override
basis. A retained identical identity is a durable duplicate; conflicting contents
throw. An expired original redelivery is refused. Identities must not be reused
or retimed after eviction; there is no permanent deduplication tombstone.

Writers remove expired rows on open, successful intake, explicit `maintain`, and
scheduled maintenance. The injected timer schedules the earlier of the next
known expiry and a one-minute poll, including while idle. Storage failures reach
`onMaintenanceError` and retry one minute later. Errors thrown by that observer
are contained. Persistent storage failure can delay physical removal; it cannot
make expired reports appear in queries. `close` cancels scheduling, and timers
do not keep an otherwise finished process alive.

`openResourceReportReader` accepts only the separate read-only SQLite capability
and a clock. `query(environment)` returns qualified retained reports in identity
order; that ordering makes no claim about provider source order. It never sums
balances, infers usage, fills usage gaps, refreshes a provider or writes storage.
Missing, empty, foreign or wrong-store files are refused without initialization.

The report file uses DELETE rollback journaling with FULL synchronous commits,
so read-only opening creates no WAL sidecars. Existing Machine storage defaults
remain WAL. Inspection and DELETE opening refuse existing WAL files before
mutation. Readers see committed evidence while the writer remains open, but
rollback-journal contention can return the host's typed busy error. Journal mode
must not change externally while handles are live; hot-journal recovery belongs
to a writable open. No result is substituted for a failed read.

See the [bounded design and lifecycle](../../docs/validation/resource-report-design.md)
and [acceptance tests](../core/test/accounting/resource-reports.test.ts). This is
an Accounting port; it does not assemble a CLI, provider adapter or latest-balance
product.
