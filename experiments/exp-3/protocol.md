# EXP-3 SQLite publication protocol

This fixture tests the History-owned relationship among writer authority,
monotonic attempt allocation, retained results, and the current pointer. It is a
bounded experiment, not a History backend or production SQLite adapter.

## State and authority

The schema has one `writer_state` row for the whole database. Its `last_fence`
only increases; the current `holder_id`, expiry, and token together identify the
one active logical writer. A holder operation is authorized only when the holder
and token still match and the lease has not expired at the operation's supplied
time. Acquisition after expiry replaces the holder and increments the token.
Renewal, allocation, staging, publication, and release all check the same fence.
Read operations do not grant authority.

An attempt moves through `allocated → staged → completed`. The per-subject
generation counter is separate from the current pointer, so abandoned attempts
consume their number. The caller's stable attempt key is unique and allows a
retry to find the committed outcome after losing its acknowledgment.

## Transitions and linearization

| Transition | Durable change | Linearization point | Recovery after process death |
| --- | --- | --- | --- |
| Acquire or reclaim | Replace writer and increment fence | Commit of `writer_state` update | Lease remains held until expiry; no attempt is inferred |
| Allocate | Advance subject generation and insert `allocated` attempt | Commit of generation and attempt transaction | Generation remains consumed; attempt has no result |
| Stage | Store candidate JSON and mark attempt `staged` | Commit of staging transaction | Candidate bytes remain diagnostic attempt state, never a result |
| Publish | Insert immutable snapshot with payload, fingerprint, and provenance; update current pointer; complete attempt | Commit of the one publication transaction | Before commit, all changes roll back; after commit, all are visible |
| Renew/release | Extend or clear current lease without resetting its fence | Commit of fenced writer-row update | A reclaimed writer's token still rejects the old holder |

The publication transaction uses `BEGIN IMMEDIATE` through the Node adapter. The
observable result becomes published only when that transaction commits. A
reader resolves current by joining the pointer to a retained snapshot, and
historical reads resolve the exact `(subject, generation)` reference; neither
read can return staged bytes.

## Recovery traces

- Death after acquisition preserves the writer row; the next writer can acquire
  only after the supplied expiry time.
- Death after allocation preserves the attempt and its generation. The next
  allocation for that subject advances again instead of reusing the abandoned
  generation.
- Death after staging preserves the staged attempt, while current remains the
  prior complete snapshot (or absent if none existed).
- Death after publication SQL but before transaction commit leaves the staged
  attempt and prior pointer intact because SQLite rolls back the open transaction.
- Death after commit but before acknowledgment leaves the snapshot, pointer, and
  completed attempt available. A retry first resolves the stable attempt key;
  it does not call the body again.
- A constraint failure during publication leaves the transaction's inserts,
  pointer update, and attempt completion unapplied. Previously retained exact
  references remain readable after later successful publication.
- After lease expiry and reclaim, the old token cannot renew, stage, publish, or
  release the new holder's lease.

## Schema and writer limits

Schema version 1 owns the writer lease, generation counters, attempt identity and
state, staged bytes, immutable snapshots, and current pointers. An unknown or
malformed version is rejected; this fixture has no migration path. Foreign keys
prevent a pointer or snapshot from naming missing attempt/result state.

The SQLite candidate admits one logical active writer for the entire database.
SQLite's transaction serialization is not treated as permission for multiple
application writers. EXP-3 exercises reclaim and fencing outcomes, but does not
prove every concurrent interleaving required before M5. Multi-process fixture
tests use a single writer at a time and explicit logical operation times.

## Commands and observed results

The test-first typecheck was run after the baseline packages built and before the
candidate files were added:

```text
./node_modules/.bin/tsc --noEmit -p experiments/exp-3/tsconfig.test.json
TS2307: Cannot find module '../src/index.js' or its corresponding type declarations.
TS2307: Cannot find module '../harness/node-sqlite.js' or its corresponding type declarations.
```

The module-resolution failures were the expected red state for the assertions
written first. After implementation, `npm run test:exp3` passed the capability
suite first (5 tests), then the protocol suite (12 tests), on Node 24.14.0 with
better-sqlite3 12.9.0. `npm ci` completed from the lockfile with zero reported
vulnerabilities; the install-script allowance is pinned to better-sqlite3 12.9.0.
The exact candidate pin is `better-sqlite3` 12.9.0 in both the root manifest and
lockfile, and its install-script allowance uses that same version. The
supervisor accepted 12.9.0 as the experiment dependency.

The retry regression injects an observer failure only after `publishAttempt`
returns its committed reference, closes and reopens the database, then retries
through the same stable-key lookup. It asserts that the exact reference is
returned, the completed record resolves, and a file-backed body-call marker
still contains one invocation. Before the observer call was added, the test
failed because no post-commit exception was raised.

The portable source check compiles only `src/` with `types: []`, keeping Node host
declarations out of the candidate while the Node adapter and child-process
harness remain test-only. A negative compiler probe confirms that `NodeJS`
declarations are unavailable under that source configuration.

Before this fix, the pull request's Node 20, 22, and 24 checks passed at the
previous reviewed head. At the scoped fix head, the supervisor ran `npm run
check`, `npm test`, and `npm run build` in sequence; all exited successfully.
The new `npm test` run passed all 77 tooling tests, the five SQLite capability
tests, the twelve publication tests, and the package suites. Fresh GitHub CI for
the scoped fix head remains pending before acceptance across the supported
runtime matrix.

## Evidence limits

The kill tests run real Node child processes against one local file with WAL,
`synchronous=FULL`, foreign keys enabled, and a bounded busy timeout. They prove
process termination and reopen behavior under this runtime and filesystem
configuration. They do not prove storage survives machine power loss, filesystem
or device failure, network filesystems, clock skew, or distributed hosts. A
single SQLite transaction establishes the tested publication boundary, not
general backend qualification or production History correctness.

**Recommendation:** provisional pass for the tested single-file,
single-active-writer candidate shape on Node 24 with 12.9.0. Node 20/22 runtime
evidence, concurrent worker safety, and all listed durability limits remain open.
The History owning contract and adoption decision remain with the supervisor.
