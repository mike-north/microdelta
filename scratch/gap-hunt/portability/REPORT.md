# Track E continuation: portability

Baseline c5802daca4a0bb8ea91159854d84eddcfa5215b6, macOS arm64, Node24.22.1 and26.12.0. All installs/store files live in this isolated worktree's ignored scratch tree. No release, paid calls, repository settings, external messaging, or production changes.

## Confirmed external-consumer friction: pnpm native build approval

**Consumer need:** an ESM-only consumer installs microdelta0.2.0 and opens the durable workspace. This consumer need is distinct from the known project-private alpha TypeScript setup and Node26 native compatibility findings.

Observed, before explicit build approval:

- `npm exec --yes --package=pnpm@10.34.7 -- pnpm --dir scratch/gap-hunt/portability/pnpm10 install` exits0, warning `Ignored build scripts: better-sqlite3@12.9.0`. ESM import and public `createMemoryStore` work, but durable `openWorkspace` throws `Could not locate the bindings file`.
- `/Users/mnorth/.nodenv/versions/24.14.0/bin/pnpm --dir scratch/gap-hunt/portability/pnpm12 install` (pnpm12.10.1, executing with active Node24.22.1) installs the packages then exits1 with `ERR_PNPM_IGNORED_BUILDS` for better-sqlite3.
- Both package managers advise `pnpm approve-builds`. Root/project user docs contain no pnpm install/native approval recipe. This is normal package-manager trust enforcement, not evidence of a package manager bug.

Suggested issue direction: **P2 installation documentation/support recipe**, if not covered by the parent's installation issue. State the native dependency and targeted build approval, and test an installed external ESM consumer. Do not recommend globally disabling build-script protections. Do not conflate default installation failure with ESM module resolution, which works.

Minimal reproduction in a fresh directory:

```json
{"name":"consumer","private":true,"type":"module","dependencies":{"microdelta":"0.2.0"}}
```

Run the chosen pnpm install; then run `import {openWorkspace} from 'microdelta'; const w=openWorkspace({location:'./history.sqlite',logicalStore:'consumer'}); w.close();` in an `.mjs` file. pnpm10's durable open fails without the native binding; pnpm12's installation fails at the ignored-build gate.

**Positive control:** create this local `pnpm-workspace.yaml`, then rebuild the named dependency:

```yaml
allowBuilds:
  better-sqlite3: true
```

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --dir scratch/gap-hunt/portability/pnpm10 rebuild better-sqlite3
/Users/mnorth/.nodenv/versions/24.14.0/bin/pnpm --dir scratch/gap-hunt/portability/pnpm12 rebuild better-sqlite3
node scratch/gap-hunt/portability/pnpm10/durable.mjs
node scratch/gap-hunt/portability/pnpm10/durable.mjs
node scratch/gap-hunt/portability/pnpm12/durable.mjs
node scratch/gap-hunt/portability/pnpm12/durable.mjs
```

Both isolated ESM consumers cold-run **calls1/published**, then fresh process **calls0/reused**, retaining exact `mdh1|["portability","portability","fixture",1]`. Logs in `logs/`: `pnpm10-{install,approved,cold,restart}.log` and corresponding pnpm12 logs. Replay fixtures are in `consumer/`; sanitized captured logs are in `logs/`. Installation trees, native binaries, and database files are excluded. These runtime probes intentionally avoid the known alpha TypeScript configuration problem.

## Alias behavior

`packages/core/test/gap-hunt-portability-alias.test.ts`:

```sh
npx tsc -p packages/core/tsconfig.test.json
node --experimental-vm-modules node_modules/jest/bin/jest.js --config packages/core/jest.config.mjs --runInBand --runTestsByPath packages/core/.test-build/test/gap-hunt-portability-alias.test.js
```

Result: **symbolic file alias passes**. Both handles observe one writer, second acquire reports `held` with correct holder/expiry, and second handle reads the exact reference published through the first.

**PROVISIONAL hard-link consumer requirement is red:** open both hard-link aliases succeeds, then the first writer acquisition throws raw `SqliteError: disk I/O error` in `readWriter`. No conflicting writer grant or corruption was demonstrated. The current canonical-location documentation enumerates symbolic links, relative/absolute spelling and redundant segments; it does not explicitly promise hard links. Do not file this as a proven PUB-002 stale-write violation. Suggested bounded direction: document/reject unsupported hard-linked SQLite stores if maintainers want an explicit support boundary. `logs/alias.log` preserves exact stack/output. TypeScript and lint pass for the probe.

Existing Machine location and core writer-wait tests already cover directory symlink canonicalization and nested-run reentrancy; DX also verified source-result reuse through a symlink. This new file-symlink probe adds direct same-lease/exact-read assertions.

## Node26 and built-in SQLite

- Node26.12.0 `node:sqlite` exists and executes `select sqlite_version()` returning3.54.0 (`node26-builtin.log`).
- Actual shipped Machine adapter imports better-sqlite3 and opens its native driver unconditionally; there is no built-in SQLite fallback. Thus built-in availability alone does not make this adapter portable.
- Reopening this consumer's Node24-generated store under Node26 fails before analysis with native module ABI mismatch: binary137, Node26 requires147 (`node26-durable-open.log`). A later Node24 process reuses the unchanged exact result with **calls0** (`node24-after26.log`). This does not establish Node24-to26 result reuse or invalidation stability.
- DX already recorded the independent fresh Node26 install failure (unsupported engine range, missing prebuild, source compile/link failure) and equal MDV1/MDS1 codec hashes across24/26. Those are not duplicated here. Source bounds v8 usage to detached in-process snapshots; the codec comparison is not a cross-version durable-run proof.

## Linux boundary

Docker29.8.2 client exists, context desktop-linux, but no daemon at `/Users/mnorth/.docker/run/docker.sock`. No available Linux runtime was executed; no macOS-to-Linux behavior claim is made. No VM or daemon was installed/started. Path semantics remain macOS evidence.

## Execution notes

An attempted npm-exec download/invocation of pnpm12.15.0 ended137 with an empty log; cause unestablished. The existing pnpm12.10.1 binary supplied a clean reproducible result and positive control. Do not classify the137 as a microdelta failure.

Track B's report/artifacts remain intact under `scratch/gap-hunt/durability`.

## Attribution

Implementer: Codex worker (gpt-6.1-sol).
Agent assistance: Codex worker (gpt-6.1-sol) authored and ran the probes; parent review remains separate.
