/** Structural completeness only: semantic evidence remains the reviewer's judgment. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const expected = new Set();
for (const doc of ['execution', 'operations', 'acceptance']) {
  const source = readFileSync(`docs/spec/${doc}.md`, 'utf8');
  for (const expression of [/^### ((?:RES|REUSE|PUB|RUN|CLI|ACC)-\d+)/gm, /^\| (A-\d+) /gm, /\*\*(TEST-\d+) /g]) {
    for (const match of source.matchAll(expression)) expected.add(match[1]);
  }
}
const matrix = readFileSync('scratch/gap-hunt/contract-operations/COMPLETION-MATRIX.md', 'utf8');
const actual = new Set([...matrix.matchAll(/^\| ((?:RES|REUSE|PUB|RUN|CLI|ACC|TEST|A)-\d+)(?:[ .|])/gm)].map((match) => match[1]));
assert.deepEqual([...actual].sort(), [...expected].sort(), 'every current stable clause requires an explicit matrix row');
for (const placeholder of ['No claim of complete coverage.', 'other prose obligations are not automatically discharged']) {
  assert.equal(matrix.includes(placeholder), false, 'generic residual placeholders do not identify work');
}
console.log(`PASS: ${expected.size} current stable clause identifiers have matrix rows; this checks inventory shape, not behavioral conformance`);
