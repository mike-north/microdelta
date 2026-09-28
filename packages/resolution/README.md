# Reuse Resolution

This package owns current candidate eligibility, current source policy,
direct-child validation with consumed-output cutoff, honest misses, and
execution through injected admission and History ports. Every export is a
project-private `@alpha` declaration; spellings are not a public contract. See
the [execution contract](../../docs/spec/execution.md), the
[M3 plan](../../docs/plans/m3-contribution-analysis.md) and the
[package map](../../docs/package-map.md).

It consumes Definition, Tracking, History and Materialization through their
generated alpha declarations only. It never touches History rows, stores no
finality answer, and never replays a body as validation. Admission policy and
run lifetime belong to Run Supervision; storage consistency to History.

## Binding family

`IResolutionFamily<TInputs, THelpers>` is the family a facade passes to
Definition's `declarations()`. Callbacks receive:

- `inputs`: the declared input slots as one tracked record, so consumed
  configuration fields become evidence;
- `helpers`: each declared helper as a tracked function, so an actually called
  helper's implementation becomes evidence and an uncalled one does not;
- sources also receive `previous` (the eligible previous result's immutable
  `{ data }` carrier, or `undefined`) and `outcome`, whose `fresh(data)` and
  `retain(previous)` mint the only outcomes a source may return;
- memos receive Definition's declared `calls`; each resolves to `{ data }`, a
  lazy view over the child's exact retained result.

## Resolution order

`createResolution(options).resolve({ step, requestKey, lease })`:

1. **Candidates**: History results for the step's scoped subject and
   compatibility version, latest publication first.
2. **Own evidence**: each candidate's actually called implementation, consumed
   inputs and called helpers are compared with current facts. A source's reads
   of its previous result are history and are not compared.
3. **Source policy**: only for a still-eligible source candidate is the
   *current* finality hook evaluated. `true` retains the exact reference with a
   new acceptance record. `false` or no hook admits the source check, which
   receives the eligible carrier and returns fresh data (a new publication, even
   when equal) or `retain` of exactly that carrier. Anything else fails.
4. **Direct children** (memos): each recorded witness is reconnected through
   Definition; the current child is resolved under current policy and shared
   within the request; only the child output facts the memo consumed are
   compared. Unsupported or unreconnectable witnesses are honest misses; a
   missing or wrong-scope historical child is an integrity failure.
5. **Admission and execution**: work that validation could not avoid is
   admitted before any claim, attempt or body. Denial is a typed `refused`
   outcome. Admitted work allocates an attempt keyed by the request key and the
   structural invocation, with the complete current intent digest, then runs
   under capture and publishes through History.

`check({ step })` reports `reusable`, `execution-required` or `uncertain` at a
needed source boundary without admission, attempts, bodies or writes.
`recover({ step, requestKey })` recomputes the attempt key and intent without
running author code and reports the identified execution's durable outcome;
a different intent is rejected and nothing is executed automatically.

## Durable evidence

Provenance, acceptance and attempt-ending records use the versioned formats
`microdelta.resolution.provenance`, `.acceptance` and `.attempt-ending`
(version 1), documented in `src/evidence.ts`. History stores them opaquely.

## Tests

Owner tests cover the outcome-envelope registry and the typed family (`tsd`).
Behavioral suites run in the facade's assembly tests
(`packages/core/test/resolution`) because only assembly may compose History
with Node's real SQLite capability. An on-demand mutation-control runner there
plants single wrong behaviors into this package's emitted build.
