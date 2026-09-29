---
"@microdelta/definition": minor
"@microdelta/resolution": patch
---

Add project-private `@alpha` Definition declarations for keyed fanout.

- A source can declare itself a keyed collection with a designated identity field.
- A fanout template's factory runs exactly once against a symbolic member whose builders reject every later call with `frozen`. Member memos may name sibling member steps and composition-wide supplied step slots. An optional custom key and tracked gate can be declared.
- A strict fold names `{ template, step }` and receives explicit `succeeded` or `skipped` entries in canonical key order; reading a skipped entry's data throws.
- Compositions accept templates alongside composition-level steps.
- A member instance is addressed by its template step descriptor plus the member key. Its subject is the step's prefix applied to that key; its declarations are minted per composition and retained only for members that keying returned. An opened instance always records version-2 witnesses, and the version-1 witness parser rejects template-bearing descriptors. A renamed template or moved collection is a miss.
- `keyMembers` keys a collection snapshot before any gate or body. It rejects malformed members, and missing, non-string, empty or duplicate keys, for the whole snapshot, with a deterministic diagnostic.
- `gateOf` exposes an instance's gate and `gateOutcome` classifies it.
- `IInvocation` and `IStepDeclaration` now include folds.

Explicit-member compositions, their descriptors and version-1 witnesses keep their meaning. Resolution refuses template instance steps and strict folds with `invalid-request` before any evidence, candidate lookup or admission.
