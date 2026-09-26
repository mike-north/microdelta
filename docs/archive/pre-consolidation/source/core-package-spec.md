> Historical artifact. Superseded by the [active specification](../../../spec/README.md). Do not implement from this document.

# Core package specification

2026-09-12. **Job:** draft. **Artifact:** the specification of the `core` package — twelve components, their interfaces, invariants, and validation — for the implementing agent. **Shape:** architecture-heavy (components, composition, interfaces, failure handling, examples, validation), adapted to this project's conventions: rev 9's numbered sections, layer tags, SC/ST/S references, and a graveyard.

**Governing sources, in precedence order:**

1. `incremental-analysis-deep-design-rev9.md` — settled semantics. §2.1–2.7 (core), §3 (contracts), §6.5–6.7 (claims, leases, failure), §11 (SC), §12 (ST), Appendix (S). Where this spec and rev 9 disagree, rev 9 wins and this spec is wrong.
2. `incremental-analysis-components.md` — component boundaries, dependency graph (§6), sequencing (§8).
3. `analysis-explorer-viewer-sketch.md` — a consumer; constrains only `materialize`'s loader (§5) and the tracking façade (§6).

**Tag legend for rules in this document:**

- **[settled]** — restates a rev 9 decision; the rev 9 section is cited. Not up for revision here.
- **[proposed]** — a decision this spec makes because deep-design deliberately deferred it (API surface, schemas, error names, defaults). Normative unless Mike vetoes; each one is small enough to reverse in isolation.
- **[assumption]** — a bounded assumption made to avoid blocking; labeled so it can be checked.
- **[deferred]** — out of scope for this spec; where it goes is stated.

Every substantive rule has an identifier (`NM-1`, `FP-2`, …) and a **Validation** line naming the assertion, fixture, or diagnostic that checks it. A rule without one is underspecified and should be raised, not implemented.

---

## 1. Why this package exists, and its boundary

The thesis, from rev 9 §1: *pull-based autotracking over durably identified results, where the author decides — per function — whether it recalculates every time or is stored, so that an analysis stays current at minimum cost, and can be explored.*

`core` is the smallest package that makes that sentence true. It contains the twelve components of `components.md` §3 and nothing else.

**In scope:** `name`, `fingerprint`, `identity`, `track`, `middleware`, `store` (with the in-memory and SQLite defaults), `trace`, `repository`, `claim`, `materialize`, `wrapper`, `explain`.

**Out of scope, with destination:**

- `fanOut` / `fanIn`, concurrency, permits, partition hints, work stealing → `helpers` spec. [deferred]
- The React bridge, client routing table, stream transport → `react` adapter spec and the viewer. [deferred]
- Retry, provider timeouts, rate pacing → the author's body or `helpers` (rev 9 §4, §6.6). **Never core.** [settled]
- Detecting what is expensive, cost classes, freshness policies, a scheduler → nowhere (rev 9 §2.2, graveyard). [settled]

**Preserved behavior:** none — this is a new package. **Non-goals** are the rev 9 graveyard (§15); an implementation that reintroduces any entry there has broadened scope.

**Runtime assumption.** [assumption] Node.js ≥ 20, TypeScript, ESM. `AsyncLocalStorage` is available and is the mechanism for ambient execution context (§4.11). Server-side only; no bundler/minifier is in the build (rev 9 §7 hazard on renamed functions). If a bundler is ever introduced, `name` overrides become mandatory for memoized steps.

**Package identity (current override).** The repository and core package use `microdelta`. This archived draft's earlier name rationale and registry availability notes were superseded by the later identity decision. `@microdelta/helpers` and `@microdelta/react` remain proposed future packages; this draft does not authorize publishing them.

---

## 2. Package layout and the dependency rule

```
packages/core/
  src/
    name/          # 4.1
    fingerprint/   # 4.2
    identity/      # 4.3
    track/         # 4.4  (façade over an adopted tag library, or a minimal implementation)
    middleware/    # 4.5
    store/         # 4.6  interface + memory/ + sqlite/
    trace/         # 4.7
    repository/    # 4.8
    claim/         # 4.9
    materialize/   # 4.10
    wrapper/       # 4.11
    explain/       # 4.12
    index.ts       # public surface = wrapper's API + types + store defaults + explain
  test/
    conformance/store/   # the suite every Store implementation must pass (4.6)
    threads/             # ST0–ST3, ST7, ST9, ST16 as integration tests (§7)
```

**DR-1 (dependency rule).** [proposed] Each module may import only from the modules listed as its dependencies in `components.md` §6. Enforced by an ESLint `no-restricted-imports` (or `dependency-cruiser`) config checked in CI. A new edge requires editing the config, which makes the graph change visible in review.
*Validation:* CI lint job; a test that the config matches `components.md` §6's adjacency list.

**DR-2.** `wrapper` contains no rule of its own (components §3.11). Any conditional in `wrapper` that is not "which middleware to instantiate" or "which frame to install" is a defect.
*Validation:* review checklist; `wrapper`'s unit tests are only the steel threads.

---

## 3. Shared types

Defined once in `core/src/types.ts`; every component imports from here rather than redefining.

```ts
/** Opaque, stable, hex-encoded. Equality is string equality. */
export type Fingerprint = string & { readonly __fp: unique symbol };

/** A path from a value's root to a node: dotted keys and bracketed indices. "" is the root. */
export type Path = string;               // "", "body", "sections[3].title"

/** Identity is structure, stored readably, indexed by hash. (rev 9 §2.3, §2.5) */
export type Identity =
  | { kind: "type"; type: string; key: string }                        // declared identity function
  | { kind: "step"; name: string; inputs: readonly Identity[] }        // named step over identified inputs
  | { kind: "member"; of: Identity; path: Path }                       // unidentified member of an identified value
  | { kind: "collection"; step: string; source: Identity };            // fan-out output (used by helpers; defined here)

/** The subject of a memoized execution: the step's name plus the identities it was given. */
export type Subject = Extract<Identity, { kind: "step" }>;

export type ResultKey = {
  step: string;
  revision: number;
  subjectHash: string;                   // hash of the Subject structure; Subject stored alongside
};

/** One recorded read. Addresses are relative to the execution's arguments. (rev 9 §2.4) */
export type RecordedRead =
  | { kind: "field"; arg: number; path: Path; fingerprint: Fingerprint }   // grain = the node at path
  | { kind: "whole"; arg: number; fingerprint: Fingerprint }               // whole-grain read of an argument
  | { kind: "memo"; key: ResultKey; generation: number };                  // nested memoized call

export type GenerationState = "claimed" | "current" | "superseded" | "abandoned";

export type Outcome =
  | { kind: "served";    key: ResultKey; generation: number }
  | { kind: "executed";  key: ResultKey; generation: number }
  | { kind: "checked";   key: ResultKey; wouldExecute: boolean; divergence?: Divergence }  // dry run
  | { kind: "refused";   key: ResultKey; reason: unknown }
  | { kind: "failed";    key: ResultKey; error: unknown }
  | { kind: "abandoned"; key: ResultKey; reason: "error" | "lease-expired" | "refused" }
  | { kind: "ran" };                     // unmemoized named step: no key

export type Divergence =
  | { read: RecordedRead; was: Fingerprint; now: Fingerprint | "missing" }
  | { read: Extract<RecordedRead, { kind: "memo" }>; nested: Divergence };
```

**TY-1.** [settled, rev 9 §2.3] `Subject` is *identities only*. Unidentified arguments do not appear in the subject; they are recorded reads (`kind: "whole"` or `"field"`), verified by fingerprint. A memoized step given no identified arguments has subject `{ kind: "step", name, inputs: [] }`.
*Validation:* S32 — a model-version string argument changes; the subject is unchanged; a new generation supersedes the old.

**TY-2.** [proposed] `inputs` is in argument order. Reordering a memoized function's parameters is a body change and requires a revision bump, exactly like any other body change.
*Validation:* fixture with swapped parameter order produces a different `subjectHash`; documented under hazards.

---

## 4. Components

Each section: purpose (one line), interface, rules, examples with what they prove, validation.

### 4.1 `name`

**Purpose.** Derive a step's name from what the author already declared; report absence; never invent.

```ts
export function nameOf(fn: Function, override?: string): string | undefined;
```

**NM-1.** [settled, rev 9 §0.1, SC20] The name is `override` if given, else `fn.name` if it is non-empty and not a synthetic name (`"anonymous"`, `""`, names TypeScript emits for default exports such as `"default"`). Otherwise `undefined`. `name` never throws; the *caller* decides whether absence is fatal.
*Validation:* `nameOf(function build(){})` → `"build"`; `nameOf(class Report{})` → `"Report"`; `const f = () => {}; nameOf(f)` → `"f"` (inferred); `nameOf(() => {})` → `undefined`; `nameOf(() => {}, "x")` → `"x"`; `nameOf(function(){}.bind(null))` → `undefined` (bound names start with `"bound "`, treated as synthetic).

**NM-2.** [proposed] `name` exports the list of synthetic names it rejects, so the lint configuration and the tests share one source.
*Validation:* the exported list is what NM-1's fixtures iterate over.

**Design note.** The library ships no lint rule (rev 9 §0.1). The README's authoring section names the ecosystem rule that catches anonymous function expressions and recommends enabling it for any file that calls `memo`.

### 4.2 `fingerprint`

**Purpose.** Content → fingerprint at two grains, such that whole-grain equality proves field-grain equality.

```ts
export type FieldFingerprints = ReadonlyMap<Path, Fingerprint>;   // includes "" for the root

export function fingerprintValue(value: unknown): Fingerprint;      // whole grain
export function fingerprintFields(value: unknown): FieldFingerprints; // every node, recursively
export function canonicalize(value: unknown): CanonicalBytes;        // exported for tests and store
```

**FP-1 (two grains, one derivation).** [settled, rev 9 §2.1] A node's fingerprint is computed from its own leaf content or from the ordered fingerprints of its children plus their keys. Therefore `fingerprintValue(v) === fingerprintFields(v).get("")`, and if two values have equal root fingerprints, every path has equal fingerprints.
*Validation:* property test — for random nested values, root equality ⇒ every-path equality; changing one leaf changes exactly the fingerprints on the path from that leaf to the root and no others.

**FP-2 (canonical form).** [proposed] Canonicalization: object keys sorted; arrays ordered; numbers as shortest round-trip decimal; `-0` as `0`; strings as UTF-8; `null`, booleans tagged; `undefined` properties omitted; `Date` as tagged ISO-8601; `Map`/`Set` as tagged sorted entries; `BigInt` tagged decimal. Everything else (functions, symbols, class instances with non-enumerable state, cyclic graphs) is a `NonFingerprintableError` at the point of use.
*Validation:* golden fingerprints checked into the repo (a change to canonicalization is a breaking change and must fail this test); `{a:1,b:2}` and `{b:2,a:1}` equal; a cyclic object throws with the path in the message.

**FP-3 (algorithm).** [proposed] BLAKE3 if available, else SHA-256; 32 bytes; hex. Algorithm identifier is stored in the store's metadata row (4.6) so a future change is detectable rather than silent.
*Validation:* store conformance checks that the metadata algorithm matches the runtime's.

**FP-4.** [settled, rev 9 §2.4] `fingerprint` performs no I/O and knows nothing about steps, stores, or identity.
*Validation:* DR-1 (no imports).

**Example — what FP-1 buys.** A PR record with 40 fields; a downstream step read `createdAt` only. On the next run the store compares the recorded fingerprint of `createdAt` to the stored one — two strings — and loads nothing. A step that read the whole PR compares one root fingerprint. *Proves:* the price of verification is proportional to the grain read, not the size of the value.

### 4.3 `identity`

**Purpose.** Resolve and compose identities; hash them for indexing; the one rule on its own axis.

```ts
export interface TypeToken<T> {
  readonly type: string;
  readonly identity?: (value: T) => string;   // canonical stable key
}
export function defineType<T>(type: string, opts?: { identity?: (v: T) => string }): TypeToken<T>;

/** Identity of a produced value. `token` is the producing step's declared output type, if any. */
export function identityOf(args: {
  value: unknown;
  token?: TypeToken<unknown>;
  producer?: { name: string; inputs: readonly Identity[] };   // a named step; absent for unnamed code
  derivedFrom?: readonly Identity[];                           // identities read while deriving (unnamed code)
}): Identity | undefined;

export function memberIdentity(of: Identity, path: Path): Identity;      // { kind: "member" }
export function subjectOf(step: string, argIdentities: readonly (Identity | undefined)[]): Subject;
export function hashIdentity(id: Identity): string;                      // stable structural hash
```

**ID-1 (resolution order).** [settled, rev 9 §0.2(1), §2.1] Exactly one rule, applied regardless of whether the producer is memoized:
1. if `token.identity` is declared → `{ kind: "type", type, key: token.identity(value) }`;
2. else if `producer` is a named step → `{ kind: "step", name: producer.name, inputs: producer.inputs }`;
3. else if `derivedFrom` is non-empty → the identity composed from what was read: a single source passes through unchanged (a reshape of a PR *is* that PR); multiple sources compose as `{ kind: "step", name: "", inputs: derivedFrom }` [proposed: empty name marks unnamed composition];
4. else `undefined` — the value is content.
*Validation:* a fixture per branch; the same fixtures run with `memoized: true` and `false` on the producing step and produce identical identities (the axis test).

**ID-2 (identity forks; content bumps).** [settled, rev 9 §4, S12, S32, S45] Two arguments with different identities produce different subjects. The same identity with different content produces the same subject; the content difference is a recorded read and produces a new generation.
*Validation:* S12 (experiment vs production fork) and S45 (edited rubric supersedes) as unit tests over `subjectOf` plus a fake `trace` verdict.

**ID-3 (members).** [settled, rev 9 §2.1] `memberIdentity(prIdentity, "title")` is `{ kind: "member", of: prIdentity, path: "title" }`. Members of an unidentified value have no identity.
*Validation:* unit test; `memberIdentity` on `undefined` is a type error.

**ID-4 (brackets).** [settled, rev 9 §2.5] A `collection` identity is `member step + source collection identity`; a reducer's subject is `{ kind: "step", name: reducer, inputs: [collectionIdentity] }` — members never appear in it. The `collection` kind is defined here and *constructed* only by `helpers`.
*Validation:* a unit test that builds `Engineer → PR → review → paragraph` and asserts depth 4 at the paragraph and depth 2 at the reducer over paragraphs (rev 9 §2.5's example).

**ID-5 (hash).** [proposed] `hashIdentity` = fingerprint (4.2) of the canonical structure. Collision handling: none beyond the hash width; the structure is stored alongside for explanation and for disambiguation if ever needed.
*Validation:* stable across process restarts (golden values).

**ID-6 (type tokens and erasure).** [proposed] TypeScript erases types, so the "type system relates a step's output type to its identity function" (rev 9 §2.1) is realized by the `returns: TypeToken<T>` option on `step`/`memo` (4.11) being typed as `TypeToken<ReturnType<fn>>`. Two steps returning `PR` must pass the same token; passing a token whose `T` does not match the function's return type is a compile error.
*Validation:* a `tsd`/`expect-type` test that a mismatched token fails to compile.

**Example — why the name is on its own axis.** `reshape(pr)` returns `{ title: pr.title, age: … }`. Unnamed: its identity is `pr`'s (ID-1 rule 3, single source). Wrapped with `step(reshape)`: its identity is `{ step: "reshape", inputs: [pr] }`. Wrapped with `memo(reshape, { revision: 1 })`: the *same* identity as the `step` case — the store is irrelevant to it. *Proves:* the axis principle holds in the implementation, not only in the prose.

### 4.4 `track`

**Purpose.** Process-local reactivity: tags, frames, entanglement, in-process memoization. A façade so the underlying library is replaceable.

```ts
export interface Tag { readonly __tag: unique symbol }
export type Revision = number;

export function createTag(): Tag;
export function consume(tag: Tag): void;                    // entangle with the current frame
export function dirty(tag: Tag): void;                      // bump
export function snapshot(tags: Iterable<Tag>): Revision;    // max revision across tags
export function isValid(tags: Iterable<Tag>, at: Revision): boolean;

/** Run fn in a fresh frame; return its result and every tag consumed. */
export function withFrame<T>(fn: () => T): { value: T; consumed: ReadonlySet<Tag> };
export function withFrameAsync<T>(fn: () => Promise<T>): Promise<{ value: T; consumed: ReadonlySet<Tag> }>;

/** Consumer-facing primitives (viewer sketch §2, rev 9 §2.7). */
export function cell<T>(initial: T): { get(): T; set(v: T): void };
export function derived<T>(fn: () => T): { get(): T };      // memoized until a consumed tag moves
```

**TK-1.** [settled, rev 9 §2.7, SC21] Nothing exported here is ever serialized or written to the store. `track` has no dependency and no I/O.
*Validation:* DR-1; a test that no `track` type appears in any `store` row schema (a type-level `never` assertion over the row types).

**TK-2 (async frames).** [proposed] Frames are carried by `AsyncLocalStorage`, so a read after an `await` inside the same execution entangles with that execution's frame. Concurrent executions in one process have disjoint frames.
*Validation:* two interleaved async executions each consume only their own reads.

**TK-3.** [settled] Entanglement is on *read*; nothing declares dependencies.
*Validation:* `derived` recomputes iff a consumed cell was set; a cell read in a branch not taken does not entangle.

**Design note.** If an existing library is adopted, this module is the adapter; its tests are the façade contract above, not the library's. OQ8 (whether `derived`'s in-process memoization earns its keep) is measured with the façade in place and does not change the interface.

### 4.5 `middleware`

**Purpose.** The stack mechanism only: reserved positions, regions, stop-on-no-next, inspection.

```ts
export type Next = () => Promise<Outcome>;
export type Middleware<Ctx> = (ctx: Ctx, next: Next) => Promise<Outcome>;
export type Region = "around" | "gate";

export interface StackSpec<Ctx> {
  /** Library positions in order; each is { name, fn }. Immovable, visible. */
  reserved: ReadonlyArray<{ name: string; fn: Middleware<Ctx>; region?: Region /* a user region sits *before* this position */ }>;
}
export interface Stack<Ctx> {
  use(region: Region, mw: Middleware<Ctx>, opts?: { name?: string }): void;
  inspect(): ReadonlyArray<{ position: number; name: string; owner: "library" | "user"; region?: Region }>;
  run(ctx: Ctx): Promise<Outcome>;
}
export function createStack<Ctx>(spec: StackSpec<Ctx>): Stack<Ctx>;
```

**MW-1 (immovable block).** [settled, rev 9 §2.6, SC19] Reserved positions are fixed at construction; `use` can only add to a region; there is no API to remove, reorder, or insert between reserved positions.
*Validation:* `inspect()` shows library entries in spec order with user entries only in regions; the type of `Stack` has no removal method (compile-time); ST9's "attempt to reorder" is a test that no such call exists.

**MW-2 (regions are positions).** [proposed] A region is bound to the reserved position it precedes. For the memoized stack (4.11): `around` precedes `verify`; `gate` precedes `claim` (i.e. sits after `verify`). Order within a region is registration order.
*Validation:* registration order preserved in `inspect()`; a gate middleware never observes a call whose verdict was `served` (SC19).

**MW-3 (stop).** [settled, rev 9 §2.6] A middleware that returns without calling `next` produces the outcome it returns. In the `gate` region the returned outcome must be `refused`; returning anything else from a gate without calling `next` is an `InvalidGateOutcomeError`.
*Validation:* a gate returning `{ kind: "refused", reason }` short-circuits and nothing after it runs; a gate returning `served` throws.

**MW-4 (around observes, does not affect).** [settled, rev 9 §2.6] An `around` middleware must call `next` exactly once and return its outcome. The stack verifies both. A violation is a `MiddlewareContractError` reported through the outcome as `failed` *without* any reserved position having run if the violation occurred before `next`.
*Validation:* an `around` that skips `next` → `failed`, store untouched; one that calls `next` twice → error on the second call; one that swaps the outcome → error.

**MW-5 (containment).** [settled, rev 9 §2.6] A user middleware that throws is caught by the stack, reported as `failed` with the error, and — because reserved positions are inside — the store is consistent: if the throw was in `gate`, nothing was claimed; if in `around` after `next` returned, the write already completed.
*Validation:* both cases as tests over a fake reserved block that records its calls.

**MW-6.** [settled] The mechanism has no dependencies and no knowledge of what its middleware do.
*Validation:* DR-1.

### 4.6 `store`

**Purpose.** Rows in, rows out, and one compare-and-set. The demanding leaf.

```ts
export interface SubjectRow {
  key: ResultKey;
  subject: Subject;                       // structure, for explanation
  version: number;                        // CAS token; incremented on every write to this row
  currentGeneration: number | null;
  claim: null | {
    generation: number;                   // the generation row written in state "claimed"
    holder: string;                       // opaque process/task id
    leaseUntil: number;                   // epoch ms
    progress: { fingerprint: Fingerprint; value: unknown } | null;
  };
  durations: number[];                    // recent execution durations, ms; bounded window (4.9 uses it)
}

export interface GenerationRow {
  key: ResultKey;
  generation: number;
  state: GenerationState;
  reads: RecordedRead[];
  identity: Identity | undefined;         // derived identity of the output
  startedAt: number; endedAt: number | null;
  cost: Record<string, number>;           // author-reported, e.g. { usd: 1.2, tokens: 30000 }
  arrival: "batch" | "interactive" | string;   // policy input (viewer sketch §4); free-form string
  abandonReason?: "error" | "lease-expired" | "refused";
  error?: { message: string; stack?: string };
}

export interface FieldRow { key: ResultKey; generation: number; path: Path; fingerprint: Fingerprint; value: unknown }

export interface Store {
  meta(): Promise<{ schemaVersion: number; fingerprintAlgorithm: string }>;

  getSubject(key: ResultKey): Promise<SubjectRow | undefined>;
  putSubject(row: SubjectRow): Promise<void>;                              // insert only
  /** The qualifying operation. Applies `patch` iff the stored version equals `expectedVersion`. */
  casSubject(key: ResultKey, expectedVersion: number, patch: Partial<Omit<SubjectRow, "key" | "version">>): Promise<boolean>;

  getGeneration(key: ResultKey, generation: number): Promise<GenerationRow | undefined>;
  listGenerations(key: ResultKey): Promise<GenerationRow[]>;
  putGeneration(row: GenerationRow): Promise<void>;                        // insert only
  updateGeneration(key: ResultKey, generation: number, patch: Partial<GenerationRow>): Promise<void>;

  putFields(rows: FieldRow[]): Promise<void>;
  getFields(key: ResultKey, generation: number, paths: Path[]): Promise<FieldRow[]>;       // values + fingerprints
  getFingerprints(key: ResultKey, generation: number, paths: Path[]): Promise<Map<Path, Fingerprint>>; // no values

  expiredClaims(now: number, limit: number): Promise<SubjectRow[]>;
  close(): Promise<void>;
}
```

**SA-1 (CAS is the qualifying operation).** [settled, rev 9 §6.5; components §3.6] `casSubject` is atomic per row and linearizable with respect to other `casSubject` and `putSubject` calls on the same key. A backend that cannot provide this does not qualify, regardless of anything else.
*Validation:* conformance test — N concurrent `casSubject` with the same `expectedVersion` on one key: exactly one returns `true`.

**SA-2 (insert-only rows).** [proposed] `putSubject`/`putGeneration` fail on an existing key with `DuplicateRowError`. Generation numbers are allocated by `repository`, not by the store.
*Validation:* conformance test.

**SA-3 (fingerprints without values).** [settled, rev 9 §2.4] `getFingerprints` must not load field values. For SQLite this means fingerprints and values are in separate columns (or tables) and the query selects only the fingerprint.
*Validation:* conformance test with a large value asserts `getFingerprints` completes within a bound independent of value size; SQLite implementation asserts the query plan reads no value column.

**SA-4 (sweep query).** [settled, rev 9 §6.5] `expiredClaims(now, limit)` returns subject rows whose `claim.leaseUntil < now`, oldest first, at most `limit`. It does not modify them; `claim` (4.9) does, via CAS.
*Validation:* conformance test.

**SA-5 (metadata).** [proposed] `meta()` reports schema version and fingerprint algorithm; the runtime refuses to open a store whose algorithm differs from its own (`FingerprintAlgorithmMismatchError`) — a silent mismatch would invalidate everything without saying so.
*Validation:* open a store written with a different algorithm identifier → error.

**SA-6 (defaults).** [settled, rev 9 §3] Two implementations ship: `memory` (tests) and `sqlite` (default on disk). Both pass the same conformance suite. SQLite: WAL mode; `subject` and `generation` tables keyed by `(step, revision, subjectHash[, generation])`; `field` table keyed by `(step, revision, subjectHash, generation, path)` with `fingerprint` and `value` in separate columns; `version` column drives CAS via `UPDATE … WHERE version = ?` and `changes() = 1`.
*Validation:* conformance suite run against both; a schema-migration test from version 1 to 1 (the harness exists before any migration does).

**SA-7 (no semantics).** [settled] The store knows nothing about what `claim`, `currentGeneration`, or `state` mean. It never transitions state on its own.
*Validation:* DR-1; grep-level review that `store/` imports only `types.ts`.

**Design note (OQ4).** Notification instead of polling for claim waits is a future `Store` capability, added as an optional method (`watchSubject`) rather than a change to the required surface. SQLite contention at 150k rows is measured by ST11 against this schema before any tiering is built.

### 4.7 `trace`

**Purpose.** Record reads during an execution; verify a stored read set; report the first divergence.

```ts
export interface RecordingFrame {
  record(read: RecordedRead): void;
  reads(): readonly RecordedRead[];
}
export function withRecording<T>(fn: (frame: RecordingFrame) => Promise<T>): Promise<{ value: T; reads: RecordedRead[] }>;

export interface Resolver {
  /** Current fingerprint of an address, or "missing". For storage-backed args this loads nothing. */
  fingerprintOf(read: Exclude<RecordedRead, { kind: "memo" }>): Promise<Fingerprint | "missing">;
  /** Verify (and if necessary re-evaluate) a nested memoized key; return its now-current generation. */
  resolveMemo(read: Extract<RecordedRead, { kind: "memo" }>): Promise<{ generation: number; divergence?: Divergence }>;
}
export type Verdict = { valid: true } | { valid: false; divergence: Divergence };
export function verify(reads: readonly RecordedRead[], resolver: Resolver): Promise<Verdict>;
```

**TC-1 (verify is a comparison).** [settled, rev 9 §2.4] For each recorded read in order: `field`/`whole` → compare recorded fingerprint to `resolver.fingerprintOf`; `memo` → `resolver.resolveMemo`, invalid if its generation differs from the recorded one. First inequality → `{ valid: false, divergence }` and stop. All equal → valid.
*Validation:* unit tests over a fake resolver: equal → valid; one differing field → divergence names it; a differing nested generation → divergence wraps the nested one.

**TC-2 (a miss is never a change).** [settled, rev 9 §2.4] `"missing"` from the resolver for a `field` read *is* a divergence (the recorded field no longer exists — content changed). But a field the body reads *now* that was not in the recorded set is not a verification concern at all: verification only iterates recorded reads. The prefetch prediction (4.10) handles the unrecorded read.
*Validation:* a body reading a new field on execution records the union; the prior generation's verify never consults it.

**TC-3 (order and short-circuit).** [proposed] Reads are verified in recorded order and verification stops at the first divergence. Recorded order is execution order, which tends to put cheap in-memory reads first. `explain` (4.12) can request a full scan with `verify(reads, resolver, { all: true })` for reporting.
*Validation:* the resolver is a spy; on first divergence no further `fingerprintOf` calls occur.

**TC-4 (memo reads verify recursively — the suspending scheduler).** [settled, rev 9 §14 "suspending scheduler over verifying traces"] Verifying an outer result requires each nested key to be verified first; `resolveMemo` may execute the nested step if it is a miss. The outer result is then compared against the nested key's *current* generation. This is how a chain of memoized steps is verified without running the outer body.
*Validation:* ST3 — three-deep chain; change a leaf input; only the leaf executes; middle and outer are verified against the new generation and re-execute only if the fields they read changed.

**TC-5 (record format is owned here).** [settled] `RecordedRead` is defined in `types.ts`; only `trace` constructs verdicts and divergences. `materialize` calls `frame.record`, `wrapper` installs the frame.
*Validation:* DR-1.

**TC-6 (captured values).** [proposed] A tracked read whose address cannot be expressed relative to the execution's arguments (a tracked value captured from an enclosing scope) is a `CapturedReadError` at record time, with the diagnostic *"pass it as an argument"*. Plain untracked constants are invisible to tracking and are covered by the revision; this is documented as a hazard, not detected.
*Validation:* a memoized body reading a `cell` from closure scope throws with that message; the same cell passed as an argument records a `whole` read.

**Example — what TC-4 proves.** `report(engineer)` calls `summarize(pr)` (memoized) for each PR, then reads `summary.headline`. On re-run with one PR's body changed: verifying `report` reaches the `memo` read for that PR; `resolveMemo` verifies `summarize(pr)` — its recorded read of `pr.body` diverges — so `summarize` executes (through its own stack, gate and claim included) and produces generation 2. Back in `report`'s verification, the recorded `headline` fingerprint is compared with generation 2's. If the headline happens to be identical, `report` is *served*. *Proves:* early cutoff; the outer step is not re-paid because a nested one re-ran.

### 4.8 `repository`

**Purpose.** The result row's meaning: keys, generations, supersession, retention parameters.

```ts
export interface RetentionPolicy {
  keepGenerations: number | "all";                     // per key; "all" is the batch default
  reclaim?: (g: GenerationRow, subject: SubjectRow) => boolean;   // OQ5 hook; default: never
}
export interface Repository {
  current(key: ResultKey): Promise<{ subject: SubjectRow; generation: GenerationRow } | undefined>;
  subject(key: ResultKey): Promise<SubjectRow | undefined>;
  ensureSubject(key: ResultKey, subject: Subject): Promise<SubjectRow>;    // idempotent create
  generations(key: ResultKey): Promise<GenerationRow[]>;
  nextGenerationNumber(row: SubjectRow): number;                              // max existing + 1
  writeCurrent(args: { key: ResultKey; generation: number; fields: FieldRow[]; reads: RecordedRead[]; identity?: Identity; cost: Record<string, number>; arrival: string; startedAt: number }): Promise<void>;
  markAbandoned(key: ResultKey, generation: number, reason: GenerationRow["abandonReason"], cost: Record<string, number>): Promise<void>;
  fingerprints(key: ResultKey, generation: number, paths: Path[]): Promise<Map<Path, Fingerprint>>;
  fields(key: ResultKey, generation: number, paths: Path[]): Promise<FieldRow[]>;
}
export function createRepository(store: Store, policy: RetentionPolicy): Repository;
```

**RP-1 (key).** [settled, rev 9 §2.3] Lookup key is `(step, revision, subjectHash)`; the `Subject` structure is stored on the subject row.
*Validation:* `ensureSubject` twice with the same key returns one row; `subject` field round-trips structurally.

**RP-2 (supersession).** [settled, rev 9 §2.3] `writeCurrent` writes fields, then the generation row in state `current`, then (via `claim`'s release, 4.9) the subject row's `currentGeneration`. The previous current generation is updated to `superseded`. Nothing paid for is deleted by this operation.
*Validation:* two writes → generation 1 `superseded`, generation 2 `current`; both readable; SC17.

**RP-3 (retention).** [settled, rev 9 §2.3; proposed parameters] Default `keepGenerations: "all"`. A `reclaim` predicate, when configured, may delete `superseded` or `abandoned` generations only — never `current`, never `claimed`. Reclamation is an explicit `repository.reclaim(now)` call, never a side effect of a write.
*Validation:* a predicate returning `true` for everything still leaves `current` and `claimed` rows; `writeCurrent` never triggers it.

**RP-4 (abandoned keeps cost).** [settled, rev 9 §2.3, SC16] `markAbandoned` records the reason and whatever cost was reported; the row is retained.
*Validation:* S34.

**RP-5 (schema owner).** [settled; components §3.8] `repository` owns the row types' meaning; `claim` writes only the `claim` and `durations` members of `SubjectRow`, through `casSubject`.
*Validation:* review; a type test that `claim`'s patch type is `Pick<SubjectRow, "claim" | "durations" | "currentGeneration">`.

### 4.9 `claim`

**Purpose.** The lifecycle on one key: acquire, extend by progress, release, wait, sweep.

```ts
export interface Held { kind: "held"; row: SubjectRow }                       // someone else holds it
export interface Acquired {
  kind: "acquired";
  key: ResultKey; generation: number; holder: string;
  extend(progress: unknown): Promise<void>;                                  // rejects an unchanged value
  release(outcome: { kind: "current"; durationMs: number } | { kind: "abandoned"; reason: GenerationRow["abandonReason"] }): Promise<void>;
}
export interface ClaimKeeper {
  acquire(key: ResultKey, opts: { holder: string; leaseMs?: number }): Promise<Acquired | Held>;
  waitFor(key: ResultKey, opts?: { pollMs?: number; deadlineMs?: number }): Promise<"resolved" | "released">;
  sweep(now?: number): Promise<{ swept: ResultKey[] }>;
  leaseFor(row: SubjectRow): number;                                          // derived from durations
}
export function createClaimKeeper(store: Store, repo: Repository, opts?: ClaimOptions): ClaimKeeper;
```

**CL-1 (acquire is one CAS).** [settled, rev 9 §6.5] `acquire` reads the subject row (creating it via `repository.ensureSubject` if absent), then `casSubject(key, row.version, { claim: {...} })` with `claim === null` as the logical precondition (encoded by the version). Success → `Acquired` and a generation row in state `claimed`. Failure → re-read; if a claim now exists → `Held`; if the row changed for another reason → retry the CAS once, then `Held`.
*Validation:* N concurrent `acquire` on one key → exactly one `Acquired`, N−1 `Held` (SC12); the `claimed` generation row exists before `Acquired` resolves.

**CL-2 (lease derivation).** [settled, rev 9 §6.5; proposed constants — OQ7] `leaseFor(row)`: if `durations` is empty → `ClaimOptions.firstRunLeaseMs` (proposed default 10 min); else `ClaimOptions.leaseMultiplier` (proposed 3) × the p95 of `durations`, clamped to `[minLeaseMs, maxLeaseMs]` (proposed 30 s, 6 h). All four are options; the defaults are placeholders until OQ7 is measured.
*Validation:* unit tests over synthetic `durations`; options honored.

**CL-3 (extend requires progress that differs).** [settled, rev 9 §6.5, S36, S37] `extend(progress)` fingerprints the value; if equal to the fingerprint on the row → `ProgressNotAdvancedError`, lease unchanged. Else CAS the row with the new progress and `leaseUntil = now + leaseFor(row)`. No history is kept on the row.
*Validation:* S37 — a `setInterval` calling `extend("working")` fails on its second tick; S36 — page-numbered progress extends each time.

**CL-4 (release).** [settled, rev 9 §6.5] `release({ kind: "current", durationMs })` CASes the row: `claim: null`, `currentGeneration: generation`, `durations` appended (bounded window, proposed 20), and updates the previous current generation to `superseded`. `release({ kind: "abandoned" })` CASes `claim: null` and marks the generation abandoned. Either way the key is open when `release` resolves.
*Validation:* after release, a fresh `acquire` succeeds; the generation row has the expected state; SC16 "a throwing body releases immediately."

**CL-5 (wait).** [settled, rev 9 §6.5; proposed mechanism — OQ4] `waitFor` polls `getSubject` at `pollMs` (proposed 250 ms, with jitter) until `claim` is null; returns `"resolved"` if `currentGeneration` advanced, `"released"` otherwise (abandoned or swept — the caller then re-verifies and may acquire). The waiter holds no permit and no lease. If the store gains `watchSubject`, `waitFor` uses it; the signature does not change.
*Validation:* a held claim released as `current` → waiter gets `"resolved"`; released as `abandoned` → `"released"`; a swept claim → `"released"`.

**CL-6 (sweep).** [settled, rev 9 §6.5] `sweep` calls `expiredClaims`, and for each row CASes `claim: null` and marks the claimed generation `abandoned` with reason `lease-expired`. A CAS failure on a row (the holder released or extended concurrently) is skipped, not retried — it is no longer expired. The runtime runs `sweep` on `ClaimOptions.sweepIntervalMs` (proposed 60 s).
*Validation:* S34; a concurrent extend during sweep loses nothing.

**CL-7 (no retry, no reconciliation).** [settled, rev 9 §6.6] After a sweep or an abandonment the key is simply open. `claim` never re-executes anything and never inspects provider state.
*Validation:* absence — `claim` has no reference to any execution.

**CL-8 (holder id).** [proposed] `holder` is `${hostname}:${pid}:${taskId}`; informational only, shown by `explain`. No liveness inference is made from it (that would be a heartbeat by another name).
*Validation:* review.

**Example — why CL-3 is worth its awkwardness.** A forty-minute agentic step iterates pages. Written correctly, `await extend({ page })` sits after each page's call; a hung provider call means no extend, the lease expires, the sweep opens the key, and the next reader executes — one abandoned row records the loss. Written with a timer, the second tick would throw `ProgressNotAdvancedError` in the author's face during development. *Proves:* the design makes the wrong implementation fail early rather than fail silently in production.

### 4.10 `materialize`

**Purpose.** The storage-backed value: a proxy whose fields resolve on read, record reads, cache weakly, and prefetch from a prediction. Plus the transport-agnostic loader.

```ts
export interface Materializer {
  /** A lazy, addressable view of a generation's output. */
  valueOf(key: ResultKey, generation: number, opts?: { identity?: Identity; prefetch?: RecordedRead[] }): unknown;
  /** Wrap an in-memory argument for read recording during one execution. */
  recordingProxy(value: unknown, arg: number): unknown;
  isStorageBacked(v: unknown): v is StorageBacked;
  /** Force full materialization (used at consumer boundaries; viewer sketch §6). */
  materialize<T>(v: T): Promise<T>;
}
export interface StorageBacked { readonly key: ResultKey; readonly generation: number; readonly identity?: Identity }

/** The loader: partition a read set, batch the unrequested, resolve all. */
export interface Loader {
  load(reads: ReadonlyArray<{ key: ResultKey; generation: number; path: Path }>): Promise<void>;
}
export function createMaterializer(repo: Repository, loader?: Loader): Materializer;
export function createLoader(repo: Repository, opts?: { batchWindowMs?: number; maxBatch?: number }): Loader;
```

**MT-1 (a value is a query).** [settled, rev 9 §2.1] `valueOf` returns a proxy. A `get` of property `p` on the proxy for path `P` records a `field` read at `P.p` with the stored fingerprint (obtained via `repository.fingerprints`), returns a nested proxy if the stored node is an object/array, or the loaded leaf value otherwise. No field value is loaded to compute a fingerprint.
*Validation:* reading `pr.createdAt` issues exactly one `fingerprints` call and one `fields` call for that path; reading `pr.author.name` loads `author.name` only.

**MT-2 (whole-grain reads).** [proposed] Any trap other than `get`-of-a-specific-key — `ownKeys`, `has`, `getOwnPropertyDescriptor`, spread, `JSON.stringify`, iteration — records a `whole` read of that node and materializes it. Passing a proxy to a native function that enumerates it therefore records a whole read, which is the correct sensitivity.
*Validation:* `Object.keys(pr)` records `whole` at `""`; `[...pr.tags]` records `whole` at `"tags"`; `pr.tags.length` records `field` at `"tags.length"` — [proposed] `length` of an array is a field, so member-grain loops that read `length` and index do not take a whole-grain dependency on content.

**MT-3 (recording proxy for in-memory args).** [settled, rev 9 §2.4 "the only place in-memory values are hashed"] `recordingProxy(value, arg)` records reads with fingerprints computed *now* by `fingerprint` at the grain read. Primitives cannot be proxied; a primitive argument is recorded as a `whole` read at call time by the wrapper (4.11).
*Validation:* an object arg read at `a.b` records `{ field, arg, path: "b", fingerprint: fingerprintValue(value.b) }`; a string arg records `{ whole, arg, fingerprint }`.

**MT-4 (weak cache).** [settled, rev 9 §3] Loaded field values are cached in a `WeakMap` keyed by the parent proxy; nested proxies are cached the same way so `pr.author === pr.author` within one execution. Nothing is retained past the last strong reference.
*Validation:* identity of nested proxies; a heap test that dropping the root drops the cache.

**MT-5 (prefetch is a prediction).** [settled, rev 9 §2.4] If `opts.prefetch` (the prior generation's recorded reads) is given, `valueOf` issues one `loader.load` for the storage-backed field reads in it before returning. A read not in the prediction falls back to a single-field load (MT-1). The prediction never affects what is recorded or any verdict.
*Validation:* prediction covers 3 of 4 fields the body reads → one batch of 3, one single load; recorded set is the 4; the same body without a prediction records the same 4.

**MT-6 (loader partition).** [settled, viewer sketch §5; components §3.10] `load` partitions requested reads into *resolved* (in cache), *in flight* (a pending load exists — join it), and *unrequested* (batch them, one `repository.fields` call per key/generation, bounded by `maxBatch`), then awaits all. Nothing is cancelled. The loader has no knowledge of transport; the `react` adapter reuses it with a remote `Repository`.
*Validation:* two concurrent `load`s sharing a path issue one underlying fetch; `maxBatch` splits; a load for a path already cached issues nothing.

**MT-7 (no mode).** [settled, rev 9 §2.1] There is no option that changes behavior by expected value size or cost.
*Validation:* absence — `Materializer` options are `identity` and `prefetch` only.

**MT-8 (immutability).** [settled, rev 9 §2.7, SC21] `set`, `deleteProperty`, `defineProperty` traps throw `ImmutableValueError`. Proxies are frozen views.
*Validation:* assignment through a storage-backed value throws; `materialize(v)` returns a deep-frozen plain object.

**MT-9 (boundary materialization).** [proposed] `materialize(v)` resolves every leaf reachable from `v` (using the loader, batched) and returns a plain frozen object with the same identity metadata attached via a symbol property. Reads of the materialized object are *not* recorded — it is for consumers outside a tracking frame.
*Validation:* materialized object round-trips `fingerprintValue` equal to the stored root fingerprint.

**Design note (OQ1).** Proxy leaks — `===` against a plain object, `instanceof`, `structuredClone` — are the known hazards. The spec's position is MT-2 (enumeration traps record whole reads) plus documentation; a leak detector is not in scope.

### 4.11 `wrapper`

**Purpose.** The author-facing API and the assembly of everything above. No logic of its own.

```ts
export interface StepOptions<R> { name?: string; returns?: TypeToken<R> }
export interface MemoOptions<R> extends StepOptions<R> {
  revision: number;
  wait?: boolean;                 // default true: wait on a held claim (rev 9 §6.5); false = execute anyway (duplication accepted)
  arrival?: string;               // default "batch"; the viewer passes "interactive"
}

export function step<F extends (...a: any[]) => any>(fn: F, opts?: StepOptions<ReturnType<F>>): F;
export function memo<F extends (...a: any[]) => Promise<any>>(fn: F, opts: MemoOptions<Awaited<ReturnType<F>>>): F;
export function pin<T>(value: T, identity?: TypeToken<T> | string): T;   // identified (or not) tracked input

/** Ambient, valid only inside an executing memoized body. */
export function progress(value: unknown): Promise<void>;                 // -> claim.extend
export function reportCost(cost: Record<string, number>): void;          // accumulates on the generation

export interface Runtime {
  readonly stack: { memoized: Stack<MemoCtx>; named: Stack<NamedCtx> };  // register user middleware here
  run<T>(entry: () => Promise<T>, opts?: { mode?: "execute" | "check" }): Promise<{ value: T; outcomes: Outcome[] }>;
  sweep(): Promise<void>;
  close(): Promise<void>;
}
export function createRuntime(opts: { store: Store; retention?: RetentionPolicy; claim?: ClaimOptions; holder?: string }): Runtime;
```

**WR-1 (name or throw).** [settled for `memo`, rev 9 §0.1, SC20; proposed for `step`] Both wrappers use `nameOf(fn, opts.name)`. `memo` on an unnamable function throws `UnnamedStepError` at wrap time with the diagnostic *"memoized steps need a stable name; declare a named function or pass { name }"*. `step` does the same: the author called `step` precisely to name the function, so returning it unnamed would be a silent no-op. (Unnamed code that is never wrapped remains legitimate and needs no name — rev 9 §2.1.)
*Validation:* S46, S47; both wrappers throw synchronously at module load for an arrow with no inferred name.

**WR-2 (the memoized stack).** [settled, rev 9 §2.6] `memo` builds, once per wrapped function, the reserved block in this order and no other: `verify`, `gate`, `claim`, `execute`, `write`, `release`. Regions: `around` before `verify`, `gate` before `claim`. `step` builds `around`, `execute`. `Runtime.stack` exposes both for registration; the stacks are shared by all steps in the runtime.
*Validation:* `inspect()` golden output; ST9.

**WR-3 (a memoized call, executed path).** [settled, rev 9 §2.4] On call with arguments `args`:
1. *subject* — `subjectOf(name, args.map(identityOfArg))`, where an arg's identity is its `StorageBacked.identity`, its `pin` identity, or `undefined`. Key = `(name, revision, hashIdentity(subject))`.
2. *verify* — `repository.current(key)`; if present, `trace.verify(generation.reads, resolver)` where the resolver maps `field`/`whole` reads to the current args (storage-backed → `repository.fingerprints`, in-memory → `fingerprintValue`) and `memo` reads to a recursive call of this same procedure for the nested key (TC-4). Valid → outcome `served`, return `materializer.valueOf(key, generation, { identity, prefetch: reads })`. Invalid or absent → continue with the divergence attached to the context.
3. *gate* — user middleware; a refusal returns `refused`.
4. *claim* — `claim.acquire(key)`. `Held` and `wait !== false` → `claim.waitFor(key)`; then go to step 2 (re-verify; the waiter never executes without re-verifying). `Held` and `wait === false` → proceed as if acquired but with no claim row [proposed: outcome is still `executed`; the write races and the loser's generation is `superseded` immediately — duplication accepted by the author].
5. *execute* — install a `track` frame and a `trace` recording frame (both via `AsyncLocalStorage`), present args as `recordingProxy` (in-memory objects), unchanged (storage-backed), or record a `whole` read now (primitives); make `progress`/`reportCost` ambient; call `fn(...args)`. Nested memoized calls record `memo` reads as they return.
6. *write* — `fingerprintFields(output)` → `FieldRow`s; `identityOf({ value: output, token: returns, producer: { name, inputs: subject.inputs } })`; `repository.writeCurrent(...)`.
7. *release* — `acquired.release({ kind: "current", durationMs })`; outcome `executed`; return `materializer.valueOf(key, newGeneration, { identity })`.
On any throw in steps 5–6: `release({ kind: "abandoned", reason: "error" })`, `repository.markAbandoned` with reported cost, re-throw; outcome `failed`.
*Validation:* ST0–ST3, S34, S40, S43 as integration tests; a sequence assertion (spy on components) that the calls occur in this order.

**WR-4 (served outputs re-enter tracking).** [settled, rev 9 §2.4] Both `served` and `executed` return a storage-backed value carrying the derived identity, with fresh process-local tags.
*Validation:* a served value passed to a second memoized step contributes its identity to that step's subject; restart the process and the same subject hash is produced (ST16).

**WR-5 (check mode).** [settled, rev 9 §2.4, §2.6] `run(entry, { mode: "check" })`: step 2 runs; on invalid or absent the outcome is `checked` with `wouldExecute: true` and the divergence; nothing is claimed or executed; the body is not called; the *value* returned to the caller is the prior generation's if one exists, else a `CheckModeMissError` is thrown so the entry function's control flow stops. Unmemoized code still runs (it must, to compute in-memory reads).
*Validation:* a dry run of ST1 reports one `wouldExecute` and writes nothing; `outcomes` lists every memoized call.

**WR-6 (ambient helpers).** [proposed] `progress()` and `reportCost()` outside an executing body throw `NoExecutionContextError`. `progress()` inside a body whose claim was not acquired (`wait: false` race loser) is a no-op that returns.
*Validation:* unit tests.

**WR-7 (pin).** [settled, rev 9 §2.1] `pin(value, PR)` attaches `{ kind: "type", type, key: PR.identity(value) }`; `pin(value, "rubric:tone")` attaches `{ kind: "type", type: "pinned", key: "rubric:tone" }` [proposed encoding]; `pin(value)` attaches nothing and merely marks the value as a tracked input. Identity travels with the value via a symbol property; the value itself is frozen.
*Validation:* S45 (identified rubric edited → supersedes); S32 (unidentified version string edited → supersedes under the same subject, because it was never in the subject); S12 (different identity → forks).

**WR-8 (the seam).** [settled, rev 9 §2.7] Nothing from `track` is passed to `repository` or `store`; nothing from a row is handed to `track` except through `materialize`'s proxy. The wrapper is the only module that imports both `track` and `repository`.
*Validation:* DR-1; TK-1's type test.

**Example — WR-3 step 4 with a waiter.** Two workers reach `summarize(pr#4521)`. Worker A acquires; worker B gets `Held` and waits. A finishes and releases as `current`. B's wait returns `"resolved"`; B goes to step 2, verifies A's generation against its own args (identical fingerprints), and is `served`. One execution, one generation, two callers. *Proves:* SC12 with no queue, no coordination service, and no special case in B's code path — B took the same path as any second run.

### 4.12 `explain`

**Purpose.** Read-side queries that turn stored data into "why," plus the tracing observer.

```ts
export interface Explain {
  why(key: ResultKey): Promise<{ state: GenerationState; lastOutcome?: Outcome; divergence?: Divergence; claim?: SubjectRow["claim"] }>;
  generations(key: ResultKey): Promise<Array<{ generation: number; state: GenerationState; cost: Record<string, number>; startedAt: number; endedAt: number | null }>>;
  diff(key: ResultKey, a: number, b: number): Promise<Array<{ path: Path; before?: unknown; after?: unknown }>>;
  /** Obviation pricing: a check-only run's misses grouped by step, summed over recorded cost of what would be superseded. */
  price(outcomes: Outcome[]): Promise<{ byStep: Record<string, { misses: number; cost: Record<string, number> }>; total: Record<string, number> }>;
  /** The tracing observer: an `around` middleware that records durations and emits nudges. */
  tracing(opts?: { slowUnmemoizedMs?: number; abandonedAttemptsThreshold?: number }): Middleware<AnyCtx>;
}
export function createExplain(repo: Repository, trace: typeof import("../trace")): Explain;
```

**EX-1 (why).** [settled, rev 9 §8] `why` reports the current state, the last outcome recorded on the generation row, and — for a superseded generation — the divergence that superseded it (stored by `wrapper` on the new generation's row [proposed: `GenerationRow.supersededBecause?: Divergence`]).
*Validation:* S40 — after PR 4521's commit, `why` names `pr.commits` as the diverging field.

**EX-2 (price what you will obviate).** [settled, rev 9 §8] `price` takes the outcomes of a `check`-mode run; for each `checked` with `wouldExecute`, adds the recorded cost of the current generation that would be superseded.
*Validation:* S32 — bumping the model name prices every judgment before any executes.

**EX-3 (tracing nudges).** [settled, rev 9 §2.6, §8, S18] The tracing middleware sits in `around` on both stacks; it records duration per call and emits a `"consider memoizing"` diagnostic for an unmemoized step slower than `slowUnmemoizedMs` (OQ6; proposed default 2000). Diagnostics go to a pluggable sink (default: `console.warn`, once per step name per run).
*Validation:* S18.

**EX-4 (read-only).** [settled; components §3.12] `explain` performs no writes.
*Validation:* DR-1 — imports `repository` and `trace` only; a spy asserts no `Store` write method is called.

---

## 5. Composition — one execution, end to end

```
caller ─▶ memo(fn)(args)
   │
   ├─ subjectOf(name, identities of args)            identity
   ├─ stack.run(ctx)                                 middleware
   │    ├─ [around: user]  ─┐
   │    ├─ verify ──────────┼─ repository.current → trace.verify(reads, resolver)   trace / repository / fingerprint
   │    │     └ served? ─── return materialize.valueOf(key, gen, prefetch)          materialize
   │    ├─ [gate: user] ── may return refused
   │    ├─ claim ────────── claim.acquire → Held? waitFor → back to verify          claim / store (CAS)
   │    ├─ execute ──────── frames on; recordingProxy(args); fn(...args)            track / trace / materialize
   │    │     └ nested memo(...) records { memo, key, gen } as it returns
   │    ├─ write ────────── fingerprintFields(out); identityOf(out); writeCurrent   fingerprint / identity / repository
   │    └─ release ──────── acquired.release(current | abandoned)                   claim
   └─ return materialize.valueOf(key, newGen)
```

**CP-1.** [settled] The order above is the only order. Any implementation in which a user middleware can run between two reserved positions, or in which `gate` runs before `verify`, violates SC19.
*Validation:* ST9.

**Served path (steady state).** Steps: subject → verify (all fingerprints equal, nested keys valid) → `served`. Cost: unmemoized code ran; storage-backed reads compared fingerprints only; in-memory reads were re-fingerprinted. No claim, no gate, no body.

**Check mode.** subject → verify → `checked`. Nothing else.

---

## 6. Failure handling and diagnostics

| Error | Thrown by | When | Store effect |
|---|---|---|---|
| `UnnamedStepError` | `wrapper` | wrap time; no derivable name | none (module load fails) |
| `NonFingerprintableError` | `fingerprint` | unsupported value in output or in-memory read | none; execution fails before `write` → `abandoned(error)` |
| `CapturedReadError` | `trace` (via wrapper) | tracked read not addressable from args | `abandoned(error)` |
| `ProgressNotAdvancedError` | `claim` | `extend` with unchanged progress | lease unchanged |
| `InvalidGateOutcomeError`, `MiddlewareContractError` | `middleware` | contract violation | none (outside reserved block) |
| `ImmutableValueError` | `materialize` | write through a storage-backed value | none |
| `FingerprintAlgorithmMismatchError` | runtime | opening a store with a different algorithm | refused to open |
| `DuplicateRowError` | `store` | insert of existing row | none |
| `NoExecutionContextError` | `wrapper` | `progress`/`reportCost` outside a body | none |
| `CheckModeMissError` | `wrapper` | check mode reaches a subject with no generation | none |

**FH-1.** [settled, rev 9 §6.5] Every path out of `execute` releases the claim: normal return → `current`; throw → `abandoned(error)`; process death → lease expiry → sweep → `abandoned(lease-expired)`. There is no fourth path.
*Validation:* SC16; a fuzz test that kills the process at random points during ST1 and asserts, after a sweep, that no key is claimed and every claimed generation is `abandoned` or `current`.

**FH-2.** [settled, rev 9 §6.6] No error above triggers a retry, a rollback of a paid call, or any provider interaction.
*Validation:* absence; grep for retry loops in `core` fails.

**Diagnostics.** Every `Outcome` is appended to `Runtime.run`'s `outcomes`; the tracing middleware is the only thing that prints by default.

---

## 7. Validation plan

**Unit, per component** — the *Validation* lines above, organized by module. Each component's tests use fakes for its dependencies (components §1), except `wrapper`.

**Store conformance suite** (`test/conformance/store/`) — SA-1…SA-7 as a parameterized suite; both shipped backends must pass; a third-party backend imports and runs it.

**Steel threads as integration tests** (`test/threads/`) — the rev 9 §12 threads that core alone can satisfy:

| Thread | Exercises | Gate for |
|---|---|---|
| ST0 basic memoize | WR-3, RP-2, MT-1 | sequencing step 3 done |
| ST1 input change → one re-execution | TC-1, FP-1, ID-2 | step 3 |
| ST2 naming/identity cases | NM-1, ID-1, WR-1, WR-7 | step 3 |
| ST3 chains | TC-4, WR-4 | step 3 |
| ST7 generations and pinned inputs | RP-2, RP-3, WR-7 | step 3 |
| ST9 middleware | MW-1…5, WR-2, CP-1 | step 3 |
| ST16 consumer reactivity | TK-3, WR-4, SC21 | step 3 |
| S34, S36, S37 | CL-1…CL-6, FH-1 | step 2 (against fake store) and step 3 |
| S43 budget gate | MW-3, WR-3 step 3 | step 3 |

Threads needing `helpers` (ST4–ST6 fan-out, ST8, ST10–ST15) are gates for the `helpers` spec, not this one. **ST11 (scale)** runs against the SQLite backend with this schema before any tiering, notification, or worker work is considered.

**Property tests** — FP-1 (two grains), ID-1 axis test (memoized flag has no effect on identity), FH-1 kill-fuzz.

**Sequencing gates** (components §8): step 1 complete when every leaf's unit suite is green and the store conformance suite passes on `memory`; step 2 when `trace`/`repository`/`claim` pass against fakes and `sqlite` passes conformance; step 3 when the thread table above is green; step 4 when EX-1…4 pass.

---

## 8. Deferred and open

| Item | Status | Where it lands |
|---|---|---|
| OQ1 proxy leaks | open; MT-2 + docs is the position | `materialize` |
| OQ2 collection identity in tracking | **bounded assumption:** a whole-grain read of a collection records a fingerprint over `(length, member identities or member fingerprints)`; `length` alone is a field read (MT-2) | `identity` + `materialize`; resolve before either interface freezes |
| OQ3 fingerprint granularity | FP-1/FP-2 as proposed; measured by ST11 | `fingerprint` |
| OQ4 poll vs notify; SQLite contention | CL-5 polls; `watchSubject` reserved; contention measured by ST11 | `store`, `claim` |
| OQ5 reclamation | RP-3's `reclaim` hook; policy deferred to the viewer's needs | `repository` |
| OQ6 tracing thresholds | EX-3 defaults are placeholders | `explain` |
| OQ7 lease parameters | CL-2 defaults are placeholders; measure on Thread B's slowest steps | `claim` |
| OQ8 in-process derivation cache | `derived()` ships; measured | `track` |
| `helpers`, `react` | separate specs | — |
| `wait: false` semantics (WR-3 step 4) | proposed; duplication accepted by the author, loser superseded | `wrapper` |
| `supersededBecause` on the generation row | proposed for EX-1; small schema addition | `store`/`repository` |

**Assumptions to check with Mike** (each labeled in place): runtime (§1), `AsyncLocalStorage` for ambient context (TK-2, WR-3), argument-order subjects (TY-2), `length` as a field read (MT-2), the `pin(value, string)` encoding (WR-7), CL-2/CL-5/CL-6/EX-3 numeric defaults, `step()` throwing on an unnamable function (WR-1).

---

## 9. Traceability

| rev 9 decision | Spec rule(s) | Validation |
|---|---|---|
| Thesis: per-function opt-in memoization | WR-1, WR-3, MT-7 | ST0, ST2 |
| Two grains, load-bearing (§2.1) | FP-1, MT-1, MT-2 | property test; ST1 |
| A value is a query (§2.1) | MT-1, SA-3 | fetch-count assertions |
| Identity: one rule, own axis (§2.1, §0.2) | ID-1, ID-6 | axis test |
| Identity forks; content bumps (§4, §7) | ID-2, TY-1, WR-7 | S12, S32, S45 |
| Name from the declared function; throw on none (§0.1, SC20) | NM-1, WR-1 | S46, S47 |
| Recorded reads as prefetch prediction; a miss is never a change (§2.4) | TC-2, MT-5 | MT-5 test |
| Served outputs re-enter tracking (§2.4) | WR-4 | ST3, ST16 |
| Check-only mode in core (§2.4, §2.6) | WR-5, EX-2 | dry-run tests |
| Middleware: reserved block, regions, gate after verify (§2.6, SC19) | MW-1…5, WR-2, CP-1 | ST9, S43 |
| Claim = row state; row lock = mutex (§6.5) | SA-1, CL-1 | SC12 concurrency test |
| Lease + sweep, no heartbeat (§6.5) | CL-2, CL-6 | S34 |
| Extend requires differing progress (§6.5) | CL-3 | S36, S37 |
| Failure releases promptly; no retry (§6.5, §6.6) | CL-4, CL-7, FH-1, FH-2 | SC16, kill-fuzz |
| Retention; nothing paid is deleted (§2.3) | RP-2, RP-3, RP-4 | SC17 |
| Nothing from the tag half persists; values immutable (§2.7, SC21) | TK-1, MT-8, WR-8 | type tests; ST16 |
| Three contracts, boring defaults (§3) | SA-6, MT-5/6, `ClaimOptions` | conformance suite |
| Explainability standing (§8) | EX-1…3 | S18, S40 |

---

## 10. Graveyard additions from this spec

Rejected while writing, so they are not re-proposed at implementation time:

- **Generation numbers allocated by the store** — the repository owns generation semantics (SA-2).
- **A `claim` table separate from the subject row** — two rows means two locks; the CAS is on one row by design (CL-1).
- **Recording reads by tag instead of by address** — tags do not survive the process (TK-1); addresses relative to arguments do.
- **Fingerprinting storage-backed reads on the client side** — the stored fingerprint *is* the fingerprint (MT-1).
- **A "size hint" on `memo`** — a mode by another name (MT-7).
- **Auto-retrying a swept key inside `claim`** — retry is never core (CL-7).
- **A heartbeat column keyed on `holder`** — CL-8 says the holder id is informational only.
