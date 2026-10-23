# REUSE-003 current window and alias boundaries

Owning contract: `docs/spec/execution.md:193–203`, read together with REUSE-002 eligible-candidate/current-hook ordering. The latest supervisor status/matrix contained current-hook/rubric controls but no direct widened-window or artifact/alias example. These tests add those two finite assertions using existing authored source/memo APIs only.

## Window policy

A raw event at20 lies outside the initial window[30,40). Cold retrieval stores its observation while the consumer reports excluded. An authored current finality hook accepts a cached event outside the window, skipping retrieval. After upstream content changes, the same narrow window runs the current hook, retains the exact excluded consumer result and keeps reads1. Widening to[10,40) causes that same current hook to answer false against the eligible previous event; retrieval reaches reads2 and the consumer publishes current content.

Only finality and consumer interpretation read the window. Raw source retrieval does not depend on window, so this case specifically observes current finality revocation rather than mistaking earlier candidate-input invalidation for a hook invocation. Each invocation rebuilds declarations and opens/closes History. No wall-clock timing, generic finality token or untracked computation invalidation is inferred.

## Artifact and alias policies

A mutable release alias points to an authored immutable artifact A. The alias's current hook returns false; each demand refreshes it. Artifact A's own current hook returns true; its source loads once and keeps its exact reference. An unchanged alias refresh permits the equal-consuming memo to reuse. Changing alias target to B redirects the consumer to a new artifact/result while the old exact artifact A remains reusable/readable. Observed source loads: alias3, A1, B1; mutable hook2 after the cold run; immutable hook executes on retained artifact use.

These are ordinary separately scoped source subjects and declared child calls. There is no built-in alias identity API or inference that finality on one source transfers to another.

## Checks and negative controls

Focused Jest2/2, strict Core source/test compilation and targeted type-aware lint pass. `source-boundaries.log` is the in-place reuse-build check. The one-command runner defaults to clean npmci and generated package builds before these same checks:

```sh
bash scratch/gap-hunt/contract-operations/verify-source-boundaries.sh
```

`GAP_HUNT_REUSE_BUILD=1` skips only installation/generated package build for an already built checkout. Default bootstrap was separately executed in a new detached temporary worktree with no dependencies/declarations, copying only the added test and runner; full output/context are `source-boundaries-clean.log` and `source-boundaries-clean-context.json`. This is a replay bootstrap, not a broad repository test claim.

Two temporary authored-helper mutations keep assertions unchanged and exercise the expected failure: accepting the widened window incorrectly returns old data (1fail/1pass), and treating the mutable alias as immutable suppresses its required refresh (1fail/1pass). Complete outputs are `source-boundaries-negative-stale-window-finality.log` and `source-boundaries-negative-immutable-alias.log`. Original test source was restored before final validation. No production code was changed, and these deliberate wrong author policies are not product defects.

The old RUN-012 candidate paragraph in `node26-clt/DIAGNOSTIC-158.md` now explicitly points to existing cross-owner b2ad91b expiry evidence, so these artifacts no longer disagree about that completed finite control.
