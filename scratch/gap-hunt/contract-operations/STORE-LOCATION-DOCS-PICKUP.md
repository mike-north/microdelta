# Document the canonical store-location alias boundary

## Consumer need and actual contract

An author choosing the location of a project-private durable workspace needs to know which filesystem names are interchangeable before opening a SQLite WAL store. `canonicalNodeLocation` provides an **absolute real path** for an existing local file: relative/absolute spellings, redundant segments and symbolic links resolve to the same canonical path. Different hard-linked names are distinct canonical paths. Authors must not concurrently access one SQLite WAL database through those different hard-linked names; associated journal/WAL names make that unsafe. This is documentation of the existing path API and backend limit, not a proposal to normalize inodes or support hard links.

Current TSDoc overstates its scope: `packages/machine-node/src/index.ts` says “two spellings of one file compare equal”; `packages/core/src/workspace.ts` says “however the caller spelled its location”. The supported symbolic/path scope is narrower. `canonicalNodeLocation` is project-private alpha and implemented by `realpathSync.native` in Node Machine. Host identity mechanics remain Machine-owned; writer/fencing/publication policy stays History/Supervision-owned. No implementation change is needed for this pickup.

Live duplicate check: identity-enforced `gh issue list --state all --search 'hard link'` plus the complete current open issue title list found no existing dedicated alias-boundary issue. Snapshots: `hardlink-queue-live.json` and `store-location-open-queue.json`. #158 concerns native installation/linker setup; #138 concerns busy-contention typing; #161 covers broad current-checkout documentation. Coordinate nearby native/current-checkout prose without expanding this narrow issue into those tasks. No issue was filed or edited by this worker.

## Governing evidence

- API/source: `packages/machine-node/src/index.ts:57–65`, `src/node/location.ts`; core workspace canonical identity comment near `const store = canonicalNodeLocation(options.location)`.
- Positive runtime: existing Machine `test/node-location.test.ts` covers canonical symbolic/redundant paths, distinct files and missing-file refusal. The original symbolic-file alias probe also observes one fenced writer and exact shared reference reads.
- Provisional negative observation: original `packages/core/test/gap-hunt-portability-alias.test.ts` seeded a disposable database, created another hard link, opened both pathnames and failed at first writer acquisition with raw `SqliteError: disk I/O error`. Linux aarch64 Node24.13.0/26.12.1 at `bfb1cc3` report the failure too. No competing ownership grant, stale publication, corruption or extended SQLite I/O cause was established. Existing logs suffice; **do not rerun or adopt that intentionally red support expectation as an acceptance requirement**.
- [SQLite official §2.6](https://sqlite.org/howtocorrupt.html#_multiple_links_to_the_same_file) explains different database names can use different rollback-journal/WAL names. Local source excerpt/provenance is `sqlite-multiple-links-source.json`; detailed review is `LINUX-ISSUES-HARDLINK-AUDIT.md`.

PUB-002 continues to govern ownership mutations but this observation is not a PUB-002 violation. There is no new runtime rejection/error-class requirement. Previously calling the topology simply “unsupported” was shorthand; this pickup makes the author guidance explicit without claiming an earlier normative prohibition.

## Numbered acceptance criteria

1. State the actual canonical API boundary in native/store-location author guidance: absolute and relative paths, redundant segments and symbolic links are supported canonical spellings of an existing local store; distinct hard-linked names do not become one canonical identity. Missing-file behavior remains unchanged.
2. State the practical SQLite restriction: authors must not concurrently open the same WAL database through different hard-linked names. Explain the journal/WAL sidecar naming reason and link official SQLite guidance. Do not imply symbolic links share the hard-link limitation; preserve the existing selected symbolic canonicalization positives.
3. Make the guidance directly discoverable from root README, facade README and contribution example README. They may state it or directly link one shared local native/storage guide; no prescribed heading, exact prose or new guide filename is required. Keep project-private alpha usage separate from the public memory Store API.
4. Narrow the two owning comments (`canonicalNodeLocation` TSDoc and core's canonical store key comment) to supported path/symbolic normalization, explicitly distinguishing hard-linked names. Remove their unqualified “two spellings of one file compare equal” / “however the caller spelled” implications. Preserve durable semantic commentary and ownership boundaries.
5. Before documentation edits, run the supplied one-command check and observe the intended five missing-guidance/comment failures with canonical runtime positives passing. After edits, the same command must pass. The checker verifies prose concept/link coverage and obsolete wording removal; substantive review checks whether the explanation is correct. It is not runtime proof of hard-link topology behavior.
6. Preserve runtime/API/dependency behavior and the existing supported-path tests. No runtime rejection/error class, inode normalization, hard-link interoperability, driver/engine change, package publication, release automation, global toolchain change or all-SQLite-I/O translation belongs in this task. Do not turn the historic I/O observation into a corruption, Linux native-install or fencing claim.

## Clean one-command acceptance

Evidence is on branch `gap-hunt-durability`; carry this pickup's scripts into a clean evidence checkout. From the repository root:

```sh
bash scratch/gap-hunt/contract-operations/verify-store-location-docs.sh
```

The default command installs locked dependencies, builds generated owner/facade packages needed by strict consumers, typechecks Machine Node and core, compiles Machine tests, syntax-checks the new dependency-free documentation checker, runs only the existing canonical-location 3-test suite, then runs 5 documentation assertions. It does not invoke the hard-link probe, native rebuild diagnostic, full `npm test`, paid provider or GitHub write. Standard npm/native-toolchain prerequisites apply if dependencies need source compilation. Build/install trust and toolchain policy remain #157/#158's separate scope. `GAP_HUNT_REUSE_BUILD=1` skips install/build only for a known prepared checkout and is not fresh-bootstrap evidence.

The five docs assertions permit a directly linked shared guide and check concepts (supported path forms, distinct hard-linked names, unsafe concurrent WAL/journal use) rather than exact replacement prose. All assertions are evidence helpers under scratch; an implementer may carry/graduate them as appropriate without changing package runtime behavior or broadening the task.

## Baseline result and attribution

Prepared-checkout command: strict Machine/core checks and existing canonical 3/3 pass; docs 0/5, with expected failures naming each of the three entrypoints and two overbroad comments (`store-location-docs-red.log`). Default clean-bootstrap verification in a new detached checkout at `c5a3f273ed23acd75a833cbf0c6565e196e29e37` on macOS arm64, Node v24.22.1, installed 614 locked packages, completed the generated-package build and strict compilation, passed the canonical tests 3/3, then failed exactly the five documentation assertions (exit 1). Evidence: `store-location-docs-clean-red.log` and `store-location-docs-clean-context.json`. The empty `cleanAfter` field records tracked checkout cleanliness after execution; isolation before execution follows from creating the detached checkout and copying only the two new scratch helper scripts. No implementation docs/comments have been changed in this evidence branch.

Implementer: Codex worker (gpt-6.1-sol), operating for Mike North, authored the pickup and executable prose checks and inspected prior alias evidence. Agent assistance: supervising Codex reviewed the prior audit and narrowed this task to documentation; no human implementation/review, new Linux execution or GitHub mutation is claimed.
