# Definition & Binding

This package owns frozen step declarations, the fixed M3 step graph, current
structural correspondence and declared child-call handles. Every export is a
project-private `@alpha` declaration; spellings are not a public contract.
See the [package map](../../docs/package-map.md) and
[composition contract](../../docs/spec/composition.md).

## Authoring surface

A facade calls `declarations<TFamily>()` once. The binding family supplies
type-level mappings from a declared result type to the view authors read, the
immutable previous-result carrier a source receives and the outcome a source
returns, plus distinct source and memo binding records. Definition never
imports Tracking, History or Resolution; the facade chooses those meanings.

- `source<R>({ subject, version?, label?, run, finality? })` declares a retained
  source. `run` receives source bindings and `previous` (the eligible carrier or
  `undefined`); `finality` always receives a carrier. Authors read `previous.data`.
- `memo({ subject, version?, label?, children?, run })` declares a memoized
  computation. `children` maps sibling slot names to the source declarations
  occupying them; `run` receives memo bindings and typed `calls`.
- Subjects are complete opaque author strings retained exactly (RES-001).
  Versions are positive safe integers, default 1 (REUSE-008). Declaring never
  invokes a callback, and declarations retain the author's actual functions.

## Supported M3 topology

`compose({ scope, inputs?, helpers?, members })` freezes framework-owned copies
before any run. Inputs become frozen Value snapshots; accessors are rejected
without being invoked. Members carry explicit keys and step slots. The only
permitted edge is a memo naming a sibling **source** slot of the same member,
whose declaration must be exactly the pinned child (current-composition
consistency, not restart correspondence). There are no cross-member or
memo-to-memo edges, runtime arguments, derived arguments or fanout. One scoped
subject is claimed by exactly one declaration object; the same declaration may
occupy several branches.

`resolve(descriptor)` returns `bound`, `missing` or `ambiguous` by exact
`{ scope, role, slot, memberKey? }` match; there is no name, subject, hash,
function-identity or ordinal fallback. `resolveWitness(data)` reconnects a
version-1 direct-child witness with the explicit empty-argument form and reports
unknown versions or argument forms as unsupported.

## Invocation bridge

`openInvocation(composition, descriptor, port)` opens a live scope for one
uniquely bound step. `apply` hands the actual author callback and the context
Definition assembled to Resolution's rank-2 invoker, so tracking and capture
fingerprint the author's own function. Declared handles take no arguments and
dispatch an empty-argument witness plus the pinned child declaration through the
injected port; results arrive as frozen `{ data }` carriers. Forged, substituted,
out-of-scope, closed, composition-phase and argument-bearing calls reject before
dispatch. Materializing, selecting and validating results belong to later
Resolution work; the port's typed child view is a trusted caller contract.

`nameOf` and its synthetic-name vocabulary remain label and diagnostic helpers;
names never identify a subject or reconnect a binding.
