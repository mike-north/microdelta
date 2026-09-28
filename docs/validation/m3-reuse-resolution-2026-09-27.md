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
  an integrity failure. Observations are stored as unshared plain copies
  because canonical Value encoding rejects Tracking's shared descriptors.
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
- **Reused request key.** A normal request whose derived attempt already
  committed with the same intent returns that committed result without
  executing; an incomplete or unsuccessful earlier attempt under the same key
  is rejected (`invalid-request`), never resumed automatically.
- **Attempt ending after explicit check retention (History contract gap).**
  An admitted source check that retains its previous result produces no new
  result. History's `abandonAttempt` offers only `failed` or `interrupted`, so
  Resolution ends the attempt as `interrupted` with an attempt-ending record
  `{ ending: 'retained', reference }`, after recording the acceptance. Recovery
  of that key therefore reports `unsuccessful`. A dedicated no-result ending
  may be preferable; that is a History contract decision for the supervisor.
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
occupying the child slot. One engine fault was found by the suites: Tracking
shares frozen descriptors across observations, which canonical encoding
rejects; provenance now stores unshared copies.

Added after first green, each then required by a mutation control:
- an incompatible source version offers no eligible previous result;
- a check that read its previous result stays eligible later;
- one finality evaluation per direct invocation within a request.

**Gate enrollment (tooling, test first).** A new negative assertion in
`tooling/foundation-wiring.test.mjs` requires a skipped Resolution build to be
reported. Against the previous `foundation-wiring.mjs` it failed
(`expected: /build:packages.*@microdelta\/resolution/u`, only CI-context
problems reported); with Resolution enrolled, 4/4 pass.

## Contract coverage (assembly suites over real durable History)

`packages/core/test/resolution`, 51 tests in three suites. Each "session" opens
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
final run rejected **20 of 20**, baseline and restored build 51/51.

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
| a post-commit observer failure fails the call | 1 |

## Repository gates

Recorded under *Final gate results* at the PR head.

## Limits

- In-process sessions over a reopened real SQLite file prove Resolution's
  contract over real History; they are not the independent-process,
  lost-acknowledgment proof through the assembled authoring path (#58).
- No workspace entry operation, Supervision or runnable example (#57).
- Ambiguous current correspondence is handled by the same code path as missing
  correspondence but has no dedicated test; the M3 composition cannot express
  an ambiguous child slot without also making the parent step ambiguous.
- Single logical writer only; no concurrency claim (M5).
