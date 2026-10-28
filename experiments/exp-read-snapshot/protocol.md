# Finite SQLite read-snapshot qualification — #296

Status: supervisor-selected EXP-0 experiment; this protocol and its assertions
precede the candidate. Root must review these practical bounds before candidate
execution. No result, production API or PR #232 adoption is claimed here.

The governing [issue #296](https://github.com/mike-north/microdelta/issues/296)
and [EXP-0](../../docs/spec/experiments.md#common-experiment-contract) select the
question. [CLI-001/004 and RUN-006–008](../../docs/spec/operations.md),
[A-16](../../docs/spec/acceptance.md#preview-observation-cases) and the
[standalone plan](../../docs/plans/standalone-inspection.md) retain their meaning.

## Question, owners and two independent axes

Can the pinned better-sqlite3/Node host perform one finite, coherent observation
of committed synthetic rows in an existing History-compatible WAL layout,
**both during an ordinary active writer and after healthy closure/checkpoint**,
without source-file content or directory-entry effects?

The useful-inspection axis requires truthful committed reads, coherent related
queries, and zero execution/domain claims/acceptance/publication or other domain
mutation. Ordinary read locks are permitted coordination; checkpoint constraints
are not History writer claims. Machine owns host opening/locks/lifetime/portable
rows. History owns its schema, logical-store identity, exact-reference meanings,
currentness and retention. This experiment uses no History schema or policy.

The stronger hypothesis additionally forbids source content writes, creation,
deletion and source-directory entry changes, including existing SHM bytes.
Existing rollback-only Machine guarantees and CLI-005's DELETE observation
artifact remain unchanged. This qualification does not retroactively impose
that stronger hypothesis on every M6 mechanism. A candidate can read correct
values while violating the stronger hypothesis; report both facts.

Strict PASS requires both axes in **both** mandatory healthy layouts. Refusing a
verified healthy active or closed WAL layout rejects this candidate; it is not
delivery of a narrower inspector. Inadequate fixture/attribution evidence is
INCONCLUSIVE. Missing/corrupt/recovery-required inputs can safely fail without
being relabeled healthy successes. A valid foreign SQLite file is not Machine
corruption or a History store-identity error merely because fixture SQL fails.

## One candidate, no fallback

The only candidate is the installed pinned better-sqlite3 existing-file
`readonly:true` opening, bounded SQLite busy wait, and a finite `BEGIN DEFERRED`
read transaction. Its anchor is an actual read of `snapshot_meta.revision` in
the target database, not BEGIN alone or `SELECT 1`. Fixed experiment SQL reads
one correlated metadata revision and current row. The client receives no exec,
run, arbitrary SQL, configuration, lease or writable-connection authority.

The experimental handle uses explicit finite begin/read/end/close stages, not
a general user callback API. Nested begin and use outside the active lifetime
must fail; no asynchronous/thenable callback support is promised or introduced.
Capture real loaded Node, driver, SQLite version and compile options before
interpreting results; vendored headers are not runtime pins.
The candidate records pure open and actual data-read images before requesting
its runtime-pin queries, so those measurements cannot be mistaken for the first
data anchor. A later `pinned` image separately records their effects.

No production source/export, new engine, VFS, extension, package or tracing
platform is selected. No immutable/nolock option, WAL omission, exclusive-mode
fallback, journal conversion, temporary DB copy/backup/export, permission-forcing
reader strategy, initialization, repair or sidecar cleanup is allowed. Native
default-driver side effects are measured counterexamples, not hidden repairs.

## Finite domain and process bounds

`src/protocol.ts` records executable bounds, to be enforced by the coordinator:

| Boundary | Maximum |
| --- | --- |
| Processes | Coordinator plus two owned children; one case/control fixture at a time; no detached processes |
| Synthetic data | 72 total rows, scalar integer revisions 1–4 and values A–D; at most 64 padding rows of 4096 bytes for a genuine hot-journal negative |
| Source sizes | 2 MiB per source file; 8 MiB per case; no unbounded table/payload scan |
| Communication | 8192 bytes per JSON line, 65536 bytes total output per child, 16 commands per case |
| SQLite busy budget | 500 ms, matching the existing Node Machine writer |
| Wait/lifetime | 5 s per stage, 15 s per child, 20 s per case, 180 s total coordinator, 5 s cleanup allowance |
| Outer assertion deadline | 210 s; exceeding a bound is explicit failed/incomplete harness evidence, never a synthesized candidate PASS |

Every acknowledgment is a framed protocol fact. Parent deadlines terminate only
owned children, await actual exit and retain the original failure plus cleanup
facts; no wait depends on an arbitrary sleep or an unbounded child read. Proof
logs live outside each inspected source directory. Capture full small source
bytes for comparisons and retain the bounded raw stage images beside the compact
sizes/hashes/differences, outside the inspected source directory. Preserve actual
child acknowledgments/transcripts, returned values and owner exit facts in the
final evidence artifact; a stage label alone is not physical provenance.
Abort on a size/output bound rather than silently keeping a prefix.

## Fixture and execution order

Use only disposable coordinator-owned paths. The normal writer is the generated
public Node Machine capability with its existing WAL/FULL/foreign-key settings;
the experiment's synthetic schema has `snapshot_meta` and `snapshot_current`
with atomically correlated integer revisions and values. Configuration for a
controlled checkpoint or genuine hot journal belongs only to fixture/control
preparation, never to the inspection candidate.

First qualify the finite oracles with the real controls below. Then execute
`closed-wal-no-sidecars` first: an owner commits A and B and cleanly closes its
normal WAL handle; verify actual exit, acknowledged B, WAL header 2 and no WAL/SHM.
**Never manufacture this healthy state by deleting live sidecars.** Observe the
candidate open, first data anchor, held/query/end and close phases with no other
source modifier alive. A definite candidate-attributable effect or false read
is a decisive REJECT and may stop the candidate matrix; every later cell must
remain explicitly unexecuted rather than becoming inferred support.

If no decisive counterexample appears, proceed in this fixed matrix order:

| Cell | Expected observation/proof |
| --- | --- |
| closed-wal-no-sidecars — mandatory | Actual B readable after healthy owner closure; no source effect under strict hypothesis |
| active-wal — mandatory | A checkpointed first; separate writer acknowledges uncheckpointed B; reader anchors B, writer commits atomic C, held reads remain B and later snapshot sees C |
| active-readonly-sidecars | Same useful truth with effective read-only sidecar access; permissions prepared only on disposable fixtures; explicitly record inability to enforce permissions |
| retained-wal-missing-shm | Writer killed only after acknowledged B and actual exit; preparation removes disposable SHM while no connection is alive, retains WAL; candidate never repairs/recreates as fallback |
| retained-wal-inaccessible-shm | Permission-limited disposable retained-sidecar input; explicit supported/refused/failed observation without permission changes by reader |
| missing | No main file created |
| empty | No schema/file initialization |
| foreign-sqlite | Valid unrelated tables; native inapplicable-query failure, no History schema/identity diagnosis |
| corrupt | Host-evidenced corruption/NOTADB, no repair |
| hot-journal | Bounded real spilled rollback journal left by killed fixture owner; no recovery or cleanup by reader |

Active coherence additionally covers a writer commit between BEGIN and the first
data SELECT, uncommitted/rolled-back updates, and one controlled PASSIVE checkpoint
while B is held. Record checkpoint progress/lock outcomes honestly; ending and
closing the snapshot must release its constraints so a later owner checkpoint
can finish. Pause all legitimate modifiers at each reader-only filesystem stage.
Writer commits, checkpoints and writer-close cleanup are separately attributed.

## Same oracles and meaningful controls

`test/evidence.test.ts` first asserts exact committed-value, correlated-pair,
source-difference, error-meaning and verdict outcomes. It uses literal model
evidence only for oracle sensitivity; that evidence cannot be a runtime result.
`test/qualification.test.ts` separately requires actual tagged control execution,
loaded runtime pins and an honest candidate verdict/matrix.

- **Held old snapshot/value-oracle sensitivity:** hold a real pre-B data-anchored
  read after A was checkpointed; permit the separate writer to acknowledge B.
  A remains the legitimate answer for that old anchor. Deliberately present its
  actual A value as a new current-B answer and require the expected-B value oracle
  to reject it. This tests value-oracle sensitivity, not a main-file-only reader
  and not a SQLite defect; no unsafe main-only/immutable fallback is implemented.
- **Torn pair:** make actual separate autocommit reads around an acknowledged
  atomic B→C writer commit, combining revision B with current-row C. The same pair
  oracle must reject it; an artificial label alone proves nothing.
- **IMMEDIATE:** a separately tagged writable control uses the existing Machine
  IMMEDIATE reservation while the other writer attempts a bounded write. Observe
  actual reservation/contention; it is distinct from the read candidate and must
  not be classified as permitted read-lock coordination. That reservation is
  forbidden candidate host authority, but is not itself a History claim or domain
  mutation. Do not set the domain-mutation axis merely because a lock was acquired.
- **Content/sidecar:** with legitimate writers paused, deliberately change a
  disposable control file's content and create/remove a control sidecar at sampled
  barriers. The same source comparison must detect the differences.
- **Transient restoration:** deliberately write→restore and create→remove between
  sampled stages. Endpoint equality must expose the observer's blind spot, not
  become operation-wide absence proof.

The selected measurement method is **sampled byte/entry images**, not a qualified
native operation-wide observer. Capture before open, after opening, while anchored,
after queries/end, after close and on failure. An attributed changed byte or entry
can conclusively REJECT. Equality cannot prove absence of transient/native/mmap
effects: this method alone cannot produce strict PASS. Report INCONCLUSIVE if no
decisive counterexample appears; do not build a general tracing mechanism or
pretend JS fs interception covers native SQLite writes.

## Failure, lifetime and result contract

Missing/invalid/recovery cases preserve explicit native causes and supported/
refused/failed distinctions. An in-process error remains the original cause;
JSON carries finite error fields, not JavaScript object identity. Preserve a
primary open/query/caller error while attempting required end/close cleanup;
record later cleanup failures separately. Normal and query/forced-caller failure,
nested begin, idempotent close and clear use-after-close have finite checks when
their matrix reaches them. No pre-existing sidecar is deleted as reader cleanup.

A successful harness command can report **REJECT**. Baseline Jest GREEN means its
assertions/control sensitivity and truthful report succeeded, not that the
candidate was adopted. PASS requires all mandatory healthy cells, real coherent
reads and domain nonmutation plus adequate strict source-effects evidence.
Decisive counterexample means REJECT; unproved/missing evidence means INCONCLUSIVE.
The returned verdict must equal the case-evidence classifier. An ordinary
completed report must actually attempt the closed-first candidate on verified
healthy provenance: acknowledged A/B commits, successful normal owner closure,
WAL header 2, no before-open sidecars, reader/writer records and source images.
REJECT additionally needs a concrete eligible witness tied to that attempted
case: recorded native refusal on verified health, incorrect returned values, an
attributed matching source-image difference, or an actual forbidden domain
operation. A verdict string or source-effect label is not sufficient evidence.
All-unexecuted cells plus generic limitations cannot pass as ordinary completion.

If actual preparation/runtime/transport infrastructure fails before the required
candidate can be attempted, use a separate `infrastructure-inconclusive` branch:
retain the real preparation attempt/failure records and available source images,
report missing runtime facts explicitly, and leave candidate cells unexecuted.
Do not invent healthy provenance or a REJECT witness. This branch still binds its
INCONCLUSIVE verdict to its case evidence; it cannot hide an already observed
counterexample. Report-validation negative controls cover both missing/wrong
witnesses and fabricated all-unexecuted completion.
Each measured candidate stage is retained immediately; if a later transport or
cleanup failure breaks the harness, preserve the already observed counterexample
and fail the harness rather than relabeling it infrastructure INCONCLUSIVE.
Every report states unexecuted/unproved cells, two-axis outcomes, actual runtime
pins, source hashes, finite bounds, exact commands and the next decision.

Initial tests-first command (before candidate/evidence/coordinator wiring):

```sh
./node_modules/.bin/tsc --noEmit -p experiments/exp-read-snapshot/tsconfig.json
```

Missing `src/evidence.ts` / `test/coordinator.ts` is expected absent-wiring RED and
proves order only, not a reproduced semantic defect in existing Machine/SQLite.
After root reviews the plan and wiring exists, reproduce the bounded assertions:

```sh
./node_modules/.bin/tsc -p experiments/exp-read-snapshot/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config experiments/exp-read-snapshot/jest.config.mjs --runInBand
```

Final evidence also requires strict/type-aware lint and import/suppression checks,
repository check/test/build on one frozen head, independent adversarial review
before push/PR, protected merge and exact-main verification owned by root. A
result selects no production API or new mechanism and closes none of #165/#167/M6.
