# M3 host capabilities: portable SQLite and clock (issue #52)

Implementation base: `53ce118ecb3209d9ce2c320ee76c3af1de4750ab`. Local runs used
Node v24.14.0 on macOS; Node 20 and 22 are exercised only by the repository CI
matrix. Dates are UTC.

## Scope

Machine gains two separate `@alpha` capabilities, `ISqliteCapability` and
`IClockCapability`; `IMachine` is unchanged. `@microdelta/machine-node` adds
`createNodeSqlite()` and `createNodeClock()` and is the only production owner of
the pinned `better-sqlite3` 12.9.0 driver, now its runtime dependency. The
connection runs caller SQL only; it holds no schema, subject, lease, attempt or
publication policy. The clock reports observations; History owns high-water,
backward/forward movement and lease-eligibility policy.

## Tests written before implementation

| Area | Assertions |
| --- | --- |
| Reusable conformance (`packages/machine-node/test/sqlite-conformance.ts`) | Commit then reopen; WAL/FULL/foreign-key/500 ms busy settings read back on first and later opens; foreign-key rejection; IMMEDIATE exclusion of a competing writer (with a WAL precondition); refusal of `:memory:`, the empty path, a directory, a missing parent (no file created) and a non-database file; bound values; row cell domain and detached plain `Uint8Array` blobs; `__proto__`/`constructor` columns as own data properties without prototype change; unsafe-integer `RangeError`; `TypeError` for NaN, infinity, boolean, bigint, `undefined` and object parameters with no write; commit returns the callback result; rollback with identical thrown value; nesting refused without running the inner callback; async and thenable results refused and rolled back; awaited continuations and scheduled work inherited from an ended transaction cannot exec, prepare, run statements, open transactions or close; independent calls continue; close idempotence, use-after-close, independent second connection, close inside a callback refused with rollback, delayed statement after close |
| Node process boundary (`node-sqlite.test.ts`) | A separate `node --unhandled-rejections=strict` consumer rejects two async callbacks, including one that throws after its await, exits 0 with empty stderr, and records no late write |
| Clock (`node-clock.test.ts`) | Safe-integer epoch milliseconds bracketed by independent host readings; backward host movement reported unchanged; NaN, infinity, fractional and ±2^53 host readings refused with `RangeError` |
| Types (`packages/machine/test-d/host-capabilities.test-d.ts`, `types: []`) | Portable signatures; parameter domain; async, Promise and thenable callbacks are compile errors; `IMachine` literals still assignable and not SQLite/clock capabilities |
| Import enforcement (`tooling/context-boundaries.test.mjs`) | Driver imports (default, type, subpath, re-export, `export *`, dynamic, `import =`, `require`) are refused in History, Machine, Core, Tracking, EXP-3 source, other machine-node source and all tests; allowed in `machine-node/src/node`; type-position `import()` remains refused everywhere by the existing fail-closed rule |

## Observed failures before implementation

1. **Missing exports only (not behavioral):** Machine tsd reported 26 errors
   and machine-node test compilation failed with TS2305 before the contract existed.
2. **Import enforcement (behavioral):** before the rule change, `packages/history`
   could import `better-sqlite3` with zero diagnostics (9 passed, 1 failed).
3. **Pass-through driver control** (portable contract present; driver opened
   with defaults and a plain deferred transaction): 22 failed, 22 passed of 44.
   - Configuration: journal `delete` (expected `wal`) and busy timeout `5000`
     (expected `500`). FULL synchronous and foreign keys were already the driver
     defaults.
   - `:memory:`, empty path and a non-database file opened without error.
   - Blobs returned as `Buffer`; `9007199254740993` returned rounded.
   - NaN, infinity, bigint and `undefined` parameters were bound; an object
     failed with `RangeError` rather than `TypeError`.
   - A nested transaction ran its inner callback through a savepoint.
   - Async callback: the driver itself refused the Promise and rolled back, but
     all four writes after the await committed.
   - Work scheduled by a committed callback wrote later.
   - `close()` inside a callback closed the connection.
   - The strict subprocess exited 1 with an unhandled `late failure` rejection.
   - All five out-of-domain clock readings were returned.
4. **IMMEDIATE discrimination:** with WAL applied but a deferred transaction, the
   competing writer succeeded, so the IMMEDIATE test fails for that reason alone.
5. **Added before the production change:** the `__proto__` column assertion
   failed (the key was absent from the row) and the inherited late-close
   assertion failed (both late closes succeeded).

Already passing against the control, recorded as baseline rather than claimed
failures: commit/reopen, foreign-key rejection, directory and missing-parent
refusal, SQL-injection binding probe, boolean refusal, result return, rollback
identity, thenable refusal, close idempotence/use-after-close, a second
connection surviving the first close, delayed statement after close, clock
bracketing and backward pass-through, and the eight existing Node Machine tests.

Two test corrections followed the first control run: error kinds are compared by
standard name because native-addon errors come from another realm than Jest's
test globals, and the IMMEDIATE test asserts WAL first because rollback
journaling also blocks a competing commit.

## Review findings and repairs

Independent review and actual emitted-adapter probes confirmed two contract
bypasses in the first production snapshot. Each regression was written and
observed failing before the repair (3 failed, 45 passed of 48), then passed
(48 of 48).

1. **Non-finite row output.** `SELECT 1e999 AS value` returned
   `{ value: Infinity }`, although rows carry only finite numbers. New
   `get()`/`all()` cases cover positive and negative overflow literals, a row
   mixing a finite and an overflowing column, and a stored REAL overflow. All
   must fail with `RangeError`, while finite reals and safe integers still
   transport exactly. The adapter now refuses non-finite numeric cells.
2. **Native Promise with a shadowed `then`.** A resolved native Promise whose
   own `then` was `undefined` was accepted, and its INSERT committed. New
   in-process cases return native Promises whose own `then` is `undefined`, a
   non-callable string, or a throwing getter. Each must fail with `TypeError`,
   roll back and leave the getter unread. The strict subprocess adds rejected
   native Promises with a shadowed or throwing `then`. Before the repair it exited 1 with an
   unhandled `shadowed rejection`. The adapter now recognizes native Promises
   by their internal slot (`util.types.isPromise`, cross-realm) before any
   `then` check. It contains their rejection through the intrinsic
   `Promise.prototype.then`, which never reads the instance's `then`. The
   foreign-thenable case now also asserts that its `then` is never called.

## Implementation

- Open refuses `''` and `:memory:`, applies each setting and reads it back; any
  failure closes the driver handle and rethrows. Files are never deleted.
- Statements read integers as exact bigints and narrow them to safe numbers,
  read rows as arrays and rebuild them with `Object.fromEntries` (own data
  properties, ordinary prototype), and copy blobs into plain `Uint8Array`s.
  Non-finite numeric cells fail with `RangeError`. Bound values are checked
  before the driver sees them.
- Transactions use the driver's IMMEDIATE wrapper, refuse nesting, native
  Promise results (by internal slot) and other thenable results, and rethrow
  the original error. A connection-private
  `AsyncLocalStorage` marks callback lifetime; inherited calls after it ends fail.
  A refused native Promise from any realm gets a no-op rejection handler through
  the intrinsic `Promise.prototype.then`. Foreign thenables are not invoked.
- The clock returns `Date.now()` only when it is a safe integer.
- `tooling/context-imports.mjs` confines driver specifiers and subpaths to
  `packages/machine-node/src/node` production source.

## Commands and results

| Command | Result |
| --- | --- |
| `npm ci` | Passed (611 packages; existing allow-scripts warnings for unrelated packages) |
| `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` | Lockfile adds `better-sqlite3` to machine-node and drops `dev` flags from its dependency subtree only |
| `npm run check` | Passed |
| `npm test` | Passed: tooling 154/154; machine-node 46/46 before the review repairs, 48/48 after; all workspace, tsd and experiment suites |
| `npm run build` | Passed, including API Extractor reports for both Machine packages |

## Limitations

- Every SQLite call is synchronous and blocks the event loop, including up to
  500 ms on a locked database. No concurrency or async-host claim is made.
- Lifetime refusal covers calls that inherit an ended callback's async context;
  it does not stop other effects of leftover JavaScript, or work started through
  mechanisms that do not propagate async context.
- Detecting a non-native thenable reads its `then` property, which may run a
  getter; the function itself is never called. Containing a native Promise
  reads its `constructor` for species resolution. If that lookup throws, the
  Promise is still refused and rolled back, but its later rejection is not
  contained.
- The clock is a wall clock, not monotonic; readings can move backwards or jump.
- Evidence covers a single local file on one host. Power loss, filesystem
  failure, network filesystems and multi-host operation are not claimed.
- The existing import rule reports every TypeScript `import()` type as an
  unanalyzed path. The new rule leaves that fail-closed behavior unchanged.
