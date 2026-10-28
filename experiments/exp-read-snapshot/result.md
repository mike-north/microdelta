# Read-snapshot candidate result — REJECT

The selected existing-file readonly/DEFERRED candidate returned the correct
committed B value from a healthy closed WAL-mode database, but its first actual
data-read stage created a 32KiB SHM file and an empty WAL file. This is a concrete
counterexample to the separately selected **no-source-filesystem-effects**
hypothesis. It is not a History claim or domain publication and does not show
that useful M6 inspection is impossible. No production reader is adopted.

The machine-readable [observed record](observed-darwin-arm64.json) binds the
source/emitted bytes, raw artifact manifest, loaded native runtime and bounds.
Its raw directory is retained at
`/var/folders/r4/j5y28vpj6258k4_0kn5f33s00000gn/T/microdelta-read-snapshot-Vmlthi`.
The implementation baseline was `452760f6ea0e67b0803d8d7d14fa5f8e28b687fe`.
Final-head reproduction and required check/test/build evidence are separately
recorded by the delivery review; source fingerprints prevent an older run from
silently becoming evidence for changed code.

## Observed facts and attribution

Loaded runtime: Node `v24.14.0`, better-sqlite3 `12.9.0`, SQLite `3.53.0`,
Darwin/arm64. Actual compile options and SQLite source ID came from the opened
native connection and are retained; they were not filled from vendored headers.
The observed compile-option list includes `USE_URI`; no URI workaround was used
or qualified.

The normal generated Machine writer atomically committed A and B, acknowledged
both literal pairs, closed normally and exited0. Before inspection, the source
directory contained only a valid 12288-byte SQLite main file with WAL header
versions2/2. No sidecar was manually removed to create this healthy layout.
The writer and every other source modifier were closed before reader-only
attribution began.

| Reader stage | Main file | SHM | WAL | Data |
| --- | --- | --- | --- | --- |
| Before open | 12288bytes | absent | absent | Owner acknowledged B |
| Opened, no pin queries | unchanged | absent | absent | No data query yet |
| Actual DEFERRED data anchor | unchanged | created32768bytes | created0bytes | revision2/current2/valueB |
| Second actual data query | unchanged | retained | retained | revision2/current2/valueB |
| Runtime pin queries, then end | unchanged | retained | retained | Pins recorded after data reads |
| Close, repeated close, use-after-close check | unchanged | retained | retained | Repeated close succeeded; later read explicitly refused |

All raw stage images are retained outside the inspected source directory and
their bytes/hashes are checked by the harness. Actual child records, per-peer
cleanup outcomes and exits
support the values/closure; stage labels alone are not the physical proof.
No active-writer mutation or writer-close cleanup is blamed on the reader.
The main-file bytes remained equal at sampled stages; that equality does not
prove absence of transient writes.

An earlier preserved run created the same two sidecars by an opening stage that
also queried runtime pins. It is retained separately at
`/var/folders/r4/j5y28vpj6258k4_0kn5f33s00000gn/T/microdelta-read-snapshot-p3wCHY`.
That first result did **not** attribute creation to the constructor alone. The
record above separates pure open, actual data reads and later pin queries.

## Oracle controls and coverage

The actual controls ran before the candidate, using the same finite comparison
rules. A held old A remained legitimate for its own anchor after B committed;
deliberately presenting it as a current-B answer failed the value oracle. This
is not a main-file-only reader or a SQLite defect. Separate autocommit reads
around an actual writer B→C commit produced a mixed pair rejected by the
correlation oracle. An actual IMMEDIATE control caused bounded native
`SQLITE_BUSY`; releasing it allowed the writer's next B commit. Reservation
alone was not classified as History/domain mutation.

Deliberate content and sidecar changes were detected at sampled barriers.
Deliberate write→restore/create→remove between sampled stages were missed, as
expected. Thus endpoint equality supplies no operation-wide native/mmap absence
proof. A positive sidecar-creation counterexample can still reject the candidate.

| Candidate cell | Outcome |
| --- | --- |
| Healthy closed WAL/no sidecars | Correct B and related queries; REJECT due to two new sidecars |
| Ordinary active WAL | Unexecuted after decisive rejection |
| Active readonly sidecars | Unexecuted |
| Retained WAL/missing SHM | Unexecuted |
| Retained WAL/inaccessible SHM | Unexecuted |
| Missing file | Unexecuted |
| Empty file | Unexecuted |
| Valid foreign SQLite | Unexecuted; pure failure-meaning assertions are not a native schema test |
| Corrupt file | Unexecuted |
| Hot journal | Unexecuted |

The active control observations do not close the mandatory current-B active
snapshot case. Commit-between-BEGIN/first-read, dirty/rollback, checkpoint while
a read is held, permission/recovery matrices and forced failure-path lifetime
coverage remain unproved. There is no general concurrency/platform claim.

## Test order, checks and next decision

Phase1 protocol/assertions preceded the candidate. Original strict compilation
failed on two absent wiring modules; strengthened assertions retained those
missing-module failures before implementation. These failures establish order,
not a reproduced defect in existing SQLite/Machine behavior. Root's Phase1
release and independent source confirmation pin the accepted protocol hash in
the observed record. No retrospective RED reconstruction was used.

An earlier `npm run test:read-snapshot` run passed 33 assertions in three suites;
the returned candidate verdict was REJECT. The cleanup-complete run passed
36 assertions in four suites and reproduced that same physical counterexample.
Three pure release tests verify ordered
attempts, first-failure identity, secondary failures and thrown-undefined handling.
They do not establish native forced-failure release coverage. The worker applies
that release helper to end/reader-close/writer-close, retains failed closure
facts, and refuses to acknowledge a failed close as success. The earlier 33-test
record remains retained separately.

Independent source review then found two concrete transport failure gaps:
post-spawn/callback artifact writes could escape owned cleanup, and cleanup could
discard an unresolved exit. A behavior-preserving export and artifact/entrypoint
test seam exposed the existing transport without repairing it. Eight assertions
failed against that behavior, including actual process/records/stderr/exit write
failures and incorrectly accepted failed exit acknowledgment/nonzero status.
All seven actual probe children were independently confirmed gone by the outer
test containment. A separate report assertion demonstrated that unresolved owned
cleanup was accepted as ordinary completion before its guard was implemented.
The original RED logs, pre-repair source hashes and raw outcomes are retained.

The repaired transport registers ownership and close/error listeners before proof
writes, contains callback persistence failures, settles actual exit even when its
artifact cannot be written, and preserves first/secondary error identities.
Every `finish` requires an `exiting` acknowledgment and natural zero exit. Cleanup
retains observed exit versus unresolved deadline per peer; unresolved ownership
fails the harness and cannot become ordinary completion. Transport-only actual
fault probes exercise these repairs without opening a database. The unresolved
deadline itself is a pure control, not an actually unkillable native process.

The final focused run passed 45 assertions in five suites, reproduced the same
native REJECT, and is pinned by the observed record together with its seven actual
fault-probe results. No further candidate matrix cell is implied by those probes.
Portable compilation, type-aware
lint, import/suppression checks and diff checking passed. The full repository
gates and different-agent final review remain delivery gates and are not
inferred from this focused run.

Recommendation: reject this candidate under the stronger hypothesis, retain the
counterexample and ask the supervisory/owner decision to select any next concrete
mechanism. A permission change, copy/projection, alternate binding/VFS or relaxed
filesystem contract would require its own explicit scope and correctness proof;
none is selected here. Existing Machine/CLI005 guarantees and the mandatory
during/after M6 outcomes stay intact.
