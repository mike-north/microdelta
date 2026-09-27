# Tracking & Observation

This package owns the scaffold's process-local tags, capture frames, cells, and
reactive derivations. A tag or revision is not durable across processes.

The project-private `createTrackingObserver(machine)` alpha contract composes
those local utilities with Value's selected-fact encoding. Its
`tracked(value, binding)` method accepts supported objects, arrays, or functions
and copies the structural binding descriptor. Scalar reads and actually called
function code can be captured as immutable, versioned evidence. Reading through a tracked
container does not materialize unread siblings; returning a wrapper from capture
also does not make its contents an output dependency. A materializer can use the
narrow `materialization.owns()` and `materialization.read()` bridge to select
output fields without obtaining a raw source object.

`compareCurrent()` asks a caller-owned provider to resolve each binding and its
current full path before comparing facts. Its equal/changed/unavailable/ambiguous
result is evidence only: it does not decide reuse, establish source freshness, or
reconstruct a durable definition. A called function contributes emitted
`Function.prototype.toString()` evidence and observed tracked reads; this does
not make arbitrary closure captures sound, and wrapping a function does not
memoize it. Only ordinary calls are supported: native or bound functions,
construction, and function metadata/property access fail visibly. Explicit
`keys()` and `hasOwn()` helpers capture those operations. Native reflection,
unsupported Value inputs, native array methods, and unobservable object
identity/coercion are outside this bounded surface.

These runnable alpha owner contracts are not the complete durable authoring API.
History persistence, binding registry, output materialization and reuse
eligibility remain separate owners. See the [package map](../../docs/package-map.md).
