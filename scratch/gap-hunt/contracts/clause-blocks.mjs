/** Inventory every paragraph/table row under stable requirements; status is reviewable, never inferred test success. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const paths = [...readdirSync('docs/spec').filter(name => name.endsWith('.md')).map(name => `docs/spec/${name}`), 'README.md', 'packages/core/README.md', 'examples/contribution-report/README.md'];
const testPaths = execFileSync('rg', ['--files', 'packages', 'experiments', 'tooling', 'fixtures', 'examples'], { encoding: 'utf8' }).trim().split('\n').filter(path => /(?:test|fixture|check)/.test(path) && /\.(?:ts|mjs)$/.test(path));
const tests = testPaths.map(path => ({ path, source: readFileSync(path, 'utf8') }));
const blocks = [];
const idPattern = /(?:SPEC|DOM|ARC|PKG|TRK|VAL|COL|CMP|RES|REUSE|PUB|RUN|CLI|ACC|TEST|EXP|A)-\d+/g;
for (const path of paths) {
  let owner = undefined;
  let paragraph = [];
  let start = 1;
  let fence = false;
  const emit = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join('\n');
    const ids = [...new Set(text.match(idPattern) ?? [])];
    const applicable = owner === undefined ? ids : [...new Set([owner, ...ids])];
    const classification = path.endsWith('glossary.md') ? 'language-definition' : owner?.startsWith('CLI-') ? 'M6-target-not-delivered' : /arbitrary closure|resumable JS stack|class-aware|broad native-value/.test(text) && owner === 'DOM-5' ? 'explicitly-excluded-or-deferred' : /^(ARC|PKG|SPEC)-/.test(owner ?? '') ? 'architecture-artifact-or-governance-check' : /(?:Proposal|Experiment|Open:)/.test(text) ? 'proposal-experiment-or-open-context-review-required' : 'behavior-or-contract-review-required';
    const candidates = tests.filter(test => applicable.some(id => new RegExp(`\\b${id}(?![0-9])`).test(test.source))).map(test => test.path);
    blocks.push({ key: `${path}:${start}`, owner: owner ?? null, text, applicableRequirements: applicable, classification, assertionCandidates: candidates, assertionStatus: 'unreviewed-reference-only', executionStatus: 'not-established-by-inventory' });
    paragraph = [];
  };
  readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    if (/^```/.test(line)) { emit(); fence = !fence; return; }
    if (fence) return;
    const heading = line.match(/^(?:#{1,5}\s+|\*\*)((?:SPEC|DOM|ARC|PKG|TRK|VAL|COL|CMP|RES|REUSE|PUB|RUN|CLI|ACC|TEST|EXP)-\d+)/);
    const tableId = line.match(/^\|\s*\*?\*?((?:A|TEST)-\d+)/);
    if (heading || tableId) { emit(); owner = (heading ?? tableId)[1]; }
    if (line.trim() === '') { emit(); return; }
    if (line.startsWith('|')) { emit(); start = index + 1; paragraph.push(line); emit(); return; }
    if (paragraph.length === 0) start = index + 1;
    paragraph.push(line);
  });
  emit();
}
writeFileSync('scratch/gap-hunt/contracts/clause-blocks.json', JSON.stringify({ scope: 'Exhaustive non-code paragraph and table-row inventory across requested spec and READMEs; each stable requirement retains complete prose. A candidate assertion path only means a literal reference. Deferred classification is provisional and must not become a defect count.', blocks }, null, 2) + '\n');
console.log(JSON.stringify({ blocks: blocks.length, requirementOwners: new Set(blocks.map(block => block.owner).filter(Boolean)).size, classified: blocks.reduce((acc, block) => ({ ...acc, [block.classification]: (acc[block.classification] ?? 0) + 1 }), {}) }));
