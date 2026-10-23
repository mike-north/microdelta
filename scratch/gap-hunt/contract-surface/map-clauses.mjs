/**
 * Preserve every paragraph/table row while separating runtime obligations,
 * process obligations, accepted decisions and dated evidence. Evidence mappings
 * are reviewed below; matching a requirement ID alone never establishes proof.
 */
import { readFileSync, writeFileSync } from 'node:fs';
const files = ['README', 'domain', 'architecture', 'package-boundaries', 'experiments', 'reconciliation', 'validation'];
const evidence = JSON.parse(readFileSync('scratch/gap-hunt/contract-surface/obligation-evidence.json', 'utf8'));
const blocks = [];
for (const name of files) {
  const path = `docs/spec/${name}.md`;
  const lines = readFileSync(path, 'utf8').split('\n');
  let owner = null;
  let section = '';
  let fenced = false;
  let paragraph = [];
  let start = 0;
  function emit() {
    if (paragraph.length === 0) return;
    const text = paragraph.join('\n');
    const base = { key: `${path}:${start + 1}`, path, line: start + 1, owner, section, text };
    let classification;
    if (/^#{1,6} /u.test(text) || /^\|(?:\s*[-:]| Artifact | Context | Mechanism | Tier | Experiment | Earlier | Original )/u.test(text)) classification = 'structure';
    else if (name === 'validation') classification = 'dated-evidence-2026-09-26';
    else if (name === 'README' && start >= 111) classification = 'current-checkout-claim';
    else if (name === 'README' && owner === null) classification = 'status-or-purpose-summary';
    else if (text.startsWith('The current scaffold imports') || text.startsWith('The existing scaffold has strict')) classification = 'historical-scaffold-context';
    else if (name === 'reconciliation') classification = section === 'Explicit supersessions' || section === 'Preserved original product obligations' ? 'active-contract-cross-reference' : section === 'Scaffold migration' ? 'migration-process-obligation' : 'authority-and-artifact-policy';
    else if (name === 'experiments') {
      if (owner === null) classification = 'accepted-bounded-decision-summary';
      else if (owner === 'EXP-5') classification = 'retired-mechanism-and-standing-no-CML-policy';
      else if (owner === 'EXP-6') classification = 'historical-proof-and-standing-no-Lean-policy';
      else if (owner === 'EXP-7') classification = 'conditional-model-review-process';
      else if (text.startsWith('**Question:')) classification = 'experiment-question';
      else if (text.startsWith('**Scope:')) classification = 'experiment-scope-constraint';
      else if (text.startsWith('**Assertions first:')) classification = 'experiment-behavior-proof-obligation';
      else if (text.startsWith('**Decision outputs:')) classification = 'experiment-decision-record-obligation';
      else if (text.startsWith('**Gate:') || owner === 'EXP-0') classification = 'experiment-process-obligation';
      else classification = 'experiment-context';
    } else if (owner?.startsWith('SPEC-')) classification = 'standing-workflow-or-evidence-policy';
    else if (owner === 'DOM-5') classification = 'explicit-non-goal-or-deferral';
    else if (owner === null) classification = 'informative-context';
    else classification = 'normative-contract';
    const mapping = evidence[owner ?? name] ?? evidence[name];
    if (mapping === undefined) throw new Error(`Unmapped block ${base.key}, owner ${owner}`);
    blocks.push({ ...base, classification, ...mapping });
    paragraph = [];
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^```/u.test(line)) { emit(); fenced = !fenced; continue; }
    if (fenced) continue;
    const match = /^(?:## |\*\*)(SPEC-\d+|DOM-\d+|ARC-\d+|PKG-\d+|EXP-\d+)/u.exec(line);
    if (/^#{1,6} /u.test(line) || match !== null) {
      emit();
      if (match !== null) owner = match[1];
      if (/^## /u.test(line)) section = line.slice(3);
    }
    if (line.trim() === '') { emit(); continue; }
    if (line.startsWith('|')) { emit(); start = i; paragraph = [line]; emit(); continue; }
    if (paragraph.length === 0) start = i;
    paragraph.push(line);
  }
  emit();
}
const counts = Object.fromEntries([...new Set(blocks.map(block => block.classification))].sort().map(kind => [kind, blocks.filter(block => block.classification === kind).length]));
writeFileSync('scratch/gap-hunt/contract-surface/clause-map.json', `${JSON.stringify({ scope: 'Every non-code paragraph/table row in seven selected spec files, with reviewed requirement-level evidence and remaining boundaries. Runtime status is scoped per mapping; no ID occurrence is counted as proof.', counts, blocks }, null, 2)}\n`);
console.log(JSON.stringify({ blocks: blocks.length, counts }));
