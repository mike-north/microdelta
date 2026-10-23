# Completed capture context retention: current component pickup

Production baseline: c5802daca4a0bb8ea91159854d84eddcfa5215b6. This work changes diagnostic artifacts only.

Current standalone Tracking reproduces retained host context accumulation even though current workspace execution remains bounded. The `component` worker creates fresh primary and validation observers, enters only the primary capture, awaits its scalar value, verifies one observation, and retains only numeric counters. No synthetic active-invocation context is entered. Each batch finishes before immediate/GC/immediate census; a second census confirms the first. No observer, capture, tracked input, callback or Promise result is kept in the harness across iterations. An unentered validation observer supplies the matching allocation control already covered by the existing diagnostic.

Observed Node 24.22.1 and 26.12.0: 300 captures in three batches of 100 retain 200 additional ALS instances between first and final census. The optional identical AsyncResource boundary passes with zero growth. The regression requires growth <=4 over those completed batches, allowing finite runtime diagnostic noise while rejecting per-entry retention; this is a bounded diagnostic for those tested Node releases, not a universal platform heap count or a timing contract. The semantic control independently passes await, nested capture, nested rejection, concurrent capture, caller ALS preservation and inherited closed-frame rejection on both releases.

Recommended intended contract: completed fresh captures must not accumulate a distinct host context in their continuing caller after their observers and returned captures become unreachable. Preserve capture isolation, propagation through await, caller restoration on success/failure, and rejection of detached reads inherited from a closed frame. Record this lifecycle outcome in the owning Tracking contract and Machine capability acceptance criteria before implementation. Tracking owns capture lifecycle policy; Node Machine owns host propagation mechanics. Keep implementation location/mechanism open until the repair is demonstrated against the semantic controls. No new public cleanup API, disposal requirement, synchronous/async source restriction, or author-visible scheduling behavior is implied.

This is pickup-ready internal lifecycle work with an explicit acceptance clarification, rather than a concrete author-visible design decision. Existing async propagation semantics are acceptance constraints. If a repair requires consumer disposal, altered capture results, or new author scheduling obligations, stop and escalate that concrete contract change rather than presuming authority.

Replay from clean checkout (Node24):

```sh
node scratch/gap-hunt/scale/repro-context-component.mjs
# Expected current baseline: one semantic pass, one retention failure (growth200).
CONTEXT_COMPONENT_ISOLATED=1 GAP_HUNT_REUSE_BUILD=1 node scratch/gap-hunt/scale/repro-context-component.mjs
# Two passing tests; external workaround control only, no production fix.
GAP_HUNT_REUSE_BUILD=1 node scratch/gap-hunt/scale/repro-context-consumer.mjs
# Existing four correctness controls plus flat current workspace diagnostic retained.
node scratch/gap-hunt/scale/repro-context-installed.mjs
# Optional public npm microdelta@0.2.0 comparison, disposable installation and store.
```

Pure Node26 repeat may use its binary for the compiled component Jest suite; no native store opens. `context-component-{red,green}.log` and `context-component-node26-{red,green}.log` preserve results. Strict generated-alpha compilation and type-aware lint passed. Existing workspace correctness suite remains4/4 green.

The optional historical comparison now installs microdelta@0.2.0 in an OS temporary directory, reports entry/lock SHA256, remaps only the facade import, and removes packages/stores in finally. It was exercised successfully with existing local generated builds; default clean npmci/build bootstrap is shared with the prior clean-verified runner, not independently replayed here. `context-disposable-installed.log` confirms plain ALS103→303 and isolated3→3 across300 successful source bodies. It needs network/npm native installation and does not rely on contribution-reports. Direct component imports remain current local packages. Transitive dependencies resolve under a fresh npm lock; the entry and lock checksums identify that installation rather than asserting a frozen historical dependency tree.

No issues filed, production fixes, package publication, paid-provider execution, or consumer-repository modifications.
