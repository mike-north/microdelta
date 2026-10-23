# #158 pickup addendum: accurate durable native prerequisites

Conservative pickup scope: documentation and metadata checks only. A durable consumer must distinguish the facade's advertised Node>=20 from the pinned driver's declared20/22/23/24/25 support. No engine-range change, driver switch or Node26 support expansion is authorized by this addendum. Those require an owner design decision and runtime conformance evidence.

Numbered acceptance criteria:

1. Correct root/facade/example guidance to state the native durable backend prerequisite, the pinned driver's declared range and the separately tested versions. Do not describe every major>=20 as supported or imply public memory-store compatibility proves durable support.
2. Explain native prebuild/build prerequisites and link #157's targeted pnpm approval recipe. The current adapter uses better-sqlite3 unconditionally; built-in node:sqlite is not a fallback.
3. Add a deterministic metadata check that surfaces the broad facade/machine range versus pinned native range without changing either range as a hidden fix. Keep published metadata and current checkout observations distinct.
4. Negative evidence stays bounded: Node26 macOS source build reached a host-specific SDK linker failure after headers downloaded successfully. Do not claim missing headers, universal Node26 failure, lost data or verified cross-version durable reuse.
5. Preserve public memory and supported-node durable smoke controls; any future runtime support change is separately designed/tested rather than smuggled into this documentation task.

Clean evidence-checkout Linux command (repository root):

```sh
node scratch/gap-hunt/contract-operations/verify-158.mjs
```

Prerequisites: Node/npm and network/npm registry access. This self-contained metadata runner executes no native install and is portable to Linux; a successful run is metadata evidence only, not Linux/native execution proof. It pins the published package versions, reads local manifests and asserts the mismatch. Preserve its outcome when adding the eventual repository check. Scripts reside on the worker evidence branch and must be included in the evidence checkout; they are not claimed present on main.

Dependencies: coordinate documentation with #157. Out of scope: engines changes, driver upgrade/replacement, built-in SQLite adapter, release automation, Node26 expansion or a cross-version full-store portability claim. If accurate wording cannot be chosen without changing runtime policy, return the concrete policy choice to the owner rather than broadening implementation.

The published releases are immutable evidence, not manifests this pickup can edit. New documentation/checks must distinguish existing published metadata from future support-policy changes.
