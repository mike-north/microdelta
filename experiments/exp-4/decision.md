# EXP-4 bounded mechanism decision

**Result: all five candidates pass within the stated fixture domain; two
preserved counterexamples bound candidates 1 and 2 to the tracked-influence
contract, and the strict-fold skip candidate raises four decisions for the
supervisor (listed under "Decisions for the supervisor").** This experiment
tests nested argument recipes, one supplied callable slot, a frozen keyed
fanout template, tracked gates and a strict fold's treatment of skips across a
complete process exit. It does not implement or prove an M4 runtime, History
publication, durable schema, M5 waits/retries/cancellation, or EXP-2's value
encoding. The owning contracts (composition.md, execution.md, tracking.md,
experiments.md, glossary) are unchanged by this PR; the supervisor decides
adoption and amends them.

| Mechanism | Result | Bound |
| --- | --- | --- |
| 1. Nested invocation record v2 and argument recipes | Pass | Tracked-influence contract; counterexample CX-1 |
| 2. Supplied callable slot | Pass | Implementation evidence is emitted text; counterexample CX-2 |
| 3. Fanout template and keyed collection | Pass | One fanout per composition |
| 4. Tracked gate | Pass | Gate evidence participates through its outcome |
| 5. Strict fold skip policy | Pass, with supervisor decisions | No conflict with CMP-8 or TEST-4 item 6 found |

## Bounded domain (fixed before coding)

One composition, `contribution-report`:

- inputs `config` (`minActivity`, unread `unread`) and `pulls` (PR evidence by
  id), and a collection `discovery` of contributor records
  `{ id, login, bio, activity, prs }` with completion status `complete | open`;
- one callable slot `assessor`, supplied at composition with implementation
  A, B (equal scores, different code) or C (changed score for `pr-4`);
- one fanout template `contributor`, built once from a symbolic member, with a
  tracked gate (`activity >= config.minActivity`) and one memoized `summary`
  per member key (default key `id`; one custom-key variant keyed by `login`);
- each summary reads `member.login` and `member.prs`, then for each PR calls
  `assessor(prId, forward(['input', 'pulls']))`: a **derived** scalar and a
  **forwarded** input path; it consumes only the child's `score`;
- variants pass one **unreconstructible** function argument, or peek untracked
  configuration before deriving arguments;
- one strict fold `report` over the summaries, consuming each included
  member's `total` and listing explicit skips.

Values are plain JSON-like data compared by sorted-key canonical text; there is
no hashing (VAL-2's SHA-256 is not reproduced). Bodies are synchronous
deterministic fakes that log their own invocations. Fake supervision injects
`pending` and `cancelled` member states; M5 owns their mechanics. Portable
`src/` passes `types: []` checking and the context-import Node-access rule
(now enumerated for `experiments/exp-4` in `tooling/context-boundaries.test.mjs`).
Node file and process I/O is confined to `test/`.

## Candidates as implemented

**1. Nested invocation record v2** (`src/evidence.ts`). Each retained record
holds `version: 2`, its history identity, structural descriptor, called body
implementation text, consumed structural bindings, ordered observations
(`read`, `child-read` with call index, `untracked`), ordered child calls
`{ index, child, arguments, identity, reference }`, canonical output and exact
reference. An argument list is `{ form: 'empty' }` (the M3 form) or an ordered
list of recipes: `forwarded { origin }`, `derived { value, justified }` or
`unreconstructible { reason }`. Validation order (`src/runtime.ts`,
`Pass.validate`): implementation text, consumed bindings and the frame's own
facts first; then each call in recorded order: its slot must still be
declared by the current step and resolve uniquely, forwarded origins resolve
from **current** bindings (input path, member binding, or an earlier child's
current output), derived values are used only if recorded as justified, an
unreconstructible argument is an immediate miss; the current child result is
obtained (validated or executed) and only the parent's consumed output facts
for that call are compared. Child history identity is the child descriptor
plus the canonical digest of derived values by position; forwarded values and
unreconstructible arguments never enter identity. A child sees arguments only
through tracked `argument` paths; reading an unreconstructible argument throws,
so a child can never depend on it.

**2. Supplied callable slot.** `callable('assessor')` declares a structural
slot; `supply(slot, step(body))` binds a current implementation. The parent's
record names only the slot descriptor. Implementation evidence belongs to the
child's record. A step is admitted only if each declared slot resolves to
exactly one implementation; otherwise it fails with `missing-binding` or
`ambiguous-binding` before its body runs.

**3. Fanout template and keyed collection.** The factory runs once inside
`fanout(...)`; its returned array is copied at once; the template and
composition builders reject every call after freeze. An instance descriptor is
the template step descriptor (which includes the collection binding) plus the
member key. Discovery keys every member before any gate or body runs; a
missing or duplicate key rejects the collection with a diagnostic naming the
collection, key and the custom key option. Calls accept only declared slot
names; a function or other value is rejected as an `undeclared call` before
dispatch.

**4. Tracked gate.** The gate runs each pass over the member and inputs. Only
an explicit `false` yields `{ status: 'skipped' }`; a non-boolean or a throw
(including a read of absent evidence) fails the instance. The abstract
topology is independent of gate results.

**5. Strict fold.** For each current key the fold sees an explicit outcome.
Any `failed` or `cancelled` member fails it with sorted key lists (also
reporting `pending` and `openDiscovery`); otherwise open discovery or any
`pending` member leaves it `waiting` with no body execution and no publication.
Only then is it validated or executed; its body receives `members()` entries
`{ key, status: 'succeeded' | 'skipped' }` in key order. Skipped members are
excluded from the required population, carry no data, and reading one throws.
The membership-and-status fact is fold evidence, so a gate flip reruns the
fold, while a gate-evidence change that flips no outcome reruns nothing.

## Assertion-first evidence

Assertions were written against a typed scaffold in which every mechanism
function threw (`compose`, `forward`, `step`, `runPass`, `parseRecord`,
record identity); only the canonical data helpers in `src/data.ts` existed.

- Unit suite against the scaffold: **Jest 27 failed, 1 passed** (28 total;
  the pass was the canonical-encoding infrastructure test).
- Restart suite against an empty process driver that printed `{}`: **all 28
  restart assertions failed** (combined run: 55 failed, 1 passed, 56 total).
- First run after implementation: **55 passed, 1 failed**. The failure was a
  test defect: the absent-evidence half of one test legitimately ran alice and
  carol before the truthy-gate half asserted "no summary bodies". The fix
  resets the log between halves; no implementation change.
- Two assertions were also corrected before the first implementation run:
  "the record never contains `toUpperCase`" was wrong, because a summary's own
  implementation text legitimately mentions its callback. The corrected claim
  is that no argument recipe carries the function.
- Written after the implementation and passing without implementation changes:
  the prototype-named-keys regression guard and the two counterexample probes,
  which assert the observed unsafe result as EXP-1 does.

Final: `npm run test:exp4` reports **59 passed** (31 unit, 28 restart) plus the
tsd contract; a deliberate negative control confirmed tsd reports a failing
`expectError`.

## Process-B variants

Process A writes `assessor(pr-1)=result-1`, `assessor(pr-2)=result-2`,
`summary:c-1=result-3`, `assessor(pr-4)=result-4`, `summary:c-3=result-5`,
`report=result-6`; `c-2` (bob, activity 1) is skipped. Every process B
recreates declarations in reversed registration order, traverses members and
the PR table in reversed order, and allocates fresh data. Bodies are counted
from the fake bodies' own log.

| Process B variant | Exact references after B | Bodies in B (summary / assess / report) | Evidence |
| --- | --- | ---: | --- |
| Unchanged | `c-1=result-3, c-3=result-5, report=result-6` | 0 / 0 / 0 | All hit; `pulls` hook consulted once under cached parents |
| F-04: `pr-1` title (read only for explanation) | baseline; new `assessor(pr-1)=result-7` | 0 / 1 / 0 | Child reran; consumed `score` equal |
| F-05: `pr-2` size 20 to 200 | `c-1=result-8, c-3=result-5, report=result-9` | 1 / 1 / 1 | `changed-child-output`; fold `changed-evidence` |
| Assessor A to B, equal scores | baseline; new children `result-7..9` | 0 / 3 / 0 | Child implementation change only; topology equal |
| Assessor A to C, `pr-4` score 1 to 3 | `c-1=result-3, c-3=result-8, report=result-11` | 1 / 3 / 1 | Only carol's parent and the fold rerun |
| Assessor slot not supplied | baseline, unchanged | 0 / 0 / 0 | `failed:missing-binding`; fold failed `[c-1, c-3]` |
| Assessor supplied twice | baseline, unchanged | 0 / 0 / 0 | `failed:ambiguous-binding` |
| Function argument (A and B) | `c-1=result-8, c-3=result-7, report=result-6` | 2 / 0 / 0 | `unreconstructible-argument`; children and fold reuse |
| Peek before derivation (A and B) | `c-1=result-8, c-3=result-7, report=result-6` | 2 / 0 / 0 | `unjustified-argument`; children and fold reuse |
| Insert `c-4` | baseline plus `c-4=result-8, report=result-9` | 1 / 1 / 1 | Only the new member and the fold |
| Delete `c-3` | `c-1=result-3, report=result-7`; `c-3` pointer untouched | 0 / 0 / 1 | Membership fact changed |
| Unread `bio`, `config.unread` | baseline | 0 / 0 / 0 | No whole-record dependency |
| Consumed `login` of `c-1` | `c-1=result-7`, fold `result-6` | 1 / 0 / 0 | Fold consumes only `total` |
| Duplicate key `c-1` | baseline | 0 / 0 / 0, 0 gates | Collection rejected before member work |
| Custom key `login`; ids renumbered | `alice=result-3, carol=result-5, report=result-6` | 0 / 0 / 0 | Custom key keeps identity |
| Default key; ids renumbered | new `c-11`, `c-13` instances; new report | 2 / 0 / 1 | New keys; children reuse by derived identity |
| Gate flip on (bob activity 4) | baseline plus `c-2=result-8, report=result-9` | 1 / 1 / 1 | Topology equal |
| Gate flip off (minimum 4) | `report=result-7`; `c-3` pointer remains `result-5` | 0 / 0 / 1 | Carol is an explicit skip |
| Gate minimum 3, no flip | baseline | 0 / 0 / 0 | Gate evidence changed; outcomes equal |
| Builder mutation after freeze | baseline | 0 / 0 / 0 | Late declaration rejected (`frozen`); topology equal |
| Template slot renamed `summary` to `profile` | `profile:c-3=result-7, profile:c-1=result-8, report=result-9` | 2 / 0 / 1 | `no-history`; fold `missing-binding`; no remap |
| Collection moved `discovery` to `roster` | new instances and report | 2 / 0 / 1 | `no-history`; fold `missing-binding` |
| A-11 mix, then repaired and closed | A: `c-1=result-3` only; B: `report=result-10` | A: 2 / 3 / 0; B: 3 / 3 / 1 | A fold failed with keys; alice 0 in B |
| A-11 mix, then still open with `c-3` pending | `c-4=result-7, c-5=result-5`; no report | 2 / 2 / 0 | Fold waiting `pending: [c-3]` |
| RUN-010 failed `c-4` repaired | `report=result-8` | 1 / 1 / 1 | Alice and carol 0 |
| RUN-005 open, then closed | A: no report pointer; B: `report=result-6` | A: 2 / 3 / 0; B: 0 / 0 / 1 | Members publish while fold unstarted |
| Closed empty population | `report=result-1` in A and B | 0 / 0 / 0 | Successful empty fold, retained |
| Closed empty, then open empty | `report` stays `result-1` | 0 / 0 / 0 | Waiting; no rewind |

In the A-11 process A, `c-1` succeeded, `c-2` was skipped, `c-3` pending,
`c-4` failed (`pr-6` evidence broken) and `c-5` cancelled; the fold reported
`failed: [c-4], cancelled: [c-5], pending: [c-3], openDiscovery: true` and
ran no body.

## Findings

**The unjustified-argument diagnostic is unreachable under complete tracking.**
Validation checks own evidence and earlier consumed child outputs before
reaching call *k*, so a derived value whose basis changed is already reported
as `changed-evidence` or `changed-child-output`. Under the tracked-influence
contract, an unchanged prefix replays to the same derived value. The only
reachable "insufficient justification" is an **observed** untracked read. The
prototype models this as `peek`, which records an `untracked` marker and marks
later derived arguments `justified: false`. That is the tested A-06 case.
Untracked influence the protocol cannot observe is counterexample CX-1.

**Child work during parent validation is never duplicated or speculative.**
With the parent's own evidence and earlier consumed outputs unchanged, a
re-executing parent requests the same child calls first. Child results are
memoized per pass, so a child executed during validation is reused when the
parent then runs. A missing or unreconstructible call *k* stops validation
before child *k* is invoked.

**Forwarded values are resolved from current bindings.** In the relay test,
child 1 receives child 0's output by forwarded origin. A changed input with an
equal consumed field of child 0 still reruns child 1, which receives the new
output. Stored values are never substituted.

## Preserved counterexamples

- **CX-1 (candidate 1):** a summary derives its PR id from a mutable closure
  variable instead of a tracked read. After the variable changes, own evidence
  and recorded prefix are unchanged, so the recorded derived argument is
  accepted: a false hit returning the old child's score (`protocol.test.ts`,
  "counterexample (candidate 1)"). Candidate 1's justification is sound only
  within CMP-9's tracked-influence contract; capture lint remains necessary.
- **CX-2 (candidate 2):** two assessor closures from one factory have identical
  emitted text but different captured thresholds. Swapping them through the
  slot leaves child implementation evidence equal, so `pr-4` keeps score 1 when
  it should be 3 ("counterexample (candidate 2)"). This is EXP-1's closure
  counterexample at the supplied-slot boundary. Captured configuration must be
  tracked input, not closure state.

## Decisions for the supervisor

1. **Failure precedence.** When a required member has failed or been cancelled
   *and* discovery is open or members are pending, the prototype fails the
   strict fold now (strict completion is impossible this pass), still reporting
   `pending` and `openDiscovery`. Waiting until settlement is the alternative.
   Both are honest; RUN-010 does not choose.
2. **Framework-visible coverage.** A succeeded strict fold outcome does not
   itself list skipped keys. Skips are explicit in `members()` and in this
   fixture's report output, but a fold body could drop them. If consumers must
   distinguish "complete over a gated population" from "complete over a smaller
   population" without trusting the body, the outcome needs a coverage field.
   This experiment did not add one because no assertion required it.
3. **Skips and deletions do not retract earlier publications.** After a gate
   flips off (or a member disappears), the instance's earlier current pointer
   remains. The pass reports `skipped` and the fold excludes it, but a reader of
   that instance pointer alone cannot tell. The publication owner must decide
   whether a skip supersedes, marks or leaves the prior current value.
4. **Gate framing refinement.** The supervisor's framing said that the gate's
   observations participate in fold verification. The prototype makes the
   gate's *outcome* (succeeded vs skipped per key) fold evidence, not its raw
   facts. A flip reruns the fold and only the newly required member. A
   threshold change that flips nothing reruns nothing (output cutoff at the
   gate). Folding raw gate facts would rerun the fold on every
   threshold edit.

No conflict with CMP-8 or TEST-4 item 6 was observed. Skipped is distinct from
successful `undefined`, pending, failed and cancelled at every level. A gate
over absent evidence fails rather than skips. An open or pending population
never yields a successful fold, empty or otherwise.

## Exact commands and versions

```sh
npm ci
npm run check        # exit 0
npm test             # exit 0; tooling 291/291; exp-4: 59 Jest + tsd
npm run build        # exit 0
npm run build:experiments && npm run test:exp4
node experiments/exp-4/.test-build/test/process-entry.js A <file> unchanged
node experiments/exp-4/.test-build/test/process-entry.js B <file> unchanged
```

The direct `unchanged` run reported `paid` of six bodies in A and `[]` in B,
with `c-1=result-3, c-3=result-5, report=result-6` in both, and member order
`c-1,c-2,c-3` then `c-3,c-2,c-1`.

Local evidence used Node **24.14.0**, with TypeScript **5.9.3**, Jest
**30.5.1**, tsd **0.33.0**, ESLint **10.10.0** and typescript-eslint
**8.70.0** pinned by the workspace lockfile. CI's Node 20/22/24 matrix is a
separate PR check.

## Limitations

- One fanout, one gate, one supplied slot; supplied steps cannot themselves call
  children. Multi-level nesting beyond parent/child is not exercised.
- Implementation evidence is emitted source text (EXP-1's policy and its build
  sensitivity); canonical text stands in for digests.
- Child history is a flat list of candidates per identity, validated newest
  first. Candidates grow per distinct forwarded-argument facts; no index,
  eviction or cost bound is claimed.
- Pending and cancelled states are injected. There is no pending-read semantics:
  a gate that reads not-yet-ready evidence must become pending, not skipped,
  and M5 must provide that.
- The JSON file forces a process boundary only; it is not a schema, and makes
  no atomicity, crash or concurrency claim. Publication pointers are harness
  bookkeeping.
- Partial or outcome-tolerant folds are out of scope.
