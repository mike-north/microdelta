## Problem and governing contract

**Medium correctness/privacy gap:** an author-created `ResolutionError` with a non-`execution-failure` code escapes the memo body's failure wrapper. Its author-selected text becomes the outer framework message, and the original object is not preserved as that wrapper's cause.

[RUN-013](https://github.com/mike-north/microdelta/blob/2a640aca75d5728484a2cb06af88c77690616ba9/docs/spec/operations.md#run-013--retry-history-is-part-of-supervision) says framework failure messages identify the step/position and failure kind only: “What author or caller code throws ... never enters them.” The exported ResolutionError contract repeats that boundary. It makes no exception for author-created instances of an exported error class.

This is a distinct recurrence after closed #147, which repaired ordinary author Error interpolation. Its ordinary-Error control still passes. Owning area: Resolution's memo failure boundary, consumed through Core's alpha authoring/workspace facade. Genuine declared-child runtime failures must keep their existing classification.

## Failing reproduction and exact observation

Branch `gap-hunt-error-privacy`, executed runner commit `702a15f56f69884f449dd6cfbd31c9b7420f06ec`. From a clean checkout with Node24/npm and native SQLite prerequisites:

```sh
python3 scratch/gap-hunt/error-privacy/run.py
```

The command installs/builds, compiles strictly, runs type-aware lint and checks the exact expected negative oracle. Its exit0 means the reproduction succeeded, **not** that the product assertions are green. Test: `packages/core/test/gap-hunt-error-privacy.test.ts`.

A bound author helper throws `new ResolutionError('unsupported-result', 'SYNTHETIC-OPAQUE-DETAIL-9d72')`. Before the assertion, the actual facade result records:

- outer code: `unsupported-result`, expected safe author-failure classification;
- outer message: exactly the synthetic marker, expected a safe message naming the step;
- outer error is the thrown object: true; outer cause is the thrown object: false;
- no completed result is returned.

The message assertion fails. The later expected code/cause assertions do not execute; their observed values above are recorded separately before that failure. The run has8 passing tests,1 intended failure,0 runtime-error suites. Strict compile and lint pass. A fresh independent checkout ran the complete default command with clean tracked source before/after.

The confirmed discrepancy is the outer framework message/cause boundary. No author-path event or store leakage, sandbox escape, or failure of every callback path is claimed. Six separate opaque provider-error cases do pass their event/diagnostic/store checks.

## Numbered acceptance criteria

1. An author memo body/helper throwing a constructed exported ResolutionError with a non-execution-failure code receives a safe `execution-failure` outer message naming the step, with the exact thrown object preserved as cause. Author-selected text must not become the outer framework message. Cover the reproduced code and another non-execution-failure code; class identity alone is not evidence that the runtime originated a failure.
2. Preserve ordinary author Error and author-created execution-failure wrapping/cause identity. Observe the new non-execution-failure case fail before implementation while the ordinary-Error control remains green; after implementation all these cases pass as ordinary assertions.
3. A real declared child returning unsupported data still propagates the existing runtime `unsupported-result` classification and safe message. A parent that swallows a failed child must still not publish an incomplete successful result. Do not fix the author case by discarding genuine child failure semantics.
4. Preserve the six bounded provider controls: explicit failed response versus unknown rejected-perform semantics, independent sibling progress, exactly one provider invocation, opaque cause identity on the returned failure path, and no conversion/getter evaluation or synthetic detail in event/diagnostic/store views.
5. The original nine-case fixture becomes all-green regression coverage. Retain strict TypeScript, type-aware lint, declaration boundaries and the repository's required checks. Record the test-first result and exact commands/current-head outcome in the PR; do not keep the expected-red evidence runner as a passing product CI gate.

## Scope, exclusions and dependencies

Scope: the memo-body author failure boundary, its provenance distinction from genuine runtime child failures, and focused regression tests. Suggested direction: preserve that provenance distinction instead of trusting the public error class or message contents. The issue does not prescribe a representation.

Out of scope: a new error API, redacting deliberate caller access to `cause`, changing genuine child classifications, new hosts/provider integrations, hostile-JavaScript sandboxing, scalar result support, paid-provider calls, package publication or releases. Other callback paths are unexamined by this reproduction; do not claim them fixed without evidence.

Blocking dependencies: none. Coordinate with concurrent Resolution work, but current open reuse/key/type work does not cover this failure. The privacy policy is settled; this issue needs no owner design decision. Preserve the initial runner-parser failure separately from the product evidence.

## Attribution

Implementer: gpt-6.1-sol gap-hunt worker for Mike North authored the synthetic fixture; no product fix is included.
Agent assistance: a second gpt-6.1-sol worker independently reviewed the contract and artifact. The supervising Codex agent corrected the evidence runner, ran the exact fresh reproduction, inspected the source and preserved controls, checked live duplicates, and filed the issue. No human implementation or review is claimed.
