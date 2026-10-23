# Final evidence-branch runner validation

The final runner was validated from disposable detached evidence commit `18764b3`, directly atop production baseline `f43c5872987573d9b98a19f41c324b4d9336894c`. That temporary commit exists only for validation and was not pushed. It contained the proposed test/evidence files as tracked files; production, lockfile and shared configuration matched the baseline. No manual overlays were applied during the run.

Command: `python3 scratch/gap-hunt/criterion-proof/run.py`.

All prerequisite commands and checks passed. Actual Jest JSON reports record 2 new operation/report tests, 2 new observation tests, and 3 selected existing provenance tests passing, with zero failures. Thirty unrelated existing tests were intentionally not selected. The strict TypeScript and type-aware lint commands passed. Tracked state was clean before and after, and fresh output went to the printed system temporary directory, leaving the committed evidence logs unchanged.

`published-run-validation/summary.json` records exact production baseline, disposable evidence HEAD, allowed baseline diff paths, verified overlay hashes, commands and actual passing counts. The three Jest JSON files retain the direct count/assertion evidence. `results/` preserves the earlier exact-baseline validation unchanged. Subsequent additions of this validation record/manifest are evidence-only; tested runner and four test bytes are unchanged.
