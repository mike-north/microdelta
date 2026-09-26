> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Exploring the microdelta authoring surface

**Latest comparison:** [Two concrete authoring options](concrete-authoring-options.md)
applies the subsequent trial-mode, analysis-context, cancellation, and observed
usage decisions to complete, type-checked examples. It compares scoped context
with opt-in explicit context and introduces concepts gradually. Scoped context
has now been selected; the rest of those signatures remain proposals. See the
[test-first plan](../scoped-context-implementation-plan.md). The earlier field-access
alternatives below remain supporting research.

**Exploration, not a specification or API decision.** The user requested concrete
code examples to compare power and approachability before selecting a surface.
Names such as `read`, `readFields`, and `ready` are placeholders. None is implemented
or exported by core. The existing internal tracking façade does not settle them.

Confirmed: Node ≥20, AsyncLocalStorage, and array `length` as a field read.
Promise-valued properties are allowed as a candidate, not selected as the design.

## One task, three primary surfaces

Each version reads a PR's title and body, plus a rubric's prompt. It fetches reviews
only when the body requests them, then calls the same paid operation once. We omit
the unchanged memo wrapper and type registration to make the author code comparable.
`needsReviews` is an ordinary pure function over the resolved body string.

### 1. Await properties

```ts
async function assess(pr, rubric) {
  const [title, body, prompt] = await Promise.all([
    pr.title,
    pr.body,
    rubric.prompt,
  ]);

  const reviews = needsReviews(body) ? await pr.reviews : [];
  return judge({ title, body, prompt, reviews });
}
```

This is familiar JavaScript. One-field reads are particularly easy to understand.
The example is the same whether properties expose native promises or PromiseLike
handles; that representation should not be decided from syntax alone.

Sequential `await`s are correct but may serialize loads. Missing an await can
silently go wrong in truthiness checks or string interpolation even with TypeScript.
Do not assume a native promise is allocated eagerly for every field in the store;
an implementation can construct one only when requested.

### 2. Await a selection from one value

```ts
async function assess(pr, rubric) {
  const [{ title, body }, { prompt }] = await Promise.all([
    readFields(pr, ["title", "body"]),
    readFields(rubric, ["prompt"]),
  ]);

  const reviews = needsReviews(body)
    ? (await readFields(pr, ["reviews"])).reviews
    : [];
  return judge({ title, body, prompt, reviews });
}
```

The load boundary is explicit; everything after it can be ordinary immutable
values. TypeScript can infer the selected keys without a cast at the call site.
Selecting from a dynamic list of keys is natural, but the return type needs care:
the compiler probe showed that a naive `Pick<T, K[number]>` overpromises available
fields when `K` is a widened key array. A partial result or tuple-only policy is
needed for a sound final contract.

The cost is repetition: keys appear in the selection and destructuring. Combining
several sources requires several selections or another batch shape. Nested fields
also need a deliberate selection form; unrestricted dotted strings would sacrifice
type checking and complicate escaping.

### 3. Await a bag of field references

```ts
async function assess(pr, rubric) {
  const { title, body, prompt } = await read({
    title: pr.title,
    body: pr.body,
    prompt: rubric.prompt,
  });

  const reviews = needsReviews(body) ? await read(pr.reviews) : [];
  return judge({ title, body, prompt, reviews });
}
```

Property access produces a lightweight address-bearing reference. One call resolves
the requested bag across sources. There need not be a native Promise per reference:
the resolver can hand the entire selection to the loader and return one completion.
Internal joins and requests still have allocation costs.

A tuple variant offers the familiar shape of `Promise.all`:

```ts
const [title, body, prompt] = await read([
  pr.title,
  pr.body,
  rubric.prompt,
]);
```

The main learning cost is that `pr.title` is a reference, not a string. Authors must
know when they are routing an address versus using its value. Type checking catches
many mistakes, but JavaScript accepts `await` on nonthenable objects; types alone
cannot make every mistaken `await reference` fail.

## The bag's return value is a separate decision

Two variants look identical in the common destructuring case but differ when some
requested fields are not used.

```ts
// A collective read: every selected field becomes a dependency.
const values = await read({ title: pr.title, body: pr.body });
return values.title;
```

This contract is easy to state. Selecting body is an explicit read, even if the
author later ignores its value. It should not be confused with prefetching.

```ts
// A readiness boundary: loading finishes, then accesses record dependencies.
const fields = await ready({ title: pr.title, body: pr.body });
return fields.title;
```

This variant loads both fields but records only the title read. It returns a frozen
tracked view over resolved fields, not a plain copied object. Destructuring both
fields would read both; merely completing the batch would not. This deserves a
prototype because it uses the existing distinction between loading and consuming
while offering synchronous property access after one await.

The additional rules must be visible and testable: the view holds one immutable
generation; a cached getter still records the current caller's read; selected
fields that fail to load reject readiness; a field outside the selected view is a
type error or requires another explicit request. Batch failure policy is not settled
by this sketch. We should not claim this view is free of descriptors or retained
payloads merely because it has one completion promise.

## Make the candidates handle something harder

### Conditional reads

Every primary example has two phases when reviews are needed and one otherwise.
The second phase continues the existing body; nothing reruns `judge` or replays a
memoized body. A loader can coalesce concurrent consumers independently of syntax.

For a field-reference surface, this tempting code is wrong:

```ts
// The condition inspects an unresolved reference, not its boolean value.
await read(() => pr.flags.needsReviews ? pr.reviews : []);
```

If a callback returns a bag of inert references, it can execute once safely:

```ts
await read(() => ({ title: pr.title, prompt: rubric.prompt }));
```

But the direct-object form already does that job. A callback should earn its syntax
through a demonstrated benefit. A callback that pretends unloaded fields are raw
values is a different design and must not smuggle in body replay.

### Nested fields and array length

```ts
const { author, reviewCount } = await read({
  author: pr.author.login,
  reviewCount: pr.reviews.length,
});
```

This is a strong test of the reference model. Forming `pr.author.login` must not
consume the whole author object. `reviews.length` is a field read and must not
load or depend on review bodies. Arrays therefore cannot simply masquerade as
ordinary `Review[]` if their length is an unresolved field handle.

The same capabilities must be expressible in the selection candidate without
requiring untyped path strings. A nested typed-selector object is an option, but
its syntax and inference should be tested before adding it.

### Reuse without another framework concept

```ts
function promptFields(pr, rubric) {
  return { title: pr.title, body: pr.body, prompt: rubric.prompt };
}

const { title, body, prompt } = await read(promptFields(pr, rubric));
```

An ordinary function can compose a request bag. It is not a stored projection,
declared graph, new step class, or special selector registration. Renaming bag
keys changes local names, not the underlying addresses.

### Routing through an async helper

```ts
async function titleField(pr) {
  return pr.title;
}
```

With nonthenable references, the returned value can still be a field reference.
With PromiseLike references, JavaScript assimilates the thenable and returns its
resolved value instead. This is standard promise behavior, not an implementation
bug. It makes an identity-bearing handle less transparent to ordinary async helpers.
The [promise resolution procedure](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise-resolve-functions)
is the governing source. An envelope such as `{ field: pr.title }` prevents direct
assimilation, at the price of another authoring convention.

### Passing identity versus passing content

```ts
await classifyTitle(pr.title);       // A reference can carry parent identity + path.
await classifyText(resolvedTitle);   // An ordinary string carries content.
```

Neither awaiting a promise nor resolving a bag attaches identity to a primitive
string. A deliberate surface should make this distinction understandable rather
than relying on a side table keyed by primitive value. The wrapping/unwrapping
contract for memo arguments remains open.

## What would make an option win

| Criterion | Property awaiting | Typed selection | Field-reference bag |
| --- | --- | --- | --- |
| First one-field read | Very little new syntax | Verbose but explicit | One new `read` operation and a reference concept |
| Batch across several inputs | Familiar `Promise.all` | Multiple selections | One named or tuple bag |
| Conditional extra field | Ordinary await | Another selection | Another read |
| Nested typed addresses | Needs more than top-level Promise properties | Needs a typed nested selector | Fits the property-reference model |
| Reusable request shape | Promise construction/timing matters | Plain functions over key lists | Plain functions over bags |
| Passing a field without resolving | Requires promise metadata or separate refs | Requires a reference operation | Natural for nonthenable refs |
| Dependency precision after a batch | Depends on consumption contract | All selected keys, unless returning a tracked view | All read refs, or later accesses on a ready view |
| Promise allocation | Must measure the implementation | Can share one bag completion | Can share one bag completion; references still allocate |

My working shortlist is **typed selection** and **field-reference bags**, including
the resolved tracked-view variant. Property awaiting remains the familiarity
baseline. PromiseLike support is an independent candidate capability, not an
automatic optimization or a selected default.

Before choosing, use each surface to write the same short exercise: add a field,
extract a helper, add a conditional load, route a field through an async helper,
and inspect why a dependency was recorded. Count required annotations and surprising
behavior, not just characters. Allocation measurements should compare the same
live window and requested fields, not an eager all-record design against a lazy one.

## Supporting evidence

- [Declared binding candidates](declared-bindings.md): ordinary calls to wrapped
  functions as the leading happy path, explicit binding bags for comparison,
  memoization-based readiness defaults, and separate preview observation and
  verified consumption for the known-pipeline model.

- [GitHub contribution analysis scenario](../scenarios/github-contribution-analysis.md):
  the user's product anchor for live provisional histograms over contribution
  facts and readiness-gated agentic analysis of an individual's complete period.
  Use both consumers in subsequent API exercises, not only isolated field reads.

The subsequent [confirmed streaming/blocking requirement](../decisions.md)
extends these exercises: the same results must support a progressively updating
viewer and an expensive consumer that waits for a coherent required input set.
Test the case where three related fields arrive or change separately. A simple
collective await is sufficient only if the references already describe the
intended complete input set; it cannot infer that an upstream update has ended.
The design must identify that readiness boundary without treating every observed
intermediate state as authorization for another paid execution. Exact consistency
semantics, update policies, and public syntax remain open.

- [Analysis CLI and fan-out failures](analysis-cli-and-failures.md): the user's
  added requirements, a live terminal sketch, and candidate author code for
  complete/partial folds, bounded groups, coverage, and failure handling. These
  exercises extend the surface comparison beyond field-loading syntax.

- [Long-form candidate examples](authoring-options-notes.md), including memoized
  assessment, downstream headline consumption, and ten separate consumers.
- [Type prototypes and checks](types/README.md): property handles, nested fields,
  array length, literal key selection, and cross-source record/tuple bags were
  checked with TypeScript 5.9.3 and tsd. Inline bags and tuples infer without casts.
  The notes identify the widened-key-array problem and the fact that TypeScript
  accepts awaiting a nonthenable reference. Passing these type tests does not
  establish runtime correctness or approve a surface.
- [Allocation probe](allocation-notes.md): retaining 100,000 eager three-field
  records used about 20.0 MB with native field promises, 15.2 MB with tiny
  thenables, and 10.4 MB with one bag promise on Node 20 and 24. These are toy
  representation measurements, not predictions for a lazy materializer. Custom
  thenables still incurred promise machinery when awaited. A real comparison
  must include address objects, caches, payloads, and a bounded live window.
