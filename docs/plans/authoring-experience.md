```ts
import { analysis, memo } from 'microdelta';

interface IPullRequest {
  readonly id: string;
  readonly title: string;
  readonly labels: readonly string[];
}

export const assessment = analysis<{ readonly pr: IPullRequest }>((input) =>
  memo({
    name: 'assessment',
    from: { pr: input.pr },
    run: ({ pr }) => pr.title.length,
  }));
```

# Proposed authoring experience

**Experiment candidate, not an adopted or implemented API.** The goal is an expressive DSL with little machinery. Ordinary function syntax is optional. Existing domain and execution invariants remain authoritative.

Compose a fixed graph once with typed symbolic values. `from` expresses graph relationships once; computation callbacks read ordinary tracked values. Reusable factories import naturally, take symbolic arguments and return composed values. The graph factory executes once; computation and source callbacks do not execute to discover relationships. No custom compiler transform is assumed.

## Complete design fixtures

These `.ts.txt` files are intentionally excluded from compilation: they describe proposed syntax, not supported APIs.

- [One retained calculation](../../examples/authoring-design/01-single.proposed.ts.txt): a title-length result; unread labels do not become dependencies.
- [Reusable argument-bearing composition](../../examples/authoring-design/02-reusable-and-composed.proposed.ts.txt): an imported factory and a report that consumes only its scalar score. The file clearly separates its two modules.
- [Keyed source analysis](../../examples/authoring-design/03-keyed-source.proposed.ts.txt): a fresh application-supplied catalog snapshot, one fixed member template and a strict report.
- [Application bootstrap](../../examples/authoring-design/application-bootstrap.proposed.ts.txt): workspace lifetime, scope/environment/request identity, status handling and complete local JSON validation. The source variant lists its entry/input substitutions explicitly.

The source example reads and validates the file each process invocation. Its source callback must also execute beneath a retained parent and publish a new source result even when the supplied snapshot is equal; reading the file alone does not prove source acceptance. Its declared source policy accepts that current snapshot with no finality shortcut. It promises neither a filesystem watch nor mid-run refresh. A remote source would still need its own explicit current checking/retrieval/retention policy.

## Meaning of the remaining constructs

| Construct | Why it exists | Boundary |
| --- | --- | --- |
| `analysis` | Builds and freezes the declared graph from symbolic inputs | Cannot resolve data or execute bodies during construction |
| `IBinding<T>` in reusable signatures | Distinguishes composition values from runtime data | Not a declaration of fields to observe |
| `from` | Names each graph relationship once | Actual field dependencies remain discovered by tracked reads |
| `memo.name` | Explicit stable occurrence name; also the default complete subject | Never inferred from a TypeScript variable, display label, registration order or function text |
| `subject` override/selector | Chooses domain history identity when it differs from occurrence | Complete opaque author string; no hidden suffix or namespace |
| `keyed` | Declares one member recipe, instantiated by explicit keys | Recipe runs once symbolically, not once per member to build topology |
| `using` for helpers | Explicit current callable capabilities without a global registry | Arbitrary imported closures are not inferred safe |

An explicitly authored name can supply both occurrence and default subject when the author wants the same string. [RES-001](../spec/execution.md#res-001--a-subject-is-the-authors-complete-opaque-identity) requires a complete author-provided opaque string and forbids deriving it from a **display name**. Here `name` is an identity declaration; display labels remain separate. The proposed default copies that exact string without reinterpretation. If implementation treats it as display metadata, this compression would conflict with RES-001 and must be rejected.

Occurrence names are local to their composition scope; complete subjects must satisfy analysis-wide uniqueness. Two factory instances need distinct explicit occurrence names, such as `primary` and `secondary`. Passing the same already-built node twice preserves aliasing. A reused factory does not acquire identity from its function name. Keyed assessments explicitly choose `assessment:${pr.id}` as their subject; the framework must not silently append a key. Distinct retained rubrics for one PR require distinct complete authored subjects. Explicit aliases may intentionally share one history; they must preserve that declared relationship, never silently merge unrelated occurrences. An intentional single history with changing scoring inputs is a different author choice. Structural occurrence correspondence and history identity remain separate even when their strings coincide.

## Assumptions and costs to test

| Assumption | Required evidence / cost |
| --- | --- |
| Symbolic composition can replace duplicated registry/descriptor wiring | Freeze copied topology, preserve named current relationships, reject missing/multiple targets before admission (CMP-1/6/9) |
| Bound values preserve argument origins and child boundaries | Restart reconstruction without stale argument substitution; child reexecution with equal consumed output retains parent (CMP-5/7) |
| Callbacks receive ordinary values without losing selective reads | The experiment lowers author-facing numbers internally; current alpha intentionally restricts roots to records/arrays (#156). Selected views and exact references remain distinct |
| Imported factories and helper capabilities identify current code | Current body/helper implementation changes invalidate relevant work; tracked capture enforcement remains bounded (TRK-2/4) |
| Source and keyed composition retain their existing meaning | Current source policy beneath retained parents, stable member keys, open/failed population handling and strict coverage (REUSE-002; CMP-4/8) |

The proposed first prototype covers one or two numeric nodes with fixed subjects, symbolic `from` edges and selected input views. It may use `input('pr')`; the leading `input.pr` sketch remains aspirational, and no executable surface is adopted. The [prototype charter](authoring-prototype-charter.md) records internal bridges, required proof, baseline gaps and later pressure cases.

One material alternative is direct runtime callable memos plus a mandatory build-derived relationship manifest. It removes `from`, but adds custom build integration, restricted analyzable syntax, stable emitted call-site identity, source maps and fail-closed manifest validation. That tooling burden is why symbolic composition is the preferred experiment. No public API shape is adopted.
