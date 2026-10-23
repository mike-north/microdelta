# PR199 / issue174 independent documentation review

PASS within the six documentation acceptance criteria at exact source
`e42e31b7e618222e8a57b67d94b88b51e0c4e14b`. No product runtime change was needed
or found. The owning path identity mechanism remains Node Machine's
`realpathSync.native`; History/Supervision still own writer/publication policy.

Run from the repository root with Node24, npm and Python3:

```sh
python3 scratch/gap-hunt/review-199/replay.py
```

The default runner prints an external temporary evidence directory, installs its
own locked dependencies through the original verifier, builds owner/facade
packages, typechecks Machine Node/core, compiles Machine tests, and runs only the
existing three canonical-location tests plus five original documentation checks.
It also runs affected-package strict/type-aware lint checks and a token/link check.
The unchanged helpers are temporarily installed at their original paths and
removed/restored afterward. No inherited reuse flag can skip fresh setup; only the
negative/restored invocations reuse this invocation's completed owned build.
Source/doc/helper bytes are restored in `finally`. Committed captures are not
written by replay.

## Acceptance mapping and observations

1. The shared guide names existing-file absolute/relative spellings, redundant
   segments and symbolic links. Distinct hard-linked names remain distinct
   canonical paths; a missing file is refused, not created by the path API.
2. It prohibits concurrent access to one WAL database through distinct hard-linked
   names, explains database-path-derived journal/WAL sidecars, and links official
   SQLite §2.6. It explicitly avoids inode normalization or hard-link
   interoperability promises. Modern supported symbolic aliases remain separate.
3. Root, facade and contribution-example README links resolve directly to the
   same guide. The facade/example identify this as the project-private alpha
   durable workspace; the public memory Store remains process-local/non-durable.
4. Both requested owning comments now name supported pathname/symbolic identity
   and distinguish hard-linked names. Neither retains its old unqualified
   same-file/all-spellings implication. Ownership remains explicit.
5. The two original helpers are byte-identical to frozen
   `275124b32fbd1b960cf8fa46b5e341b51dfdb38e`. Fresh current execution passed
   canonical **3/3** and documentation **5/5**. Restoring only the six prior
   docs/comment files from main parent `52e3786516a404e3433bef03807a027c8103786c`
   produced canonical **3/3**, then exactly **five intended docs assertions**
   failed (exit1). Source restoration passed canonical **3/3**, docs **5/5**
   again. This independently checks the before/after counterfactual; it does not
   claim to have witnessed the implementer's chronological pre-edit execution.
6. The issue-specific diff is exactly six files. TypeScript scanner token streams
   of both changed source files match their pre-change versions after trivia is
   removed: comments only. There are no dependency, runtime, driver, API-shape,
   release, or publication edits. Affected Machine Node/core strict/lint checks
   passed. No full test or hard-link runtime probe was invoked.

All six commands returned the exact expected exits; no runtime/load failure was
accepted as a negative. Negative docs checks retain every original assertion.
The default original verifier's fresh bootstrap occurred at the exact PR head in
a new isolated checkout without node_modules. The evidence recipe was authored
locally around those frozen helpers; the later evidence commit is not separately
runtime-replayed. The tracked source tree was clean after terminal execution,
before intentionally copying normalized captures into this evidence directory.

## Alias and SQLite evidence boundary

`frozen/alias-fixture.ts` and `frozen/alias.log` are historical evidence copied
unchanged from275124b, not new execution or required hard-link support. The
symbolic-file case passes: both handles observe one fenced writer, and the second
reads the exact reference published through the first. The provisional hard-link
case fails at first writer acquisition with raw `SqliteError: disk I/O error`.
It establishes no competing writer grant, stale publication, corruption, or
specific extended SQLite error mechanism. The documentation makes no such claim.

`frozen/sqlite-multiple-links-source.json` retains the dated/hash-qualified official
SQLite §2.6 excerpt. It explains distinct database names can select distinct WAL
and rollback-journal files; modern symbolic canonicalization is distinguished
from hard-link warnings. This supports the practical restriction without proving
why that particular historical in-process I/O error arose.

This is finite macOS arm64 Node24 evidence. No new Linux qualification, hard-link
interoperability, inode identity, all-I/O translation, native installation change,
paid-provider execution, or package publication is implied.
