# Private alpha declarations for workspace consumers

The facade's alpha declarations are a **project-private workspace contract**.
They are not a published alpha channel. The default package type entry remains
the public surface, and no `microdelta/alpha` package subpath exists.

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
owner declarations to generated alpha rollups:

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
mkdir -p ../consumer/node_modules
ln -s ../../microdelta/packages/core ../consumer/node_modules/microdelta
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
