> Historical artifact. Superseded by the [active specification](../../../../spec/README.md). Do not implement from this document.

# Reviewing the validation API

**Recommendation:** use one `memo(...)` definition mechanism with an explicit
`validation: 'author'` option for source retrieval. Keep dependency validation as
the default for derived calculations. This is a recommendation for review, not a
newly selected public API. The settled finality and reuse behaviors are unchanged.

The earlier [complete roster example](analysis.ts) uses separate `retrieval(...)`
and `memo(...)` constructors. [Both alternatives](api-options.ts) now compile with
identical retrieval bodies, finality hooks, identities, assessment bodies, and
consumer wiring. [Type tests](api-options.test-d.ts) were written first and pass.
Neither declaration surface has an implemented runtime.

## Two spellings, one semantic distinction

Candidate A names the validation strategies with different constructors:

```ts
const retrievePR = retrieval(prDefinition);
const assessPR = memo(assessmentDefinition);
```

Candidate B puts the distinction on the definition:

```ts
const retrievePR = memo({
  ...prDefinition,
  validation: 'author',
});
const assessPR = memo(assessmentDefinition);
```

Both definitions still contain `name`, `revision`, `identity`, `run`, and optional
`isFinal`. Neither changes the consumer call:

```ts
assessPR({
  evidence: retrievePR({ pr, policy }),
  prompt,
  model,
});
```

For the full roster program, only `fetchRoster` and `retrievePR` need author
validation. Discovery remains non-memoized. Complexity assessment and person
summary use default dependency validation. CSV parsing, trial selection, and
folding stay ordinary steps. The optional HTTP adapter is independent of this choice.

| Consideration | Separate constructors | One constructor with an option |
| --- | --- | --- |
| Source checks cannot be skipped by ordinary dependency reuse | Explicitly choose `retrieval` | Explicitly choose `validation: 'author'` |
| Basic derived calculation | `memo(definition)` | `memo(definition)` |
| Identity, prior data, finality, explicit reuse, managed publication | Same machinery under both names | One common definition mechanism |
| Author moves from simple memoization to custom source acceptance | Change constructor | Add one property |
| Classes/interfaces describing a step | Must also choose the corresponding binder | Validation strategy travels with the definition |
| Mistakenly omitting author validation | Calling `memo` can skip the source body | Omitting the option can skip the source body |
| Terminology | Adds a step category tied to retrieval | Describes how a stored result is accepted |

The option fits the user's preference for a small required definition with
optional capabilities revealed as needed. It also accommodates author validation
of non-HTTP inputs without suggesting a separate execution engine. Both spellings
remain vulnerable to choosing the wrong strategy; a second constructor does not
eliminate that mistake. We must document it and test execution behavior.

Use `validation: 'author'` to mean **the author decides whether source data remains
acceptable**. microdelta still manages storage, identity, isolation, claims, trace
verification, cancellation, and observations. Do not infer author mode from the
presence of `previous`, a finality hook, or a reuse return: those affordances are
also useful when an ordinary memoized calculation actually needs to execute.

## Lifecycle shared by both candidates

The finality authority, previous-result access, explicit reuse, and fresh discovery
are settled. The following ordering and error/concurrency details are engineering
recommendations that make those decisions implementable; they have not been
silently added to the production runtime.

1. **Find an eligible completed result.** Establish environment/storage scope,
   definition identity, logical subject, revision compatibility, and complete
   usable payload before exposing previous data. For this proposal, a different
   execution revision is a cold miss; cross-revision migration is separate work.
   Do not require all ordinary input fingerprints to match first: the author
   needs prior data specifically to decide what changed inputs mean.
2. **On a cold miss, execute `run(input, undefined)`.** There is no cached value
   on which to decide finality or invoke reuse. A new successful result is stored
   through the normal publication protocol. An incomplete attempt is not prior data.
3. **With prior data, consult the current optional `isFinal(input, previous)`.**
   True accepts that exact prior result for this resolution. False or absent
   supplies no shortcut. No finality answer, flag, or dependency cache is persisted
   as a reason to skip this hook on a later resolution. Hooks may await lazy fields;
   keep network validation in `run` for this design so finality is a local decision.
4. **If finality did not accept, follow the selected validation strategy.**
   Default dependency validation verifies the current consumed inputs and nested
   results, reusing or running accordingly. Author validation always calls `run`
   with the eligible previous result; an unchanged URL or old trace must not skip
   it. The body can inspect current inputs and perform progressively expensive work.
5. **Interpret the body's outcome.** A value is a newly produced result, even if
   equal to prior content. `previous.reuse(reason)` accepts the exact prior result,
   retaining its original payload provenance. The current attempt's observations
   remain attributable to that attempt. Do not manufacture a fresh payload merely
   to record a validation request. Attempt persistence is a separate schema concern.
6. **Resolve consumers against the accepted snapshot.** Unchanged consumed fields
   permit ordinary downstream cutoff. New prompts or other consumed inputs can
   require new downstream work. Source finality never propagates automatically to
   the assessment or the person's summary.

A finality exception is an error, not false: fail verified resolution and expose
any retained data only through the existing explicitly stale/error preview path.
Do not silently turn a hook failure into either acceptance or paid retrieval.
Likewise, failed remote validation is not an unchanged response. Ordinary explicit
error/retry policy, when supplied, remains separate from successful acceptance.

## Four concrete walkthroughs

Counts below describe one PR in one logical validation resolution. They exclude
fresh discovery, HR calls, and any separately necessary person-summary call. An
adapter operation may involve multiple HTTP requests; `inspect = 1` does not
promise a single GitHub request.

| Case | Current hook | Source body | Provider operations | Assessment |
| --- | --- | --- | --- | --- |
| 1. Cold run | Not called: no previous value | Runs with `undefined` | `fetch = 1`; no prior validation needed | Runs once after complete evidence is available |
| 2. Cached merged PR, policy accepts merged | Called now; returns true | Skipped | `inspect = 0`, `fetch = 0` | Reused if prompt/model/consumed evidence are unchanged |
| 3. Non-final PR, all evidence validators unchanged | Called now; returns false | Runs, then returns explicit reuse | `inspect = 1`, `fetch = 0` | Reused if other inputs are unchanged; validation work is still recorded |
| 4a. Policy changes from accepting merged to rejecting it | Called with current policy; returns false | Runs despite the previously true answer | Inspects; fetches only if its acceptance check requires it | Determined by the accepted evidence and assessment inputs |
| 4b. Prompt changes while source policy still accepts merged | Called now; returns true | Skipped | `inspect = 0`, `fetch = 0` | Runs once against retained evidence and the new prompt |

Both API spellings produce exactly these traces. In case 3, a change to a review
validator must prevent reuse even if the PR metadata validator is unchanged. In
case 4a, editing the current hook's logic has the same effect as changing its policy
input: the previous answer has no authority. For a widened time window, discovery
runs anew and admits newly in-scope PRs; previously discovered PRs follow these
same per-result rules. A hook that itself reads the window receives the new value.

A new fetch that returns equal evidence is observable as a new fetch, but it still
need not rerun the LLM if the consumed field fingerprints are unchanged. This is
why comparing return-value equality is insufficient to represent explicit reuse.

## Boundaries that the implementation must preserve

**Nested verification:** an outer cached assessment must discharge its source's
current acceptance obligation before declaring the dependency valid. Otherwise
an outer memo hit would hide source-policy changes and never reach the finality
hook. Recursive validation must still cut off the outer calculation when the
fields it consumes have not changed. Previous-value reads inspect the retained
snapshot, not a recursive request to resolve the same step again.

**Validation resolution:** acquiring and validating a bound result yields one
accepted snapshot. Reading several fields from that snapshot does not initiate
several source validations. Multiple waiters on the same in-flight resolution
may share it only when their current definition, input context, scope, and prior
snapshot agree. A later independent resolution evaluates the current hook again.
No cross-resolution acceptance cache is introduced by this proposal.

**Different current policies:** a shared PR URL is not enough to share an acceptance
decision. One caller might accept merged snapshots while another requests refreshed
metadata. Sharing storage or provider work must not skip either caller's current
policy. The runtime must account for relevant input context when coalescing work;
this does not require the author to encode that context into logical PR identity.

**Exact previous snapshot:** a reuse control outcome refers to the generation
actually inspected. If another caller publishes a newer result concurrently,
reuse cannot silently switch to that newer payload or move the global current
pointer backward. Keep the accepted snapshot stable for the consumer; apply
publication fencing separately for any newly produced result. The precise storage
protocol is an existing unresolved prerequisite, not something type declarations
prove.

**Definition changes:** a corrected finality hook is consulted from the current
loaded definition. If the author also changes the execution revision, the proposed
eligibility rule treats old-revision results as ineligible before finality. This
prevents a permissive hook from approving an incompatible output schema. A hook
change by itself never needs a stored finality flag reset, since none exists.

**Observations:** keep these paths distinguishable: current hook accepts locally;
source body validates and explicitly reuses; source body produces fresh data;
ordinary dependency verification serves a calculation. Record actual request/token
increments once. Neither missing usage nor a reuse outcome proves an attempt was
free. The durable attempt/observation schema is still to design.

## Test-first implementation handoff

| ID | Required assertion | Layer and fixture |
| --- | --- | --- |
| V1 | Cold miss executes without prior data and cannot retain an incomplete attempt | Repository eligibility and wrapper; seeded complete/incomplete records |
| V2 | A current hook runs on each new resolution and can change true to false after reopen | Wrapper plus persistent store; changed current definition and policy |
| V3 | Author mode executes validation despite unchanged URL/input fingerprints | Wrapper against a provider spy; ordinary mode still skips eligible derived work |
| V4 | Hook exception causes error with no implicit source request or successful acceptance | Wrapper errors; throwing/rejecting hook and provider spy |
| V5 | Explicit reuse retains the inspected payload/provenance while recording validation usage | Repository/observation integration; separate prior and current attempt |
| V6 | Changed prompt reruns assessment without forcing source fetch after finality acceptance | Nested wrapper steel thread with request/model counters |
| V7 | Changed review data invalidates assessment; unread source-only fields do not | Field-sensitive nested verification against controlled fingerprints |
| V8 | Two simultaneous policies for the same URL do not share an unauthorized acceptance | Deferred-barrier concurrency test, then exact-generation readback |
| V9 | A concurrent publication cannot retarget an already-created reuse outcome | Repository/claim interleaving test with pinned prior generations |
| V10 | Several field reads use one accepted snapshot without repeated source requests | Materialize/wrapper test; later independent resolution rechecks the hook |
| V11 | No finality flag, cached callback answer, or acceptance cache bypasses current policy | Store schema/serialization and wrapper regression tests |
| V12 | The two API spellings have identical output types and enforce required identity/revision | Passing compile/type comparison in this exercise |

Only V12 is established by the new comparison tests. The existing 18 callback
tests establish their narrower application behaviors; they do not implement V1–V11.
The next implementation work should formalize this lifecycle against the existing
repository/claim/trace contracts, then add those tests at their owning component
boundaries. A convenience constructor cannot resolve the outstanding publication
and nested-verification contracts.

Validation commands, from the repository root:

```sh
node_modules/.bin/tsc --noEmit --strict --module NodeNext --target ES2022 \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  docs/exploration/roster-example/api-options.ts
node_modules/.bin/tsd --typings docs/exploration/roster-example/surface.d.ts \
  --files docs/exploration/roster-example/api-options.test-d.ts
```
