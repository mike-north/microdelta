# Tracking immutable observation: bounded proof for #277

The owning contracts are [TRK-1–6/8 and VAL-1–3](../spec/tracking.md),
[ARC-002/004](../spec/architecture.md), and
[PKG-001/003–005](../spec/package-boundaries.md). The accepted issue is
[#277](https://github.com/mike-north/microdelta/issues/277). This record describes
its small deterministic runtime proof, independently of the later TEST-5 gate.

## Ownership and read-work contract

Value owns supported-shape validation, snapshot detachment/freezing and exact
selection semantics. Tracking owns wrapper roots, structured paths, binding and
capture identity. Each new data wrapper prepares its complete supported input
through Value once. An observer-private WeakMap retains only the Value-created
root and its authenticated `IPreparedValue` token. Descendant wrappers share that
proof; neither a binding descriptor, caller object identity nor `Object.isFrozen`
confers trust. Both preliminary get selection and recorded evidence selection
resolve the full root/path through `observePrepared`. Callable roots retain their
separate implementation-evidence path; lazy sources and current-fact providers
retain their existing selected-fact contracts. No declaration/API changes are
needed, and sibling imports continue through generated alpha declarations.

Creation still performs Value's ordinary full validation/encode/decode passes.
Subsequent narrow navigation, length, position, scalar, membership and own-presence
reads may follow selected path depth; they must not rescan every sibling slot or
record field per operation. Explicit key enumeration and output detachment still
traverse what their operations request. This is not a universal constant-time or
whole-runtime memory claim.

## Test-first failure and resulting pass

The test-only observer in
[`immutable-observation.test.ts`](../../packages/tracking/test/immutable-observation.test.ts)
delegates the real `Object.getOwnPropertyDescriptor` call and returns its actual
result. It separately counts creation/preparation and read work, checks nonzero
preparation and frozen-snapshot reads, and restores its spy in `finally`. It does
not replace Value/Tracking helpers or inspect private caches.

Before runtime edits, the array control failed at N=8 with 680 slot descriptor
reads against a 256 bound, and N=32 with 10,400 against 1,024. With the runtime
restored to the accepted base, the completed test set also failed its record
control: 1,440 reads against 288 at N=8 and 21,888 against 1,152 at N=32. These are
actual delegated descriptor-call counts for these fixtures, not instruction counts
or duration/hotspot attribution.

The array bound is fixed from four literal expressions, maximum selected path
depth four, and two selections (preliminary selection and evidence), times N and
the number of captures. The record bound uses three expressions, depth two, two
selections and three captures. The bounds were written and observed failing
before the corresponding runtime implementation; they were not fitted to its
passing counts. Repeated captures reuse the same wrapper and repeat actual reads.
The final test set against the original runtime reported four failing work tests
and 142 passing tests. With prepared-root integration it reported 146 passing
tests across ten selected suites. Strict Tracking compiler/portable and type-aware
lint checks passed after generating its own declaration artifacts.

Commands used for the observed original-runtime failure and implemented pass:

```sh
npm run test:unit --workspace @microdelta/tracking -- --testPathPatterns immutable-observation
npm run build --workspace @microdelta/tracking
npm run check --workspace @microdelta/tracking
```

The runtime change was temporarily restored to the original accepted file before
adding the later semantic and record-width tests, and those outcomes were observed
before restoring the prepared-root implementation. The complete RED output named
`wide record reads do not rescan sibling fields` and
`narrow reads follow selected paths rather than population surfaces`, each at
N=8 and N=32. The expected failure was the explicit descriptor-work bound, with
nonzero preparation/frozen-root checks already succeeding.

## Acceptance mapping and preserved boundaries

| Criterion | Executable evidence |
| --- | --- |
| Actual array/record surface work, both get selections, nested paths, distinct indices, length/membership/own, repeated captures | New `owned immutable observation work` tests, N=8/32 with genuine RED/GREEN above |
| Sparse hole versus own undefined, numeric Property versus Index, returned values, exact operation/address/encoded facts, read dedup | New `sparse positions and numeric record keys retain independently specified facts across captures`; expected facts are literal independent vectors encoded with the existing Value encoder |
| Custom prototype lookup, inherited membership versus own, insertion order | New `bounded custom prototype lookup and insertion order survive preparation`; existing Value prepared-snapshot tests cover two custom prototype levels |
| Caller isolation, independent fresh wrappers using the same caller/binding, no binding-identity cache | New `caller mutation cannot change an owned view or seed another wrapper with the same binding`; existing Tracking same-address distinct-facts case |
| Ordinary mutable Value validation timing, unsupported newly added shape, no getter execution | New parameterized `ordinary mutable Value surfaces are checked again after ... mutation`, covering accessor/symbol/extra property/unsupported array prototype; existing Value navigation unread-subtree test |
| Arbitrary frozen inputs cannot grant trust, fabricated tokens reject | New `arbitrarily frozen unsupported input never becomes an ownership proof`; existing Value `reject malformed values at preparation and reject fabricated runtime tokens` |
| Length versus same-length edits, container navigation versus null | Existing Tracking array-length/positional tests and `container-guard.test.ts`; these now exercise the prepared route |
| Output consumption, callable facts, capture isolation/restoration, closed frames, lazy views, untracked/suppressed reads | Existing Tracking output/observer/capture/lazy/untracked/own-presence suites, preserved without implementation changes |
| Normal generated-authoring/facade reuse with unread/consumed changes and exact references | Existing core `workspace/own-presence.test.ts` finite durable literal read matrix, including the closure case; generated facade worker reads real Tracking inputs and verifies body counts and exact retained references |
| #275 request preparation, ambient author capture and full-input intent | Existing core `resolution/stable-input-preparation.test.ts` and `resolution/input-preparation-contract.test.ts`; no Resolution changes |
| Closed declaration boundary and unchanged API | Repository compiler, tsd, API report and source-import gates |

Final delivery requires the clean committed head to pass, in order,
`npm run check`, `npm test`, and explicit `npm run build`. Their exact head,
outputs and independent review disposition belong in the PR/supervisor evidence;
the targeted proof above does not substitute for them.

## Limits

No #272 harness was imported, copied, changed or run for this work. The interrupted
full150000 lineage stays preserved. These small tests do not establish full scale
completion, latency, a causal runtime hotspot, physical I/O, transient heap peak,
TEST-5 acceptance or M7 closure. Root retains authority over any later source
freeze and fresh scale qualification. Publication, release automation and the
supported Value domain are unchanged.
