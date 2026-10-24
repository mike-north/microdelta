# Native SQLite toolchain: bounded evidence

The [consumer guide](../native-sqlite-toolchain.md) applies these observed
results to diagnosis without changing runtime or support policy. Its checked-in
[`diagnose-158-native.mjs`](../../scratch/gap-hunt/contract-operations/diagnose-158-native.mjs)
is byte-identical to `gap-hunt-durability@faa7d2563945374b75cbd5b239a82df4e17a334d`
(SHA-256 `05062901824f478b0ca4a25b6c1f2ce101cd76e2f8c0b9169a3d4012b97953a4`).
It pins `better-sqlite3@12.9.0`, removes its temporary external consumer, and
reports actual child install and smoke statuses. Its outer exit 0 only means
the diagnostic finished.

## Preserved Node 26 and Linux sources

The [macOS arm64 Node 26.12.0 CLT report](https://github.com/mike-north/microdelta/blob/6d3f3f3533d75ea42be226edbd7e3932b974f447/scratch/gap-hunt/contract-operations/node26-clt/REPORT.md)
records a source build after no matching prebuild: Node header downloads
succeeded, but the local SDK linker could not read `.tbd` stubs. A first
command-local CLT selection failed separately at `stdio.h` discovery. The
consistent absolute CLT compiler/linker/SDK retry built the locked driver and
passed native open/query/close. The [clean diagnostic replay](https://github.com/mike-north/microdelta/blob/faa7d2563945374b75cbd5b239a82df4e17a334d/scratch/gap-hunt/contract-operations/node26-clt/DIAGNOSTIC-158.md)
recorded install and smoke child statuses 0 on that Node 26.12.0 host. Neither
result changes the driver's declared engine range.

The [owner-supplied Linux aarch64 report](https://github.com/mike-north/microdelta/blob/e475049c3f858c270791581fb77f925e761363ce/scratch/gap-hunt/contract-operations/owner-linux-parity.md)
and [provenance](https://github.com/mike-north/microdelta/blob/e475049c3f858c270791581fb77f925e761363ce/scratch/gap-hunt/contract-operations/LINUX-PROVENANCE.md)
record independent native installs/builds and full `npm test` passing for main
`c5802daca4a0bb8ea91159854d84eddcfa5215b6` on Node 24.13.0 and
26.12.1. These are supplied devbox results, not reruns by this implementer.
The report did not test pnpm approval or Linux cross-version same-store reuse.

## Current disposable Node 24 host probe

This implementation host exposed Node 24.14.0 / npm 11.18.0 on Darwin arm64
and had no local Node 26 installation. To get a current native install/open
observation without changing the checked-in pinned fixture, an ephemeral
`/private/tmp/issue158-native-node24-probe.mjs` copy changed only the version guard
from `startsWith('26.')` to `startsWith('24.')`. The one-line diff was checked
before execution. The adapted copy has SHA-256
`700f7cc4f4e76fc7d4edd9bdc2a9f19031e2637509cef852eaa1a5335517301c`.
It is not a Node 26 test and is not offered as the pinned fixture's unchanged
replay. The exact temporary transformation and observed diff were:

```sh
sed "s/startsWith('26.')/startsWith('24.')/" \
  scratch/gap-hunt/contract-operations/diagnose-158-native.mjs \
  > /private/tmp/issue158-native-node24-probe.mjs
diff -u scratch/gap-hunt/contract-operations/diagnose-158-native.mjs \
  /private/tmp/issue158-native-node24-probe.mjs
```

```diff
-if(!process.versions.node.startsWith('26.'))throw new Error('Select Node26 on PATH for this pinned native diagnostic');
+if(!process.versions.node.startsWith('24.'))throw new Error('Select Node26 on PATH for this pinned native diagnostic');
```

The unchanged error text applies only if that temporary copy is run under an
unselected Node version; it did not affect the Node 24 observation. The run
used a task-local npm cache and preserved no installed consumer:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN \
  NPM_CONFIG_CACHE=/private/tmp/issue158-native-npm-cache \
  node /private/tmp/issue158-native-node24-probe.mjs \
  > /private/tmp/issue158-node24-result.json
```

The outer command exited 0. The [captured JSON](native-sqlite-node24-probe-2026-10-23.json)
(SHA-256 `c9bd9bfa1e527269d9c6f256648ec6f6d715d5fbf1fb7f39141017e93b900ed7`)
reports `install.status` 0 and `smoke.status` 0 with
`native-sqlite-open-query-ok`. npm also emitted an `allow-scripts` advisory;
the successful smoke establishes a usable binding in this disposable consumer,
but this run does not distinguish a prebuilt binding from a source build. It
does not test microdelta's full suite, Node 26, or cross-version store reuse.
