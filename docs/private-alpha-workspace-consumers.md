# Private alpha declarations for workspace consumers

The facade's alpha declarations are a **project-private workspace contract**.
They are not a published alpha channel. The default package type entry remains
the public surface, and no `microdelta/alpha` package subpath exists.

The declaration and installed-command examples below describe checkout or
locally built package evidence. The accepted controlled proof of `start` plus
finite `observe` is recorded under [#294](https://github.com/mike-north/microdelta/issues/294#issuecomment-6462080386);
it does not claim a new package publication or expose the alpha declarations
through the published package surface.

## Build generated declarations first

From a clean repository checkout, install the lockfile and build the packages
before compiling an approved sibling consumer:

```sh
npm ci
npm run build:packages
node node_modules/typescript/bin/tsc -p fixtures/declarations/consumer-alpha/tsconfig.alpha-six.json
node --test fixtures/declarations/consumer-alpha/alpha-consumer.test.mjs
```

The checked-in consumer fixture lives beside the package directories under
`fixtures/declarations/consumer-alpha`. It imports only `authoring` from
`microdelta`; the TypeScript configuration maps that facade and its reached
owner declarations to generated alpha rollups. The preview projection's alpha
signatures name Materialization's existing read capability and lazy view type,
so Materialization belongs to this declaration closure even when a consumer
imports only `authoring`. The positive consumer compile fails if that mapping
is omitted; the facade-only negative fixture still rejects an incomplete
closure:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": "../../../",
    "noEmit": true,
    "skipLibCheck": false,
    "types": [],
    "paths": {
      "microdelta": ["packages/core/dist/api/microdelta.alpha.d.ts"],
      "@microdelta/definition": ["packages/definition/dist/api/definition.alpha.d.ts"],
      "@microdelta/history": ["packages/history/dist/api/history.alpha.d.ts"],
      "@microdelta/materialization": ["packages/materialization/dist/api/materialization.alpha.d.ts"],
      "@microdelta/resolution": ["packages/resolution/dist/api/resolution.alpha.d.ts"],
      "@microdelta/supervision": ["packages/supervision/dist/api/supervision.alpha.d.ts"],
      "@microdelta/tracking": ["packages/tracking/dist/api/tracking.alpha.d.ts"]
    }
  },
  "files": ["alpha-import-only.ts"]
}
```

The paths above are relative to the repository root through `baseUrl`; they
target the generated alpha-trimmed declarations, never source files or
untrimmed rollups. To run the checked-in fixture from its own directory, use
the repository-relative compiler path and config name:

```sh
cd fixtures/declarations/consumer-alpha
../../../node_modules/typescript/bin/tsc -p tsconfig.alpha-six.json
node --test alpha-consumer.test.mjs
```

The fixture also creates a temporary consumer directory **beside a checkout**
and checks that relative paths work there. For the same layout by hand, place
the checkout in a directory named `microdelta` and a consumer beside it:

```text
parent/
  microdelta/   # this repository
  consumer/
```

In `consumer/tsconfig.json`, use the same strict options, with `baseUrl` and
alpha mappings relative to the two sibling directories:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": false,
    "types": [],
    "baseUrl": "../microdelta",
    "paths": {
      "microdelta": ["packages/core/dist/api/microdelta.alpha.d.ts"],
      "@microdelta/definition": ["packages/definition/dist/api/definition.alpha.d.ts"],
      "@microdelta/history": ["packages/history/dist/api/history.alpha.d.ts"],
      "@microdelta/materialization": ["packages/materialization/dist/api/materialization.alpha.d.ts"],
      "@microdelta/resolution": ["packages/resolution/dist/api/resolution.alpha.d.ts"],
      "@microdelta/supervision": ["packages/supervision/dist/api/supervision.alpha.d.ts"],
      "@microdelta/tracking": ["packages/tracking/dist/api/tracking.alpha.d.ts"]
    }
  },
  "files": ["alpha-import-only.ts"]
}
```

Create a local package link, save the runtime probe below as
`consumer/runtime-import.mjs`, and run the checkout's TypeScript compiler plus
the runtime probe from `consumer/`:

```sh
cp ../microdelta/fixtures/declarations/consumer-alpha/alpha-import-only.ts ./alpha-import-only.ts
mkdir -p node_modules
ln -s ../../microdelta/packages/core node_modules/microdelta
node ../microdelta/node_modules/typescript/bin/tsc -p tsconfig.json
node runtime-import.mjs
```

The runtime probe uses an ordinary package import:

```js
import { authoring } from 'microdelta';

if (typeof authoring !== 'function') {
  throw new TypeError('Expected the built facade export');
}
```

The package link points at the built package root so Node follows its declared
`exports` and then resolves the other workspace packages through the checkout's
own `node_modules`; neither TypeScript aliases nor source-file paths participate
in runtime resolution. A real sibling application should use its normal package
installation or local workspace link in the same way.

The paired facade-only configuration intentionally maps only `microdelta` and
must report the existing `TS2305` for a transitive alpha-owned name. The
six-path configuration must compile the same import-only file. This boundary
is specific to that facade export, package baseline, and consumer: another
alpha API can reach a different declaration closure. The five owner mappings
shown here passed the pinned import-only probe; they are not a universal
minimum or a promise that every consumer always needs five mappings.

## Type and runtime resolution stay separate

TypeScript `paths` only selects declarations for this private workspace check;
it does not change JavaScript imports. The runtime proof imports
`microdelta` from this sibling fixture using Node's normal package resolution.
That succeeds because `npm run build:packages` creates the workspace package
outputs and the workspace installation makes the package available through
`node_modules`; the package root export selects the built runtime entry. Keep
imports on package names and supported exports, and keep each consumer within
the allowed package dependency edges.

External consumers should omit these private `paths` mappings and resolve the
default public package view normally. A separately selected beta package may
opt in to its beta declarations; that does not expose alpha. These mappings
are local development configuration only and do not widen publication or
release surfaces.

## Installed foreground run-start

The same installed package supplies a foreground `start` command and the
separately permissionable finite reader:

```sh
microdelta start --module ./dist/workload.js --observation ./observations/run.sqlite -- opaque-app-arg
microdelta observe --location /absolute/path/observations/run.sqlite --execution-id <32-lowercase-hex-digits>
```

The compiled local module default-exports `defineCliWorkload(factory)`. Its
factory receives a frozen readonly array of opaque arguments and returns a
preparation containing its workspace, run options without `stop`, body, and
exactly-once disposer. Import and preparation must not start a run. The CLI
injects its stop controller and the absolute observation location when it
starts the prepared body. The generic helper and its preparation types are
project-private alpha declarations; they are not a published alpha channel.
Compatible physical package copies recognize the same helper handoff, so a
caller module can use its ordinary local package import with a separately
installed command. This does not promise compatibility between arbitrary alpha
versions; the caller must satisfy the installed command's preparation contract.

Start writes a version-1 locator receipt as soon as the observed handle is
returned, then a bounded terminal receipt after both the runtime result and
observation acknowledgment settle and disposal completes. Receipts never
contain application arguments, body values, arbitrary errors, or provider
configuration. A locator receipt proves allocation only; an acknowledged
terminal record still does not prove that an application report is complete.
The application's own bounded statement remains a separate observation fact.

The CLI does not serialize the caller's report or body return value: stdout is
reserved for its locator and terminal JSON lines. Caller code owns report
assembly and output. During the active application run, the body can use the
existing `run.read(reference)` operation to obtain the deeply frozen data for
that exact completed result. The read adds no acceptance or dependency evidence,
and a missing or wrong-store reference fails rather than retargeting. The caller
can then present or persist the report through its own application output path.
The read does not establish current validity or success: if current work is
incomplete or failed, an earlier readable result is prior retained data, not a
current completed report.

The module path must name an explicit local `.js`, `.mjs`, or `.cjs` file.
There is no package lookup, remote loader, TypeScript compilation, or discovery.
Tool flags may appear in either order exactly once. Unknown/missing/repeated
flags fail before import; only arguments after `--` reach the factory. Module
and observation paths are at most 4,096 UTF-16 code units before and after
absolute resolution. At most 256 application arguments are accepted, each at
most 4,096 code units. Absolute observation locations are passed into the
runtime before allocation, so a second process can use the locator from any
working directory.

Stdout is reserved for CLI JSON lines; caller diagnostics belong on stderr.
This is trusted caller JavaScript: the helper neither sandboxes module side
effects nor intercepts global console output. Import and factory preparation
must leave analysis/provider work unstarted. A factory that fails before
handover owns cleanup of its resources. After a valid preparation is returned,
the CLI owns its disposer, including after synchronous start refusal.

The fixed version-1 records use these fields:

| Record | Fields and meaning |
| --- | --- |
| Locator | `version: 1`, `type: "locator"`, `locator: { location, executionId }`. Allocation/return only; preparation, body entry and liveness are separate facts. |
| Terminal | `version: 1`, `type: "terminal"`, optional allocated `locator`, `runtime: "returned" / "failed" / "not-started"`, `failures`, `stop`, optional `acknowledgment`, `cleanup`, `transport`. |
| Independent failures | `failures` is a finite, duplicate-free array drawn from `module`, `preparation`, `runtime`, `observation`, `cleanup`, `transport`. Concurrent runtime/observation/cleanup failures remain distinct, including under a signal exit. |
| Stop intent | `stop: "none" / "soft" / "hard"` is the final CLI controller intent, rather than evidence of provider cancellation. |
| Observation settlement | A fulfilled acknowledgment retains its existing `kind` (`acknowledged`, `uncertain`, `unprepared`), `revision` when acknowledged, and optional bounded `observationFaults`. A rejected acknowledgment is `{ kind: "rejected" }`; absent means no observed handle was obtained. |
| Cleanup | `cleanup: "not-handed-over" / "disposed" / "failed"`. `disposed` means the handed-over disposer fulfilled once after any obtained run promises settled. |
| Transport | `transport: "available" / "failed"` describes the locator write. A terminal-write failure cannot promise a delivered receipt and makes an otherwise successful command fail. |

Each receipt has one bounded locator (location at most 4,096 code units and
execution identity of 32 lowercase hexadecimal digits), fixed discriminants,
and bounded runtime acknowledgment values. No body return, error/stack,
application argument or credential-bearing configuration enters these records.
A locator-write failure retains both promise settlements and drain/disposal
ownership. No failed output write forces an early process exit.

Signal handling is installed before module import/preparation. First SIGINT
requests soft stop with no default deadline: no new admissions, with admitted
work draining under the existing runtime policy. Further SIGINT and SIGTERM
request hard stop through the same controller. A signal during setup causes
zero starts and disposal after preparation settles. Uncooperative JavaScript
has no forced-termination guarantee. One cancellable Node keep-alive covers
setup, drain, acknowledgment and disposal; it is released with signal
subscriptions at final cleanup and performs no lease renewal or observation
heartbeat.

| Exit | Meaning after actual drain and cleanup |
| --- | --- |
| `0` | Runtime fulfilled, observation acknowledged, cleanup succeeded, no stop or transport failure. Application completeness is still independent. |
| `1` | Preparation/runtime/observation/cleanup/transport failure or uncertain observation. |
| `2` | Invalid invocation or module contract/load failure. Invalid flags emit only a fixed stderr usage diagnostic, with no stdout; valid invocations emit a terminal receipt when stdout remains available. |
| `130` / `143` | Handled SIGINT / SIGTERM. Independent failure facts remain in the terminal receipt when writable. |

An uncertain or rejected acknowledgment never authorizes an automatic second
invocation or restart. Use the existing exact locator reader to inspect evidence;
another explicit invocation is a separate caller decision.

The default workspace lease is 30,000 ms and renews at request/pass boundaries,
not during a pass or each HTTP send. A caller should choose a lease longer than
its actual longest uninterrupted pass; a long lease also delays crash takeover.
There is no CLI heartbeat or 11–12 hour endurance guarantee, and the operation
journal is not a raw-response cache. Useful acquired data must pass through the
normal declared source and result boundaries.
