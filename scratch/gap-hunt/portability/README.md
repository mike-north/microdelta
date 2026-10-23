# Portability probes

Implementer: Codex worker (gpt-6.1-sol).

These artifacts preserve macOS arm64 evidence for published `microdelta@0.2.0` under Node 24.22.1. See [REPORT.md](REPORT.md) for findings and boundaries; sanitized captured output is in `logs/`.

## Fresh external ESM consumer

Copy the three files in `consumer/` to a fresh temporary directory and enter that directory. Use Node 24.22.1 and either pnpm 10.34.7 or 12.10.1:

```sh
pnpm --version
pnpm install
node main.mjs
node durable.mjs
```

Before local native-build approval, pnpm 10 installation exits successfully but durable open reports a missing better-sqlite3 binding. pnpm 12 installation itself reports `ERR_PNPM_IGNORED_BUILDS`. The public memory-store import works.

Create `pnpm-workspace.yaml` containing:

```yaml
allowBuilds:
  better-sqlite3: true
```

Then run:

```sh
pnpm rebuild better-sqlite3
node durable.mjs
node durable.mjs
```

The first successful run reports `calls:1` and published; the second process reports `calls:0` and reused, with the same exact history reference. Use a fresh directory for each package-manager version. No globally relaxed build-script setting is needed.

## Repository alias probe

From the repository with dependencies installed:

```sh
npx tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-portability-alias.test.js
```

The symbolic-link case passes. The exploratory hard-link case is deliberately red (SQLite disk I/O error); it establishes neither a conflicting writer grant nor corruption, and hard-link support is not specified.

Node 26 logs demonstrate an ABI failure using a Node 24 native binding, followed by successful Node 24 reuse. They do not demonstrate cross-version durable reuse. Linux execution was unavailable.
