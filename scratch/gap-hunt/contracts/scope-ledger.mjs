/** Separate delivered obligations from target/proposal/history before reporting a coverage denominator. */
import { readFile, writeFile } from 'node:fs/promises';
const prefix = 'scratch/gap-hunt/contracts/';
const semantic = JSON.parse(await readFile(prefix + 'semantic-clauses.json', 'utf8'));
const external = JSON.parse(await readFile(prefix + 'other-owner-evidence.json', 'utf8'));
const surface = JSON.parse(await readFile(prefix + 'surface-owner-evidence.json', 'utf8'));
const historicalBlocks = new Set(['docs/spec/tracking.md:152', 'docs/spec/tracking.md:164', 'docs/spec/tracking.md:181', 'docs/spec/tracking.md:188', 'docs/spec/tracking.md:206', 'docs/spec/tracking.md:217']);
const metadataBlocks = new Set(['docs/spec/glossary.md:3', 'docs/spec/glossary.md:8']);
const units = [];
for (const block of semantic.blocks) {
  // Sentence-sized units retain their source block; table rows preserve their complete operation/negative contract.
  const initialParts = block.clause.startsWith('|') ? [block.clause] : block.clause.replaceAll('\n', ' ').split(/(?<=[.!?])\s+(?=[A-Z“])/u);
  const parts = initialParts.flatMap(text => text === 'Classes are deferred, not silently supported as plain data.' ? ['Classes are deferred', 'not silently supported as plain data.'] : [text]);
  for (const [position, text] of parts.entries()) {
    let scope = 'delivered';
    let reason = 'Current selected Tracking/Composition semantics or a glossary definition of delivered M5 capabilities; bounded assertion evidence does not discharge all prose.';
    if (block.status === 'structural-text-no-runtime-claim' || metadataBlocks.has(block.key)) {
      scope = 'structural'; reason = 'Heading, table schema, status or vocabulary governance; not a runtime obligation.';
    } else if (historicalBlocks.has(block.key) || /Its synchronous fixture|The \[EXP-1 counterexample/u.test(text)) {
      scope = 'historical'; reason = 'Explicit experiment evidence/limitations or dormant Lean model; not an additional delivered runtime feature obligation.';
    } else if (/proposed .*convenience|exact identity-bearing brand\/helper API remains experimental/u.test(text)) {
      scope = 'proposal'; reason = 'Explicitly proposed/experimental API surface; no implementation behavior is inferred.';
    } else if (/^Classes are deferred$|production cache\/eviction policy|scale behavior remained unproven|full tracked materialization surface remains implementation work/u.test(text)) {
      scope = 'target'; reason = 'Explicit deferred/unavailable surface; no delivered conformance claim.';
    }
    const requirements = [];
    for (const match of text.matchAll(/\b([A-Z]+)-(\d+)((?:\/\d+)*)\b/gu)) {
      for (const number of [match[2], ...match[3].split('/').filter(Boolean)]) requirements.push(`${match[1]}-${number}`);
    }
    const ownerAnchors = external.requirements.filter(row => requirements.includes(row.requirement)).map(row => ({
      requirement: row.requirement, classification: row.classification, meaning: row.meaning,
      actualTests: row.executedAssertionIds.map(id => external.tests.find(test => test.id === id)).filter(Boolean).map(test => ({ id: test.id, path: test.path, name: test.name, status: test.status })),
      residual: row.residual,
    }));
    units.push({ key: `${block.key}#${position + 1}`, sourceBlock: block.key, scope, reason, text,
      localBoundedAssertionIds: block.executedAssertionIds,
      surfaceOwnerAnchors: requirements.filter(id => surface.requirements[id]).map(id => ({ requirement: id, ...surface.requirements[id] })),
      ownerAnchors,
      conformance: 'not-certified-by-whole-clause-association',
      residual: scope === 'delivered' ? 'Only the exact proves statements of local assertions and linked owner meanings are established. Every other sub-obligation remains open; test presence is not whole-unit coverage.' : 'Outside the delivered runtime denominator; scope reason must be retained.',
    });
  }
}
const denominator = Object.fromEntries(['delivered','target','proposal','historical','structural'].map(scope => [scope, units.filter(unit => unit.scope === scope).length]));
const delivered = units.filter(unit => unit.scope === 'delivered');
await writeFile(prefix + 'scope-evidence-ledger.json', JSON.stringify({
  unit: 'Sentence-sized source units; complete operation/glossary table rows remain indivisible. Counts are an inventory denominator, not a pass rate.',
  classificationBoundary: 'Explicit historical/proposal/deferred sentences are excluded first. Mixed paragraphs are split where possible. Current delivered assertions remain bounded; no unit is certified merely because it shares an ID or paragraph with a test.',
  denominator,
  deliveredEvidenceRouting: {
    withLocalBoundedAnchors: delivered.filter(unit => unit.localBoundedAssertionIds.length).length,
    withOtherOwnerAnchors: delivered.filter(unit => unit.ownerAnchors.some(owner => owner.actualTests.some(test => test.status === 'passed'))).length,
    withoutEitherAnchor: delivered.filter(unit => !unit.localBoundedAssertionIds.length && !unit.ownerAnchors.some(owner => owner.actualTests.some(test => test.status === 'passed'))).length,
    withSurfaceOwnerReferences: delivered.filter(unit => unit.surfaceOwnerAnchors.length).length,
    certifiedCompleteUnits: 0,
  },
  surfaceSnapshot: { file: prefix + 'surface-owner-evidence.json', branch: surface.sourceBranch, commit: surface.sourceCommit },
  externalSnapshot: { file: prefix + 'other-owner-evidence.json', branch: external.sourceBranch, commit: external.sourceCommit },
  units,
}, null, 2) + '\n');
console.log(JSON.stringify({ denominator, deliveredWithoutEitherAnchor: delivered.filter(unit => !unit.localBoundedAssertionIds.length && !unit.ownerAnchors.some(owner => owner.actualTests.some(test => test.status === 'passed'))).map(unit => unit.key) }));
