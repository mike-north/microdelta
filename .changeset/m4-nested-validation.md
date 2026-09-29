---
"@microdelta/resolution": minor
"@microdelta/tracking": minor
"@microdelta/definition": minor
"@microdelta/materialization": patch
---

Validate nested memo calls with argument recipes and equal-output cutoff (project-private `@alpha` surfaces).

- Resolution resolves nested calls: sibling memos and implementations supplied to callable step slots, with their runtime arguments.
  - A supplied child's history subject comes from its slot's subject function.
  - Its argument list is a frozen array that behaves as the plain list under every ordinary idiom. Element reads are observed under the `argument` binding, and so are its shape reads (`length`, positions past the end, `in`, key reflection). A changed arity or value under an equal subject therefore reruns the child.
- Nested memos record provenance version 2: ordered calls, each with its version-2 witness, exact child result and a `call` binding for the consumed output facts. Acceptance version 2 names each call's current result by position.
- Version-1 provenance keeps its existing meaning, and any other version is unsupported evidence.
- Validation order:
  - The memo's supplied-slot occupancy is checked before any candidate. A memo whose supplied slot is unbound fails with `unbound-step` before admission.
  - For each candidate, the memo's own evidence is checked first. Then every recorded call's witness is reconnected with no child work, so a missing or ambiguous slot or an unsupported witness is reported without resolving any child.
  - Then each call in recorded order:
    - rebuild its arguments: forwarded origins from current bindings or an earlier call's current output; derived values and forwarded paths only when recorded justified;
    - obtain the current child through its own validation or normal admission;
    - compare only the facts consumed from that call.
  - An unchanged consumed output keeps the parent's exact reference.
- `ICandidateMiss` gains distinct reasons: `changed-child-output`, `missing-binding`, `ambiguous-binding`, `unreconstructible-argument` and `unjustified-argument`.
- Children obtained while validating are shared with the parent's execution, so none runs twice in a request.
- A body that returns while a call it started is unsettled fails without publishing. Every started call settles before an attempt ends, and a body's own thrown error stays the reported failure. `IStepKind` gains `supplied`.
- Callbacks receive `untracked(view, key)`. `argumentsJustified` now reports whether the calling body has made an observed untracked read.
- Tracking adds the observed untracked read: `untracked(view, key)` and `untrackedReadObserved()`, recorded as an `untracked-read` observation (`MDU1`) that comparison skips.
- Definition changes:
  - Forwarded recipes in the version-2 witness now carry `justified`, like derived recipes. A path chosen after an observed untracked read is recorded unjustified, and the parser requires the field.
  - Definition exports `derivedArguments`, which decodes a call's derived recipe values, so Resolution can rebuild arguments without reading Value's encoding directly.
- Materialization's current-fact provider routes untracked-read requests to its fallback.
