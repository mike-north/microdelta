# PR200 / issue175 bounded Resolution qualification

Subject: `1c0adc28df18b167bd4f7a7254108baad7457ea7`, based on
`5e3b2feba7191d6d643e571492730e5344b73b22`. This evidence branch changes no
product implementation. Run `python3 scratch/gap-hunt/review-200/reproduce.py`
from its worktree root. It installs the lockfile, rebuilds the locked native
History addon, builds generated packages, checks the Resolution owner and runs
only the named owner/assembly/control witnesses. It restores every source plant
and removes transient owner fixtures on both success and error. The successful
recipe additionally rebuilds the normal package and owner-test JavaScript; an
interrupted failed recipe guarantees source cleanup but may require rebuilding
ignored emitted artifacts before reuse. Raw outputs go
to a fresh temporary directory. Committed captures are path-normalized copies.

## Eight issue criteria

1. The factory `_createResolutionWithChildService` is an owner-supported deep
   module seam. A supplied service receives the actual current child invocation
   and a normal continuation; the normal entry supplies only that continuation.
   The seam is after current Definition reconnection and supplied argument/subject
   reconstruction. It does not replace the parent Resolution algorithm.
2. Original owner equal-output test arms all four actual child sentinels at once,
   retains the exact parent reference, consumes a new current child reference in
   acceptance, and observes real parent query/historical integrity/output reads.
   Supplemental equal-output witness additionally reconnects a changed current
   child subject, counts zero parent bodies, changes unread output and checks the
   old completed envelope remains byte-identical under JSON serialization.
3. Original changed-score test checks new parent payload and current child edge.
   Supplemental changed-score witness counts exactly one parent body, requires a
   different parent reference and checks old envelope immutability. Two service
   calls are expected: validation and the ensuing parent execution.
4. `execution-required` on check stays uncertain at the child boundary; refusal
   stays refused; failure rejects and cannot add parent acceptance. Supplemental
   tests count zero parent work for check/failure, preserve exact thrown error
   identity, and prove a missing exact current reader value is not replaced by
   historical data. That last test exercises the fake History reader's failure,
   not an assertion that arbitrary dishonest service outputs are validated.
5. Candidate eligibility, finality, admission and body sentinels all remain
   unreachable on fake-child validation. Four normal-route positive controls
   independently reach each sentinel, and a normal-continuation count control
   reaches every stage. The typed counterfactual forces the factory to ignore
   substitution and call the normal continuation. It is an injected fault, not
   a current product defect; exact semantic failures are captured separately.
6. Existing `nested/restart.test` exercises actual child resolution in fresh
   processes. The original 29 mutation anchors remain valid. The five #144
   witnesses and five controls are transplanted byte-for-byte from PR197 source
   `b5bf8275e1f724aa5d5233d5023729d5430d90d0`, with a temporary runner selecting
   only those last five controls and that witness suite. This is cross-stack
   qualification on PR200, not a claim PR200 contains the unmerged PR197 files.
7. Definition reconnects current bindings. Tracking determines selected output
   facts. Resolution retains comparison, current validity, admission calls and
   parent decision. The fake in-memory History port stores exact references,
   immutable envelopes and acceptances separately. Its Node host provides only
   hash/context capabilities. No invariant moved into Machine or the facade.
8. Owner strict TypeScript, type-aware lint, tsd/public consumer checks and package
   build apply. Fake outcomes satisfy existing declared types. No casts or new
   suppressions are added by the supplemental derivative. The derivative includes
   the original 15 cases for fixture reuse but runs only its five new cases;
   those skipped duplicates are not additional witnesses.

## Original static diagnostic

`frozen/arc008-surface.mjs` and `ARC-008-LITERAL.md` preserve exact original bytes
from `018f25dd593a52b92b8121ec74c5f7ad7ff08eb4`. The original diagnostic expects
four recursive functions lexically inside `createResolution`. PR200 moves them
inside its internal factory. Its current-source exit 1 with the exact assertion
`Expected the actual lexical child-resolution routes` is therefore an obsolete
representation census, not a failed runtime behavior. With only Resolution
source temporarily replaced by exact prior `5e3b2fe` bytes, the same diagnostic
exits 0 and records the old lexical routes. Source is then restored. Neither
result is used as the semantic fake-child test. Missing imports or compiler
errors from the pre-seam source would be invalid negative evidence and are not
used.

## Declaration boundary

The three new deep-module names are absent from unchanged package barrel and
all generated API tiers; package exports still exposes only `.`. Existing
same-owner `current.ts` implementation exports follow the same pattern. Under
PKG-003/004/005 this is an owner implementation collaboration, not a package
entry-point API promotion or sibling source alias. Source TSDoc states that
boundary. The supervisor accepted this bounded classification; no release tags
or type promotion were added by review.

## Limits and disposition

This is bounded Darwin/arm64 Node execution at the named source commit. It does
not repeat full repository CI, run Linux, authorize provider execution, publish
packages, or prove arbitrary fanout/concurrency. The in-memory History fixture
is intentional isolated-port evidence, not SQLite durability proof; fresh-process
assembly and #144 controls are distinct evidence. Implementer-reported test-first
history is not independently replayed here. The service-bypass negative supplies
independent sensitivity evidence after implementation.

The first captured run deliberately installed with scripts disabled but omitted
the native-addon rebuild. Its eight assembly failures were missing-addon setup
failures, and are excluded from runtime acceptance. A default-SDK rebuild then failed in the host linker on macOS27 SDK arm64e.x1 entries. A command-local installed macOS26.5 SDK rebuild succeeded. The final runner records and applies that SDK selection for the addon only, before any assembly test. No global toolchain setting changed. Source restoration is checked.

Once the successful exact-source captures and independent review are accepted,
the precise proposed historical74 overlay change is only ARC-008: from missing
isolated fake-child evidence to passing at PR200 source with this bounded owner
proof, plus distinct fresh-process and #144 preservation qualification. Keep the
historical denominator 74 unchanged and keep CMP-8 gate-kind insufficient; do
not rewrite original static findings or count supplemental tests as rows.

Attribution: evidence authored and executed by Codex worker `/root/contracts`
(GPT-6.1 Sol) for Mike North. Product implementation remains the PR200 author's;
independent artifact/semantic review is reported separately by its reviewer.

## Captured results and final guard qualification

The successful captured recipe has 24 commands: original **15/15**, supplemental
**5/5** (15 derivative duplicates skipped), fresh-process **8/8**, #144 witnesses
**5/5**, all **29** original anchors, and **five** #144 mutations each rejected by
its corresponding sole witness. Typed service bypass produces **8 failed/7
passed** original cases and **4 failed/1 passed/15 skipped** derivative cases.
The unchanged supplemental check-only case still passes under bypass; this is
explicitly not presented as independently sensitive. Restored original15 and
supplemental5 are green with identical title inventories.

After capture, only guards and read-only API-report coverage were strengthened:
clean tracked start; full production tree equality to the source pin; absent
transient paths; 900-second subprocess timeout; corrected Jest runtime-error
field check; exact eight/four negative title inventories, counts and semantic
message fragments; and API report exclusion alongside the existing four API
rollups. `judge-captures.py` accepts the captured negatives and rejects four
synthetic corruptions (empty assertions, renamed failure, runtime-error suite,
wrong sentinel). `guard-qualification.json` independently hashes all 798 tracked
production files against the source pin, verifies absent transient files and
records restored owner-test/package emitted JavaScript hashes. Their executable
bytes match after removing the package-only source-map comment. These are
post-capture guard qualifications; the full workload was not rerun for them.
The runtime fixtures are unchanged. The original captured 24-command recipe
was not rerun for guard changes.

A separate appended command then executed the canonical original **29 semantic
mutation controls** against the exact restored PR200 package: baseline73 and
restored73 green; every mutant had at least one rejecting semantic witness.
`existing29-controls.log` and `existing29-receipt.json` preserve this distinct
execution; the emitted package hash equals the restored successful-recipe hash.
The current runner now includes this command after the original anchor check.
It is therefore a 26-command reproduction recipe including the later semantic
judge, while the original captured full recipe remains the documented24.

Parent review identified that a preflight rejection inside try could delete a
preexisting transient in finally. All preflight assertions now precede try.
The clean committed runner was invoked with an actual preexisting sentinel file;
it rejected on the absence guard, preserved the exact bytes and began no
workload (`preexisting-file-guard.json`). This guard-only correction required no
repeat of the successful runtime witnesses.
