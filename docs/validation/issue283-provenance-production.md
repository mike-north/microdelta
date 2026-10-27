# Provenance wire 5 production integration

The [private first gate](issue283-provenance-tuples-first-gate.md) was accepted at
`4d2aeda97a7b055b29b9b49a87b9b219552b62bf` before this separately released integration.
Its conditional 150000 representation arithmetic, qualified original runtime
closure, bounded cohorts and resource limitations remain historical evidence.
Production integration does not rerun those diagnostics or establish TEST-5/M7.

## Owner boundary and behavior

`packages/resolution/src/evidence.ts` is the sole new production dispatch boundary.
Every new source (including callable source), direct memo, nested memo, supplied
step, strict fold and outcome fold writes provenance wire 5. `semanticVersion`
retains existing variants 1/2/3/4 and `trackingSemantics` remains 2. The accepted
private tuple codec is unchanged. New observations enter its own-slot copier
directly, preserving admitted sparse binding/address/visited/order vectors and
negative zero. Child/call/member plain surfaces retain their copying and semantic
responsibilities. The reader decodes wire 5 then delegates to the unchanged direct,
nested, strict-fold or outcome-fold semantic validator. Unsupported generation or
positive safe-integer future semantics remains a miss; malformed supported
representation remains typed integrity damage before current work or fallback.

Legacy wire 1–4 retains its existing interpretation. Reading/reuse does not migrate
or rewrite provenance cells. A prior reader treats wire 5 as unsupported; no older
binary reuse guarantee follows. Acceptance 1/2/3, ending 1, shared version values
and the shared plain-observation helper retain their outputs. Resolution consumers,
public exports/declarations and Value, History, Tracking, Machine, schema and graph
contracts are unchanged. The patch changeset records this runtime behavior repair.

## Tests and observed outcomes

Independent owner literals specify all writer shapes, legacy wire 1–4, every
selection, unequal addresses/operations, unknown outer-operation strings,
absent/present-empty facts, descriptor options and ordering. The production
semantic/generation matrix uses typed `ResolutionError`/`integrity` assertions.
Literal nonempty acceptance and ending records prevent paired writer/reader
agreement from hiding another-format change. First production tests observed
18 failures/15 passes; strengthened malformed-option argument framing, semantic5
and typed classification observed 18 failures/16 passes before dispatch routing.
The redundant old observation copier then failed the added sparse production-seam
control (one failure); passing original observations directly to the unchanged
codec corrected it. Owner dispatch plus compatibility checks passed 85 tests in
two suites with strict compilation and type-aware lint.

The runtime raw-wire baseline observed 20 failures/166 passes in ten suites.
Fixture changes inspect independent tuple positions and preserve raw tuples when
removing/rebinding facts. Witness corruption changes only witnesses and retains
actual wire/semantic metadata; it never relabels tuples as legacy. Acceptance wire
assertions remain unchanged. The narrow test-only inspection helper observed four
failures before implementation, then four passes. Updated runtime suites passed
190 tests in eleven suites, including unchanged #279 reference-index ceilings and
historical missing-dependency error/read-vector order.
The first full repository test pass at production commit `be22eb17` exposed four
more object-observation fixture assumptions in `keyed/members.test.ts` and
`gap-hunt-contracts-resolution-144.test.ts` (four failures/1341 passes in the core
unit stage). Their inspection/removal helpers now use the same independent tuple
view; gate/acceptance object evidence and all original semantic assertions remain
unchanged. Focused verification of these files and the related view-type cleanup
passed 68 tests in four suites with strict compilation and type-aware lint. The
original failed full-suite log is retained; full delivery gates restart at the
updated committed head.

`packages/core/test/resolution/provenance-upgrade.test.ts` adds ordinary fresh-file
History integration, not retained-lineage diagnostics. Its sessions close/reopen
History and rebuild declarations/Tracking **within the same OS process**. Literal
legacy memo evidence survives equal current input rebinding, then changed consumed
name publishes wire 5 and subsequently reuses that exact new reference. It compares
original raw SQL provenance cells, dependency references and SQLite schema objects
across legitimate acceptance/publication work. Independently literal legacy/current
source records cover both candidate orders and future-semantic newest misses.
A literal legacy parent with a nonempty exact child reference/dependency reuses
its unchanged parent reference across current wire-5 child rebinding: the changed
child implementation publishes an equal value under a new reference, while the
parent body stays uncalled and original parent/child provenance cells and the
parent's historical dependency stay exact. Another reopened session retains the
new current child and original parent. All seventeen upgrade scenarios pass
strict compilation, runtime checks and type-aware lint.
Malformed current-generation tags/tuples and missing own implementation fail
before finality, source/memo bodies, admission or allocation; unsupported Tracking
paired with malformed body honestly misses. These characterize the already
implemented owner contract; initial passing cases were not assigned manufactured
RED evidence. Fixture construction errors (shared Value-tree addresses and foreign
array reencoding) were repaired in tests only. External fixture work flows through
declared tracked helpers; no capture-rule suppression or weakening is used.

Existing independent-OS-process source/callable, nested, strict/outcome-fold and
acceptance restart suites remain separate evidence. Same-process upgrade sessions
do not claim to replace them. Existing semantic suites retain their independent
current facts, witnesses, child cutoff, statuses, retention/finality and opaque
History/atomic-publication assertions.

## Reproduction and delivery checks

With this checkout's own dependencies and generated sibling declarations, use
Node 24.14.0. These are ordinary test/build commands; none authorizes capacity or
qualification execution:

```sh
npm run build --workspace @microdelta/resolution
node_modules/.bin/tsc -p packages/resolution/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/resolution/jest.config.mjs --runInBand
node_modules/.bin/tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --testPathPatterns 'provenance-production|provenance-upgrade|provenance-wire-inspection|resolution/|nested/|fold/|outcome-fold/|source-call/'
```

Delivery requires sequential `npm run check`, `npm test` and explicit
`npm run build` on the same final committed head, followed by different-agent
whole-change adversarial acceptance before PR opening. Gate outcomes are bound to
that exact delivery revision. PR opening, Copilot review, protected merge and
post-merge verification remain supervisory steps; this document does not claim
them from local focused tests.
