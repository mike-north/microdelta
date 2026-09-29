---
"microdelta": minor
---

Name the keyed composition authoring surface and the strict fold reports from the facade (project-private `@alpha` surfaces).

- The alpha view now names, as facade-local aliases, the vocabulary a keyed analysis needs: keyed collections (`ICollectionResult`, `ICollectionStatus`), template member builders and bindings (`IMemberBuilder`, `IMemberBinding`, `IAnyTemplateDeclaration`), supplied step slots (`IStepSlot`, `ISuppliedStepDeclaration`, `ISuppliedStepRegistration`, `ISlotSubject`, `IDerivedArguments`), forwarded arguments (`IForward`, `IForwarded`, `IPathInput`), the observed untracked read (`IUntrackedRead`), strict folds (`IFoldDeclaration`, `IFoldEntry`, `ISucceededEntry`, `ISkippedEntry`) and keying results (`IKeyedSnapshot`, `IKeyedMember`, `IKeyingDiagnostic`, `IKeyingFailure`).
- It also names the strict fold request's report types: `IFoldReport`, `IStrictFoldOutcome`, `IFoldOutcome`, `IFoldCoverage` and `ICandidateMiss`.
- A consumer can author and run a discovered, keyed, gated, nested and strictly folded analysis while importing only `microdelta`. Existing declarations are unchanged, and the public view still exposes only the Store API.
- The contribution report example now discovers its contributors, keys and gates them, assesses each authored pull request through a supplied assessor, and folds the required summaries into a strict report with framework coverage.
