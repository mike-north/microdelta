# Source-to-emitted artifact boundary

TRK-2 selects the actual called function's emitted `Function.prototype.toString()` text as bounded implementation evidence, paired with tracked reads/calls under TRK-4. Source edits matter through the declared compiler policy, not through a promise that arbitrary source formatting is ignored.

Frozen runtime: `7a629f94d83366131e4aa25e541a24e41db744fa`. Executed local fixture/runner source: `67f37f9` (full pin in receipt.json). The final sanitized evidence commit preserves those exact four fixture and runner byte hashes; only captures/reports were added or normalized afterward. The local pre-sanitization commit is not a required public support ref. A fresh Git archive had no dependencies or generated outputs. The unchanged default command below installed dependencies, built packages, strictly compiled Core tests, passed type-aware lint on all four fixture sources and passed four Jest cases / twelve fresh Node processes. Every frozen production source file remained byte-identical. No product fix or provider ran.

| Source edit under the same compiler policy | Emitted leaf bytes | Cold / edited / repeat bodies | Exact reference |
|---|---|---|---|
| Add a source comment; `removeComments: true` | Identical | 1 / 0 / 0 | Same throughout |
| Change token spacing, preserving line layout | Identical | 1 / 0 / 0 | Same throughout |
| Put the multiline body on one line | Different | 1 / 1 / 0 | New on edit; repeat keeps it |
| Change multiplication by 2 to multiplication by 3 | Different | 1 / 1 / 0 | New on edit; repeat keeps it; score 6 becomes 9 |

Each case uses an independent SQLite store and three separate process lifetimes, with distinct request keys. The facade declares the imported leaf and intermediary in helper slots; the memo observes both through normal calls. The leaf's TypeScript source is recompiled by the actual repository compiler before each variant. It extends tsconfig.base.json with every strict check intact and an explicit build-artifact policy: remove comments, omit source/declaration maps and declarations. The byte-equality claim covers the whole emitted leaf JavaScript file; it does not cover omitted maps or arbitrary toolchains.

The changed callable is a positive invalidation sensitivity control. The line-layout case establishes a useful conservative rerun with unchanged score. Complete source/emitted hashes, source text, emitted text, compiler status/stdout/stderr, process status/stdout/stderr, actual locators, values and body counts are in captures/final-clean-four-case/cases.json. Separate install/build/types/lint/Jest command receipts include timeouts, elapsed time, statuses and log hashes.

## Preserved attempts

The first clean bootstrap passed install/build/types/lint, then two tests passed and the formatting equality precondition failed: TypeScript preserved the one-line body layout. That assertion fired before the formatting variant's edited-process run. It was a mistaken fixture premise, not a product failure. captures/initial-layout-precondition retains exact initial source and receipts; its two successful cases are not added to the final count. The corrected three-case run then passed; captures/corrected-three-case retains it separately. The final four-case fresh-archive run supersedes those attempts for the final result. No test-first product-implementation chronology is claimed.

## Reproduce

From a checkout of this evidence branch with Node 24/npm and the native build prerequisites available:

```sh
python3 scratch/gap-hunt/source-artifact-boundary/reproduce.py
```

The command installs with npm ci, builds packages and runs only the focused strict/lint/Jest checks. Default output goes to .test-build/source-artifact-boundary; MICRODELTA_BOUNDARY_OUTPUT can select another directory. The executed clean validation used a separate empty archive and external output directory. No checkout or provider mutation, paid execution, publication, Linux execution or general invalidation-soundness conclusion follows. No issue is proposed because all four intended finite outcomes passed.

Implementer: Codex worker (GPT-6.1 Sol), operating for Mike North. Agent assistance: the supervising Codex agent scoped the evidence and requested the preserved line-layout control. Independent review is pending; no human implementation review is claimed.

Public capture normalization: one intermediate Watchman warning contained the local checkout path. It is replaced by `<evidence-checkout>` in the public copy; that command receipt retains the raw digest separately. Final clean-archive captures require no normalization. The unpushed preliminary history was squashed onto frozen7a before publication preparation.
