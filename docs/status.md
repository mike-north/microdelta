# Project status and limits

This page holds the current support boundaries so the [README](../README.md)
can describe what microdelta does. Each statement here is a limit, not a plan.
Owning contracts and dated evidence records are linked where they exist.

## Maturity

microdelta is **experimental**. The repository implements a bounded durable
runtime, keyed composition and operational controls, verified through the
milestone records linked from [milestones](milestones.md). No M6 or later
milestone is complete. Treat the example and the accepted checkpoints as
evidence for the shapes they exercise, not as a guarantee that arbitrary
analyses are safe.

## API surfaces

- **Public entry.** The default `microdelta` export is the compatibility
  History Store API (`createMemoryStore` and the row Store types). It is
  process-local and non-durable. It is not the analysis API the README
  describes.
- **Analysis authoring and workspace.** `authoring()`, `openWorkspace` and
  the run, recovery, stop, environment and accounting surfaces are
  **project-private alpha**. They are reachable only through the workspace's
  generated alpha declarations, and breaking changes are expected. The
  [facade guide](../packages/core/README.md) lists the names.
- **Published packages.** The historical `0.1.0` and current `0.2.0`
  publications are recorded in the
  [first-release record](validation/first-release-2026-09-28.md). Publication
  does not make the alpha authoring API a supported public contract.
  `@microdelta/accounting` is a workspace-private package supplied through an
  injected port.
- **A proposed authoring DSL** (`analysis` / `memo` / `from`) is under design
  in [issue 176](https://github.com/mike-north/microdelta/issues/176) and the
  [authoring-experience plan](plans/authoring-experience.md). It is not
  implemented or adopted.

## Runtime guarantees and their bounds

- **Durability evidence is bounded** to one fenced writer per store on
  single-host SQLite, including process kill and restart tests. It does not
  establish distributed operation, power-loss safety, lease-wait fairness or
  production readiness. See [execution](spec/execution.md) and the
  [M5 record](validation/m5-2026-10-01.md).
- **Multi-writer parallelism, the general CLI, the read-only inspection
  checkpoint, full workflow and scale acceptance, and real-provider
  acceptance are not delivered.** Each is a later milestone in
  [milestones](milestones.md).
- **The acquisition retry and rate target** accepted on 2026-10-24
  ([data-acquisition retries](plans/data-acquisition-retries.md)) supersedes
  the M5 replay policy on paper only. The runtime still implements the M5
  behavior until the open implementation issues land.
- **Nullable-container guards**
  ([issue 155](https://github.com/mike-north/microdelta/issues/155)) retain
  bounded kind evidence across restarts. Upgrading past that change
  invalidates earlier computation evidence and may recompute prior work; exact
  historical results and operation journals remain readable. See the
  [tracking evidence compatibility boundary](spec/execution.md#reuse-001--reuse-is-a-current-contextual-decision).

## What the runtime tracks and what it does not

- Tracked reads record the facts a step consumes. Called-implementation
  evidence is recorded automatically. Authors remain responsible for declaring
  external influences: mutable closure state, hidden I/O and arbitrary
  JavaScript operations are not made safe by function-source tracking. See
  [tracking](spec/tracking.md).
- Tracking and memoization are separate. Authoring a tracked helper does not
  retain its result.
- **Supported values are constrained.** Plain records and arrays are the
  result-root shapes. Cyclic or shared references, accessors, `Date`, `Map`,
  `Set` and class instances are rejected. See
  [supported values](spec/tracking.md#structured-addresses-and-fingerprints).

## Platform and installation

- **Node.js 24** and npm from a repository checkout are the tested path.
- The durable path uses the native `better-sqlite3` dependency. If no
  prebuilt binary matches, a native build toolchain is required. Do not assume
  every newer Node version is supported by that dependency. The
  [native toolchain guide](native-sqlite-toolchain.md) records qualified
  evidence and a host diagnostic; the
  [native install guide](native-sqlite-install.md) covers pnpm external
  consumers of the published `0.2.0`. The public memory Store needs neither.
- Store paths are canonicalized. Distinct hard-linked names must not be used
  concurrently for one WAL database. See
  [native store locations](native-store-locations.md).

## Where to look next

- [Package map](package-map.md): what each package implements today.
- [Specification](spec/README.md): the active design authority, with status
  notes per milestone.
- [Validation records](validation.md): dated evidence, not fresh runs.
