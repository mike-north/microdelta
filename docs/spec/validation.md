# Specification consolidation validation

Date: 2026-09-26. Scope: M0 documentation and artifact consistency.

The consolidated specification describes target behavior. M1 experiments and
runtime implementation have not begun as part of this change. Historical passing
runtime tests remain historical; no full runtime suite rerun is claimed here.

## Checks

- Local Markdown targets and anchors checked across active docs, the archive,
  root README and package READMEs. Historical line anchors were adjusted for the
  archive notice and checked against target line bounds.
- Requirement definitions and references checked for uniqueness and resolution.
- `reuse-cases.json` parsed: 10 distinct cases, explicit expected outcomes, and
  valid requirement/suite references. These are not executed runtime fixtures.
- `source-map.csv` parsed: 21 source areas, each pointing to an existing active
  artifact (paths are relative to `docs/spec/`).
- Markdown code fences checked for balance.
- Independent architecture/spec review completed; corrections below incorporated.
- `npm run test:tooling`: **4/4 passed**, confirming the retained legacy graph
  fixture still matches the existing scaffold checker. This does not validate
  future package enforcement.

The final structural check completed with zero errors. It inspected 119 defining
requirement IDs and 19 acceptance suites. Full `npm test`, build and package
consumer experiments were not run: this pass changed documentation/fixture
locations, not runtime implementation. No test result is inferred from a spec.

## Review corrections incorporated

- Restored the settled per-memo positive-integer compatibility version, default 1,
  with normal-validation rollback, from the original user decisions.
- Kept automatic tracked implementation invalidation, superseding advisory-only
  old prose without losing explicit compatibility control.
- Added the minimal retained source→consumer path to M3 so its finality acceptance
  case can actually be satisfied before general higher-order M4 work.
- Included admission/middleware and narrow materialization suites in their
  respective milestone exit criteria.
- Preserved distinct TS class access, ECMAScript runtime privacy, and exported
  declaration tiers; sibling consumption uses alpha-trimmed declarations.
- Retired old active narratives into the archive and retained only the labeled
  component-graph fixture required by the existing tooling test.

## Limits

No generated CML, Lean proof, TLA+ model, new runtime, CLI, package extraction build,
or restart experiment is represented as implemented or validated by this pass.
The existing scaffold graph test does not establish the six-context architecture.
