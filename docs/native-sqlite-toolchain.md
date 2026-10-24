# Native SQLite toolchain and host diagnosis

The project-private durable workspace uses the Node Machine's
`better-sqlite3@12.9.0` adapter. The default public memory `Store` is
process-local and does not exercise that native SQLite binding. Built-in
`node:sqlite` is not an adapter fallback. This guide diagnoses native
installation on specific hosts; it does not change microdelta's public API or
promise that every Node, OS and architecture combination works.

For a checkout, start with the [root Node 24/npm instructions](../README.md).
For an external pnpm consumer of published `microdelta@0.2.0`, the separate
[#157 build-approval workflow](https://github.com/mike-north/microdelta/issues/157)
explains pnpm's local script trust. Approving a build cannot repair an
incompatible compiler, linker or SDK.

## Understand the native installation path

An install can use a matching prebuilt binding. If none is available, npm
builds `better-sqlite3` from source through `node-gyp`; that path needs Node
headers, Python 3, `make`, a C++ compiler, linker and a compatible host SDK.
Check the actual install output before diagnosing the failure. A successful
header download is not proof that the SDK linker works, and a package's
declared engine range is not a runtime result.

The [captured macOS arm64 investigation](https://github.com/mike-north/microdelta/blob/6d3f3f3533d75ea42be226edbd7e3932b974f447/scratch/gap-hunt/contract-operations/node26-clt/REPORT.md)
distinguishes three outcomes for locked `better-sqlite3@12.9.0` on
**Node 26.12.0 / npm 11.20.0**:

| Control | Observed result | Meaning |
| --- | --- | --- |
| Original local build after no matching prebuild | Node headers and SHASUMS downloaded with HTTP 200; the installed SDK linker failed with `tapi error: malformed file` and `unknown architecture` while reading `libSystem.B.tbd` and `libc++.1.tbd`. | This was a local SDK/linker failure, not missing Node headers or general Node 26 incompatibility. |
| Command-local `DEVELOPER_DIR` and CLT `PATH` alone | The retry failed earlier with `stdio.h not found`, although the chosen SDK contained that header. | This is a separate header-discovery failure caused by an incomplete toolchain selection. |
| Consistent command-local CLT compiler, linker and SDK | `npm ci --no-audit --no-fund` built the same locked driver; native SQLite open/query/close passed. | This repaired that host's build without changing driver, engines or global tool selection. |

For an installed Apple Command Line Tools tree at the paths below, the
successful retry selected all related tools and headers for **one command**.
Set `NODE26_BIN` to the directory of the selected Node 26.12.0 executable;
the [evidence report](https://github.com/mike-north/microdelta/blob/6d3f3f3533d75ea42be226edbd7e3932b974f447/scratch/gap-hunt/contract-operations/node26-clt/REPORT.md#exact-successful-command-recipe)
records the exact machine-local binary path used in the test. Run this from a
checkout with its package lock if reproducing the repository install:

```sh
NODE26_BIN=/absolute/path/to/node-26.12.0/bin
CLT=/Library/Developer/CommandLineTools
SDK="$CLT/SDKs/MacOSX.sdk"
DEVELOPER_DIR="$CLT" \
PATH="$NODE26_BIN:$CLT/usr/bin:$PATH" \
CC="$CLT/usr/bin/clang" \
CXX="$CLT/usr/bin/clang++" \
SDKROOT="$SDK" \
CFLAGS="-isysroot $SDK" \
CXXFLAGS="-isysroot $SDK" \
LDFLAGS="-isysroot $SDK" \
npm ci --no-audit --no-fund
```

The same environment prefix can run the diagnostic below by replacing the
final `npm ci` command with
`node scratch/gap-hunt/contract-operations/diagnose-158-native.mjs`. This recipe
does not run `xcode-select` or change its global setting. It applies to the
observed CLT layout and linker failure; use your host's actual tool paths
when they differ. The bounded macOS control also passed 24→26→24 and
26→24→26 same-store sequences with separately installed bindings, one body
execution then two exact-reference reuses. It does not certify all macOS
toolchains or Linux same-store cross-version reuse.

## Run the disposable native diagnostic

With Node 26.x and npm selected on `PATH`, from a clean checkout run:

```sh
node scratch/gap-hunt/contract-operations/diagnose-158-native.mjs
```

The [pinned diagnostic](../scratch/gap-hunt/contract-operations/diagnose-158-native.mjs)
creates a temporary external package with only `better-sqlite3@12.9.0`,
records Node version, module ABI, OS, architecture, npm version, native install
status/signal/output, and then opens, queries and closes SQLite if installation
succeeds. It removes its temporary directory afterward. Inspect the JSON
`install.status`, `smoke.status` and `native-sqlite-open-query-ok` marker; its
outer exit 0 means the diagnostic completed, **not** that native installation
passed. Preserve relevant linker or missing-binding output when reporting a
failure. A successful native installation is a valid diagnostic result: the
[recorded clean macOS run](https://github.com/mike-north/microdelta/blob/faa7d2563945374b75cbd5b239a82df4e17a334d/scratch/gap-hunt/contract-operations/node26-clt/DIAGNOSTIC-158.md)
had child install and smoke statuses 0 on Node 26.12.0 with the command-local
CLT selection. This fixture does not run microdelta's full suite or compare
stores across Node versions.

## Keep Linux observations and metadata distinct

The [owner-supplied Linux aarch64 report](https://github.com/mike-north/microdelta/blob/e475049c3f858c270791581fb77f925e761363ce/scratch/gap-hunt/contract-operations/owner-linux-parity.md),
with its [provenance limits](https://github.com/mike-north/microdelta/blob/e475049c3f858c270791581fb77f925e761363ce/scratch/gap-hunt/contract-operations/LINUX-PROVENANCE.md),
records main `c5802daca4a0bb8ea91159854d84eddcfa5215b6` passing
independent `npm ci --no-audit --no-fund`, `npm run build`, and full `npm test`
on **Node 24.13.0** and **Node 26.12.1** with separately installed native
bindings. The Node 26.12.1 patch version substituted for the requested
26.12 line. These are supplied devbox results, not a rerun by this guide's
author. They do not test pnpm's build approval, Linux same-store cross-version
reuse, or every Linux host.

The upstream driver declares `20.x || 22.x || 23.x || 24.x || 25.x`; the
microdelta facade and Machine Node manifests say `>=20`. The Node 26
`EBADENGINE` warning expresses that metadata mismatch. The bounded macOS and
Linux successes are observed behavior, not an amendment of the upstream
declaration or a universal support policy. Changing engine ranges, drivers,
adapters or publication requires separate contract and conformance work.

The [bounded evidence record](validation/native-sqlite-toolchain-2026-10-23.md)
also records this implementation host's disposable Node 24 install/open probe
as a separate result, without treating it as a Node 26 test.
