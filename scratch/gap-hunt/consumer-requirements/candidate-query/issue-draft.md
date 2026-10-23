# Promotion-aware candidate lookup scans unrelated same-analysis results

Medium performance regression toward DOM-1/DOM-3 scale needs. A candidate lookup returning one result now performs work proportional to unrelated subjects in the same analysis, even with no promotions. The published lookup uses the full existing index prefix; main's promotion-aware predicate leaves an analysis-only seek and temporary sort. This is separate from #159 acceptance readback and the earlier candidate-history concern that intentionally returns many matching candidates.

At mainf43c587, `packages/history/src/durable/index.ts:182-187` puts environment inside an OR with promotion eligibility, while `packages/history/src/durable/schema.ts:137` retains index `(analysis,environment,subject,version,publication)`. `findCandidates` at index.ts:747-750 executes this query before envelope construction. Resolution source reuse calls it before finality at `packages/resolution/src/resolution.ts:1369`. Many independently keyed sources in one analysis therefore repeat the broad access path even when exactly one candidate is eligible.

Captured production query/table/index DDL on invented rows, fixed one eligible candidate:

| Total subjects | Published SQLite VM instructions | Main instructions |
| --- | --- | --- |
| 100 | 69 | 600 |
| 1000 | 69 | 5100 |
| 10000 | 69 | 50100 |

Python SQLite3.54.1 progress callback counts every VM instruction without changing predicates. Other-analysis filler keeps main at106 instructions across all three populations; other-environment same-analysis unrelated filler reproduces the growth. Both query variants return the same one eligible result. Node's installed better-sqlite3 SQLite3.53.0 independently confirms full-prefix baseline seek versus analysis-only main seek and temporary ORDER BY. No wall-time threshold is used.

Replay after obtaining this evidence directory:

```sh
python3 scratch/gap-hunt/consumer-requirements/candidate-query/repro.py
```

Expected current result: exit1,5100 instructions exceeds generous1200 allowance at1000 subjects. Diagnostic with `--diagnostic-only` exits0. Strict TypeScript and type-aware lint pass; emitted Jest has3passing controls and1failing regression assertion. Captures and complete outputs accompany the diagnostic.

## Numbered acceptance criteria

1. Restore an efficient same-environment exact-subject lookup over the existing candidate semantics: with one eligible result, unrelated same-analysis subject growth must not force the observed broad scan. Use a counter-based regression test at100/1000/10000 subjects rather than returned-row or executed-statement counts alone.
2. Exercise unrelated-subject filler in both the requesting environment and other environments of the same analysis, plus other-analysis filler as an isolation control. Repaired work must remain bounded under this finite discriminator; do not prescribe a universal constant-time metadata SLA.
3. Preserve explicit promotion eligibility: a promoted result may enter its target environment while an otherwise identical unpromoted result cannot. Preserve same-analysis boundaries and verify corrupted or unauthorized references remain integrity failures through real History controls.
4. Preserve matching subject/version and newest-publication-first order, intentional enumeration of all eligible matching candidates, and rollback eligibility for older versions. Do not pass by truncating history, omitting promoted candidates or changing the public lookup contract.
5. Keep candidate lookup read-only: no publication, acceptance, promotion, journal or current-pointer mutation may occur merely to answer it. No new public author API, host implementation or author batching obligation is required.
6. Include real History/public-facade correctness coverage through generated declarations alongside the captured-SQL work discriminator. Current synthetic SQL tests bypass normal publication/integrity validation and are insufficient alone to close the repair.
7. The repair regression gate must derive its query/schema from actual repaired production and still fail a deliberate old broad-query negative control; editing a frozen capture alone cannot establish repair. Record engine versions and validate actual Node engine access paths/work or an equivalent validated counter. Preserve strict TypeScript/type-aware lint and negative controls; a plan-string change alone is not proof of repair. Keep #159 acceptance-row history, #160 publication validation, #172 context retention and #173 fanout queuing separate.

No index/schema/query rewrite is prescribed here. A schema change or migration implication needs its own compatibility assessment; do not add a guessed fix solely to match a plan string. No complete consumer timing causality, Linux qualification, full capacity guarantee or provider work is established. The earlier unrelated-history diagnostic counted17executed statements; it could not measure scan work inside this single statement. Full consumer warm timing motivated the investigation, but this isolated proof does not establish how much of that elapsed delta it explains.

Attribution: Codex gap-hunt worker authored the source comparison, unchanged-SQL diagnostic and strict Jest regression test for Mike North. Supervisory review and filing are pending; no human implementation/review or fix is claimed.
