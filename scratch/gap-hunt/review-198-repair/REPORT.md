# PR198 callback error-boundary qualification

PASS for issue194's four callback routes at `094378f66dd4955a533f4878b2a820f68e233610`. The separate memo RUN-013 residual from PR195 remains PARTIAL: authors can mutate a genuine child Error.message and rethrow or swallow it. This callback repair does not conceal or close that existing memo hole.

## One-command reproduction

With Node24/native SQLite prerequisites, from this exact checkout:

```sh
python3 scratch/gap-hunt/review-198-repair/reproduce.py
```

The runner performs22 expected commands, validates10 exact Jest result logs and98/98 preservation tests across4 suites, exercises the exact old Resolution source negative, and restores current source/build bytes in finally. Intentional mutation residual tests retain normal safe-message assertions and therefore exit1; the runner validates the exact two named failures, their observations, and zero failing-parent completed rows before accepting that expected diagnostic result. An install/build/load error cannot substitute for a semantic failure.

Guard-only capture validation also rejects synthetic missing, load-error, forged-load and wrong-count evidence:

```sh
python3 scratch/gap-hunt/review-198-repair/reproduce.py --check-logs PATH_TO_CAPTURES
```

## Contract and acceptance evidence

RUN-013 requires safe framework text identifying the owning position while preserving the exact authored thrown value at its callback boundary. Public class/code/message do not prove framework provenance. RUN-010 preserves strict/outcome aggregate handling; memo issue190 and callback issue194 are distinct scopes.

The historical eight-case callback fixture is byte-identical to proof `350805fbfa423b8bfdfaeba4fe7ea3b8f7a51b3c`; its four ordinary Error and four authored ResolutionError tests are unchanged and compile against generated alpha declarations under strict TypeScript and repository type-aware lint. All8 pass current and restored source. They record one helper call, exact boundary cause identity, safe execution-failure text, no completion and no completed row for the failing subject, including the supplied route's legitimate enclosing memo wrapper.

Official32 cases pass: six thrown-value modes across source, supplied, strict-fold and outcome-fold callbacks (plain Error, string, null and three public error codes), plus unsupported-output and pre-body-observer controls per route. The latter preserve unsupported-result/observer-failure classification, exact observer cause, correct callback counts and nonpublication; wrapping everything would fail those controls. Existing memo12 and provider/author opacity6 remain green. Focused source-policy, fold, supplied validation and outcome-fold preservation suites pass98/98 across4 files. Resolution/Core checks, generated declarations, consumer compile/lint and package/fixture builds pass.

The frozen memo mutation fixture is byte-identical to proof `95679b0484bcda7d6e6a00d2cddc165041fe2baf`. Its unmodified genuine-child control passes; mutate-rethrow and mutate-swallow fail safe-text assertions in both current and restored source. Both retain unsupported-result classification, the exact mutated error object and marker, one mutation, no completion and zero total completed result rows. This qualifies the existing PR195 residual; it is not a new regression from PR198 and not a blocker silently added to issue194.

## Source and negative sensitivity

Against stacked base `a13a3fd88ffe5ed24334f60af84316b31d98971e`, product changes are only Resolution implementation, its32-case regression suite and a patch changeset for Resolution/Core. A private invocation-local wrapper records only rejection from the actual tracked author callback. begin/setup and finish/output validation remain outside that catch; memo bodies and source finality retain their existing failure owners. No public error API/declaration change is introduced.

Replacing only `packages/resolution/src/resolution.ts` with exact a13 base bytes and rebuilding restores exactly4 authored-class failures/4 ordinary passes in the frozen fixture. Official32 becomes12 failures/20 passes, with exactly the three authored public-class code modes under each route failing. This demonstrates sensitivity to the callback repair. Finally restores exact current source and rebuilds; frozen8 and official32 return green and the separate memo residual remains2fail/1pass.

## Scope and provenance

Synthetic local macOS/Node24 SQLite evidence only: no paid provider, Linux, deployment, hostile-JavaScript sandbox, deliberate cause redaction, or all-callback audit. Nonpublication assertions do not establish additional event/store leakage. The original historical expected-red wrapper is not used as a green acceptance oracle.

Captures were obtained before the final runner-only refinements that automatically normalize output paths and assert the preservation98/4 census; fixtures, source and semantic assertions did not change. Fresh replay of the final committed runner verifies those refinements separately. Supervisor owns publication, dependency/retargeting decisions and acceptance; this worker changed no owner branch.
