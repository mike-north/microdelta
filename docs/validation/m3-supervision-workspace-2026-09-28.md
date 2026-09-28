# M3 Run Supervision, workspace path and executable example (issue #57)

Implementation base: `02dfa13` (default branch after #56). Local runs used Node
v24.14.0 on macOS with SQLite through better-sqlite3 12.9.0 via Machine's Node
adapter. Node 20 and 22 are exercised only by the repository CI matrix. Dates
are Pacific.

## Scope

- A new project-private `@alpha` package, `@microdelta/supervision`
  (`packages/supervision`), owns Run Supervision's M3 slice: scoped runs,
  context lookup, the writer port, the admission port, the fixed observer
  positions and ordinary nonmemoized work. It consumes Definition and
  Resolution's generated alpha declarations only. It has no Machine, Node or
  History import.
- The `microdelta` facade composes the owners into a project-private alpha
  workspace path: `authoring()`, `openWorkspace()` with the normal
  (`resolve`) and recovery (`recover`) entry operations, `check`, `ordinary`,
  exact `read`, and `currentRun()`. `createMemoryStore` and every public
  declaration are unchanged.
- Definition gains two alpha additions its consumers need: the topology's
  declared input/callable slot names and the read-only `isComposing()` query.
- A checked-in executable example (`examples/contribution-report`) runs the
  two-contributor report through the installed workspace's generated alpha
  declarations.

Not claimed: the independent-process kill-point and lost-acknowledgment
acceptance through the assembled path (#58); M3 acceptance (#50); retry,
cancellation, scheduling, fanout or M5 concurrency.

## Evidence roles

| Role | Evidence |
| --- | --- |
| Author (Claude Code Opus 5.5 implementer) | Tests, implementation, corrections, mutation controls and every local gate result in this record, unless attributed below |
| Peer (author-dispatched read-only Claude reviewer subagent) | Pre-PR review findings listed under *Author-requested peer review* |

## Selected encodings and disclosed choices

These are routine implementation choices within the settled contracts, listed
so review can assess them.

- **Structural scope capability.** Supervision accepts
  `{ createAsyncContext<T>() }`, structurally identical to Machine's
  capability; the facade passes its Node Machine. Supervision never names a
  Machine type, so no Machine edge is added.
- **Run context.** `{ runId, analysis, environment }`, frozen. The run id is
  volatile (caller-supplied or a process-local counter) and never evidence;
  the environment is History's environment for every request of the run.
- **Lookup failures.** `outside-run` (no live run in this asynchronous
  execution), `run-closed` (a callback scheduled inside a run fires after it
  closed), `composition-phase` (author code running during `compose`, for
  example a Proxy trap, even inside a live run). A run cannot start during
  composition either.
- **Writer port.** History's single-writer lease is taken only for normal
  requests: acquired on the run's first `resolve`, renewed on each later one,
  re-acquired with a fresh fence if it expired between requests, and released
  exactly once when the run closes (an already expired lease counts as
  released; any other release failure is a run diagnostic). Each run's holder
  name includes its run id, so a blocked run's error names the holding run.
  `check` and `recover` never take it, so a crashed holder's unexpired lease
  cannot block recovery; another unexpired holder makes `resolve` fail with
  `writer-unavailable`. The default lease is 30 s.
- **Admission.** The caller's policy is Resolution's admission port while the
  run is open; after close, presented work is denied without consulting it.
  The default admits everything.
- **Observers.** Captured at run start (replacing `observe` later has no
  effect), offered frozen `{ kind: 'step' | 'ordinary', runId, ... }` events,
  every observer sees every event, return values are ignored, and the first
  failure is rethrown so Resolution's position rules decide: before execution
  it stops the call, after a commit it is a diagnostic. `stepLifecycle` and
  `ordinaryLifecycle` publish the fixed positions.
- **Ordinary work.** `ordinary(label, work)` runs in the run scope, observed at
  `begin` (an observer failure stops only that call before the work),
  `end`/`fail` (observer failures are diagnostics). It has no reference and no
  memoization.
- **Binding slots.** The facade derives Resolution's input/helper binding slots
  from Definition's topology (`inputs`, `helpers`), so authors never repeat
  them. Definition owns declared slots; the values are still read only through
  `resolve`.
- **Facade-local alpha aliases.** API Extractor does not trim re-exports of
  external packages, so `export { X } from '@microdelta/…'` of an alpha symbol
  would have leaked into the public rollup. Every new facade export is a local
  `@alpha` declaration (type aliases, const aliases for the two error classes
  and lifecycle constants). The facade build now trims now-unused imports from
  its beta and public rollups, and its extractor config maps siblings through
  `node_modules` so they stay external imports (a relative mapping inlined
  History's public types into the facade rollup; that attempt was discarded).
  The API report adds only `@alpha` items.
- **Declaration closure.** Resolution's generated rollup names History and
  Tracking types, which Supervision has no edge to. The preflight now admits,
  at the alpha tier only, the rollups in the first-party import closure of an
  owner's approved producers. It grants no source edge (the import rule still
  rejects a Supervision source import of History). The tier-typecheck test now
  checks project-private (untrimmed/alpha) views with exactly that closure
  mapped; public and beta views must still stand alone.
- **Exact read.** `run.read(reference)` returns deeply frozen data from
  History's exact reader, records nothing, and fails after its run closed.
- **Fixed positions.** `stepLifecycle` is a frozen literal tuple whose element
  union is checked at compile time to equal Resolution's phase union.
- **Example imports.** `check:imports` restricts `examples/**` to `microdelta`
  and Node built-ins (no scoped owner package, no path into workspace source);
  the suppression check scans `examples` too.
- **Recovery after reuse.** Reuse allocates no attempt, so a request key used
  only for reused work recovers as `absent`; the example documents this.

## Tests first

Commands: `npm run test:unit --workspace <pkg>`, the facade's Jest config over
`.test-build/test/workspace`, and `node --test` for tooling and the example.
Raw logs are kept in the work record, not the repository.

| Test commit | Observed failure before implementation | Kind |
| --- | --- | --- |
| `18fdf75` Definition topology slots, `isComposing` | Compile errors (members absent); then, with type-correct wrong stubs (empty slot lists, `isComposing` always false), exactly the two discriminating tests failed: *the topology names the declared input and callable slots…* and *isComposing reports true only while author code runs during composition*. The empty-slot negative case coincided with the stub and passed. | Behavioral |
| `30933bd` declaration closure | *a context may map only the alpha declaration closure…* failed: History and Tracking alpha aliases rejected as unapproved. | Behavioral |
| `94726ba` Supervision owner suite | Against the placeholder engine (`757eb6d`): 23 of 25 failed. The two passes were the lifecycle-constant test (constants written in the scaffold) and the malformed-options test (the placeholder's `invalid-request` coincided). This proves the suite runs against the package; discrimination is the mutation controls below. | Placeholder |
| `fcd7c04` workspace assembly suites | Against the placeholder facade (`1cce867`): 24 of 24 failed at `openWorkspace`/`currentRun`. Suite-execution evidence only. | Placeholder |
| `c29d658` wiring/release/declaration matrix | *Value package build… and package order are required* failed: Supervision absent from `build:packages`. The release-graph Supervision test passed on first run because the package already existed; the release-artifacts addition runs with the tarball install. | Behavioral / after-package |
| `fa940d5` example gates and preflight | *the executable example is built, checked, linted and run…* failed (`build:examples` not required); *the executable example maps only installed generated alpha declarations* failed (preflight did not scan `examples`). | Behavioral |
| `bba654b` expired writer lease | Failed with `StaleWriterError` from `renewWriter` inside the writer port. | Behavioral regression |

The example's CLI verification (`examples/contribution-report/test`) was
written after the example code; its expected sentences and counts are derived
by hand from the fixture data and the README's rules, and two mutation
controls (pending reviews counted, inclusive window end) prove it
discriminates. The facade's public-tier tsd negatives were checked by a
deliberately wrong `expectError(facade.createMemoryStore)`, which failed tsd.
The example's lint coverage was checked by a temporary callback capturing a raw
value, which the capture rule rejected.

**First green and corrections.** The Supervision suite had two test faults:
calling a stored closure from the test's own context is correctly
`outside-run`, so escaped callbacks are now *scheduled* inside the run; and an
escaped lookup left unawaited after a failing assertion crashed Jest (found by
a mutation control), so escaped lookups now settle into values. `node --test`
rejects a bare directory, so `test:examples` names the test files. The
facade's root type-check needed mappings for its new edges.

Added after first green, each then required by a mutation control: the
selected environment scopes History (another environment cannot reuse), and an
exact read through a closed run fails.

## Behavioral discrimination (mutation controls)

`node packages/core/test/workspace/controls/workspace-mutation-controls.mjs`
plants one wrong behavior at a time into emitted builds (Supervision's `dist`
and test build, the facade's test build, the example's `dist`), runs the
Supervision owner suite, the four workspace assembly suites and the example
verification, judges each run fail-closed, and restores the bytes.

| Control (one planted defect) | Rejected by |
| --- | --- |
| Context lookup ignores the composition phase | 2 tests (owner, facade scope) |
| A closed run still answers context lookups | 3 |
| A closed run still accepts new work | 1 (owner) |
| Work presented after close is admitted | 1 (owner) |
| The caller admission policy is ignored | 3 |
| Recovery takes the writer lease | 3 |
| The writer lease is never released | 18 |
| Observer failures are swallowed | 5 |
| Observers are read live instead of captured at start | 1 (owner) |
| A failing begin observer does not stop ordinary work | 1 (owner) |
| Ordinary completion is not observed | 5 (incl. the example) |
| Request diagnostics are not collected by the run | 3 |
| Resolution uses a fixed environment instead of the selected one | 1 |
| A closed run can still read results | 1 |
| An expired writer lease is kept instead of re-acquired | 1 |
| Releasing an expired lease is reported as a failure | 1 |
| Every run of a workspace uses the same writer holder name | 1 |
| The example counts pending reviews | 1 (example) |
| The example window end is inclusive | 1 (example) |

Final run at `2113abb`: **PASS, 19 of 19 rejected**; baseline and restored
builds 56/56 (Supervision 25, workspace 29, example 2). The first runs exposed
two runner/test faults, both fixed: Supervision's owner suite imports its own
test build, so controls plant into both emitted copies (four controls had
escaped); and an unawaited escaped lookup crashed Jest under one control.

## Acceptance mapping

| Criterion (#57) | Evidence |
| --- | --- |
| 1. Bounded Supervision with run/analysis/environment and structurally injected scope; no Machine edge or helper context argument; lookup fails outside a live run and during composition; fixed positions inspectable, not replaceable | `packages/supervision` (edges Definition, Resolution; import rule rejects a History/Machine import). Owner suite *scoped run context*, *writer ownership*, *observer positions*; facade `scope.test.ts` (*lookup outside any run fails…*, *a composition constructed inside a live run cannot look up…*, *author helpers … see the run context across awaits*); tsd `supervision.test-d.ts` (structural capability, observe-only observers, read-only positions); `admission-observers.test.ts` *every resolved step reports events only at the fixed lifecycle positions* |
| 2. Generated alpha facade authoring declarations, input/helper brands, declared handles, top-level outcomes/exact refs; public `createMemoryStore` and declarations preserved; context is not a seventh owner | `microdelta.api.md` adds only `@alpha` items; public rollup still exports only the History Store API; facade tsd `test-d/facade.test-d.ts` rejects every workspace export on the public entry (negative-controlled); `fixtures/declarations/consumer-alpha/src/workspace-authoring.fixture.ts` compiles the alpha surface (`ITrackedView`, `IResultView`, `IDeclaredCallHandle`, `IResolutionOutcome`, …); the facade composes owners only (`src/workspace.ts`) |
| 3. Checked-in executable example: two fixed source/summary pairs, acme/widget Q1 fixture, independent counts and template text; documented attribution, opaque subjects, selected scope, array semantics, ordinary report ordering; no private imports, test persistence, live GitHub or model | `examples/contribution-report` (README sections *Attribution rules*, *Array-position semantics*, *What the example shows*); `examples/contribution-report/test/example.test.mjs` (hand-derived sentences and counts; mutation-controlled); imports only `microdelta` through installed alpha declarations; the preflight scans its aliases |
| 4. Tests first and RED: hits before denied admission; refused miss leaves nothing; source execution needed by validation obeys its own admission; check-only runs nothing; pre-execution observer failure contained; post-commit observer throw preserves success/ref; scoped context follows await and closes; nonmemoized assembly observed without hidden cache identity | `admission-observers.test.ts`: *reusable hits are served before a denying admission policy is ever consulted*, *a refused cold miss leaves no claim, attempt, body or reference, and strands no writer*, *source work needed to validate a cached summary obeys its own admission*, *check-only reports the source boundary and never runs missing work…*, *a pre-execution observer failure stops only the affected call…*, *a post-commit observer failure preserves committed success and its exact reference*, *ordinary report assembly is observed on every run with no reference and no hidden memoization*; `scope.test.ts` and the Supervision owner suite for scope follow/close. RED record above; discrimination by the controls |
| 5. Natural async child calls carry selected views safely; capture lint and generated alpha consumer enforce syntax; example compiles and runs via installed declarations; commands and instability documented | `contribution-run.test.ts` *changing only unread avatar, labels and a then data field keeps both exact summaries*; consumer fixture negatives (captured scalar, `currentRun()` in a callback, captured outcome constructor) are required diagnostics; `check:examples` type-checks and lints the example with the capture rule (negative-controlled); `build:examples`/`test:examples`; README *Run it now* and the instability notice |
| 6. Full strict/type/lint/runtime/declaration/API/build/Node CI gates; no scheduling/retry/cancellation, M5 or publication/release changes | *Final gates* below; CI matrix runs on the PR. No workflow, trust, registry or version change; Supervision's manifest satisfies the accepted full-graph checks at `0.0.0` |
| Recovery ownership (#57 share) | `recovery.test.ts`: *recover returns the exact committed summary without source hooks, bodies or a new acceptance*, *recover rejects a saved key whose current declared intent differs*, *recover reports absent…*, *recovery does not need the writer lease that another holder still owns*, *a normal request cannot reuse a saved key, while a fresh key performs current source policy*; the example's `run`/`recover` with caller-saved `requests.json` |

## Author-requested peer review

An author-dispatched read-only reviewer subagent reviewed the branch at
`b3d5d3d`. It found no High findings. Dispositions:

- **Medium, documented.** The lease is renewed when each normal request
  starts, not while one runs: a single request that outlives the lease fails
  stale and leaves its attempt incomplete. Renewal inside Resolution's History
  mutations would change the Resolution/History ports and is outside this
  issue; the `leaseMilliseconds` TSDoc states the limit.
- **Medium, fixed.** Two concurrent runs on one workspace used the same holder
  name. Regression *a second concurrent run on one workspace cannot write,
  names the other run as holder, and can still check* **failed** first; holder
  names now include the run id, and the `IWorkspace.run` TSDoc states the
  one-writer behavior. Coordination between runs is M5.
- **Medium, fixed.** Nothing stopped the example from importing owner packages
  directly. Tests *the example may import only the microdelta facade and Node
  built-ins* and the wiring gate **failed** first; `check:imports` now enforces
  it and the suppression check scans `examples`.
- **Low, fixed.** Releasing an expired lease produced a false diagnostic.
  Regression **failed** first; it now counts as released.
- **Low, documented.** `close()` under a live run, and operations a body starts
  without awaiting, are documented on `IWorkspace` (late work cannot be
  admitted or claimed; late writes fail fencing).
- **Low, fixed.** Fixed positions lacked an exhaustiveness check; the tsd
  assertion **failed** first and the constant is now a checked literal tuple.
- **Low, fixed/disclosed.** The observer-containment test now targets the
  summary's admission; the negative example config moved to a temporary
  directory. The lease-expiry tests use real timers with 150 ms margins
  (disclosed).
- **Low, fixed/disclosed.** The example validates its saved request keys and
  documents recovering before the next `run`. The checked-in fixture file is
  still read with a trusted cast after duplicate/author validation.

The reviewer also noted that the declaration closure is derived from built
rollups, so a producer that newly leaks a sibling type widens the approved
closure rather than being flagged; API report review remains the check there.

## Final gates

Run sequentially by the implementer at `2113abb` (Node v24.14.0, macOS);
later commits change only this record.

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 |
| `npm run check` | exit 0 (strict and portable types, type-aware lint with the capture rule over packages, fixtures and the example, import boundaries including the example, declaration preflight, fixtures, wiring, release graph and workflow audit) |
| `npm test` | exit 0. Tooling 291/291, including the real-workspace pack, isolated-install and public-declaration typecheck of every tarball (now including Supervision) and the installed Node SQLite check. Facade Jest 146/146 (durable History 44, Resolution 73, workspace 29), facade tsd and controls judge. Supervision Jest 25/25, tsd and public consumer. Example 2/2. All other suites passing |
| Workspace mutation controls | PASS 19/19; baseline and restored 56/56 |
| Resolution mutation controls | not rerun (Resolution unchanged) |

## Limitations

- In-process sessions and the example's separate CLI processes prove the
  assembled path across ordinary restarts only. Kill points, lost
  acknowledgment through the assembled path and concurrent workers are not
  claimed (#58, M5).
- Implementation identity remains callback source text (the existing Tracking
  limit): closures with equal text but different captured values are
  indistinguishable. The example writes each member's callbacks with literal
  keys for that reason.
- One store allows one writing run at a time; a concurrent normal request in
  another run fails with `writer-unavailable`.
- The writer lease is renewed per request, not within one; a single request
  longer than the lease fails stale (its attempt stays recoverable).
- `stepLifecycle`'s published order is a documented sequence; only its
  membership, not its order, is checked against Resolution at compile time.
- Runtime context carries only the run id, analysis and environment. Services,
  cancellation and resource reporting are not yet part of it.
