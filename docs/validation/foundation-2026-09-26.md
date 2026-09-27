# M0.5 foundation acceptance

Accepted on 2026-09-27 UTC (2026-09-26 Pacific). This record connects the
[foundation exit](../milestones.md#m05--tooling-package-and-host-foundation)
to accepted issue evidence; it does not establish M1 outcomes or later runtime behavior.

| Requirement area | Accepted change and evidence |
| --- | --- |
| Strict compiler, typed lint, tests-first enforcement and deterministic CI | [Issue #1](https://github.com/mike-north/microdelta/issues/1), [PR #13](https://github.com/mike-north/microdelta/pull/13) |
| Package boundaries, generated declaration tiers, negative consumers and fail-closed imports | [Issue #2](https://github.com/mike-north/microdelta/issues/2), [PR #15](https://github.com/mike-north/microdelta/pull/15) |
| Injected portable Machine contracts, Node conformance, Tracking/History integration | [Issue #3 acceptance](https://github.com/mike-north/microdelta/issues/3#issuecomment-5851641453), [PR #16](https://github.com/mike-north/microdelta/pull/16) |
| Executable PR evidence gate and live main-branch protection | [Issue #4 acceptance](https://github.com/mike-north/microdelta/issues/4#issuecomment-5851704619), [PR #14](https://github.com/mike-north/microdelta/pull/14), [event and settings evidence](pr-evidence-2026-09-26.md) |

The final foundation commit is `1e84e81cede430871b08c15d89f85bbb336cc0d7`.
Its [default-branch Check run](https://github.com/mike-north/microdelta/actions/runs/36285372315)
passed `npm ci`, `npm run check`, `npm test`, and `npm run build` on Node 20, 22,
and 24 after PR #16 merged. The issue and PR records retain test-first failures,
negative cases, exact commands, reviewed heads, and scope limits.

Machine supplies async-context propagation and synchronous detached snapshots;
Tracking retains frame policy, History retains persistence policy, and the facade
selects the Node adapter. Generated declaration consumers run without ambient Node
types. This acceptance does not qualify a durable backend or promote experiment
capabilities into permanent Machine APIs.

M1 issues #5 through #8 are eligible after this foundation. The Lean and publication
state-model pilots retain their EXP-2 and EXP-3 dependencies respectively. Each
experiment still needs bounded assertions, reproducible evidence, and an explicit
adopt/reject/inconclusive decision in its owning contract before its gate closes.
