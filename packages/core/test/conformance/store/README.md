# Store conformance

This documents the existing provisional Store suite. Its legacy SA identifiers
refer to the [archived core draft](../../../../../docs/archive/pre-consolidation/source/core-package-spec.md),
not the current target architecture. Start new backend work from the
[active execution contract](../../../../../docs/spec/execution.md).

`storeConformance(name, options)` registers Jest tests without importing a backend.
Each test receives a fresh store; the suite closes it afterwards. Compile the test
modules as ESM before running Jest, as the workspace's `test:unit` command does.
Consumers of the test subpath install Jest 30 and `@jest/globals`; the normal
package entry point does not load the test dependency.

```ts
import { storeConformance } from 'microdelta/conformance/store';

storeConformance('custom backend', {
  fingerprintAlgorithm: 'sha256',
  create: (options) => openTestDatabase(options),
  probeValueReads: (store) => instrumentationFor(store),
});
```

The factory's optional `fingerprintAlgorithm` argument sets up an open with
incompatible fingerprint metadata. A factory must exercise its real open-time
compatibility check and reject with `FingerprintAlgorithmMismatchError`; the
factory must not manufacture the expected exception itself. Normal opens report
schema version 1 and the suite's supplied runtime algorithm. For a durable backend,
seed the stored algorithm and open against the runtime algorithm. A fixed-format
in-memory backend may exercise the inverse: retain its fixed metadata and request
an incompatible runtime algorithm.

The optional value-read probe has `reset()` and `count()` methods. Count actual
value reads or deserializations inside the backend, not calls to `getFields` made
by the suite. The probe is reset after insertion. `getFingerprints` must leave its
count at zero for both small and large payloads; a subsequent `getFields` must
increase the count, proving the probe is connected. Without a probe this one test
is explicitly skipped, so a green run alone does **not** qualify SA-3. Any qualifying
backend must provide a probe; a future SQLite backend must additionally verify its SELECT excludes
the value column. Timing alone is insufficient evidence for the no-value-read
guarantee.

## Proposed clarifications to the draft storage contract

These describe the existing baseline suite, derived from the archived core draft
§4.6, without establishing the new publication lifecycle:

- `SubjectPatch` excludes `key` and `version`; `GenerationPatch` excludes `key` and
  `generation`. Runtime attempts to supply these properties reject with
  `InvalidStorePatchError`, including structurally assignable objects with extra
  properties. A rejected patch changes nothing.
- `updateGeneration` rejects an absent tuple with `MissingRowError`; updates never
  create generations implicitly.
- `putFields` is insert-only and atomic over its supplied batch. An address already
  stored or repeated within the batch rejects with `DuplicateRowError`, leaving
  the entire batch unchanged. This realizes rev 9 §2.7's immutable stored values.
- Every successful CAS increments the supplied stored version exactly once,
  including an empty patch. Stale or absent rows return false without mutation.
- Versions are nonnegative safe integers. Inserting an invalid version or advancing
  an exhausted `Number.MAX_SAFE_INTEGER` token rejects with `RangeError`. This
  prevents two contenders from succeeding against a token that cannot increment.
- All inserted data, nested patch data, and returned rows are detached snapshots.
  Mutating a caller-owned object cannot modify a retained generation or progress.
- Missing read addresses are omitted; lists are scoped to the complete tuple.
  Generation-list ordering is deliberately unspecified. Expiry ordering follows
  SA-4 exactly, and a zero limit returns no rows.

## Scope of qualification

The 64-way CAS test is the SA-1 qualifying operation. The suite also checks
concurrent insert-only subject/generation writes, all-or-nothing field batches,
tuple-boundary collision isolation, independent generation numbering, strictly
expired read-only lease queries, copy isolation, and algorithm compatibility.

The Store interface offers no atomic operation spanning a subject CAS and a
generation write. Passing these tests therefore does not establish crash-safe
claim publication, release, or sweep bookkeeping across those rows. Those design
questions remain explicit blockers for the claim/repository layer. This suite
does not implement or infer lifecycle transitions, retries, or provider recovery.

The memory backend snapshots using V8 serialization. Raw shared buffers and
unsupported serializable values reject before mutation; shared buffer views are
copied into private storage. Memory-specific regressions verify this because
`structuredClone` alone shares raw SharedArrayBuffer memory across snapshots.
This codec is not the final canonical fingerprint format or a cross-version disk
format. Choosing the supported fingerprint domain remains a separate decision.
