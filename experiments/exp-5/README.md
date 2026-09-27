# EXP-5: native CML correspondence evidence

This bounded fixture tests whether a native Context Mapper DSL (CML) model can
check selected architecture facts already visible in TypeScript declarations. It
does not establish domain behavior, import permission, cache validity or a
production requirement to install Java. The [experiment contract](../../docs/spec/experiments.md)
and [package boundaries](../../docs/spec/package-boundaries.md) govern its scope.

## Reproduce

The run used macOS arm64, Eclipse Temurin **17.0.20.1+1**, Gradle **7.4.2**,
Context Mapper DSL **6.10.0**, TypeScript **5.9.3**, API Extractor **7.59.2**,
`@microsoft/api-extractor-model` **7.33.13**, and Jest **30.5.1**. The checked
Gradle wrapper came from the [official standalone example](https://github.com/ContextMapper/context-mapper-standalone-example)
at commit `87e6b3d60de6f1f7639e8a06ba6fe597f4091bb8`; its bundled wrapper
JAR has SHA-256 `3dc39ad650d40f6c029bd8ff605c6d95865d657dbfdeacdb079db0ddfffedf9f`.
The pinned Gradle distribution ZIP has SHA-256
`e6d864e3b5bc05cc62041842b306383fc1fefcec359e70cebb1d470a6094ca82`.

On this host, the JDK archive was downloaded from the
[Temurin 17.0.20.1+1 release](https://github.com/adoptium/temurin17-binaries/releases/tag/jdk-17.0.20.1%2B1):

```sh
curl -L -o OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz \
  'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz'
shasum -a 256 OpenJDK17U-jdk_aarch64_mac_hotspot_17.0.20.1_1.tar.gz
```

Its release checksum file and the local archive both report SHA-256
`196d13ba5f10414bef7f6a05a9b3f00edacb18ebacef2b99485db9e2ee18f0e8`.
Extract the archive into a local directory, set `JAVA_HOME` to its
`jdk-17.0.20.1+1/Contents/Home`, then run from the repository root:

```sh
JAVA_HOME=/path/to/jdk-17.0.20.1+1/Contents/Home ./experiments/exp-5/verify.sh
```

The script installs the pinned npm lockfiles, invokes the official parser through
the Gradle wrapper, compiles the two fixture workspace packages, emits their four
declaration tiers and `.api.json` models, runs strict TypeScript/type-aware lint,
checks the mapped facts, then runs 17 Jest assertions. It is a separate bounded
command; normal CI does not acquire a Java prerequisite before an adoption
decision. In the verified warm-cache run it completed in about 13 seconds. The
first setup downloaded a 185,851,019-byte JDK archive and a 159,315,974-byte
Gradle distribution, plus Maven dependencies; that setup cost matters to adoption.

## Selected mapping and observed limits

| Native CML fact | Compared TypeScript/API fact | Boundary |
| --- | --- | --- |
| `BoundedContext` ownership | Explicit `mapping.json` context → package/entrypoint and `ApiModel.loadPackage` | CML names do not infer npm package names |
| `Aggregate` → `Entity`/`Service` name | Explicit aggregate object → exported class in `.api.json` | Only two mapped objects; not every helper has a CML counterpart |
| Operation name, parameter names/order, return type | API Extractor model `ApiMethod` and its typed excerpts | Simple strings and one named class reference only |
| CML `package` operation visibility | `@internal` on a generated TypeScript declaration | API Extractor omits internal methods from `.api.json`, so TypeScript's AST supplies this fact |
| CML `public` operation visibility | Native TypeScript public class method | Public member accessibility is independent of `@public`/`@alpha`/`@beta` release tier |
| Cross-context `RecordEntity` parameter | Consumer API method's printed type and canonical producer-class reference | The producer declaration is reached by an explicit sibling alpha `paths` entry; this is not import-permission evidence |

The parser validates [model.cml](model.cml) without new syntax. The bridge uses
`ContextMapperStandaloneSetup.getStandaloneAPI().loadCML`, API Extractor's
maintained `ApiModel` reader, and the TypeScript compiler AST. It does not parse
CML or `.api.json` syntax ad hoc. [mapping.json](mapping.json) selects only
correspondence and artifact paths; it supplies no purported model facts.

The fixture deliberately includes entity attributes, a standalone function, interface, type alias,
native `protected`/`private`/`#` members, and beta/alpha release tiers. Those
are reported as unsupported CML coverage. Compiler AST assertions show native
privacy separately; API-model assertions show release tiers separately. CML
relationships do not grant a TypeScript context-import edge. The existing
PKG-007 consumer fixtures remain the release-tier/import enforcement baseline.

The positive comparison reports zero diagnostics and six explicit unsupported
categories. Mutations of ownership, type and operation names, parameter and
return types, `@internal`, and cross-context type references fail the checker.
The tests also change native `.cml` and TypeScript source, parse/build both again,
and reject a same-named type from the wrong package. They alter generated
API-model/declaration inputs before rereading them with maintained tools. This
supports **Pass for the represented subset**, not general semantic equivalence.
The coverage limit and Java setup cost favor keeping CML as an optional
architecture correspondence tool until a concrete production use justifies its
maintenance; the package tier and import rules remain mandatory independently.
