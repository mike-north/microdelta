# A3 glossary residual anchors

These are bounded anchors, not whole-row certification. Ledger records live in
obligation-evidence.json; full original paragraphs remain in clause-map.json.

| Glossary unit | Meaning/invariant checked | Executed assertion and evidence | Residual boundary |
|---|---|---|---|
| Analysis (`glossary.md:19`; DOM-1/2) | One declared logical analysis survives separate process runs; a run lifetime is distinct from result identity | Example test `keyed-cold-and-restarted-report` (example-matrix.log8/8); F observation process test(jest.log3/3); workspace/scope.test.ts:296 newrunid retains results;scope37/48 context acrossawait/outsideclosedrun controls(workspace-resolution.log130/130) | Bounded declared fixtures; does not prove hours-long jobs, arbitrary closure soundness or all service/credential isolation |
| Bounded context (`glossary.md:22`; ARC-001/002/010) | Six context owners; Value/Materialization/Machine are supporting boundaries; host capabilities do not transfer persistence/freshness policy | tooling/package-architecture.mjs six `kind:context` entries; context-boundaries.test.mjs29/58/78/98/127/156 tests allowed edges/forbidden source/deep/facade paths and Node/nativeconfinement(additional-foundation.log41/41); MachineNode83,Materialization34(owner-contracts.log),Value50(contracts worker) | Import/port enforcement and component outcomes support boundary distinctions; invariant meaning remains architecture review, not a count-of-packages proof |
| Publication (`glossary.md:120`; ARC-007) | Allocation/claim/publication form authoritative completion; staged/partial writes cannot be current; exact immutable history survives | experiments/exp-3/test/publication.test.ts:166 allocationprecommitkill,194stagednotcomplete,209stageprecommitkill and publishcommit boundaries(experiments.log16publicationtests,5capability); History completed-results.test.ts:66exactreferenceaftercurrentmoves(owner-contracts.log44); source-policy.test.ts116fresh-equal distinct/workspace-resolution.log130 | EXP3 is bounded mechanism evidence; current durable backend fullfaultqualification comes from B ledger, not this prototype alone; exact-reference ownertest uses fake reader. #159 performance gap does not negate immutable-history behavior |

Current-source policy/fake-port nuance is in ARC-008-REVIEW.md. Do not turn that
open isolation question into an unobserved runtime failure or require a new
public child-resolver API merely to match an illustrative capability name.
