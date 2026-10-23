# PR201 / issue154 bounded private-alpha setup qualification

Source `f4211e3d925ed8aaedc313ac468d49a13149826c`, based on
`e59c64d0e1c607b5a4a8ae1fa124b1be5cdc2573`. This evidence branch changes no
product files. Run `python3 scratch/gap-hunt/review-201/reproduce.py` from its
worktree root. The runner creates an actual clean source archive in a fresh
`parent/microdelta` directory with no node_modules, then exercises the original
issue reproduction and the documented consumer recipe. Every subprocess has a
900-second timeout. An inherited reuse-build flag is removed. A command-local
installed macOS26.5 SDK is selected on this host for the locked native addon;
no global toolchain setting changes.

## Five issue criteria

1. The guide documents package build prerequisites, strict TypeScript with
   explicit generated alpha rollups, and ordinary built-package runtime
   resolution. Both facade and contribution-example README links resolve to it.
   The manual sibling probe uses the exact second JSON fence and exact JavaScript
   fence extracted from the guide, with an actual consumer beside the archive;
   the local package link is relative. No absolute source/home/worktree path is
   present in the documented config.
2. The exact original `abb9bab1987d18644093fb67dadb17c3ea9f94ce` reproduction
   script, bootstrap helper and three import-only inputs are frozen here. The
   original script performs its own npm ci and package build, observes actual
   facade-only TS2305/IAbortSignal diagnostics, and compiles the six-path positive.
   That original exit0 remains diagnostic success, not documentation acceptance.
   Current official tests and independent manual sibling compilation then verify
   the documented fix. Each of five individual owner-mapping omissions produces
   TS2305; missing files/configuration errors cannot substitute for that boundary.
3. Package manifests and generated declaration/API-report surfaces retain the
   public default and existing beta selection semantics. No `./alpha` export,
   source alias, release or publication change is present. A sibling compile with
   no private paths uses ordinary package resolution and rejects `authoring`
   through actual TS2305. Core tsd contracts run separately.
4. The guide explicitly bounds the six mappings to this consumer/export/baseline
   and warns that another API can reach another closure. The five omission
   controls are evidence for this concrete input, not universal minimum claims.
5. Clean archive compilation, root and fixture-directory documented commands,
   and the separate literal sibling compiler/runtime commands all run. The
   official four-test suite also constructs its own temporary sibling fixture;
   the manual probe independently uses an actual archived checkout rather than
   that test's checkout symlink. TypeScript and runtime resolution remain separate.

## Ownership and scope review

Only the guide, two README links, four consumer fixtures and root check:fixtures
wiring change. PKG-003 deliberately keeps alpha project-private; PKG-004 requires
approved consumers to use generated sibling declarations and legitimate package
runtime exports. The patch documents those existing requirements without moving
context ownership or exposing alpha publicly. The import-only input has no
source-body signature, unsupported output type or authoring invocation to
confound the closure failure. New JavaScript fixture syntax/runtime tests and
focused ESLint run; strict declaration checking and tsd supply type evidence.
The TypeScript lint configuration's type-aware rules apply to TypeScript files;
no new TypeScript suppressions or skipLibCheck escape are introduced.

## Evidence boundaries

The checked-in suite has four unique cases. Running its root and fixture-directory
commands is two invocations of those same four cases, not eight unique witnesses.
Manual sibling compile/runtime and five missing-owner compiler controls are
separate inputs. This is Darwin/arm64 Node24 qualification of the named source;
Linux, paid execution, publication, full-repository CI and arbitrary downstream
alpha API closures are outside this review. Source is docs/fixture only; no old
runtime implementation is substituted as an artificial counterfactual.

Earlier review-harness attempts are excluded: one expected TAP summary while
Node printed its successful spec reporter; another optional command asked for a
nonexistent core test:public script. Neither is a product failure or negative
acceptance witness. The final clean archive recipe uses the actual normal-public
compile control and accepts the documented command's Node reporter format.

Attribution: evidence authored and executed by Codex worker `/root/contracts`
(GPT-6.1 Sol) for Mike North. Product implementation and its test-first history
remain the PR201 author's. The supervisor owns current-main integration,
independent acceptance, publication and workflow changes.

## Final captured results

The final clean archive recipe passed all **15** top-level commands with their
expected exits. The original script also ran npm ci and the full package build.
Its facade-only input produced exactly **114 TS2305** diagnostics. Both official
four-case invocations passed; literal sibling compilation/runtime passed. Missing
Definition gives39 TS2305 plus3 downstream TS2536 diagnostics; missing History,
Resolution, Supervision and Tracking give6/42/57/8 TS2305 respectively. The public
default rejects authoring with one TS2305. Core tsd and focused fixture lint pass.

All **814** regular files in the exact source archive remain byte-identical after
execution. `archive-source-proof.json` records each source hash. The read-only
`verify-captures.py` checks exact command inventory/exits, precise diagnostic
classes/counts, both four-test reporter summaries and the package export boundary.
It independently accepted the final capture and rejected four corruptions:
missing command, wrong diagnostic, wrong test count and an injected alpha export.
The final runner appends this read-only verifier; that guard-only addition did
not require another execution of the successful workload.
