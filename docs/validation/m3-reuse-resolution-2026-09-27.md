# M3 Reuse Resolution over durable History (issue #56)

Implementation base: `3534030` (default branch after #55). Local runs used Node
v24.14.0 on macOS with SQLite through better-sqlite3 12.9.0 via Machine's Node
adapter. Node 20 and 22 are exercised only by the repository CI matrix. Dates
are Pacific.

## Scope

A new project-private `@alpha` package, `@microdelta/resolution`
(`packages/resolution`), implements Reuse Resolution over the accepted owner
ports: Definition's frozen composition, structural correspondence, witnesses
and invocation bridge; Tracking's observer; History's durable authority; and
Materialization's lazy exact views and fingerprint provider. It consumes only
their generated alpha declarations, has no Node or Machine import, and adds no
facade export. The public Store API and `microdelta.api.md` are unchanged.

It owns, per the issue's acceptance and recovery ownership:

- candidate lookup by scoped subject and compatibility version, then validation
  of the candidate's own actually called implementation, consumed inputs and
  called helpers;
- current source policy: the current finality hook only for a still-eligible
  candidate; false/absent entering the source check; explicit retention of
  exactly the eligible carrier; fresh equal data as a new publication;
- direct-child validation beneath a cached memo: witness reconnection through
  Definition, current child resolution under current policy, comparison of only
  the consumed child output facts; honest misses versus integrity failures;
- admission after the reuse opportunity and before any claim, attempt or body;
  check-only evaluation; a framework-owned, inspectable lifecycle trace with an
  optional observer whose post-commit failures become diagnostics;
- request-key-derived attempt keys, complete current intent digests, and
  no-execution recovery through History, including wrong-intent rejection.

The workspace normal/recover entry operations, Supervision and the executable
example (#57), and the independent-process proof (#58) are not claimed here.

## Evidence roles

| Role | Evidence |
| --- | --- |
| Author (Claude Code Opus 5.5 implementer) | Tests, implementation, corrections, mutation controls and every local gate result in this record, unless attributed below |
| Peer (author-dispatched read-only Claude reviewer subagent) | Pre-PR review findings listed under *Author-requested peer review* |

## Selected encodings and disclosed choices

These are routine implementation choices within the settled contracts, listed
so review can assess them.

- **Binding family.** Callbacks receive `inputs` (one tracked record of the
  declared input slots) and `helpers` (each declared helper as a tracked
  function). Sources also receive `previous` and `outcome` (the `fresh`/`retain`
  constructors). Supplying `outcome` in the context was chosen because the
  typed capture rule (correctly) flags a source callback that captures a
  module-level constructor.
- **Evidence paths.** Tracking bindings are `['self']` (the step's own author
  callback), `['inputs']`, `['callable', slot]`, `['child', slot]` and
  `['previous']`. Previous-result reads are kept in provenance but excluded
  from later validation: they are history, not a current input.
- **Durable formats.** `microdelta.resolution.provenance`, `.acceptance` and
  `.attempt-ending`, version 1 (`src/evidence.ts`). Another format or version is
  unsupported evidence (an honest miss); this format with malformed content is
  an integrity failure, including its semantic invariants: every source and
  memo record must carry its own `['self']` implementation observation, and
  a source record carries no child edges. These checks run before comparison,
  hooks, admission or bodies. They detect records that break the format's own
  meaning, not arbitrary hostile storage that forges well-formed evidence.
  Observations are stored as unshared plain copies because canonical Value
  encoding rejects Tracking's shared descriptors.
- **Child delivery.** A declared call's child view travels inside a plain
  `{ data }` carrier across every asynchronous boundary, so Promise
  assimilation never probes the view's `then` member. An author's deliberate
  read of a `then` data field is ordinary evidence; array roots are delivered.
- **Child correspondence.** The uniquely reconnected structural slot is the
  correspondence (CMP-6). A different subject occupying it is the current
  child: it is resolved under its own eligibility and admission, and only the
  consumed output facts are compared. The historical child is still read for
  exact integrity; original provenance keeps it.
- **Diagnostics and trace scope.** An outcome's `trace` holds the requested
  step's own lifecycle events. Its `diagnostics` hold every post-commit
  diagnostic of the whole request, nested children included, once each and
  naming its step.
- **Current input facts** are selected by navigating a Tracking view of the
  current input record with a separate observer that never opens a capture, so
  current-fact selection cannot record into an active author capture (for
  example a parent body whose child is being validated). A recorded read whose
  current path no longer has the recorded container shape is `incompatible`.
- **Intent digest** covers the History scope, structural step, kind, subject,
  version, the explicit empty-argument form, the source text of the step's
  callbacks and its declared children, every declared input slot's content
  (Tracking's MDS1 fingerprint, slot-name order) and every declared helper's
  source text. Deriving it reads source text; it never invokes author code.
- **Reused request key.** Before admission, a normal request derives its
  execution identity and rejects a key already used for that invocation:
  committed, incomplete or unsuccessful (`invalid-request`, pointing to
  `recover`) or a different intent (`wrong-intent`). It never serves old work
  as new or resumes it. (The first implementation served a committed attempt
  as `published`; see *Author-requested peer review*.)
- **Reuse allocates no attempt.** Finality-true and validated reuse record
  acceptance without an attempt, so `recover` for such a request key reports
  `absent`; recovery addresses admitted executions only.
- **Check-only runs current finality.** `check` evaluates the current finality
  hook (policy evaluation, an author callback) but never runs a source check,
  a body, admission or a write.
- **Candidates by subject and version.** A candidate's recorded step
  descriptor is parsed but not compared with the requested step; the scoped
  subject is the history identity (RES-001), and each consumed child is
  reconnected through its witness.
- **Implementation identity is source text.** Intent digests, like Tracking's
  MDF1 implementation evidence, identify callbacks by
  `Function.prototype.toString`. Two closures with equal source text but
  different captured values are indistinguishable, so a saved key could
  recover an execution whose closure state differed. This is the existing
  Tracking limit (closure soundness is not claimed), not a new one.
- **Verified recovery scope (retained source checks).** Accepted History
  recovery reports an admitted execution's own committed publication as
  `completed`. An admitted source check that explicitly retains its previous
  result publishes nothing: its committed effect is a separate acceptance
  record. Resolution records that acceptance, then ends the attempt
  `interrupted` with an attempt-ending record `{ ending: 'retained',
  reference }`, so `recover` for that key reports `unsuccessful` (ended without
  a result of its own). A test documents this. No active contract requires a
  retention to be recoverable as a success: the M3 recovery and
  lost-acknowledgment obligations name committed publication. No concrete
  contradiction was established, and no History state or transaction was added.
  After a lost acknowledgment, a fresh normal request applies current policy.
- **Materialization declaration fix.** Resolution is the first approved
  Materialization consumer without a Value edge. Materialization's generated
  rollup imported its projection types from Value, which such a consumer cannot
  resolve; they now come from Tracking's structurally identical copy. The API
  report changes only in those two import origins. A consumer fixture proves
  Value-produced projection facts remain assignable through Materialization.

## Tests first

**Initial placeholder failure (stub, reported separately).** The scaffold
commit `427a419` declared the contracts with a placeholder engine that rejects
every request. The assembly suites committed next (`30e7c36`) were run against
it:

```text
Test Suites: 3 failed, 3 total
Tests:       48 failed, 48 total
ResolutionError: Reuse Resolution is not implemented yet
```

This proves only that the suites run against the real package; it is not
evidence that they discriminate wrong behavior. That evidence is the mutation
controls below. The outcome-envelope module (`src/outcome.ts`) was written in
the scaffold before its unit test; its discrimination is covered by a control.

**First green and corrections.** After the engine (`c8060eb`), 47 of 48 passed.
Two failures on the way were test-fixture faults, not engine behavior:
`structuredClone` in Jest's VM sandbox produced objects from another realm
(Tracking's output encoder rightly rejected them; the fixture now copies with
JSON), and the slot-rename correspondence case also changed the memo's own code
(`calls.events()`), so an own-evidence `changed` miss correctly came first. That
case was replaced by two that change correspondence without changing the body:
a crafted witness naming a vanished child slot, and a different subject
(the latter expectation was later corrected; see *Supervisory review repairs*)
occupying the child slot. One engine fault was found by the suites: Tracking
shares frozen descriptors across observations, which canonical encoding
rejects; provenance now stores unshared copies.

Added after first green, each then required by a mutation control:
- an incompatible source version offers no eligible previous result;
- a check that read its previous result stays eligible later;
- one finality evaluation per direct invocation within a request.

Also added after first green (passed on first run): a child refused during an
admitted body refuses the summary and ends its attempt without a result.

## Author-requested peer review

A read-only reviewer subagent reviewed the branch at `1718523`. Findings and
dispositions:

- **High, fixed.** A child failure (for example a throwing child finality
  hook) rejected into the memo body; a body that caught it could publish a
  fallback with no child evidence, reused indefinitely afterwards. Regression
  test *a body that swallows a failed child call cannot publish* was written
  first and **failed** (no error, fallback published). Any failed child
  resolution is now recorded in the executing frame and prevents publication.
- **Medium, fixed.** A normal request reusing a key whose execution had
  committed with the same intent was served that old result as `published`
  after admission. Regression test *a normal retry with an already committed
  key is rejected before admission* **failed** first (no error). Keys are now
  checked before admission (see *Reused request key*).
- **Medium, disclosed.** Explicit check retention ends its attempt
  `interrupted`, so recovery reports `unsuccessful` for a successful retention.
  A test now documents this; see *Verified recovery scope* above.
- **Low, fixed.** The memo invocation now opens before the claim; a failed
  retention acceptance ends its attempt; attempts that cannot be ended are
  reported as diagnostics.
- **Low, disclosed.** Closure-state identity, reuse without attempts,
  check-only finality and subject-scoped candidates (listed above). The
  evidence module header now states that malformed or unsupported witnesses
  are honest misses by design.
- **Test naming, fixed.** The three integrity cases all fail at the
  exact-dependency membership check; they are retitled accordingly. The later
  `readEnvelope` and scope checks are defensive: History already rejects a
  dangling or other-scope dependency at staging and on read.
- **Low, not changed.** Raw History errors from `publishAttempt` (for example
  a stale lease) propagate unwrapped as History's typed errors.

**Gate enrollment (tooling, test first).** A new negative assertion in
`tooling/foundation-wiring.test.mjs` requires a skipped Resolution build to be
reported. Against the previous `foundation-wiring.mjs` it failed
(`expected: /build:packages.*@microdelta\/resolution/u`, only CI-context
problems reported); with Resolution enrolled, 4/4 pass.

## Contract coverage (assembly suites over real durable History)

`packages/core/test/resolution`, 68 tests in three suites. Each "session" opens
the real SQLite file, a fresh composition, observer and Resolution, and closes
the file; nothing survives between sessions but durable History.

| Issue acceptance | Named tests (abridged) |
| --- | --- |
| 1 Lookup, own evidence, finality only when eligible | `a changed retrieval implementation is ineligible even though the current hook would accept: hook runs zero times`; `a changed consumed input makes the candidate ineligible before finality`; `an incompatible version has no eligible previous result…`; `a cold source has no eligible previous result…` |
| 2 False/absent policy, retain vs fresh, failures | `an accepting current hook retains the exact reference with zero checks, again in every later session`; `a false hook enters the check with the eligible carrier; fresh equal data is a distinct publication`; `an absent hook supplies no shortcut; an explicit check retention keeps the exact reference with separate acceptance`; `a throwing hook…`; `a non-boolean hook answer…`; four invalid-control cases; `a carrier from an earlier invocation cannot be retained…`; `a cold check cannot retain…` |
| 3 Direct-child evidence and validation | `summary provenance records its own implementation, helpers, witness and consumed child facts, not the child's internals`; `a changed child implementation is validated beneath the unchanged summary and cut off at equal consumed output`; `a fresh source changing only unread fields…`; three unsupported-witness cases; two correspondence cases; three integrity cases |
| 4 Actual author callbacks, called/uncalled helpers, rebinding | `a changed called formatter re-executes both summaries even with unchanged statistics`; `a changed uncalled helper alone retains both summaries`; `an equal-name replacement profile retains the summary; a later name change invalidates; original provenance stays intact` |
| 5 Admission, check-only, committed outcome | `valid hits never reach admission`; `a denied summary miss is refused with no claim, attempt or body; its child work was admitted independently`; `denied source work needed for validation refuses the summary without any attempt`; three check-only cases; two observer cases |
| 6 Rollback, reordering, counts | `version 2 then unchanged version 1 rollback reuses the old exact results without rewinding the current pointer`; `version 1 rollback with changed consumed evidence misses and executes`; `reversed member registration after restart preserves each member's own references`; `cold run executes each source and summary once with exact statistics and sentences`; `unchanged restart runs current finality, zero summary bodies and zero checks…` (also 0 root payload cells read, no allocation) |
| Recovery (#56 share) | `recovery returns the exact committed success without hooks, bodies or new acceptance; a new request still runs current policy`; `recovery with a different current intent is rejected rather than served`; `reusing an allocated request key for a different execution is a conflict, not a silent hit`; `absent and unsuccessful executions are reported explicitly and never executed by recovery`; `an empty request key is rejected before any work` |

Expected statistics and sentences are derived by hand from the M3 plan's
fixture attribution rules (Ada 3/2/5, Ben 2/1/3), never from program output.

## Mutation controls (behavioral discrimination)

`packages/core/test/resolution/controls/resolution-mutation-controls.mjs` plants
one wrong behavior at a time into Resolution's emitted build, runs the three
unchanged suites, and restores the build. Runs are judged fail-closed by the
facade's shared `control-outcome.mjs`, now parameterized by the exact suite set
(its specification gained a case rejecting a run judged against the wrong
suite set; 5/5 in `npm test`). On-demand command, after `npm run build` and the
facade's `test:unit`.

The first run rejected 19 of 20: disabling request-local sharing survived,
because the request-key-derived attempt identity already prevented a second
check. The consumed-change test now also requires one finality evaluation; the
run then rejected 20 of 20. After the peer-review repairs two controls were
added (22 of 22 rejected). After the supervisory repairs five more were added;
the final run rejected **27 of 27**, baseline and restored build 68/68.

| Planted defect | Tests failing |
| --- | --- |
| source candidates skip own implementation/input validation | 3 |
| a false finality answer retains | 14 |
| a throwing finality hook becomes acceptance | 1 |
| a non-boolean finality answer is accepted | 1 |
| retention not tied to its own eligible carrier | 2 |
| look-alike envelopes treated as controls | 2 |
| previous-result reads validated as current inputs | 1 |
| consumed child output facts not compared | 4 |
| unsupported witnesses guessed as correspondence | 3 |
| a recorded child need not be an exact dependency | 1 |
| check-only evaluation proceeds to source work | 1 |
| check-only memo reuse records acceptance | 1 |
| a memo admission refusal is ignored | 1 |
| the intent digest ignores the invocation | 2 |
| the attempt key ignores the request key | 21 |
| candidate lookup ignores the compatibility version | 2 |
| declared helpers are not tracked | 4 |
| the author callback is not tracked as its own implementation | 3 |
| direct invocations are not shared within a request | 1 |
| a body that swallowed a failed child still publishes | 1 |
| a committed request key is served again by a normal request | 1 |
| a child view is resolved through Promise assimilation | 2 |
| a different current child subject is treated as lost correspondence | 2 |
| nested post-commit diagnostics stay with each step | 4 |
| supported provenance need not carry its own implementation evidence | 3 |
| supported source provenance may carry child edges | 1 |
| a post-commit observer failure fails the call | 1 |

## Supervisory review repairs

Root and independent supervisory review of `dbc59ec` (findings confirmed
unchanged at `2a39696`) found four behaviors the suites did not discriminate.
Regressions were written first (`b1cf9a9`); **12 failed** against the previous
engine for the reported behaviors, while the deliberate-`then` and
unsupported-version cases passed as preservation controls. The repairs are
`1f7ab06`. The reviewers' saved real-History probes were then rerun unchanged
against the repaired build:

| Finding | Regression (failed first) | Probe before → after |
| --- | --- | --- |
| Promise assimilation recorded `then` as a child read; array-root children failed | *delivering a child records no Promise-assimilation read…*; *an array-root child is delivered cold and validated after restart* (plus preserved *a deliberate author read of a then data field…*) | `then`: body re-ran after an unread `then` change → reused, same reference, 0 bodies. Array: `Unsupported array property then` → published |
| A different subject in the uniquely reconnected child slot forced a parent miss | *a different subject now occupying the child slot is resolved as the current child…*; *…with a changed consumed fact misses and executes* | published, `correspondence` miss, 1 body → reused, same reference, 0 bodies |
| Nested post-commit observer failures were discarded | four *lifecycle observers* cases (child accept/publish beneath executing and cached parents, shared child reported once) | `diagnostics: []` → one diagnostic naming the child `accept` |
| Supported provenance without own implementation evidence could be accepted via finality | three *supported provenance semantic integrity* source cases; *a supported memo record without its own implementation evidence…* (plus preserved unsupported-version miss) | reused via finality → `integrity` |

**Contract correction.** The earlier test *a different subject now occupying
the child slot is a correspondence miss* encoded a rule no active contract
states. CMP-6 makes the declared structural slot the correspondence;
REUSE-005/006 resolve the current child and compare consumed output; RES-003/007
and the transition-table row "current path targets a new entity with equal
consumed scalar" permit retention while current evidence names the new child.
The test now asserts that behavior, with its reasoning in a comment.

## Repository gates

Run sequentially at `1f7ab06` (later commits change only documentation):

| Command | Result |
| --- | --- |
| `npm run build` | exit 0 |
| `npm run check` | exit 0 (strict types, portable types, type-aware lint, imports, declarations, API reports, fixtures, suppressions, wiring) |
| `npm test` | exit 0: tooling 164/164; facade Jest 112/112 (durable History 44, Resolution 68), facade controls judge 5/5, facade tsd; Resolution Jest 3/3, tsd and public-consumer check; every other workspace and experiment suite passing |
| `node packages/core/test/resolution/controls/resolution-mutation-controls.mjs` | PASS: 27 of 27 controls rejected; baseline and restored 68/68 |
| Reviewer probes (`/tmp/microdelta-issue56-*-probe.mjs`, unchanged) | corrected behavior for all five; see *Supervisory review repairs* |

## Limits

- In-process sessions over a reopened real SQLite file prove Resolution's
  contract over real History; they are not the independent-process,
  lost-acknowledgment proof through the assembled authoring path (#58).
- No workspace entry operation, Supervision or runnable example (#57).
- Ambiguous current correspondence is handled by the same code path as missing
  correspondence but has no dedicated test; the M3 composition cannot express
  an ambiguous child slot without also making the parent step ambiguous.
- Single logical writer only; no concurrency claim (M5).
