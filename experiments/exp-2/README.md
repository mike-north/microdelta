# EXP-2: bounded value and selected-access evidence

This experiment answers [EXP-2](../../docs/spec/experiments.md) for the
literal facts in [TRK-5 and VAL-1/2](../../docs/spec/tracking.md). It proposes
a mechanism; it does not establish M2 behavior or a durable storage format.
The supervisor selects the bounded encoding/evidence mechanisms and records
the partial access outcome in the owning Tracking contract.

## Supported-domain decision matrix

| Input or operation | Candidate decision | Assertion or limit |
| --- | --- | --- |
| Missing property versus present `undefined` | A value read records the same `undefined`; own presence and whole-record encoding distinguish them. | `literal observation facts`; no fabricated existence read. |
| `null`, booleans, strings | Supported as distinct tags. JSON string escaping preserves UTF-16 code units, including a lone surrogate. | Roundtrip fixture. |
| Numbers | Supported: finite numbers, canonical NaN, both infinities, and negative zero distinct from positive zero. NaN payload bits are not semantic data. | Roundtrip and negative-zero assertions. |
| Sparse arrays and holes | Supported; length and hole are explicit, while a positional value read of a hole equals present `undefined`. Only standard Array prototype and indexed slots are supported. | Hole/own/length fixture. |
| Dictionary key order | MDV1 equality input sorts string keys by code-unit order; MDS1 snapshot transport retains observable enumeration order. An explicit `keys` observation records the actual `Object.keys` sequence. | Reverse insertion and snapshot roundtrip fixtures. |
| Cycles and shared references | Rejected with a path-bearing error; graph identity is outside this value domain. | Unsupported-data fixture. |
| Inherited properties | Supported for own string data on at most two custom plain-data prototypes ending in `null` or the standard `Object.prototype`. Own and `in` facts differ. Intrinsic `Object.prototype` member values are outside the data domain and are rejected if selected. | Own/inherited fixture; depth bound in candidate. |
| Getters/setters | Rejected without invoking them during canonical encoding or a selected projection. | Unsupported-data and zero-invocation fixtures. |
| Bigint; symbol data and user symbol keys | Rejected, including nonenumerable own keys rather than silently omitting them. The experiment has no framework-brand exception; any later brand exemption needs an explicit trusted source. | Unsupported-data fixture. |
| Functions | Rejected as values. A tracked function's implementation fingerprint is a separate EXP-1 observation, not a serializable data function. | Unsupported-data fixture; EXP-1 owns implementation evidence. |
| Date, Map, Set, class instances | Rejected through unsupported native/custom prototype surfaces. | Unsupported-data fixture. |
| Duplicate record keys | Rejected at entry construction and canonical decode. A plain JS object cannot reveal duplicate keys that an upstream parser already discarded; such a parser must preserve entries and detect duplicates before this boundary. | Duplicate-entry and wire-decode fixtures. |
| Nonenumerable own data | Rejected. Descriptor flags otherwise normalize on decoded immutable snapshots. | Unsupported-data fixture. |

An object `obj[0]` and `obj['0']` both use `Property('0')`; JavaScript does
not retain the source spelling. An array's `array[0]` uses `Index(0)`.
Property names containing dots or brackets remain one segment. A keyed member
identity is not either kind of positional segment.

## Format and current evidence proposal

`MDV1|` prefixes a normalized unordered equality grammar. Tags represent undefined,
null, booleans, UTF-16 strings, number tokens, arrays with explicit holes, and
sorted record entries plus a bounded prototype marker. Its decoder returns an
immutable **normal form**, not a value suitable for later order-sensitive reads.
`MDS1|` uses the same bounded tags but retains the current own-key order through
snapshot transport; decode freezes that snapshot. Both decoders reject unknown
versions, duplicate keys, malformed nodes, and noncanonical data. A reverse-key
record therefore has equal MDV1 bytes to its forward-key peer, but distinct MDS1
bytes and the same `keys` observation after an MDS1 roundtrip. `MDO1|` encodes an operation, ordered structured segments,
and a separately canonical selected fact. SHA-256 of that complete text is the
content fingerprint. Equality relies on SHA-256 collision resistance; a digest
does not prove mathematical equality or identify a current binding.
Fingerprint-only verification assumes the source's recorded digest is
authoritative for its payload version; this fixture does not prove how History
atomically publishes or updates that sidecar.

A current observation record would hold the operation, structured path, selected
fact fingerprint, and the current input binding supplied by Definition. An old
result's provenance would remain separately in History; this experiment neither
stores a binding nor decides reuse. The `MDP1|` projection input includes
collection binding, field, completion flag, sorted member keys and selected
values. It represents one exhaustive uniform logical dependency with a single
digest. Its in-memory construction takes O(n) selected-value reads and O(n)
temporary bytes for n members; retained complete evidence is O(1) apart from
binding/field lengths and digest. Arbitrary early-stop work instead records the
visited keys, O(k) for k visited members, and remains incomplete. The fixture
does **not** prove that arbitrary guarded early-stop reuse is safe from only
that digest; guard/coverage validation remains Tracking and Composition work.

The test-harness digest adapter uses Node SHA-256 behind the portable
`IDigestCapability` contract. Independent empty-string and `abc` conformance
vectors run before the candidate uses that adapter. Portable candidate modules
typecheck with `types: []` and `skipLibCheck: false`; they import no Node API.
This avoids adopting a permanent Machine method from an undecided experiment.

## Access comparison and observed limits

| Candidate | Backing assumption | Outcome |
| --- | --- | --- |
| Synchronous lazy view | Indexed synchronous `readField` can return an unexpected top-level scalar field immediately. | Ordinary scalar `view.value.name` records its exact field. Metadata verification causes zero payload reads; the positive control causes one. Two consumers read two narrow fields and never request the million-character sibling. Nested objects/arrays and proxy presence, enumeration or prototype operations reject explicitly because their observation contracts are not implemented by this view. |
| Explicit async preparation | A backing source can await named fields before creating the scalar view. | Prepared `name` is an ordinary scalar read; preparation loaded it once and observation is recorded only when read. An unexpected `city` read throws rather than pretending a synchronous getter can await I/O. This candidate alone is **rejected** as a full answer to DOM-3's unprefetched-read behavior for purely async backing. A separate explicit async read surface needs later design. |

| Instrumented case | Payload `readField` calls | Consumed observations |
| --- | ---: | ---: |
| Fingerprint match or mismatch | 0 | 0 |
| Synchronous `name` positive control | 1 | 1 |
| Two narrow consumers, `name` and `city` | 2 total | 1 per view |
| Materialize `name` output | 1 | 1 |
| Prepare async `name`, then read it | 1 during preparation | 1 on scalar read |
| Read unprepared async `city` | 0 additional | 0 additional |

Each synchronous view retains no selected field cache; its read returns one
scalar and an immutable observation copy. An asynchronously prepared view retains
only its explicitly selected fields for the lifetime of that view, O(s) for s
prepared fields, and releases them when the view is reclaimed. The experiment
does not set a production cache budget or eviction policy.

Plain `observe()` tests nested path semantics separately; a nested lazy
materialization view remains unproven for M2. The scalar view rejects rather
than reporting false own/inherited presence or empty key enumeration.

The test fixture counts selected field calls, not resident heap. It does not
prove the 150,000-subject scale target, cache eviction, or a production History
reader. The selected-loading slice gives a backing reader an explicit field
request; output materialization reads only emitted fields. `materializeOutput`
returns a new record rather than transferring an untracked proxy into a result.

## Reproduction and decision

Pinned workspace tools at the fixture run: TypeScript 5.9.3, ESLint 10.10.0,
typescript-eslint 8.70.0, Jest 30.5.1, Node 24.14.0. Tests preceded the selected-access
implementation. The first executable run had 11 value tests passing and six
materialization tests failing with `not implemented`; later assertion-first
red runs found a getter invocation, O(n) retained uniform coverage, malformed
observation acceptance, unsupported selected container shapes, and mutable
selected output/view state, then all were fixed. Peer review subsequently found
that normalized equality decoding reordered later explicit keys reads and that
the proxy gave false presence/enumeration facts; assertion-first fixes split
snapshot transport from equality and narrowed the view to scalar reads. The
final commands and counts are recorded in the PR.

```sh
node --version
npm run check:experiments
npm run test:exp2
npm run check
npm test
npm run build
```

**Decision: Pass for the declared value/evidence encodings and top-level scalar
synchronous access; reject async preparation as a general ordinary-getter
solution; nested lazy access remains unproven.** The owning Tracking contract
records that bounded selection. Integration with current bindings, Tracking,
History, and Machine is still required. No stored payload migration is inferred
from v1; unknown formats fail closed.
