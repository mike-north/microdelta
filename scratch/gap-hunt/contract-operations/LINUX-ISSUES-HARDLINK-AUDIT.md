# Live native-install issues and hard-file-alias interpretation

Read-only audit on2026-10-23. Live #157/#158 fetched through the root identity-enforcing `gh-personal.py`; complete body/comment snapshots are `issue-157-live.json` and `issue-158-live.json`. No GitHub edits/comments, new issues, implementation-agent messages, root-status edits or runtime reruns occurred.

## Live #157/#158 match the supplied evidence

The exact owner report `.worktrees/linux-parity-results.md` and existing `owner-linux-parity.md` have identical SHA256 `8bf1dae159c3bc20db5133dc011b62d240f8856a2d80b0aca83536b2c65c7e4f`. This worker inspected the report, not its remote raw logs. It records mainc5802da on Linuxaarch64 Node24.13.0/26.12.1: independent native installs/build/full npmtest pass; eight installs/builds pass; no install/build/subprocess launch failure. It explicitly records the hard-file-alias failure rather than calling it writer-fencing success. The report has no pnpm approval run and no same-store cross-version sequence.

- **#157 OPEN, updated2026-10-23T07:47:35Z.** Title “Document native SQLite build approval for pnpm10/12 consumers”. Its Linux update quotes the owner report and says “Those runs used **npm**, not the pnpm10/12 approval scenarios in this issue.” Correct. Its statement “The pnpm-specific Linux command remains unexecuted in the supplied matrix” is also correct. It references the later successful macOS CLT/cross-version control and explicitly says it does not test pnpm approval. The documentation-only scope remains; Linux npm success neither closes nor invalidates this pnpm requirement.
- **#158 OPEN, updated2026-10-23T07:51:21Z.** Title “Document native SQLite toolchain setup and macOS Node26 linker diagnostics”. Current lead: “an observed macOS Node26 native-driver build failed at the SDK linker; a consistent local CLT compiler/linker/SDK selection now builds successfully. Linux Node26 works in the supplied parity run.” Correct. Linux versions/commit/independent installs match the report. The original linker failure, intervening stdio.h failure, successful consistent CLT recipe, upstream engine warning, and runtime controls remain separate.

Latest CLT source evidence inspected directly: `node26-clt/REPORT.md`, `cross-version.log`, `DIAGNOSTIC-158.md` and `diagnostic-validated.json`. Independent Node24.22.1/26.12.0 installs atbbd2c1e pass24→26→24 and26→24→26: bodies1/0/0, same exact locator/payload. The actual clean native diagnostic atfaa7d25 reports Node26.12.0/ABI147 Darwinarm64, npm11.20.0, install0/smoke0 plus native-sqlite-open-query-ok, global xcode-select unchanged. Current #158 correctly includes these controls; driver12.9.0's Node20–25 metadata warning is not runtime incompatibility evidence.

**No new misleading live issue conclusion was found.** Historical wording that could be misleading if quoted alone remains visibly superseded/scoped:

- #157 original severity paragraph: “these controls are Node24 evidence and establish no Node26 or Linux support.” This is true of those earlier macOS controls; it must not be detached from the later Linux/CLT update and presented as today's whole evidence set.
- #157 earlier recipe paragraph: “Verification boundary: Linux execution is still required.” This remains true for **pnpm10/12 approval**, not general native/runtime Linux execution. The later Linux update supplies that qualification. No new Linux rerun or issue correction is needed to address the owner's already handled request.
- #158 old comment6358925438 points to metadata-only verify-158.mjs and says it “does not establish native installation or cross-version execution.” Correct for that old command; current body explicitly marks it metadata-only and points instead to the actually executed native diagnostic. Newer comment6360111565 records CLT success/cross-version evidence.

## Hard-link probe: observed failure, unselected support boundary

Existing exact repro: `packages/core/test/gap-hunt-portability-alias.test.ts`; original macOS result/stack in `scratch/gap-hunt/portability/logs/alias.log` and interpretation in `portability/REPORT.md:45–56`. No duplicate run was needed. The probe seeds and closes a synthetic store, creates a second hard link to its database file, opens both pathnames, and attempts writer acquisition on the first. Both opens succeeded in the original capture, then acquisition failed in History `readWriter` through a real SQLite statement with raw `SqliteError: disk I/O error`. No successful competing writer, stale publication, incorrect exact read or corruption was observed. Linux report atdurabilitybfb1cc3 records the same first substantive failure on both Nodes; it does not include an extended SQLite I/O error code or independently establish the mechanism. The symbolic-file case passes; three durability suites pass. Neither the whole selected Linux command nor the hard-link case may be labelled passing.

**The active spec does not expressly exclude hard links, but it also does not select support for two hard-linked pathnames.** PUB-002 (`execution.md:359–365`) governs fenced ownership mutations; the probe fails before any competing ownership grant, so it does not demonstrate that invariant failing. Selected local single-file WAL process-termination guarantees do not promise every filesystem alias topology. Existing canonical-location conformance explicitly names symbolic links, relative/absolute spelling and redundant segments (`machine-node/src/index.ts:57–61`; `node/location.ts`; `node-location.test.ts:37`). Its implementation is realpathSync.native, which resolves symbolic links rather than unifying arbitrary hard-linked names. The tests do not assert inode identity. The raw I/O error also does not breach an all-error-translation promise: `_typedBusy` atnode/sqlite.ts:100–113 explicitly translates contention only and passes all other errors unchanged.

However, two current explanatory statements are broader than the tested/implemented path boundary and should be narrowed in any documentation follow-up:

> “so two spellings of one file compare equal and distinct files do not” — packages/machine-node/src/index.ts:58–59
>
> “The store's file identity, however the caller spelled its location” — packages/core/src/workspace.ts:795

Hard links are different names for one file, so these sentences should not be treated as a proof of arbitrary same-inode alias support. The narrower preceding symbolic-link/path-spelling language is the executed contract boundary. Earlier local `LINUX-PROVENANCE.md` calling the probe simply “unsupported” is interpretation of this selected boundary, not an express normative hard-link prohibition; this audit supplies that distinction.

Official SQLite guidance supplies independent reason to avoid promising hard-link support: [How To Corrupt An SQLite Database File §2.6](https://sqlite.org/howtocorrupt.html#_multiple_links_to_the_same_file), fetched directly with retrieval time/content hash and excerpt in `sqlite-multiple-links-source.json`, states:

> “If two or more processes open the database using different names, then they will use different rollback journals and WAL files.”
>
> “opening and using a database file that has two or more names results in behavior that is undefined and probably undesirable.”

The same section distinguishes modern symbolic-link canonicalization (since3.10.0) from hard-link warnings. This supports the compatibility boundary; it does **not** prove that this particular in-process probe's raw I/O error arose from a specific sidecar/locking condition. No device/filesystem corruption, missing native binding or platform-wide SQLite failure should be inferred.

## Precise follow-up

No new Linux/native-install execution is needed to reconcile #157/#158, and no writer-fencing correctness issue is established by the alias probe. A **bounded diagnostic/documentation issue would be legitimate** if the supervisor wants to make this consumer failure actionable: document supported path aliases and the hard-link restriction; narrow the broad identity wording; ensure the existing synthetic two-name case is refused or diagnosed clearly without presenting success/fencing coverage. It should preserve supported symbolic-link and ordinary-path positives and avoid deleting/replacing database/WAL files on failure. An early targeted unsupported-location error is a possible implementation choice, not an already selected API or a general mandate to translate every SQLite I/O error.

The current evidence is enough for that scoped support-boundary/diagnostic pickup; it is not enough to demand hard-link interoperability, claim a PUB-002 violation, prescribe inode-based global identity, or file a general Linux disk-I/O defect. If a stricter behavioral issue is desired, first capture the exact SQLite extended error code and failing operation with DB/WAL sidecar provenance under the existing disposable fixture; no rerun was performed for this audit. There is no reason to add an implementation blocker or reinterpret this optional provisional consumer probe as a failed promised hard-link feature.

Implementer: Codex worker (gpt-6.1-sol).
