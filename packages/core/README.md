# microdelta facade

The `microdelta` entry preserves the scaffold's existing public History
Store API. It explicitly reexports `@microdelta/history` declarations and runtime
values; it does not own the Store or grant other contexts an import shortcut.
See the [package map](../../docs/package-map.md) and [active specification](../../docs/spec/README.md).

```js
import { createMemoryStore } from 'microdelta';
const store = createMemoryStore();
console.log(await store.meta());
await store.close();
```

The existing Jest suite remains available at `microdelta/conformance/store` and
is implemented by History. Memory is process-local and non-durable.

## Project-private workspace path (alpha)

The facade's generated **alpha** declarations also carry the workspace
authoring and run path. Every name is a project-private `@alpha` contract that
may change without notice; the default public entry exposes none of it. It
composes the owners and adds no policy of its own:

- `authoring<TInputs, THelpers>()`: Definition's builders bound to Reuse
  Resolution's binding family: `source` (including keyed collection sources),
  `memo`, `template` (fanout over a keyed collection with an optional custom
  key and tracked gate; member steps read their member through the `member`
  binding), `fold` (a strict fold over one template step), `stepSlot`,
  `suppliedStep` and `supply` (callable step slots bound at composition),
  the canonical `forward` argument origins, and `compose`. Step callbacks also
  receive the observed `untracked` read.
- `openWorkspace({ location, logicalStore })`: durable History over Node's
  SQLite and clock. `workspace.run(options, body)` is one Run Supervision run
  whose Resolution resolves against that store; the run offers the normal entry
  operation `resolve(step, { requestKey })`, `resolveMembers(target, {
  requestKey })` for every current member of a template step,
  `resolveFold(step, { requestKey })` for a strict fold (reporting discovery,
  each member's typed outcome and the fold's outcome with coverage), the
  recovery entry operation `recover(step, { requestKey })`, `check(step)`,
  observed nonmemoized `ordinary(label, work)`, and exact `read(reference)`.
- `currentRun()`: the live run's context, looked up without a parameter.

The alpha view names the owners' contracts through facade-local aliases, so a
consumer imports only `microdelta`: for example `IMemberBuilder`,
`IStepSlot`, `IForwarded`, `IFoldEntry`, `IFoldReport`, `IStrictFoldOutcome`
and `IFoldCoverage`.

The [contribution report example](../../examples/contribution-report/README.md)
uses this path through the installed workspace's generated alpha declarations.
The M3 independent-process acceptance harness in `test/acceptance` exercises
this path across process exits, kill boundaries and lost-acknowledgment
recovery; see the [M3 acceptance record](../../docs/validation/m3-acceptance-2026-09-28.md).
The M4 independent-process acceptance suite in `test/m4-acceptance` drives the
keyed, gated, nested and strictly folded contribution analysis through the same
path; see the [M4 acceptance record](../../docs/validation/m4-acceptance-2026-09-29.md).
