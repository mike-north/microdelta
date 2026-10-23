# Preserve the author-error privacy boundary for author-created ResolutionError instances

RUN-013 and ResolutionError's exported contract require author/caller thrown text to reach callers only as cause. On main `2a640aca75d5728484a2cb06af88c77690616ba9`, a bound helper throwing `new ResolutionError('unsupported-result', syntheticMarker)` escapes the memo body as the identical outer framework error, exposing its message. Ordinary Error is safely wrapped. This is a distinct recurrence after #147, whose ordinary Error regression passes.

Owning area: Resolution runtime error provenance, consumed through Core's alpha facade. No prerequisite design decision is needed: safe messages and genuine child error propagation are both existing contracts. Do not introduce new host support, provider integrations, or change genuine child classifications.

Acceptance criteria:

1. A memo body/helper throwing an author-created exported ResolutionError with non-execution-failure code yields a safe execution-failure outer message and preserves exact thrown identity as cause; synthetic marker absent from outer message.
2. Ordinary author Error retains the same safe wrapping and cause identity. Cover both Error variants as red-before-green regression tests.
3. A genuine declared child runtime unsupported-result still reaches the parent with its existing classification and safe framework message; the fix must distinguish runtime provenance from public class identity.
4. Preserve failed-provider response versus unknown rejected-perform semantics, successful sibling progress, no implicit retry, opaque error cause identity where returned, and no conversion/getter evaluation. Existing six bounded controls remain green.
5. Strict compile and type-aware lint pass with no casts/check relaxations; run repository-required affected/full checks and record exact-head evidence in the PR.

Reproduction: `python3 scratch/gap-hunt/error-privacy/run.py` on the accompanying evidence commit from a clean Node 24 checkout. Expected current evidence: eight pass, one exact intended message assertion fails, zero runtime-error suites. The runner exits zero when it verifies that expected reproduction. After implementation, promote the fixture into ordinary regression coverage with all nine passing rather than preserving the expected-red runner as a CI gate.

Observed failure is bounded to the author-path outer framework message. Author-path events/store leakage and all callback paths are unclaimed. Evidence report and receipt accompany the fixture. Implement in one isolated worktree, use Refs #<assigned issue>, and stop at PR-open for supervisory review.
