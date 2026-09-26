/** Issue #4 examples specify completeness without claiming substantive review. */
export const completeBody = `## Problem and resulting behavior
Reject incomplete PR evidence before supervisory review.

## Governing issue and contracts
Refs #4
Delivery conventions; metadata completeness does not prove semantic correctness.

## Acceptance evidence
Criterion 1: negative fixtures fail before implementation and pass afterward.
Verification: node --test tooling/pr-metadata.test.mjs passed.

## Risks and limitations
Mechanical checks cannot establish truth of the supplied evidence.

## Attribution
Implementer: Codex implementation agent, supervised by Mike North.
Agent assistance: Codex wrote the tests and checker.
Review: pending supervisor review.
`;

/** Each omission targets an independently required delivery-contract field. */
export const incompleteBodies = [
  { name: 'issue reference', body: completeBody.replace('Refs #4', ''), diagnostic: /issue reference/i },
  { name: 'zero issue reference', body: completeBody.replace('Refs #4', 'Refs #0'), diagnostic: /issue reference/i },
  { name: 'acceptance evidence', body: completeBody.replace(/## Acceptance evidence[^]*?(?=## Risks)/u, ''), diagnostic: /Acceptance evidence/ },
  { name: 'comment-only evidence', body: completeBody.replace(/(## Acceptance evidence\n)[^]*?(?=## Risks)/u, '$1<!-- tests go here -->\n\n'), diagnostic: /Acceptance evidence/ },
  { name: 'risks', body: completeBody.replace(/## Risks and limitations[^]*?(?=## Attribution)/u, ''), diagnostic: /Risks and limitations/ },
  { name: 'implementer', body: completeBody.replace(/^Implementer:.*$/mu, ''), diagnostic: /Implementer:/ },
  { name: 'agent attribution', body: completeBody.replace(/^Agent assistance:.*$/mu, ''), diagnostic: /Agent assistance:/ },
  { name: 'empty implementer', body: completeBody.replace(/^Implementer:.*$/mu, 'Implementer:'), diagnostic: /Implementer:/ },
  { name: 'placeholder', body: completeBody.replace('Mechanical checks cannot establish truth of the supplied evidence.', 'TODO'), diagnostic: /placeholder/i },
  { name: 'duplicate evidence', body: completeBody + '\n## Acceptance evidence\nOther claims.', diagnostic: /duplicate/i },
];
