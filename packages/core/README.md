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

The [native store location guidance](../../docs/native-store-locations.md)
describes how the project-private Node SQLite workspace canonicalizes existing
store paths and why distinct hard-linked names must not be used concurrently
for one WAL database. This does not change the public memory `Store` API.

## Project-private workspace path (alpha)

External pnpm ESM consumers evaluating the published `microdelta@0.2.0`
durable path need [consumer-local native-build approval](../../docs/native-sqlite-install.md)
before `openWorkspace`. The public memory Store above remains process-local.

The durable Node SQLite path has [platform-qualified native installation and
diagnostic guidance](../../docs/native-sqlite-toolchain.md). It is separate
from the public memory Store and from the alpha declaration setup.

The facade's generated **alpha** declarations also carry the workspace
authoring and run path. Every name is a project-private `@alpha` contract that
may change without notice; the default public entry exposes none of it. It
composes the owners and adds no policy of its own:

- `authoring<TInputs, THelpers>()`: Definition's builders bound to Reuse
  Resolution's binding family: `source` (including keyed collection sources),
  `memo`, `template` (fanout over a keyed collection with an optional custom
  key and tracked gate; member steps read their member through the `member`
  binding), `fold` (a strict fold over one template step), `outcomeFold` (an
  outcome fold over every member's settled status), `stepSlot`,
  `suppliedStep` and `supply` (callable step slots bound at composition),
  the canonical `forward` argument origins, and `compose`. Step callbacks also
  receive `hasOwn(value, key)` for own-member presence and the observed
  `untracked` read.
- Completed source results and awaited memo results have a record or array
  root in this alpha path. Wrap a scalar as a field, such as `{ value: 42 }`;
  `undefined` is also supported as a present field value. Source callbacks
  still return a trusted `sourceOutcome.fresh(recordOrArray)` or `retain()`
  outcome, synchronously or through a promise. The runtime validates the
  actual result shape for untyped callers.
- `openWorkspace({ location, logicalStore })`: durable History over Node's
  SQLite and clock. `workspace.run(options, body)` is one Run Supervision run
  whose Resolution resolves against that store; the run offers the normal entry
  operation `resolve(step, { requestKey })`, `resolveMembers(target, {
  requestKey })` for every current member of a template step,
  `resolveFold(step, { requestKey })` for a strict fold (reporting discovery,
  each member's typed outcome and the fold's outcome with coverage),
  `resolveOutcomeFold(step, { requestKey })` for an outcome fold (the same
  report, with an outcome that folds every settled status and coverage that
  never claims a complete set while anything is unsettled), the
  recovery entry operation `recover(step, { requestKey })`, `check(step)`,
  observed nonmemoized `ordinary(label, work)`, and exact `read(reference)`.
  A run's options may also carry an operator stop controller (`stop`), its
  permit pool size (`permits`, default 1) and fan-out window (`window`,
  default 8, independent of permits; a member waiting for a time lends its
  lane), how it waits for another holder's writer lease (`writerWait`, with
  no default deadline; `WriterBusyError` names the holder at the deadline),
  and what it does once only deferred work remains (`deferral`: `sleep`, the
  default, or `exit`, reporting `waitingUntil`). Unless the caller supplies
  `runId`, every run is identified as `run:<32 hex digits>` from 128 random
  host bits, so no two runs of any process share one. A caller-supplied
  `runId` must be an identifier (`^[a-z][a-z0-9_.:-]{0,63}$`) other than that
  reserved form, and keeping it unique is the caller's responsibility.
- Operations: `openWorkspace({ ..., accounting })` takes the caller's
  Resource Accounting port (`IWorkspaceAccounting`, which Accounting's durable
  adapter satisfies structurally; the facade never imports Accounting). With
  it, the workspace builds History's operation journal and Node's random
  source and gives every run Supervision's operation ports:
  `currentExecution().operation(request)` performs one declared external
  operation (intent before send, usage counted once, no blind replay), and the
  run offers `inspectOperations()`, `settleOperation(settlement)` and
  `usage(filter?)`, its environment's usage summary with unknown usage kept
  apart.
- Environments: a run selects its environment. Supervision's run operation
  `promote({ into, references, evidence })` records a promotion of exact
  results into *another* environment, under the writer lease and refused when
  a stop is in force, through History's durable store as Supervision's
  structural promotion port; `promotions()` lists the promotions recorded
  *into the run's own* environment. Trial results satisfy production only
  that way.
- `currentRun()`: the live run's context, looked up without a parameter.
- `createStopController()`: operator stop intent with deadlines on Node's
  timer. A soft stop admits no new work and drains admitted steps (with the
  first attempts of the children their bodies demand), with no
  default deadline; a deadline or a hard stop aborts sends, permit waits and
  waits for a time, and discards uncommitted output.
- `currentExecution()`: the live run's execution controls, looked up without
  a parameter: its stop intent and abort signal, permit-guarded `send`,
  stop-aware `sleepUntil` and the external `operation` handle, attributed to
  the admitted step running there.

The alpha view names the owners' contracts through facade-local aliases, so a
consumer imports only `microdelta`: for example `IMemberBuilder`,
`IStepSlot`, `IForwarded`, `IFoldEntry`, `IFoldReport`, `IStrictFoldOutcome`,
`IFoldCoverage`, `IOutcomeEntry`, `IOutcomeFoldReport`,
`IOutcomeFoldRunOutcome`, `IOutcomeFoldCoverage`, `IOperationRequest`,
`IOperationView`, `IOperationEvent`, `IWaitEvent`, `IUsageSummary` and
`IPromotionRecord`.

For a scalar calculation, retain a record and read its field from the child
result. This complete declaration example uses the generated alpha view, with
`microdelta` resolved as in the [example TypeScript configuration](../../examples/contribution-report/tsconfig.json):

```ts
import { authoring } from 'microdelta';

export const builders = authoring<Record<string, never>, Record<string, never>>();
const answer = builders.memo({
  subject: 'answer',
  run: () => ({ value: 6 * 7 }),
});
const summary = builders.memo({
  subject: 'summary',
  children: { answer },
  run: async ({ calls }) => {
    const { data } = await calls.answer();
    return { text: `The answer is ${data.value}.` };
  },
});
export const composition = builders.compose({
  scope: 'wrapped-result',
  steps: [{ slot: 'answer', declaration: answer }, { slot: 'summary', declaration: summary }],
});
```

The `answer` result retains `{ value: 42 }`; `summary` consumes `data.value`
and also returns a record. Pass `builders` as the run's `authoring` and
`composition` as its composition when resolving `summary`, following the
workspace setup in the contribution report example below. A serialized string
or a present `undefined` uses the same wrapper shape.

Approved sibling workspace consumers must map the facade and any reached owner
declarations to their generated alpha rollups. See the tested
[private-alpha workspace consumer recipe](../../docs/private-alpha-workspace-consumers.md);
the default public entry remains unchanged.

### Own presence in an alpha callback

Use the callback's `hasOwn` capability when a missing field must differ from an
own field containing `undefined`:

```ts
import { authoring } from 'microdelta';

const analysis = authoring<{ config: { optional?: number | undefined } }, Record<never, never>>();
export const configured = analysis.memo({
  subject: 'configured',
  run: ({ inputs, hasOwn }) => ({ present: hasOwn(inputs.config, 'optional') }),
});
```

`IHasOwn` names this narrow alpha capability. Resolution supplies it from the
same Tracking observer that owns the callback's views, including lazy child and
previous-result data. It records own presence, not the field's value, sibling
keys, or inherited membership. Thus missing → own `undefined` invalidates this
reader; later value-only changes preserve reuse. Ordinary `in` remains the
separate supported membership operation, and ordinary value reads can equate
missing with own `undefined` ([TRK-5](../../docs/spec/tracking.md)).

Keys are strings: records support their Value-domain property names, and arrays
support canonical nonnegative index strings; array `length` ownership is not a
supported own-presence fact. Raw objects, foreign-observer views, unsupported
keys and unsupported values reject rather than report absence. The capability
uses Tracking's current capture and existing lifetime rules. It exposes neither
an observer nor a new capture scope. Native `Object.hasOwn` and descriptor
reflection remain unsupported on tracked views.

The [contribution report example](../../examples/contribution-report/README.md)
uses this path through the installed workspace's generated alpha declarations.
The M3 independent-process acceptance harness in `test/acceptance` exercises
this path across process exits, kill boundaries and lost-acknowledgment
recovery; see the [M3 acceptance record](../../docs/validation/m3-acceptance-2026-09-28.md).
The M4 independent-process acceptance suite in `test/m4-acceptance` drives the
keyed, gated, nested and strictly folded contribution analysis through the same
path; see the [M4 acceptance record](../../docs/validation/m4-acceptance-2026-09-29.md).
