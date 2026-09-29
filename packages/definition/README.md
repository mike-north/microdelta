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
returns, plus distinct source and memo binding records. Binding records and memo
`children` must be plain records: ordinary or null prototype, string keys, and
enumerable own data properties only, so every declared field reaches the callback
context or topology. Other shapes are rejected before any work. Definition never
imports Tracking, History or Resolution; the facade chooses those meanings.

- `source<R>({ subject, version?, label?, run, finality? })` declares a retained
  source. `run` receives source bindings and `previous` (the eligible carrier or
  `undefined`); `finality` always receives a carrier. Authors read `previous.data`.
- `memo({ subject, version?, label?, children?, run })` declares a memoized
  computation. `children` maps sibling slot names to the source declarations
  occupying them; `run` receives memo bindings and typed `calls`.
- `source<R>({ ..., collection: { identity } })` declares a keyed collection
  source when `R` is `{ members, status: 'complete' | 'open' }`; `identity`
  names a string member field that is each member's default key (COL-1).
- Subjects are complete opaque author strings retained exactly (RES-001).
  Versions are positive safe integers, default 1 (REUSE-008). Declaring never
  invokes a callback, and declarations retain the author's actual functions.

## Supported M3 topology

`compose({ scope, inputs?, helpers?, members })` freezes framework-owned copies
before any run. Inputs become frozen Value snapshots; accessors are rejected
without being invoked. Each registration record (options, input, helper, member, step)
is captured once from its own data properties, and that single capture is what
lookup and invocation use; accessor or inherited registration fields reject. Members carry explicit keys and step slots. The only
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

## Keyed fanout templates, gates and strict folds

`template({ slot, collection, key?, gate?, steps })` declares a fanout template
over a keyed collection source. Its `steps` factory runs exactly once, inside
the composition phase, against a symbolic member builder: `member.subject(prefix)`
mints a member subject, and `member.source(...)`/`member.memo(...)` declare
member steps. A member memo may name sibling member sources and memos and
composition-wide supplied step slots. The builder never exposes a key or member
data and rejects every call with `frozen` once the factory returns. The
returned record is copied and frozen. Member subject prefixes may not overlap
(`p` and `p:x`), since `prefix:key` must stay unique.

`compose({ ..., steps?, templates? })` binds each template to the one
composition-level step slot holding its collection. A member instance is
addressed by `{ scope, role: 'step', slot, template, collection, memberKey }`:
the template step descriptor plus the key. Its subject is `prefix:memberKey`,
computed from the key only. Instance declarations are minted on demand and
cached per composition; they and the template's member steps cannot be
registered as ordinary steps. Renaming the template or moving it to another
collection is a miss, never a remap. An opened instance parent always records
the version-2 witness with template-bearing descriptors, and only it may forward
its member binding; the version-1 parser rejects template-bearing descriptors.

`composition.keyMembers(template, snapshot)` keys a collection snapshot by
designated identity or the template's custom `key`, returning every member in
canonical UTF-16 code-unit order with the completion status. A hole, `null` or
non-record member makes the snapshot malformed before any key function runs. A
missing, non-string, empty or duplicate key, or a throwing key function, rejects
the whole snapshot with a diagnostic naming the collection, the key and the
`key` option; the reported failure is chosen by fixed reason precedence and
least key, so it never depends on discovery order. Array position is never
identity and prototype-named keys are ordinary.

`gateOf(composition, instanceDescriptor)` exposes one instance's declared gate:
`apply` hands the actual author gate and `{ ...bindings, member }` to
Resolution's invoker, with the member view supplied for that instance.
`gateOutcome` classifies a settled gate: only `true` requires and only `false`
skips; a non-boolean result and a throw fail, distinctly.

`fold({ subject, over: { template, step }, run })` declares a strict fold,
registered as a composition-level step. Opening it yields a `fold` invocation
whose `apply` validates Resolution's member outcomes and gives `run` one entry
per member in canonical key order: `succeeded` with its view, or `skipped` with
no data (reading `data` throws `skipped-member`). Definition never evaluates
gates, runs discovery or decides fold readiness.

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
