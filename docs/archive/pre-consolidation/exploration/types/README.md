> Historical artifact. Superseded by the [active specification](../../../../spec/README.md). Do not implement from this document.

# Authoring surface type experiments

These are three independent candidates, not approved `microdelta` APIs. `authoring-options.d.ts` contains ambient declarations only; there is no resolver, storage behavior, implementation, dependency change, or package export. Every candidate uses the same PR and rubric fixtures in `authoring-options.test-d.ts`.

| Candidate | Ordinary callsite | Inferred result |
| --- | --- | --- |
| A: property promises | `await pr.title` | `string` |
| A: nested property | `await pr.author.login` | `string` |
| B: typed key bag | `await KeyBag.readFields(pr, ['title', 'body'])` | `Pick<PR, 'title' \| 'body'>` |
| B: nested source | `await KeyBag.readFields(pr.author, ['login'])` | `{ login: string }` |
| C: reference record | `await ReferenceBag.read({ title: pr.title, body: pr.body, prompt: rubric.prompt })` | `{ title: string; body: string; prompt: string }` |
| C: optional tuple | `await ReferenceBag.read([pr.title, pr.reviews.length, rubric.prompt])` | `[string, number, string]` |

The test callsites use no casts or `as const`. Both C forms retain cross-source inference. An ordinary synchronous function returning `{ title: pr.title, body: pr.body, prompt: rubric.prompt }` composes directly with C's `read()`. Its tuple variant requires one additional overload and the same mapped resolution type; it introduced no additional inference machinery.

## What the tests establish

- All candidates reject misspelled source fields, including nested `pr.author.logni`.
- Nested `pr.author.login` retains the leaf's `string` value type.
- `pr.reviews.length` is an unresolved handle/reference in each candidate, never a synchronous `number`. Resolving it yields `number`; resolving the whole reviews field preserves its readonly array type.
- A interoperates with `await` and `Promise.all`. Awaiting an ordinary object containing its property handles leaves that bag unresolved.
- B infers inline key arrays precisely, including duplicates and empty selections. A reference bag returned by a helper is not a source handle and cannot be passed to `readFields`; cross-source reads need separate requests or an additional composition API.
- C accepts named and positional reference bags, rejects raw values and other candidates' handles, and infers mixed string/number tuples. Result bag containers are modeled as newly resolved mutable objects/tuples; readonly nested value types survive.
- C references have no callable `then`. TypeScript nevertheless allows `await` on any nonthenable value: `await pr.title` still has type `Ref<string>`. These types cannot make that misuse an error; assignment or use as a string will expose it.

## Limitations surfaced

**B's widened key arrays need a policy.** A separately declared `const keys = ['title', 'body']` widens to `string[]` and is rejected. Annotating it as `(keyof PR)[]` permits the call, but the literal `Pick<T, Keys[number]>` return contract then claims every PR field, even though the runtime array may select only two. The passing type test records this loss of precision; it does not establish that the result would be sound at runtime. Possible refinements include requiring finite tuples or returning a partial result for widened arrays. Neither refinement is selected here.

**Handles are not native arrays.** The experiments deliberately distinguish length references from numbers and expose indexed references rather than native array methods. Bounds, missing fields, array traversal, and other special properties remain unresolved runtime/surface questions. A additionally exposes `PromiseLike.then`, which needs a policy for source fields with that name.

**Type inference says nothing about read effects.** The tests do not prove batching, whether awaiting a whole object records whole-grain reads, when loading starts, error handling, reference lifetime, or serialization. They do not choose a preferred surface.

## Validation evidence

Tests were written first. The initial command failed because the declarations did not exist. After adding the ambient declarations, this exact command from the repository root passed with exit code 0 and no diagnostic output:

```sh
node node_modules/tsd/dist/cli.js --typings docs/exploration/types/authoring-options.d.ts --files docs/exploration/types/authoring-options.test-d.ts
```

The checked-in test source is the reproducible evidence, including expected compile failures through `expectError`. No emitted code or core files are involved.
