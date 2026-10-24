# Track F: Markdown first pass; generated-declaration-assisted completion

Frozen base: `7a629f94d83366131e4aa25e541a24e41db744fa`.
Node `v24.22.1`; npm dependencies installed with `npm ci`; full `npm run build` succeeded.
No product edits. No live provider, paid calls, publication or GitHub writes.

## Result

The initial five Jest assertions pass under strict TypeScript and type-aware unsafe-operation linting. Four deterministic records arrive over two cursor pages. The adapter explicitly collects and sorts a complete snapshot; source/memo composition then retains a `{count:4,total:10,ids:[1,2,3,4]}` summary. Separate child processes open the same SQLite file. The first publishes; the second reports `reused` and the identical exact result reference. Both independently traverse `[null,"page:2"]` exactly once. Normal requests use fresh UUID request keys.

Adapter tests reject malformed cursors, repeated cursors (only two fetches), and overlapping records. These are application adapter obligations, not claims that microdelta validates GitHub pagination. Two deliberate generated-output mutations (truncate after first page; add one to every score) fail the tests. Source files are restored/unchanged by controls.

## Markdown-first friction

The root README and facade guide identify the alpha path, builder names and operations but contain no complete authoring example. The contribution-report README describes its source files and semantics; reaching its actual authoring syntax requires source reading. The M3 plan fragment explicitly says it is not compilable/current; the authoring-experience plan explicitly proposes an unimplemented API. Consequently the Markdown-only attempt could not establish source outcome construction, composition registrations, run options or structural resolve descriptors confidently. `pipeline-first-attempt.ts.txt` preserves the literal attempt. This is documentation/onboarding friction, not evidence that the runtime cannot support pagination. Parent must deduplicate against current authoring/examples work before filing anything.

Parent authorized a separately disclosed generated-declaration-assisted phase. Generated alpha TSDoc supplied `outcome.fresh`, `{slot,declaration}` registrations, composition inputs, run `authoring/composition/environment`, and descriptor-based `resolve`. No library implementation, existing test implementation or old probe was read.

Additional compile friction: passing a tracked input array directly to `outcome.fresh` is not assignable to a plain readonly array (`tracked-array-first-attempt.log`, TS2322). Explicit indexed copying of record fields and `fresh<readonly IRecord[]>` works without casts. This is an authoring ergonomics observation, not yet a correctness defect; the intended plain-data boundary and existing output/materialization design need supervisory comparison.

## Setup and self-caused errors

- `examples/contribution-report/package.json` does not exist; example is built from workspace root.
- `npm ci` succeeds, prints dependency deprecation/audit notices; no dependencies changed.
- Initial TS/Jest compile fails TS1259 because Jest's declarations default-import emittery while the base disables synthetic defaults. Scratch-only `allowSyntheticDefaultImports:true` fixes this interop issue; strict checks and `skipLibCheck:false` remain intact.
- Initial adapter test compile observes missing adapter module TS2307 before implementation (`test-first.log`). Pipeline Jest test observes MODULE_NOT_FOUND before implementation (`pipeline-test-first.log`).
- An attempted shorthand paths mapping contained two `*` substitutions (TS5062) and fell back to public declarations (TS2305); this is my harness error. Exact per-package alpha mappings copied from the documented example tsconfig fixed it. `pipeline-first-attempt.log` includes this noise and is not a clean library diagnostic.
- I edited the reproduction shell script while its first execution was still reading it; the shifted file caused a shell syntax error after the successful build. `reproduce-interrupted.log` preserves this harness error; the unchanged final script was rerun from the beginning.
- Toolshed memory was unavailable in the actual callable tool registry; no durable memory used.

## Reproduction and boundary

From a clean checkout of this branch under Node 24:

```sh
sh scratch/fresh-docs-cursor/reproduce.sh
```

The command installs, builds, checks strict TypeScript, lints source/tests, runs Jest, then confirms all three negative controls fail. Public sanitized historical execution logs are in `evidence/`; `SHA256SUMS` covers report, source, configuration, scripts and logs (not itself, generated dist or dependency/build artifacts).

This proves a tiny deterministic current snapshot pipeline and same-store process restart retention. It does not prove live/native pagination, streaming, cursor persistence/recovery, range bisection, M7 scale, real GitHub validators, mid-run refresh, crash tolerance or provider behavior. Native pagination was not invented; optional range bisection was omitted because no current documented API was established. Source policy accepts a previously observed snapshot only after current input evidence validates; fixture data is fully acquired anew before each run.


## Review follow-up: actual source-body traversal

The initial snapshot-input case remains unchanged evidence of acquisition before the run. The separate `source-pagination.ts` case instead calls the cursor adapter from the actual retained source body through declared `collect` and `fetch` helper slots. Its deterministic fake provider logs actual page sends to stderr, and a run observer counts `execute` events by step slot. No mutable counter influences source output. A fixture revision input is accepted only by the current finality policy; this immutable fake revision is not a real GitHub freshness validator.

A test was written and run first: it failed because `source-pagination.js` did not exist (`source-test-first.log`). After implementation, all six tests pass. Cold process: page cursors `[null,"page:2"]` exactly once, `snapshot:1,summary:1`, published count 4 / total 10 / ids 1–4. A separate same-store process: no page calls, no source/summary body executions, `reused` with the identical exact reference and summary. The third negative control forces source finality false; restart page/body-count assertions reject that behavior. The original two controls still reject dropped pages and wrong summaries. This is application cursor traversal within an ordinary source; it does not introduce a native pagination API or make crash/cursor-resumption/scale claims.

## Public-log hygiene and reproducibility

Raw captured logs are retained in private ignored storage, excluded from the branch. `normalize-logs.py` produces the public copies: ANSI formatting is removed; user paths, operating-system temp paths and Watchman recrawl warnings are replaced by disclosed placeholders. `evidence/NORMALIZATION.json` records the SHA-256 of every raw capture and corresponding public copy. Earlier raw-log commit history is removed from this unpushed branch before handoff.

The default reproduction command writes logs to `.test-build/fresh-docs-cursor/run` and restores any mutated generated JavaScript; `MICRODELTA_PROBE_OUTPUT` can select an external log directory. It never rewrites checked-in evidence. A final default invocation in a fresh archive is recorded separately in `RECEIPT.md`. Public logs are frozen snapshots; timings and process identifiers may vary on rerun. SHA256SUMS covers all checked-in probe files except itself, including normalized evidence and normalization hashes. Only the source/test/configuration and explicit report artifacts are published.
