# Independent macOS Node24 / Node26 same-store execution

**PASS** at source commit `bbd2c1ef779ea8ef05ca80bf17c6b2be04aa8209`: independently installed/built runtime checkouts complete **24→26→24 and26→24→26** over one store per sequence. Each sequence publishes with bodycalls1, then reuses twice with bodycalls0/0, identical exact locator and nested Unicode payload. Existing `verify-cross-version.mjs` / `cross-version-worker.mjs` assertions were unchanged. `cross-version.log` records every actual Node/platform/arch/result.

Host: Darwin arm64, Node24.22.1 ABI137 and Node26.12.0 ABI147, locked `better-sqlite3@12.9.0`; native Node26 open returns SQLite3.53.0. Separate detached worktrees have identical HEAD, separate npmci installs, generated package builds and distinct native binding paths/checksums (`paths.json`, `native-provenance.json`). No native binaries, dependency directories or database stores are committed. The runner removes its own temporary stores; disposable runtime checkouts are retained locally for inspection, not shared installation state.

## Toolchain investigation and bounded retry

Original complete ignored log is copied as `original-node26-install.log`: old linker/TAPI could not parse `arm64e.x1` architecture in the newer CLT SDK's `.tbd` stubs. This is a local build-environment failure; no source compile incompatibility was established by that log.

First disposable attempt used only command-local `DEVELOPER_DIR=/Library/Developer/CommandLineTools` and PATH prefixed with Node26 and CLT tools. Actual selected compiler: clang2100.3.34.2; linker27037.1/TAPI2100.3.8.1. It failed earlier with `stdio.h not found` (`install26.log`), although the selected SDK contains that header. `environment.log` records the exact commands/output. No inherited CC/CXX/CFLAGS/CXXFLAGS/LDFLAGS/SDKROOT/CPATH overrides were present.

One bounded retry explicitly supplied absolute CLTCC/CXX, SDKROOT and `-isysroot` compile/link flags (`retry-environment.json`). Same locked driver and Node; `npm ci --no-audit --no-fund` exits0 (`install26-retry.log`). The native driver then opens/query/closes an in-memory SQLite database successfully (`native-open26.log`). No further rebuild retries occurred.

Global `xcode-select` was never changed: without the command-local override it remains `/Applications/Xcode.app/Contents/Developer` (`global-selection-after.log`). No tools were installed and no production code, dependency version or driver selection changed.

The install warns `EBADENGINE`: better-sqlite3@12.9.0 declares Node20–25, excluding26. This empirical macOS run does not broaden the driver's declared support or prove general Node26 compatibility. Earlier prebuild absence and shared-Node24-binding ABI failure remain historical evidence, not current blockers for this bounded cross-version run. Linux cross-version reuse remains separate and unexecuted by this worker.

## Exact successful command recipe

`ROOT24` and `ROOT26` below are the two disposable paths in `paths.json`, each detached at the source commit above. Node binaries are their absolute installed paths, not npm-exec downloads. All environment changes apply only to the command.

```sh
# ROOT26: the single bounded retry after the header-discovery failure
DEVELOPER_DIR=/Library/Developer/CommandLineTools \
PATH=/Users/mnorth/.nodenv/versions/26.12.0/bin:/Library/Developer/CommandLineTools/usr/bin:$PATH \
CC=/Library/Developer/CommandLineTools/usr/bin/clang \
CXX=/Library/Developer/CommandLineTools/usr/bin/clang++ \
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk \
CFLAGS='-isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk' \
CXXFLAGS='-isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk' \
LDFLAGS='-isysroot /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk' \
npm ci --no-audit --no-fund
# ROOT26
PATH=/Users/mnorth/.nodenv/versions/26.12.0/bin:$PATH npm run build:packages
# ROOT24
PATH=/Users/mnorth/.nodenv/versions/24.22.1/bin:$PATH npm ci --no-audit --no-fund
PATH=/Users/mnorth/.nodenv/versions/24.22.1/bin:$PATH npm run build:packages
# Evidence worktree
/Users/mnorth/.nodenv/versions/24.22.1/bin/node \
 scratch/gap-hunt/contract-operations/verify-cross-version.mjs \
 /Users/mnorth/.nodenv/versions/24.22.1/bin/node ROOT24 \
 /Users/mnorth/.nodenv/versions/26.12.0/bin/node ROOT26
```

Install/build/raw runner logs are complete. No paid providers or external application calls were used.
