# Authoring prototype charter

**Proposed bounded experiment, not public API adoption.** Parent: [authoring experience](authoring-experience.md). Preserve DOM-2, TRK-1/2/3/4/5/6, CMP-1/5/6/7/9 and RES-001. Exact constructor spellings remain experimental.

## First slice

Implement only the smallest symbolic-composition facade needed for one retained synchronous numeric calculation and two composed calculations. Fixed subjects, explicit occurrence/default-subject identity, symbolic `from` edges, selected input views, numeric outputs, authored-callback implementation invalidation, negative authored-callback capture lint and hierarchical output cutoff are in scope. Reusable composition may express those two fixed nodes, but general argument reconstruction, helper capabilities, subject selectors, sources and keyed runtime are outside this first slice. Keep Definition, Tracking, Materialization, Resolution, History and Supervision ownership intact. Machine supplies host capabilities only.

Helper/selector/keyed/source sketches express later pressure cases. Pure tracked selector/projection behavior is a bounded proposal, not an established purity or execution-phase guarantee. They are not required runtime implementation in the first slice. Do not broaden into a general compiler, fluent API, provider integration, release or package publication.

## Authorized internal experiment bridges

The supervisor authorized an internal `{ value: number }` storage carrier; authors must still return and consume numbers. This tests the narrow facade without changing current-alpha record/array result-root policy or resolving #156. The actual authored `run` callback may be registered privately as an existing tracked helper under a stable slot. That bridge adds no author helper API and must retain current callback implementation evidence and capture enforcement.

The `input.pr` design sketch is aspirational. An explicit typed token such as `input('pr')` may be used for this bounded prototype instead of a mapped Proxy that would require a broad type assertion. The executable surface remains subject to implementation review; no spelling or successful behavior is adopted by this document.

## Evidence protocol

Write outcome assertions first and observe the expected failure. Separate a missing facade from an existing owner defect. Use Jest for runtime behavior and tsd for type contracts; retain strict TypeScript, type-aware capture lint, generated declaration boundaries and ordinary build checks. Do not disable checks or enable skipLibCheck. A local adapter may express proposed syntax, but must be fully visible and must not fabricate reuse or hide setup in custom helpers.

Durable assertions use fresh independent processes over one temporary SQLite store. Record body executions separately for each child and parent, retained exact references, current output and statuses. Printed equality alone is insufficient. Record baseline revision, test-first failure, exact commands and outcome. New conclusions about correctness need corresponding evidence; a type check is not a restart proof.

## Eight acceptance cases

| Case | Expected evidence |
| --- | --- |
| 1. One scalar result | First run publishes a primitive number with one body execution; new process reuses the exact reference with zero executions. Type contract infers the primitive result without an author `{ value }` wrapper. |
| 2. Selected input changes | Change an unread label: preserve reference and zero executions. Change consumed title: execute once and publish the current value. A later restart validates against the current binding, not its old provenance. |
| 3. Imported two-step composition and cutoff | Change child input so child recomputes but score stays equal: child count increases, parent count stays zero, parent exact reference survives. Change score: both recompute. Record both levels independently. |
| 4. Later pressure: current argument origin | Forward current input and prior child output into reusable work; on restart resolve current origins. For unsupported/unjustified derived reconstruction, honestly miss the parent and execute only after normal admission. Never substitute a stale stored argument or run paid work merely to discover whether it is needed. |
| 5. Later pressure: occurrence, alias and history identity | Reuse one built node twice as an alias; construct primary/secondary from one factory with equal implementation text and scalar arguments but different tracked config. Restart with registration order reversed, then change only primary config. Keep child/parent counts, associations and exact references separate. Reject ambiguous duplicate occurrences. Test default name-as-subject and explicit subject override without hidden suffixes. |
| 6. Later pressure: implementation and captures | Change a called helper/body implementation: invalidate relevant work. Change an uncalled helper: preserve reuse. Supported untracked mutable captures get a clear lint/type diagnostic; unsupported hidden influences retain an explicit boundary. No claim of arbitrary closure soundness. |
| 7. Later pressure: topology and correspondence | Mutate author arrays after composition: frozen graph is unchanged. Attempt resolution during construction or undeclared target substitution: reject before admitting bodies. Rename a structural relationship: honest miss, never remap by order/name similarity/function source. |
| 8. Deferred keyed/source pressure case | Before later keyed implementation, specify missing/duplicate keys, reordered/added/deleted members, source refresh beneath cached parent, open discovery, failed required member and strict coverage. Hardest fixture combines same factory/helper text, distinct configs, equal scalar arguments and different keyed members; reverse discovery order then change one config. Later evidence must count each child/parent and compare exact references. This case is a design readiness fixture, not first-slice runtime completion. |

Additional required first-slice bridge assertions:

- Change only the authored child callback while keeping adapter code, inputs and stable slots unchanged. Prove the child executes against the current callback. If its scalar output is equal, preserve the parent body count and exact reference; if changed, execute and republish the parent.
- Run the capture-lint negative fixture against the actual proposed author callback with an untracked mutable capture. Require its real diagnostic. Checking only the adapter wrapper or registering a helper without exercising the author boundary is insufficient.

Cases 1–3 plus these bridge assertions are the required first-slice evidence: run each in separate processes and record both child and parent body counts plus exact references where two nodes exist. Cases 4–8 are preserved future pressure cases, not first-slice completion requirements. Fixed-subject identity and frozen `from` edges must still be implemented honestly; no broad reusable-call reconstruction or helper system is required.

Source follow-on evidence must prove the source callback executes beneath a retained parent and that explicit fresh policy publishes a new source result even for equal data. Freshly reading a file without that source-resolution evidence is insufficient.

## Deferred consumer pressure cases

These obligations inform later source/keyed design only; they do not enlarge the required first slice.

- [#170](https://github.com/mike-north/microdelta/issues/170): keep refresh observation identity distinct from temporal cutoff; reject or explicitly invalidate reuse of one observation identity with a different cutoff. Advancing observation refreshes provisional evidence without forcing equal-content downstream recomputation.
- [#170](https://github.com/mike-north/microdelta/issues/170): preserve independent, revocable author-owned source finality. Changing one settling policy must revoke its affected acceptance without changing another source's policy.
- [#170](https://github.com/mike-north/microdelta/issues/170): distinguish ready members from held-page/population closure. Ready independent work may proceed while strict consumers remain waiting; failed/open discovery cannot become complete coverage. The selected live bridge remains design work, not proven by cumulative snapshots.
- [#173](https://github.com/mike-north/microdelta/issues/173): preserve bounded internal pending scheduling state separately from the active execution window and full roster/report metadata. This is an existing internal fanout repair scope, not an author batching requirement or a universal constant-memory claim.

## Known baseline gaps

- **[#156](https://github.com/mike-north/microdelta/issues/156), current-alpha result-root typing:** the owner selected record/array roots for current alpha, with negative authoring types and documented scalar wrappers. The issue repairs types that currently accept roots execution rejects; it does not authorize future scalar runtime support. This separate experiment may lower author-facing numbers to its authorized internal numeric carrier, without closing #156 or changing its selected contract.
- **#164, subtree reuse:** establish current child/parent behavior before attributing a failure to the candidate. Equal returned data cannot excuse repeated child execution. Keep any repair independently scoped and reviewed.
- **#154, alpha setup:** the prototype may use repository alpha declaration mappings internally, while recording that they are not the intended consumer setup. Do not claim external usability from an internal compile.
- **[#168](https://github.com/mike-north/microdelta/issues/168)/[#169](https://github.com/mike-north/microdelta/issues/169):** existing custom-key and async trusted source-callback repairs remain separate. Neither expands result roots; do not assume either repair is complete or required for this numeric first slice.

## Decision gate

A successful first slice demonstrates simple authoring with truthful restart reuse and preserves semantic ownership. It does not adopt a public API, complete the keyed design or establish production readiness. Report pass, fail or inconclusive per case, with the smallest unresolved design/owner question. Root selects subsequent work and canonicalizes any accepted contract changes separately.
