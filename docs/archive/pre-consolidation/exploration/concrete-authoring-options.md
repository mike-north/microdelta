> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Two concrete authoring options

**Updated 2026-09-15:** the user selected Option A's scoped-context direction.
The remaining experimental APIs are not selected, implemented, installed, or
exported by microdelta. The linked TypeScript examples compile against
local experimental declarations. That validates their type shape, not execution,
caching, planning, or isolation. The governing behavior remains in
[decisions](../decisions.md).

Next: [test-first implementation plan](../scoped-context-implementation-plan.md).
Option B remains useful comparative material, not another selected public API.

**2026-09-16 identity update:** the user now requires an author-supplied identity
function on every memoized step definition. The examples below predate that
decision and omit this required member. They remain context-access comparisons,
not the complete selected API. Callback arguments, output format, and namespacing
are the next identity design task; passing these historical type probes does not
establish compliance with the new requirement.

The recommendation is **Option A: scoped context**, with ordinary functions for
application logic and an accessor only when a body needs run facilities. Option B
makes those facilities explicit in the body signature and is a serious alternative.
Neither requires context parameters on ordinary calls between declared steps.

## Start with the same small example

A function that does not need microdelta stays a normal function:

```ts
function sizeBucket(lines: number): string {
  return lines < 100 ? 'small' : 'large';
}
```

A reusable analysis calculation adds a wrapper and a revision:

```ts
const summarize = memo(async function summarize(pr: Ref<Fact>) {
  const text = await pr.text;
  return { summary: text.slice(0, 120) };
}, { revision: 1 });

// This describes work. It does not run the function body yet.
const summary = summarize(pr);
```

This example deliberately uses a trivial calculation so the wrapper is visible;
real memoization should earn its storage/verification cost. `Ref<Fact>` is honest:
this is an addressable stored input, not an already-loaded `Fact`. `await pr.text`
reads that field. A normal helper can accept the resulting string.

The unavoidable departure from vanilla TypeScript is **what a wrapped call does**:
it returns a reference and declares a dependency. That buys planning, reuse,
readiness, and observation without running expensive bodies just to discover the
pipeline. We should explain this once rather than disguise the call as a native
Promise-returning function. Unwrapped functions still execute normally.

There is no context parameter, environment check, metrics registry, cancellation
handler, graph builder class, or subscription in the smallest calculation.
Named functions supply the step name; there is no duplicate string label at each
site. The proposed runtime must require stable names, reject collisions, and
support an explicit name override when build tooling changes function names.
The full durable naming protocol is still open.

## Option A — ask for context where it is needed

[Complete Option A](context-options/scoped.ts)

```ts
const population = step(async function population(teams: Ref<readonly Team[]>) {
  const context = analysisContext();
  const all = await teams;
  if (context.environment !== 'trial') { return all; }

  return all.map(team => ({
    ...team,
    employees: team.employees.filter(employee => employee.lastName.startsWith('A')),
  })).filter(team => team.employees.length > 0);
});
```

The trial rule is ordinary TypeScript in one named location. Replacing the
predicate with the author's “two staff engineers, one designer, two product
managers” selection requires an ordinary helper, not a framework constraint DSL.
No sampling intelligence is implied. An unmet role count should be handled by
that helper's chosen behavior rather than silently invented by the framework.
Selecting people does not truncate those people's required contribution histories.

An expensive step obtains the same facilities only when it needs them:

```ts
const fetchFact = memo(async function fetchFact(pr: Ref<PullRequest>) {
  const context = analysisContext();
  return services.fact(await pr.id, {
    signal: context.signal,
    onUsage: observation => context.record(observation),
  });
}, { revision: 1 });
```

`services` is an ordinary application adapter supplied at construction. An adapter
may translate a signal into a provider cancellation endpoint or observe usage
on a failed response. It cannot manufacture missing observations. The callback
reports increments, not cumulative snapshots, estimates, or remaining capacity.
It can report tokens without claiming an observed currency charge.

**Why choose A:** adding trial behavior or reporting does not alter the calculation
signature or every intermediate helper. An adapter/helper can request context
when called inside execution, so simple application steps can remain particularly
small. Async-scoped execution is already compatible with the chosen Node runtime.

**What the author must learn:** `analysisContext()` requires an active execution
body. It is not a global singleton and is unavailable during pipeline composition.
A helper using it has an ambient dependency that its parameter list does not
advertise. Isolated tests must establish a scope or test a plain helper beneath
that boundary. Concurrency isolation is a runtime requirement, not something this
syntax proves. Do not retain the context after its execution lifetime.

## Option B — opt in to an explicit context parameter

[Complete Option B](context-options/explicit.ts)

```ts
const population = step.withContext(async function population(
  context: AnalysisContext,
  teams: Ref<readonly Team[]>,
) {
  const all = await teams;
  if (context.environment !== 'trial') { return all; }

  return all.map(team => ({
    ...team,
    employees: team.employees.filter(employee => employee.lastName.startsWith('A')),
  })).filter(team => team.employees.length > 0);
});
```

```ts
const fetchFact = memo.withContext(async function fetchFact(
  context: AnalysisContext,
  pr: Ref<PullRequest>,
) {
  return services.fact(await pr.id, {
    signal: context.signal,
    onUsage: observation => context.record(observation),
  });
}, { revision: 1 });
```

The ordinary binding call is still `fetchFact(pr)`. The wrapper supplies context
at execution time; it is not a semantic argument to include in cache identity.
A step without context uses the same `step(...)` or `memo(...)` as Option A.
There are no unused context parameters on simple calculations.

**Why choose B:** run dependencies are visible in the body signature. A plain
helper can accept context explicitly, making it easy to supply a controlled
value in its unit test. The framework does not need to infer context injection
from parameter names, arity, or erased TypeScript annotations: `.withContext`
requests it explicitly.

**What the author must learn:** a second wrapper spelling, plus the distinction
between the body's parameters and the wrapped callable's parameters. Passing
context through deep helper chains can become repetitive. Runtime dispatch still
needs scoped ownership for nested work; explicit parameters do not eliminate
that implementation responsibility.

## The same complete pipeline in both options

Both linked files include all domain stages, not just the context excerpt:

1. Fetch the directory and apply author-defined trial selection.
2. For each selected team and person, discover PRs for the full period.
3. Fetch each PR's facts with bounded fan-out.
4. Project compact chart fields into a live histogram, and project evidence text
   separately for a memoized judgment.
5. Wait for that person's complete evidence before starting the judgment.
6. Fold terminal person outcomes into each team's report, retaining failed member
   keys/messages; combine team reports into the final selected-scope result.

The composition stays identical:

```ts
const definition = analysis('contributions', environment, (input: Ref<Input>) => {
  const teams = population(directory(input.organization));
  const reports = fanOut(teams, team => {
    const people = fanOut(team.employees, employee => {
      const facts = fanOut(pullRequests(employee.id, input.period), fetchFact,
        { concurrency: 8 });
      return personReport(
        assess(employee, fanOut(facts, evidenceText), input.rubric),
        histogram(fanOut(facts, chartPoint)),
      );
    }, { key: employee => employee.id, concurrency: 4 });
    return teamReport(team, people.settled());
  }, { key: team => team.id, concurrency: 2 });
  return report(reports);
});
```

`fanOut` earns its place: it exposes collection work to planning, bounds active
members, preserves their keys, and lets siblings continue after isolated failures.
Ordinary eager `Promise.all(array.map(...))` does not express those guarantees.
Concurrency values above are illustrative per-group limits, not a global provider
quota policy. Derived collections inherit their member keys. Array boundaries
and external discovery supply keys explicitly; an ordinary `id` property alone
is not implicit identity registration.

The callbacks above are **synchronous, side-effect-free composition**, not step
bodies. Planning executes them with symbolic references to discover the member
pipeline before the members exist. They must not perform I/O, access context,
read clocks, await values, or branch on unresolved data. The declarations reject
async callbacks but do not statically prove purity. A runtime would need guarded
references and documented construction rules. This is a real conceptual cost of
an upfront plan; the examples do not promise arbitrary TypeScript source analysis.

Data-dependent decisions belong inside declared bodies. Unknown membership is
represented by the same symbolic member structure. A conditional *new topology*
is not introduced by running an expensive body.

### Reveal streaming only when needed

Most simple calculations need neither `source` nor `Collection`. The complete
example needs a streaming source because a person's PR enumeration can take
multiple pages while already-discovered facts are being fetched:

```ts
const pullRequests = source(async function* pullRequests(
  employeeId: Ref<string>, period: Ref<string>,
) {
  const context = analysisContext();
  yield* services.pullRequests(await employeeId, await period, {
    signal: context.signal, onUsage: observation => context.record(observation),
  });
}, { key: (pr: PullRequest) => pr.id, revision: 1 });
```

This is a proposed additional wrapper with a specific justification: successful
iterator completion establishes discovery closure; a pause between yields does
not. Source failure does not become successful discovery of a partial population.
Whether this eventually shares a wrapper name with `step` is open; hiding its
completion semantics just to remove a name would not simplify the contract.

`Collection<T>` supports ordinary `for await` over **resolved row values**. Reading
a row consumes that row, so the example explicitly projects `Fact.text` into
`Collection<string>` for judgment and chart fields into `Collection<ChartPoint>`
for histogramming. This avoids claiming that later access to a plain row property
can retroactively narrow its dependency. The extra projection is a cost worth
comparing against reference-bearing iteration in a later focused exercise.

For a verified evaluation, iteration uses its complete verified collection.
For a permitted cheap preview calculation, iteration uses a finite snapshot of
available members and returns promptly; it does not wait for eventual discovery
closure. The runtime attaches provisional coverage/freshness to the output.
With no available members and unfinished discovery, withhold a new value rather
than fabricate a verified empty histogram. A closed empty collection is valid.
These are proposed runtime semantics to test, not behavior implemented by the
type declaration's `AsyncIterable` interface.

A memoized judgment never starts from that partial snapshot. Each person's gate
is independent of other people's progress. A team's explicit `.settled()` fold
waits for its required terminal outcomes; scheduled retries remain pending.
Repair changes status/membership dependencies and must reverify affected folds.

## One environment choice at the boundary

[Complete launch example](context-options/launch.ts)

```ts
const configuration = configure('trial');
const { definition, histogram } = createContributionAnalysis(configuration);
showPlan(definition.plan(input).text);

const execution = definition.run(input);
const unsubscribe = execution.observe(histogram, renderHistogram, { throttleMs: 500 });
try {
  await saveReport(await execution.result, configuration.name);
} finally {
  unsubscribe();
}
```

`configure` is an application-owned boundary, not an invented built-in loader.
It supplies one immutable configuration containing the environment name, storage
location, and clients. It may load credentials from a `.env` file. Construction
binds that configuration to the analysis, so `plan` and `run` cannot accidentally
receive different environment names in this candidate API. For production,
construct the same program with the production configuration.

The proposed default is separate persistent storage for trial results, claims,
indexes, and cleanup. Neither a TypeScript interface nor a string path enforces
that boundary: environment configuration must validate distinct stores and
appropriate external destinations. Trial edits do not automatically promote
results into production. Prompt/rubric content is an explicit semantic input;
credentials do not belong in cache keys, reports, or traces. Changes to hidden
client behavior still need an explicit invalidation/version policy.

Stage observation is an advanced addition: it lets the viewer inspect each bound
histogram instance even while that person's judgment is pending. It delivers an
availability/freshness/error envelope, never an unmarked stale value. Registration
must deliver current state as well as future updates, and final state after
throttling. Observation alone does not execute paid bodies; `run` supplies demand.
The stage-level subscription spelling is a proposal, not an existing capability.

A structural plan might show:

```text
contributions [trial]
  directory → population (author selection; membership unknown)
    team × ?
      person × ?
        pullRequests → fetchFact × ?
          chartPoint → histogram [provisional view allowed]
          evidenceText → assess [wait for complete person corpus]
        personReport
      teamReport [explicit terminal-outcome fold]
  report [selected environment and population]
```

The plan does not execute `population`, so it cannot know its filtered count or
reverse-engineer a `.filter` predicate. It can identify the named selection stage
and optional authored description; detailed cheap discovery/validation is a
separate operation still to design. Stored results alone do not justify a
“will hit cache” claim. Display verified decisions only when actually verified,
and otherwise conditional reuse/unknown work. This example establishes no exact
cost prediction or final cardinality before discovery.

## What each exposed concept earns

| Concept | First needed | Why it exists |
| --- | --- | --- |
| Normal functions and data | Immediately | Domain logic stays TypeScript. |
| `step` / `memo`, name, revision | Managed calculation / durable reuse | Make execution and versioned reuse explicit; memo also protects expensive readiness. |
| `Ref<T>` and `await` | Stored inputs | Honest delayed values and selected-field dependencies. |
| `analysis` and an environment | Running a connected program | Define scope, storage routing, plan entry, and execution ownership. |
| Context accessor **or** `.withContext` | Trial logic, reporting, cancellation | Access execution facilities without making the whole context a memo input. |
| `refs.all` | Several selected fields | Convenient typed batch; individual awaits remain valid. |
| `fanOut` and keys | Dynamic membership | Declared member structure, stable occurrences, bounded scheduling. |
| `source` / async collections | Streaming discovery | Express unknown membership and a real completion boundary. |
| `.settled()` | Intentionally partial reporting | Make tolerated failures and changing outcome membership explicit. |
| `observe` and preview envelopes | Live supervision | Distinguish what is available from what is verified. |

Do not begin a tutorial by presenting this entire table or the full program.
Start with one calculation; reveal environment/trial behavior next, fan-out when
multiple members appear, then the streaming/failure/observer facilities. The full
program is a review artifact for us, not the proposed first-run experience.

## Recommendation and limits

| Question | A: scoped accessor | B: explicit opt-in context |
| --- | --- | --- |
| Simple steps | Same small signature | Same small signature |
| Context-dependent body | One accessor call | `.withContext` plus first parameter |
| Deep adapter helpers | Can obtain current context | Receive and forward context |
| Dependency discoverability | Read body/imports | Visible in body signature |
| Testing helpers | Establish scope or extract plain helper | Pass a context fixture |
| Binding calls | Context never supplied by author | Context never supplied by author |

**Prefer A for the primary authoring path.** It fits the requested gradual reveal
and the request-context analogy while avoiding parameter plumbing. Keep domain
helpers pure where possible. Choose B if visible dependencies and directly
injected test fixtures outweigh the extra opt-in spelling. I would select one
primary convention before exposing both; offering both immediately doubles the
things new users must decide.

Important limits of both examples:

- The declarations are not a mock runtime. No execution/cache/preview/isolation
  guarantee has been implemented or empirically validated here.
- Stable fan-out keys address member occurrences; the complete durable subject,
  source-refresh, and cross-run identity protocol still needs specification.
  External data freshness must be supplied by the source/snapshot policy; memoizing
  a directory by organization alone cannot notice remote changes spontaneously.
- `Ref<T>` uses thenables for this comparison. Returning a reference from an async
  helper resolves it; it does not preserve its address. The source property name
  `then`, optional nested objects, and richer value types remain unresolved. These
  choices are held constant across A/B, not silently approved by this exercise.
- The example materializes one person's evidence for the model, and final compact
  reports for delivery. Memory grows with those values. Large per-person corpora
  need an author-chosen chunking/context-limit strategy; this does not demonstrate
  bounded memory for arbitrary inputs or a global provider concurrency limit.
- Observed increments need attempt attribution and durable duplicate handling.
  The simple `record` call intentionally does not claim invoice reconciliation or
  exactly-once durability. The stop escalation policy and remote cancellation
  confirmation remain separate from merely passing an `AbortSignal`.

## Validation

Type tests were written before the candidate declarations; the initial check
failed because the declarations did not exist. Additional negative tests exposed
missing array-member keys and required revisions before those signatures changed.
The resulting type tests and both full programs now compile successfully.

The checks cover ordinary and context-enabled callsites, literal input typing,
field/batch inference, asynchronous composition rejection, keyed array fan-out,
collection versus native-array distinction, immutable environment, numeric
observations, and required memo revisions. Both options infer the same final
analysis input/output types. They do not test runtime semantics.

Reproduce from the repository root:

```sh
node node_modules/tsd/dist/cli.js --typings docs/exploration/context-options/surface.d.ts --files docs/exploration/context-options/authoring.test-d.ts
node node_modules/typescript/bin/tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck docs/exploration/context-options/scoped.ts docs/exploration/context-options/explicit.ts docs/exploration/context-options/launch.ts
```

[Candidate declarations](context-options/surface.d.ts),
[type tests](context-options/authoring.test-d.ts), and
[application types/provider boundaries](context-options/domain.ts) are included
for inspection. No production package files, dependencies, or exports changed.
