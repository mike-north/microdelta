# RUN-016 finite authored trial evidence

Owning clause: `docs/spec/operations.md:570–589`. The two staff engineers / one designer / two product managers are its concrete validation example; the contract is reusable authored selection/filter/limits, selected real pipeline, no silent per-person truncation, visible restricted scope and no trial-only filters in normal mode. This fixture does not add a framework role selector.

New `gap-hunt-durability-authored-trial.test.ts` drives a real roster source, gated person template, per-person corpus memo using `currentExecution().operation`, downstream summary memo and strict aggregate fold. Provider is a deterministic fake in the helper. No paid provider, M7 adapter, HR input or production API implementation is used.

Observed PASS:

- Of eight synthetic people, trial selects the specified five example roles. Only those five have provider receipts; their exact PR lists match the full declared upstream lists. The selected designer has complete empty data and remains distinguishable from three skipped people.
- Per-person summaries and the strict organization aggregate include all five selected people. No concurrency limit is substituted for selection.
- Explicit cap1 applies to every selected person and labels every resulting scope restricted / sourceExhausted=false, including an empty result or one whose current list fits. This is scope declaration, not proof of upstream exhaustion.
- Normal mode using the same authored config with trial selection and cap still present includes all eight people with their complete PR counts/full scope, no exclusions, and only uncapped provider calls. Existing eligible member work may be reused; newly required people are present in actual receipts.

`authored-trial-negative.log` preserves the meaningful negative fixture control: assertions rejected an incorrect helper that classified empty/fitting capped results full/exhausted. The fixture helper was corrected before the passing run; no production change was made or proposed. This control assesses the authored contract, not a claimed library defect.

Validation: strict Core test compilation, strict Core source types, targeted type-aware ESLint and focused Jest1/1 all pass. Runtime log `authored-trial.log`; exact C14 command is in COMPLETION-MATRIX.md. No broad suite run.

Cross-owner freshness: supervisor `GAP-HUNT-STATUS.md` now maps RUN-012 finite-provider-expiry controls to `gap-hunt-contracts@b2ad91b`; this worker links that bounded conservative adapter evidence instead of rerunning it or retaining an unexecuted claim. Mac shared-store crossversion is already C13 positive. The earlier DIAGNOSTIC-158.md candidate paragraph predates this cross-owner scan and is superseded by this note.

Next finite evidence candidate, not executed here: REUSE-003's explicit widened-window revocation and immutable-artifact versus mutable-alias examples. Existing changed-rubric/current-hook/gate controls are narrower; no owner decision or arbitrary corruption-repair promise is required to characterize these supported authored policies.
