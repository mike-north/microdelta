# TEST-5/6 bounded current-runtime acceptance

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North.
Baseline: main c5802daca4a0bb8ea91159854d84eddcfa5215b6.
No production changes, paid calls, proposed APIs, or capacity claims.

## Inventory before adding assertions

The owner snapshots and parent confirm these were concrete residuals, not already
covered by the scale runs. Existing Tracking `lazy-view.test.ts:95` proves one
selected leaf; Materialization `nested-view.test.ts:163,213` proves selected
loading and metadata-only comparison; Tracking `track.test.ts` proves cell/tag
isolation and derived invalidation. Existing keyed/fold restart suites prove
precision for their smaller changed-member fixtures. Those do not independently
assert ten consumers, exactly three changed enrichment members, or the assembled
local filter over real retained SQLite results. Prior scale 1k/10k, 20k payload,
and fold probes are complementary measurements, not substitutes.

The new `packages/core/test/gap-hunt-contracts-cost.test.ts` and worker contain
three named passing assertions, executing ten independent Node processes in total.
`cost-results.log` records 3/3 pass; `cost-check.log` records core strict TypeScript
and type-aware lint pass; `cost-types.log` records generated-alpha tsd pass.

## Required outcomes and supported paths

1. **Exactly three changed projections in an enrichment chain (TEST-5).** Twelve
   designated-key members each have a cheap `leaf` memo and a declared dependent
   `enriched` memo. The latter calls a declared deterministic CPU helper (2,000
   arithmetic iterations). Initial cold work runs 24 member bodies; restart runs
   zero. Changing only scores for `person:2`, `person:5`, `person:9` executes just
   those three leaf and three enriched instances. The test asserts every score
   and each member's published/reused status. Unread notes plus rollback to the
   original scores run zero bodies and return the original exact references.
   This uses `microdelta` generated-alpha authoring/template/resolveMembers,
   real SQLite, and ordinary current member observations; no test-only resolver.

2. **Cheap leaves with an expensive aggregate (TEST-6).** A separately persisted
   strict fold consumes those cheap leaf scores and applies the same CPU helper
   to every required member. Cold runs 12 leaves plus the aggregate and yields
   132,000. Unchanged restart executes nothing. Three score edits execute only
   those three leaves and the aggregate, yielding 732,000. Rollback runs zero
   bodies and retains the original exact aggregate reference. This is the current
   generated-alpha fold/resolveFold facade path, without timing thresholds.

3. **Ten narrow consumers (TEST-5).** A retained corpus contains 16 members, ten
   numeric fields per member and about 3.5KB deliberately unread notes per member.
   Ten separate owner-alpha Materialization views each sum one distinct field
   across the same exact corpus result, under semantic observation capture.
   Observation around Node's real SQLite capability records exactly 160 scalar
   payload cells and zero root or staged payload cells in that read window.
   Every sum equals an independent arithmetic expectation. Navigation metadata
   queries still occur; this claims selected payload loading, not zero I/O or
   an optimized query count. It does not extrapolate to 150,000 members.

4. **Mutable local filter and immutable snapshots (TEST-6).** A fresh owner-alpha
   `createTracking` cell selects a minimum score for a local derivation over the
   History-backed view. It initially yields members 8–15; a cell change yields
   12–15. The expensive local aggregate changes from 1,840,000 to 1,080,000.
   Repeated get before the change returns the cached object with one evaluation;
   the change invalidates its local revision and triggers exactly one new
   evaluation. Retained field accesses during recomputation enter semantic
   observation. Serializing the complete stored envelope before/after is equal,
   and History still has only one corpus result. No local filter is stored.

5. **Process exit and fresh tags (TEST-6).** The corpus is published in the first
   process and accepted by exact reference with zero corpus body execution in a
   second process. Both independently create their own cell/tag/derivation and
   repeat the filter assertions over the same retained data. Each process proves
   its local tag is rejected by another freshly created tracker and cannot be
   JSON-serialized. Thus tags are recreated locally; retained evidence does not
   smuggle tag identity across process exit. Both processes' cached retained
   corpus outputs reenter normal observation through Materialization.

## Authority and boundaries

The workspace facade's `run.read` is deliberately an immutable exact-reference
payload read that records no observations. This probe therefore composes current
owner-alpha `@microdelta/materialization`, `@microdelta/history`, and
`@microdelta/tracking` APIs through generated sibling declarations for the narrow
views and local reactive filter. It does not claim a public facade reactive
convenience API or require a new export. Tests use Node Machine only for host
capabilities. Test-only SQLite instrumentation wraps the real production adapter.

The mutable local derivation is process-local UI/report work, not a durable memo
or a reuse-validation callback. `createTracking().derived` is not being promoted
as a durable semantic-evidence replay API; the cached observer derivation contract
has separate existing tests. Static query-column selection and local derivation
capture lint suppressions explain this precise test boundary. Type negatives
assert retained arrays/fields remain readonly and the local filter remains typed.

150,000 subjects remains a measurement target for memory, CPU/I/O, contention,
and in-flight work. No giant benchmark was repeated, no SLA is inferred, and no
production cache/eviction or distributed scheduling conclusion follows. These
characterization assertions already pass on the current implementation; there
was no production red/green fix. No missing capability or new owner decision was
found within the supported paths above.

## Reproduction

From this branch on Node24 with native SQLite build prerequisites:

```
node scratch/gap-hunt/contracts/reproduce.mjs cost
```

The default runner performs npm ci, declaration build, core tsd, test compilation
and focused Jest. Its underlying compile/Jest, strict checks, and tsd were run
locally on Node24.22.1; the full installer wrapper was not rerun for this selector.
The earlier Linux report does not cover this newly added suite.
