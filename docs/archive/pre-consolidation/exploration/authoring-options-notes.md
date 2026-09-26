> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Authoring options: the same analysis four ways

**Status: nonnormative exploration.** None of these APIs is selected or
implemented. Promise-valued properties are one permitted option, not a decision.
These are readable API sketches, not compile-verified declarations. The purpose
is to compare what authors write before deciding how core represents reads.

## One workload for every option

An identified PR and identified rubric feed `assess(pr, rubric)`. Assessment
reads title, body, and the rubric prompt. It reads reviews only when a flag in
the body calls for them. A paid `judge` call returns an assessment; a downstream
summary reads only its headline. Ten other consumers read different fields of
the same PR.

```ts
interface PR {
  id: string;
  title: string;
  body: { text: string; needsReviews: boolean };
  reviews: readonly { author: string; text: string }[];
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: readonly string[];
  changedFiles: number;
  additions: number;
  deletions: number;
  state: "open" | "closed";
}

interface Rubric { id: string; prompt: string }
interface Assessment { headline: string; rationale: string }

// Each consumer needs one field. The assessment is a separate consumer.
const panelFields = [
  "title", "author", "createdAt", "updatedAt", "labels",
  "changedFiles", "additions", "deletions", "state", "reviews",
] as const;
```

In all four sketches, `memo` receives a declared function and revision. Its
returned callable supplies the corresponding lazy representation of the result,
rather than pretending the stored result is already a plain `Assessment`.
`judge` receives resolved, immutable values. Identity registration, runtime setup,
and the implementation of `judge` are intentionally held constant and omitted.

## A. Await each property

The first sketch gives each top-level property a real Promise for its value.

```ts
const assess = memo(async function assess(
  pr: AsyncFields<PR>,
  rubric: AsyncFields<Rubric>,
) {
  const [title, body, prompt] = await Promise.all([
    pr.title,
    pr.body,
    rubric.prompt,
  ]);
  const reviews = body.needsReviews ? await pr.reviews : [];

  return judge({ title, body: body.text, reviews, prompt });
}, { revision: 1 });

const summarize = memo(async function summarize(
  assessment: AsyncFields<Assessment>,
) {
  return { text: await assessment.headline };
}, { revision: 1 });

// Ten separately evaluated consumers; each reads its own field.
async function panel<K extends keyof PR>(pr: AsyncFields<PR>, field: K) {
  return renderPanel(field, await pr[field]);
}

const assessment = await assess(pr, rubric);
const summary = await summarize(assessment);
await Promise.all(panelFields.map(field => panel(pr, field)));
```

**What reads well:** familiar `await` and `Promise.all`; conditional reviews are
ordinary control flow. The function executes once. The loader may merge the
three initial requests without replaying anything.

**What requires care:** a missing `await` leaves a Promise where a value was
expected. Many ordinary calls are caught by TypeScript, but string interpolation
and truthiness can still produce mistakes. Three sequential awaits would be
correct but potentially unnecessarily serial.

**Nested fields:** `await pr.body` consumes the body as a whole. Reading
`(await pr.body).text` afterwards cannot retroactively narrow that read. An API
that supports `await pr.body.text` has moved beyond a simple Promise per
top-level property; it needs a nested address model such as option D.

**Allocation shape:** an eager Promise for every property of every record is not
required. Promises can be created only on property access and cached per requested
field. Even then, each concurrently requested field has promise machinery. A
bounded record window is still necessary; an array of promises for all 150,000
records would itself defeat the memory goal.

**Type shape:** a mapped `AsyncFields<T>` can preserve the type of each top-level
property. It deliberately changes the author's argument type from `PR` to a view.

## B. Select a typed batch of fields

This sketch exposes a non-thenable value handle and one operation that reads a
typed list of keys. Destructuring gives ordinary local values.

```ts
const assess = memo(async function assess(
  pr: Value<PR>,
  rubric: Value<Rubric>,
) {
  const [{ title, body }, { prompt }] = await Promise.all([
    select(pr, ["title", "body"]),
    select(rubric, ["prompt"]),
  ]);
  const reviews = body.needsReviews
    ? (await select(pr, ["reviews"])).reviews
    : [];

  return judge({ title, body: body.text, reviews, prompt });
}, { revision: 1 });

const summarize = memo(async function summarize(
  assessment: Value<Assessment>,
) {
  const { headline } = await select(assessment, ["headline"]);
  return { text: headline };
}, { revision: 1 });

async function panel<K extends keyof PR>(pr: Value<PR>, field: K) {
  const selected = await select(pr, [field]);
  return renderPanel(field, selected[field]);
}

const assessment = await assess(pr, rubric);
const summary = await summarize(assessment);
await Promise.all(panelFields.map(field => panel(pr, field)));
```

**What reads well:** one explicit load boundary, ordinary values after it, and
an obvious list of what was requested. The author does not handle a Promise per
field. Missing fields are ordinary type errors on the selected object.

**What feels heavier:** each field name appears in the selection and usually
again in destructuring. A one-field conditional read is verbose. A batch spanning
PR and rubric still needs `Promise.all` or a second, general batch operation.

**Expressiveness:** a dynamic list of keys is straightforward. Nested access
needs a typed path/field-selector variant; unconstrained string paths would lose
some of the appeal. Requesting `body` still means reading that whole node.

**Dependency policy to choose:** the simple, honest contract makes selection a
read of every selected field. Selecting a hundred keys and using one therefore
depends on a hundred. Treating selection as only prefetch would require returning
another tracked view and defining primitive extraction; it is a different design,
not a free optimization.

**Allocation shape:** the public operation can use one Promise per selected bag,
with plain key descriptors. Individual store batches can be shared beneath it.
This permits, but does not prove, fewer Promise objects than option A. Resolving
the ten separate panels still entails ten consumer completions even if physical
I/O is coalesced into fewer calls.

**Type shape:** `select<T, const K extends readonly (keyof T)[]>` can return
`Promise<Pick<T, K[number]>>`. Const type parameters support retaining literal
key information for inline arrays; dynamic arrays necessarily produce a broader
result type. This follows TypeScript's documented
[const type-parameter inference](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters)
and [Pick utility](https://www.typescriptlang.org/docs/handbook/utility-types.html#picktype-keys).

## C. Collect a named bag of fields, then resolve it together

Here property access builds a lightweight, non-thenable field reference. The
callback returns a bag of those references; `read` resolves the bag once. It does
not evaluate a callback pretending unresolved fields are ordinary strings.

```ts
const assess = memo(async function assess(
  pr: Fields<PR>,
  rubric: Fields<Rubric>,
) {
  const { title, body, prompt } = await read(() => ({
    title: pr.title,
    body: pr.body,
    prompt: rubric.prompt,
  }));
  const reviews = body.needsReviews
    ? await read(() => pr.reviews)
    : [];

  return judge({ title, body: body.text, reviews, prompt });
}, { revision: 1 });

const summarize = memo(async function summarize(
  assessment: Fields<Assessment>,
) {
  const headline = await read(() => assessment.headline);
  return { text: headline };
}, { revision: 1 });

async function panel<K extends keyof PR>(pr: Fields<PR>, field: K) {
  return renderPanel(field, await read(() => pr[field]));
}

const assessment = await assess(pr, rubric);
const summary = await summarize(assessment);
await Promise.all(panelFields.map(field => panel(pr, field)));
```

**What reads well:** one bag can combine multiple inputs and name the resulting
locals. Conditional reads remain explicit and occur after the first batch.
The collection callback executes once; the memoized body executes once.

**What requires discipline:** `body` inside the callback is a field reference,
not its value. Branching on it there is wrong. In particular this tempting form
must not be advertised as working:

```ts
// Wrong: an unresolved reference is not a boolean value.
await read(() => pr.body.needsReviews ? pr.reviews : []);
```

Supporting arbitrary synchronous callbacks over apparently ordinary values would
require full prior materialization, suspension/replay, or another restriction.
None of those mechanisms is implicit in this sketch.

**Does the callback earn its syntax?** If the bag already contains inert
references, this may be simpler with the same semantics:

```ts
const { title, body, prompt } = await read({
  title: pr.title,
  body: pr.body,
  prompt: rubric.prompt,
});
```

Keep both forms in the usability comparison. A callback should exist only if its
scope or delayed construction provides a concrete benefit. It need not be a
mandatory authoring abstraction.

**Dependency policy:** forming an address is not consuming content; `read`
records the fields it resolves in the calling execution. Selecting a nested
address must not record every ancestor's whole-content fingerprint. References
may preserve identity when passed to other steps, while resolved primitive
locals cannot secretly carry it.

**Allocation shape:** a bag needs field references and one completion Promise.
The loader can batch by storage key and join overlapping loads. Eager construction
of a recursive reference for every field is unnecessary; create requested paths
on demand. References still consume memory and must be released with the live
window. One public completion does not mandate any particular internal Promise
count.

**Type shape:** mapped/conditional types can turn a record of `Field<T>` references
into the same record shape containing `T`. TypeScript documents the underlying
[mapped-type mechanism](https://www.typescriptlang.org/docs/handbook/2/mapped-types.html).
The exact signature, nested references, optional properties, and array behavior
still need compiler probes; this note does not claim those designs are finished.

## D. Await PromiseLike field handles

This combines option A's syntax with address-bearing objects. A field is a small
handle implementing `PromiseLike<T>` rather than a native Promise allocated at
every property access. It can be routed before somebody resolves it.

```ts
const assess = memo(async function assess(
  pr: AwaitableFields<PR>,
  rubric: AwaitableFields<Rubric>,
) {
  const [title, body, prompt] = await Promise.all([
    pr.title,
    pr.body,
    rubric.prompt,
  ]);
  const reviews = body.needsReviews ? await pr.reviews : [];

  return judge({ title, body: body.text, reviews, prompt });
}, { revision: 1 });

const summarize = memo(async function summarize(
  assessment: AwaitableFields<Assessment>,
) {
  return { text: await assessment.headline };
}, { revision: 1 });

async function panel<K extends keyof PR>(pr: AwaitableFields<PR>, field: K) {
  return renderPanel(field, await pr[field]);
}

const assessment = await assess(pr, rubric);
const summary = await summarize(assessment);
await Promise.all(panelFields.map(field => panel(pr, field)));
```

**What reads well:** essentially identical to ordinary awaiting. A nested handle
could support `await pr.body.text` without loading siblings, provided its type
and runtime distinguish address traversal from reading the node's whole value.

**The less-obvious cost:** JavaScript resolves thenables when returning them from
an async function or passing them to Promise machinery. Therefore this seemingly
innocent routing function resolves the field and returns its plain value:

```ts
async function routeTitle(pr: AwaitableFields<PR>) {
  return pr.title; // Resolves the handle; does not preserve it as a handle.
}
```

That behavior follows the standard
[Promise resolution procedure](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise-resolve-functions).
It can surprise authors who expected durable identity and field addresses to
survive routing. A non-thenable envelope, such as `{ field: pr.title }`, avoids
direct assimilation but adds an author-visible convention.

**Other questions:** what happens to a real data property named `then`; does
`await` on an object node materialize that whole subtree; and how do optional
object nodes expose children before their existence is known? The runtime must
return a non-thenable resolved representation rather than resolving a handle to
itself. PromiseLike handles also should not grow subscriptions, cancellation, or
progress state merely because they can be awaited.

**Allocation shape:** constructing a field handle need not construct a native
Promise, but `await`, `Promise.all`, and joins still create promise machinery.
PromiseLike is a possible allocation optimization, not evidence of fewer live
objects or a bounded heap. Compare it with option C's direct batch resolver using
actual measurements before adding protocol complexity for performance.

**Type shape:** `Awaited<T>` models recursive unwrapping at asynchronous boundaries,
as documented in TypeScript's [Awaited utility](https://www.typescriptlang.org/docs/handbook/utility-types.html#awaitedtype).
Field-handle types can preserve value types while awaited. Combining a thenable
object with typed child properties needs explicit collision and optionality rules.

## What all four must prove

The syntax cannot substitute for these invariants:

1. The first assessment reads title, body, and prompt; reviews are absent from
   its dependency set when `needsReviews` is false.
2. A new conditional read performs one additional load and continues the existing
   body. It never restarts earlier paid calls or replays the body.
3. Ten consumers each record only their own field. Shared I/O and caching do not
   merge their dependency sets. A cached field read still records a dependency
   for each reader, not only for the first loader owner.
4. Reading a leaf does not depend on unread siblings. Reading an entire object
   or collection has a separately defined whole-content meaning.
5. Verification of stored field dependencies reads fingerprints without values.
6. Changing assessment rationale while headline stays equal serves the summary.
7. Failed loads identify the address and preserve the underlying error; no value
   silently becomes `undefined`. A rejected batch does not cancel shared work
   that another consumer still needs.
8. Memory measurements separately count retained payloads, live field references,
   live native Promises, pending storage requests, and per-consumer continuations.
   Use a bounded window across records; none of these examples authorizes
   retaining an all-record Promise or handle graph.

## Primitive identity remains a separate choice

All options eventually produce ordinary strings such as `title`. A primitive
cannot carry a per-instance symbol identity. Awaiting a handle or resolving a
field bag therefore needs a documented boundary: does the author pass the
address-bearing handle onward, or deliberately pass resolved content?

```ts
// Candidate distinction, not selected API:
await classifyTitle(pr.title);  // A field handle can carry PR identity + title path.
await classifyText(title);      // A plain string is content; its reads are verified.
```

The distinction is easiest to preserve with non-thenable handles. PromiseLike
handles additionally face assimilation when routed through async returns. Real
Promise properties would need to carry explicit field metadata or a separate
handle to support the first call. Batch selection returns plain primitives and
therefore still needs a way to select a handle for this use case.

An identified primitive pin has the same issue. An explicit `Input<string>`
carrier could distinguish two identical strings with different identities; a
primitive-value side table cannot. This exploration does not choose whether such
carriers appear in function signatures, how `memo` unwraps them, or whether
identified primitive pins should be supported by a separate operation.

## Recommendation shortlist for the next comparison

Keep **typed batch selection (B)** and **field bags with collective resolution
(C, including the direct-object form)** as the first two candidates. B makes the
load boundary and selected dependencies particularly obvious. C composes several
sources, preserves address-bearing handles, and avoids a native Promise per field
at the public surface. Compare both with small authorship exercises before choosing.

Keep **property awaiting (A)** as the familiarity baseline. Its short example is
valuable evidence even if another option ultimately offers better batching or
identity routing. Do not reject it based on an assumed eager Promise-per-field
implementation.

Explore **PromiseLike handles (D)** as an optional convenience only if the
assimilation and identity-routing examples remain understandable to authors and
measurements justify any additional machinery. It is not automatically the best
of A and C: its standard JavaScript behavior changes what it means to return a
field from an async function.

The next deliberate choice should be made from author code that includes optional
nested fields, helper functions, primitive outputs, a field named `then`, and a
conditional provider call. These examples are still more useful than freezing a
generic API from the easy happy path.
