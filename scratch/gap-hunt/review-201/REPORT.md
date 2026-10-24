# PR201 / issue154 bounded private-alpha setup qualification

Source `f4211e3d925ed8aaedc313ac468d49a13149826c`, based on
`e59c64d0e1c607b5a4a8ae1fa124b1be5cdc2573`. This evidence branch changes no
product files. **Revised verdict: the checked-in fixture and type/runtime controls pass,
but the literal manual sibling recipe is incomplete.** It references
`alpha-import-only.ts` without creating or copying it. A fresh consumer following
only those instructions fails TS6053; explicitly copying the checked-in input
makes compilation and runtime pass. The earlier cd264c3 unqualified manual-recipe
PASS is superseded by this bounded finding. Run `python3 scratch/gap-hunt/review-201/reproduce.py` from its
worktree root. The runner creates an actual clean source archive in a fresh
`parent/microdelta` directory with no node_modules, then exercises the original
issue reproduction and the documented consumer recipe. Captured workload commands have a
900-second timeout; the separate literal-input probe has a 120-second outer bound
and 60-second command bounds. Git archive/preflight reads are outside those bounds. An inherited reuse-build flag is removed. A command-local
installed macOS26.5 SDK is selected on this host for the locked native addon;
no global toolchain setting changes.

## Five issue criteria

1. The guide documents package build prerequisites, strict TypeScript with
   explicit generated alpha rollups, and ordinary built-package runtime
   resolution. Both facade and contribution-example README links resolve to it.
   The initial manual sibling probe used the exact second JSON fence and JavaScript
   fence plus a synthesized TypeScript input. That extra input step is absent
   from the guide. A separate literal probe omits that synthesis and exposes
   TS6053; an explicit fixture-copy control restores compilation/runtime. The
   local package link is relative. No absolute source/home/worktree path is
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
   and the separate sibling compiler/runtime commands with the extra input all run.
   The literal manual commands fail until that input is explicitly copied. The
   official four-test suite also constructs its own temporary sibling fixture;
   the manual probe independently uses an actual archived checkout rather than
   that test's checkout symlink, but its synthesized input meant it did not
   establish literal documentation completeness. TypeScript and runtime resolution remain separate.

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
four-case invocations passed; sibling compilation/runtime with a synthesized input passed; the later literal
no-input probe separately fails TS6053. Missing
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

## Confirmed manual-recipe finding

The guide names `files: ["alpha-import-only.ts"]` in its manual sibling config,
but does not instruct the reader to create or copy that file. The earlier
fixture discussion identifies what the checked-in fixture imports; it does not
state that the manual reader must copy that fixture into the new consumer.
`literal-doc-input.py` uses only the guide's config/probe/package link before
its negative compiler request. That request exits2 with exactly the missing
input TS6053, not a declaration-closure error. An explicit copy of the checked-in
input then gives compiler0 and runtime0. The source/type/export implementation
is sound within the bounded controls, while AC1/AC5 manual setup completeness
needs this small documentation correction. `FINDING.md` is comment-ready; the
supervisor owns feedback and issue disposition. No product fix was made.

Publication qualification: the original 15-command workload and the literal-input
probe were executed separately against the same fresh source archive. The final
one-command runner composes both with the read-only capture verifier; that final
composition was not rerun as a whole. No underlying source or executed probe changed.
