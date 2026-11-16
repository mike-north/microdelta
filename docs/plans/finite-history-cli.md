# Finite exact-result CLI

**Standing:** supervisor-selected engineering contract for [#311](https://github.com/mike-north/microdelta/issues/311), under parent [#167](https://github.com/mike-north/microdelta/issues/167). Implementation and runtime acceptance are not claimed. The finite fact-only command and external v1 wire were selected after independent contract review; these mechanisms are not attributed to the human owner's product-scope decision.

This document owns the installed command's invocation, external transport and errors. [Finite exact History selection](finite-history-selection.md) owns the accepted #309 library mechanism; [operations](../spec/operations.md) RUN-006/007 and CLI-001, [acceptance](../spec/acceptance.md) A-16f, [architecture](../spec/architecture.md) ARC-010 and [package boundaries](../spec/package-boundaries.md) PKG-003/004 retain their invariant ownership. The [standalone inspection proposal](standalone-inspection.md) retains the broader open alternatives. This child does not complete #167, CLI-001–004, M6 or M7.

## Exact invocation and fact semantics

```text
microdelta read-result --location PATH --logical-store NAME --reference LOCATOR --operation OP --address ADDRESS_JSON
```

The five named options occur exactly once, in any order, as option/value pairs after the verb. Every required string is nonempty and otherwise literal; do not trim or infer another identity. Unknown/duplicate/missing options, extra positionals, `--name=value` alternatives, extra separators, input files/stdin programs, module/SQL/latest/current/follow/control options are not part of this grammar. No author module or program is accepted. Preserve existing `start` and `observe` behavior.

`OP` is exactly `value | own | membership | length | keys | container-kind`. `ADDRESS_JSON` is parsed as ordinary JSON and must be an array of segments, each with exactly one of these closed shapes:

```text
{"kind":"property","key":STRING}
{"kind":"index","index":NONNEGATIVE_SAFE_INTEGER}
```

A property key may be empty or contain punctuation, slash, dots, `__proto__` or `constructor`; it is literal data. No dotted-path/slash escape, string-to-index or implicit coercion is introduced. Reject malformed JSON, null/nonobject segments, unknown fields/discriminants, numeric strings, negative values and parsed noninteger/unsafe indices before path resolution or storage. Index validity follows the **parsed JSON number**; parsed -0 and 0 designate index 0 and the JSON echo is 0. This does not merge signed-zero fact values. `[]` is structurally valid; the existing selected operation decides whether its address is meaningful. Bare-root `value` remains an owner TypeError/read failure; do not advertise a new whole-root value operation.

Examples use an ordinarily published retained payload with independently prepared properties, not a new fixture/result API:

| Operation | Example structured address | Existing supported answer |
| --- | --- | --- |
| `value` | `[{"kind":"property","key":"zero"}]` | selected Number 0; a selected nested container instead returns that detached subtree |
| `own` | `[{"kind":"property","key":"present"}]` or an array index | true for an own present-undefined property; false for an inherited property or sparse hole |
| `membership` | property address naming an inherited data key | true for supported inherited presence; absent/hole stays false |
| `length` | `[{"kind":"property","key":"list"}]` | actual array length including holes; wrong container is an owner failure |
| `keys` | `[{"kind":"property","key":"orderedRecord"}]` | own enumerable string-key vector in stored observable order, e.g. `["b","a"]`; inherited keys excluded |
| `container-kind` | a valid address, including `[]` | existing `record`, `array` or `scalar` discriminant without inventing a content/currentness read |

After complete grammar validation, resolve PATH exactly once relative to the invoking working directory using the existing Machine command host. If resolution fails, emit the fixed safe diagnostic and exit 1 with no stdout, no fabricated resolved selection and zero History reads. Then call exactly once:

```text
readHistorySelection(
  {location: resolvedPath, logicalStore: NAME},
  {
    kind: 'fact',
    reference: {kind: 'completed-result', locator: LOCATOR},
    request: {operation: OP, address: parsedAddress}
  }
)
```

The locator stays opaque to the CLI. History owns canonical locator/store/scope/completion/encoding/index/integrity validation. Invalid exact references are failures, never successful misses or implicit latest-result fallback. A successful selected missing value and a present undefined both carry an undefined fact; `own`/`membership` ask the separate presence question. Fingerprint support remains available in the existing library API but is outside this command.

## Distinct permission and host boundary

The separately allowlistable authority is **`microdelta read-result`**, distinct from `microdelta observe`. Its usage/docs must explain #309's existing-file **WAL-coordinated native readonly** scope and the selected eligible native WAL/SHM coordination effects. Invoking the distinct documented verb supplies this explicit command authority; do not add a per-read interactive prompt. Readonly does not mean zero filesystem effects for this capability.

Preserve #309's supported layout/physical contract: no domain writes, initialization, migration, checkpoint, journal conversion, writable fallback, recovery or application sidecar cleanup; preserve main/committed-WAL evidence. Native coordination does not become domain mutation or a universal transient-write/media guarantee. No stronger guarantee or additional eligible layout is selected. Missing remains missing; unknown access failures do not become absence.

The handler must not load analysis registration/author modules, prepare a workload/workspace, invoke source policy/body/provider, acquire/renew/release a writer claim, publish acceptance, retry, query currentness, control/stop a run or expose a reader/lazy value. Framework imports may load framework code only. #309 owns all physical read/release work. Existing `observe` and CLI-005/A-21f keep their stricter no-writes/no-sidecars/no-init/no-recovery artifact-reader contract, with no coordinated fallback.

Use the existing `ICommandProcessCapability`/Node Machine implementation for arguments, path resolution, full-write-or-throw stdout/stderr and exit selection. Runtime CLI code must not import Node built-ins or use process/Buffer directly. No new Machine capability, owner opener, SQL/result API, observer hook or public Value decoder is needed. A narrow internal injectable read/encode/host composition for tests must not become an exported owner API. Constructor-based `SqliteReadError` classification imports the existing `@microdelta/machine` constructor: add that package as a direct core runtime dependency and update corresponding lock metadata. Do not rely on transitive hoisting, message/name matching or a new public re-export.

## Output, failure classification and exits

A resolved valid invocation produces one complete JSON document plus one LF on stdout when encoding/output succeeds, with no banners. Success echoes the exact resolved selection and means only that the retained fact was read/detached/encoded/written. It makes no freshness/current acceptance/reuse/source validation/liveness/report-completion assertion.

The success document is one JSON document followed by one LF:

```text
{
  "format": "microdelta.history-result-read",
  "formatVersion": 1,
  "selection": {
    "location": RESOLVED_PATH,
    "logicalStore": NAME,
    "reference": {"kind": "completed-result", "locator": LOCATOR},
    "operation": OP,
    "address": PARSED_ADDRESS
  },
  "result": {"kind": "fact", "encoding": "MDS1", "snapshot": MDS1_TEXT}
}
```

The exact field sets above are closed; order of outer JSON object fields is not semantic. `snapshot` is a JSON string containing the complete text `MDS1|` plus one canonical tagged JSON node below, not a JSON object representing the author value. Failure after successful input/path resolution uses the same selection and `result:{"kind":"failed","code":CODE}` with no encoding/snapshot fields. The closed failure codes are `absent | unsupported | corrupt | recovery-required | busy | schema | integrity | multiple-failures | failed`. No success/currentness implication follows from a retained fact.

**This is a deliberate new external command-wire promise.** Internally, the handler calls existing Value `encodeSnapshot` after #309 has returned/released storage, then JSON-serializes only copied framework metadata and that codec string. It does not add an arbitrary-object walker or public TypeScript decoder. Generated-alpha `decodeSnapshot` remains project-private and is not the external recipe. The ordinary consumer recipe below uses only JSON and standard ECMAScript facilities.

CLI `formatVersion:1` owns this exact MDS1 grammar and supported domain independently of future Value implementation changes. An internal encoder change must preserve it, adapt internally back to it, or receive an explicitly selected new CLI format version/contract. It cannot silently change tags, numeric spellings, holes, prototypes, key order or accepted fact meaning while still claiming v1. An unknown command format version, encoding or wire prefix is unsupported to a v1 consumer, never a reason to guess another decoder. This does not promote all Value alpha APIs or promise unrelated internal formats.


Classify only actual exception constructors and their established codes at the read boundary:

| Actual outcome | Failed-result code |
| --- | --- |
| `SqliteReadError` | its actual `absent`, `unsupported`, `corrupt` or `recovery-required` code |
| `HistoryBusyError` | `busy` |
| `HistorySchemaError` | `schema` |
| `HistoryIntegrityError` | `integrity` |
| `AggregateError` from multiple request/release failures | `multiple-failures`; never report one inner cause as the sole outcome |
| any other thrown value, including undefined or unsupported-selection TypeError | `failed` |

Never expose raw error messages/stacks/causes or author payload in a failed reply. Do not infer a diagnosis from text, names, errno guesses or existence probes. A complete typed failed-read envelope carries its diagnostic code on stdout and needs no additional stderr document.

| Exit | Selected meaning |
| --- | --- |
| 0 | exact fact read, detached after release, encoded and fully written; false/0/empty/undefined are ordinary successful data |
| 1 | storage/reference/schema/busy/selection/read-release/path/encoding/transport failure; no retry or semantic fallback |
| 2 | grammar/input validation failure before any path resolution or History operation, fixed usage successfully written to stderr and no stdout |

If a required stderr write throws or is partial, exit 1, including invalid-input paths; those paths still perform zero path resolution/History reads. Path/encoding/stdout failures use a fixed safe diagnostic; if that diagnostic also fails, exit 1 without recursive retries. Build the complete outer JSON string before the one stdout write, and do not replace partial stdout with a second JSON response. Codec/transport/diagnostic failures never trigger another read. #309 must finish all release actions before the handler encodes; failed release cannot produce ordinary success. Complete serialization/output is not promised after a transport failure.

This finite synchronous command uses #309's existing bounded host busy wait and ordinary process interruption. Do not install run-stop signal handlers or invent a completed-read/cleanup guarantee for default signal termination. Preserve `start` signal behavior.

## Source basis and supported Value domain

The accepted source basis is `641758dfc3640f359dabbb5fb9b8f1b790b0de87`. [Value's actual codec](https://github.com/mike-north/microdelta/blob/641758dfc3640f359dabbb5fb9b8f1b790b0de87/packages/value/src/value.ts) defines the behavior selected here (version/prototype bound11–19; surfaces252–299; numbers303–316; encoder320–395; decoder/canonicality407–510; data-property construction521–531; normalization866–895). [History selection](https://github.com/mike-north/microdelta/blob/641758dfc3640f359dabbb5fb9b8f1b790b0de87/packages/history/src/selection.ts) and [the facade](https://github.com/mike-north/microdelta/blob/641758dfc3640f359dabbb5fb9b8f1b790b0de87/packages/core/src/history-selection.ts) remain the library mechanisms. The command contract below is self-contained; an external consumer need not find private declarations/source to interpret its output.

A fact is undefined, null, boolean, ECMAScript string, ECMAScript Number (including NaN, infinities and signed zero), a standard array, or a string-keyed data record. Values are finite trees: cycles and repeated object identity across any traversed data/prototype occurrence are unsupported. Equal but distinct subtrees are allowed. The Number domain is binary64, not arbitrary precision integers/decimals; fact numbers need not be safe integers (address indices do).

Records contain only own enumerable string-keyed data properties. Empty and punctuation keys are literal. No symbols, accessors, nonenumerable properties or hidden behavior are transported. A record prototype is null, the consumer realm's ordinary Object.prototype terminal, or a bounded data-only record prototype. This is not arbitrary class-instance/prototype-method support. Standard intrinsic prototypes are terminals; their properties are not enumerated/serialized as application data.

Arrays have the ordinary Array.prototype and ordinary ECMAScript length constraints (at most 2^32−1 slots), no symbol fields and no own attached fields beyond `length` and enumerable data slots with canonical nonnegative index keys less than length. Holes are distinct from present undefined. Functions, symbols, bigint, maps/sets/dates or other objects whose state is outside this data/prototype domain, overridden array prototypes, cycles/shared identities and deeper prototype traversal are unsupported. There is no new numeric fact-size or total-depth quota: finite selection is a closed lifetime, not constant bytes/time. Existing storage/Value constraints and actual process/resource failures still apply; this document adds no arbitrary result-size guarantee.

## Complete tagged grammar

Let `d` be the number of **custom-prototype edges traversed on the current decoding path**, initially 0. Ordinary property/array descent preserves d; following a custom-prototype edge increments it. `d` may be 0, 1, 2. Thus the limit is not merely “two prototypes per individual record”: properties/arrays reached within a custom-prototype subtree retain its accumulated depth.

All productions below are JSON arrays with **exact arity**. `String` is any ECMAScript JSON string, including empty; `Entries` and `Slots` are dense JSON arrays. The node syntax contains arrays and strings only, never raw JSON numeric/boolean/null/object values.

```text
Snapshot       := "MDS1|" + CanonicalJSON(Node(0))

Node(d)        := ["u"]                      # undefined
                | ["n"]                      # null
                | ["t"]                      # true
                | ["f"]                      # false
                | ["s", String]              # string
                | ["d", NumberToken]         # Number; token itself is a string
                | ["a", Slots(d)]            # ordinary array
                | Record(d)

Slots(d)       := [ Slot(d), ... ]            # zero or more slots
Slot(d)        := ["h"] | Node(d)             # h is allowed ONLY in this position

Record(d)      := ["o", Entries(d), Prototype(d)]
Entries(d)     := [ [String, Node(d)], ... ]   # zero or more ordered own entries
Prototype(d)   := ["p-null"]
                | ["p-object"]
                | ["p-custom", Record(d+1)]  # allowed only when d < 2
```

There are no other tags, shorthand forms or optional trailing elements. `h` is not a value node and cannot be a top-level value, record value or prototype. `p-*` tags occur only in the prototype position. A custom prototype must decode to a nonnull record, never an array/scalar, with at most two custom edges on the path described above.

`NumberToken` is one of the exact strings `NaN`, `+Infinity`, `-Infinity`, `-0`, or the ECMAScript `String(n)` spelling of a finite Number n with ordinary zero spelled `0`. For the finite case, `n = Number(token)` must be finite and `String(n) === token`; signed negative zero uses its special token. This admits the actual shortest roundtripping ECMAScript decimal/exponent spelling, not arbitrary equivalent decimals. For example `1`, `1e+21`, `1e-7` are finite tokens; `01`, `+1`, `1.0`, `1E+21`, `Infinity`, `-NaN`, whitespace and a nonfinite overflow spelling are not. `-0` must decode as negative zero, not positive zero. Special numbers never become JSON null.

Record entry keys must be unique, including `__proto__`, `constructor` and the empty string. Their vector order must equal ordinary ECMAScript `Object.keys` order after construction with those own enumerable data keys. Integer-index-like record keys therefore have the standard numeric enumeration ordering; other string keys retain insertion order. v1 preserves observable enumeration order, not an unobservable alternative insertion history for integer-index keys. It does not sort ordinary string keys as an equality encoding would.

`CanonicalJSON` is the exact compact result of ordinary ECMAScript JSON.stringify on the tagged tree. There is no leading/trailing whitespace, alternate escaped spelling, comment, trailing comma or extra text within the snapshot. After parsing, `JSON.stringify(parsedTree)` must equal the entire suffix byte-for-text (ECMAScript strings, then UTF-8 for stdout); tag/arity/number/key/prototype validation must also pass. For strings, use standard ECMAScript JSON escaping, including well-formed escaping of lone surrogates; `/` is not unnecessarily escaped. The snapshot's prefix and JSON have no terminal LF; the outer command document has one LF.

These constraints are equivalent to the current owner's decode-then-reencode canonicality check for this data domain. Consumers do not need that private reencoder: lexical canonicality plus the grammar, finite-token spelling, key-order/uniqueness and prototype-depth checks suffice.

## Ordinary consumer decoding recipe (specification pseudocode)

This selected external recipe is specification pseudocode; its test-side realization and command remain unimplemented. Implement that realization tests-first in this child. It uses only the successful stdout document plus JSON and ordinary language facilities; it must not import microdelta, @microdelta/value, generated declarations, repository aliases or package deep paths. A consumer can instead retain the validated tagged tree as a language-independent structured value if its host cannot faithfully represent ECMAScript prototype/undefined/Number meaning.

```text
READ_SUCCESS_FACT(commandStdout, expectedSelection):
  Parse exactly one outer JSON document with one framing LF; reject extra text.
  Validate format/version, closed selection/result field shapes, and that the
    echoed exact selection equals expectedSelection.
  If result.kind = "failed": return an explicit failure with its finite code.
  Require result.kind = "fact", encoding = "MDS1", snapshot a string.
  Require snapshot starts with the exact prefix "MDS1|".
  suffix := snapshot after that prefix.
  tree := ordinary JSON.parse(suffix).
  Require ordinary JSON.stringify(tree) equals suffix exactly.
  value := DECODE_NODE(tree, customDepth = 0).
  Return an explicitly successful answer holding value, even if value is
    undefined, false, zero, empty or null. Do not infer success from truthiness.

DECODE_NODE(node, customDepth):
  Require node is an array; match one exact tagged production and arity.
  u/n/t/f: return undefined/null/true/false, respectively.
  s: require its payload a string; return it literally.
  d: require a string token; decode the four special tokens exactly;
     otherwise parse Number and require finite + exact String roundtrip.
  a:
    Require its slots payload an array. Allocate an ordinary array whose
      length is exactly the number of slots.
    For each index i: if its slot is exactly ["h"], leave i absent;
      otherwise define own enumerable data slot i as DECODE_NODE(slot, customDepth).
    Freeze the completed array; return it. Never fill holes with undefined/null.
  o:
    Require the entries payload an array; validate the exact prototype form.
    p-null -> prototype null; p-object -> ordinary Object.prototype terminal.
    p-custom -> require customDepth < 2 and its payload syntactically a Record;
      prototype := DECODE_NODE(payload, customDepth+1).
    Create a fresh record with that prototype, without assigning user keys.
    For each ordered entry: require [stringKey,valueNode] exact arity and a key
      not previously seen; decode its value at customDepth (not reset to 0).
      Define an OWN ENUMERABLE DATA PROPERTY using Object.defineProperty,
      initially writable/configurable so the record can later be frozen.
    Require Object.keys(record) equals the supplied entry-key vector in order.
    Freeze the completed record; return it. Custom prototypes were separately
      decoded/frozen; never freeze or mutate shared Object.prototype.
  Otherwise reject: unknown/malformed tag, wrong arity/type, illegal h/p-* use,
    duplicate/reordered keys, bad Number spelling or excess prototype depth.
```

Array descendant decoding also preserves `customDepth`, as the `Node(d)` grammar states. JSON.parse creates an ordinary finite tree with no references to executable author code. The recipe never evaluates names, imports modules, calls getters/toJSON from a supplied object or accepts an arbitrary object graph. Its construction must use data-property definition: assignment to `record["__proto__"]` is forbidden because it could invoke the inherited prototype setter and change lookup meaning. An own data key called `__proto__` is ordinary data and cannot change the explicitly decoded prototype. Likewise a `constructor` key is data, not constructor invocation. Do not use eval or dynamic prototype/class lookup. Freeze only newly decoded arrays/records/custom prototypes; do not alter intrinsic objects.

Consumer use of a decoded value must preserve the distinction between data and application actions. In particular, ordinary JSON.stringify of that decoded result is not a replacement transport: it loses undefined, holes, special numbers/-0 and prototype information. Consumers that only need to inspect fields can inspect the tagged tree directly.

## Independent known-wire examples and later external proof

These examples are literal expectations, not strings generated by the internal encoder during the test. They cover exact supported facts selected beneath an ordinary published payload (root member `value` semantics are not changed).

| Selected fact | Literal `snapshot` string | Independent consumer check |
| --- | --- | --- |
| present undefined | `MDS1\|["u"]` | successful answer; value is undefined |
| null | `MDS1\|["n"]` | value is null |
| false | `MDS1\|["f"]` | value is false |
| zero | `MDS1\|["d","0"]` | value equals 0; Object.is(value,-0) false |
| negative zero | `MDS1\|["d","-0"]` | Object.is(value,-0) true |
| NaN | `MDS1\|["d","NaN"]` | Number.isNaN(value) true |
| positive/negative infinity | `MDS1\|["d","+Infinity"]` / `MDS1\|["d","-Infinity"]` | exact infinity sign |
| empty string | `MDS1\|["s",""]` | exact empty string |
| sparse length 2 array: hole then present undefined | `MDS1\|["a",[["h"],["u"]]]` | length 2; own index 0 absent; own index 1 present and undefined |
| ordinary ordered `{b:2,a:1}` | `MDS1\|["o",[["b",["d","2"]],["a",["d","1"]]],["p-object"]]` | Object.keys = b,a; ordinary prototype |
| null-prototype record with literal own `__proto__:"literal"` | `MDS1\|["o",[["__proto__",["s","literal"]]],["p-null"]]` | prototype null; own __proto__ value literal |
| keys-operation fact `["b","a"]` | `MDS1\|["a",[["s","b"],["s","a"]]]` | ordered dense string vector b,a |
| own false over inherited key | `MDS1\|["f"]` | absence of own key stays false |
| membership true over that same key | `MDS1\|["t"]` | inherited presence stays true |

Complete custom-prototype example: selected record has own `own:false`, with one data prototype holding `inherited:0` and ending at null. Its exact snapshot is:

```text
MDS1|["o",[["own",["f"]]],["p-custom",["o",[["inherited",["d","0"]]],["p-null"]]]]
```

The ordinary consumer obtains own keys `["own"]`, own lookup `own=false`, inherited lookup `inherited=0`, no own `inherited` property, and a null-ended custom prototype whose own keys are `["inherited"]`. Every created node is frozen. No intrinsic prototype is serialized or modified.

## Tests-first acceptance

After the owning-document-first task, add intended-outcome and negative assertions before each new handler/dispatch/transport mechanism. Observe and retain genuine expected failures; existing owner outcomes are passing controls, not fabricated owner REDs.

The following criteria all apply:

1. Run the **installed executable** from a fresh ordinary consumer directory. Publish the fixture with the existing ordinary History authority in test preparation; no manufactured result/index rows. The consumer reads stdout using standard JSON and the documented recipe realized in test code, with no project paths, private packages/decoder imports or repository alias resolution. Match the literal snapshot strings above and independently expected semantic checks. Do not generate all expected strings with encodeSnapshot or compare only two private-codec calls. No new exported consumer API is required.
2. Cover literal punctuation/empty/`__proto__`/`constructor` keys, standard integer-key enumeration, both terminal prototypes, one and two custom edges, and nested data inside custom-prototype trees so the accumulated counter cannot accidentally reset. Equal-but-distinct subtree occurrences decode as distinct objects. Sparse-hole/present-undefined and own/inherited membership controls remain independently meaningful.
3. Decoder-recipe negative fixtures must reject unknown command version/encoding/prefix; unsupported tags; every wrong node/prototype/pair arity/type; top-level or record-value h; p-* outside prototype position; custom prototype array/scalar; duplicate keys (including __proto__); noncanonical integer-key ordering; bad Number token spellings; whitespace/noncanonical JSON escapes/trailing text; and a third custom edge, including one reached through a data property in a prototype subtree. These are external consumer tests, not proof of malicious native/storage behavior. The CLI emits only supported output; its existing encoder's refusal controls remain owner evidence.
4. Keep existing #309 exact-reference/narrow-loading/native-release evidence as the **library layer**. At the handler layer assert exactly one identical fact request to the facade and no lookup/retry. Installed-bin tests select an old reference after later publication and a narrow fact next to a large unrelated field; a small stdout document alone is not proof of narrow native loading. Do not add an owner observer API to instrument the installed command. Reuse the existing generated-statement instrumentation in `packages/core/test/history-selection/history-selection.test.ts:68-104` and pair its actual load evidence with installed dispatch/selection evidence.
5. Retain small installed-process healthy closed-WAL/active-writer and supported refusal checks, zero author/module/workspace/claim/write callbacks, and unchanged start/observe behavior. No #302 campaign/#272/#301 qualification is rerun. Tests and attribution must distinguish installed integration, existing owner proof and honest injected failure controls.


6. **Grammar, dispatch and exact errors:** unknown/duplicate/missing flags, extra positional/program/module/SQL/follow/control options, malformed/unknown-field segments and invalid/coercible indices fail before resolve/open/read. Exercise literal punctuation/empty keys and -0 index semantics. A narrow fake host/read composition must prove exact request/argument identity where applicable, read exactly once, no read retry, no module/workspace/source/body/claim/write callbacks, owner release before encode/output, false/zero/undefined success, exact safe typed error mapping, thrown undefined and AggregateError, and stdout/stderr/codec/path failure behavior. In particular stderr failure after invalid input yields 1 and still zero reads. Label injections honestly; they do not establish real native end/close malfunction.
7. **Durable intent and package boundaries:** document module/API/constant/abstraction meaning, responsibility, relationship and invariants, not task progress. Preserve strict TypeScript, type-aware lint, generated sibling declaration resolution, intentional release tags/TSDoc and existing architecture boundaries. No casts/suppressions/check weakening to satisfy fixtures; skipLibCheck requires explicit user approval. Use Jest runtime behavior and tsd type contracts. Add the direct Machine dependency/lock metadata needed for constructor identity, without public decoder/API promotion.
8. **Delivery and acceptance evidence:** a different agent must adversarially review all changed source/tests/docs **before any push or PR**. Address actual findings using tests-first repairs and fresh affected checks. Run affected installed CLI suites, strict/type-aware lint, generated declaration and import-boundary checks; run required sequential `npm run check`, `npm test`, `npm run build` on the final candidate. Preserve start/observe behavior and all existing #309 owner proofs. Prepare the repository PR template with `Refs #CHILD_NUMBER`, truthful implementation/agent attribution, named acceptance-to-test/artifact mapping, observed RED/GREEN commands and limitations; validate its saved body with `npm run check:pr-metadata -- --body-file BODY_PATH` and its configured metadata tests. Do not use a close keyword for parent #167.


## Explicit exclusions and preserved goals

No attempt/result/store enumeration, locator discovery, latest/current lookup, acceptance/currentness evaluation, dependency/reuse explanation, plan reconstruction, resource/Accounting browsing, preview current/recent ordering/retention/gaps, subscription/follow, assertion command, fingerprint verb, callback/lazy-view lifetime or retained-member-policy selection is included. No initializing Accounting opener is reused for inspection. The full standalone command family and its remaining output/store/lifetime/foreground-versus-detached alternatives remain deferred in their owning plans.

This child does not complete broad CLI-001–004, TEST-4.9, #165, #167, M6 or M7. It does not change accepted first contribution-report delivery, implement nested report integration, run provider-backed work, qualify actual #301 rows, rerun #272 scale or spent #302 campaigns, expand capture policy, adopt adaptive rate behavior, or change any #296 REJECT/#302 historical disposition. Existing read-only observation permissions and #309's bounded physical guarantees stay distinct. No failure or incomplete evidence is relabeled as accepted merely because this command is installed.
