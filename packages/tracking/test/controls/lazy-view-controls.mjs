/**
 * Discrimination controls for Tracking's lazy-view assertions. Each control
 * substitutes one deliberately wrong behavior into the emitted implementation
 * under `.test-build` (never the TypeScript source), runs the already-written
 * lazy-view suite, and requires the named assertions to fail. The emitted file
 * is restored in `finally`, and the suite must pass again afterwards.
 *
 * A missing symbol proves nothing about behavior; these controls prove that
 * the selected-read, observation, lifetime, source-validation and output
 * assertions reject plausible wrong implementations. An anchor that no longer
 * matches exactly once fails loudly so the controls cannot silently go stale.
 *
 * Run after `tsc -p tsconfig.test.json` (the `test:controls` script does both).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const emitted = fileURLToPath(new URL('../../.test-build/src/observer.js', import.meta.url));
const suite = '.test-build/test/lazy-view.test.js';
const jest = fileURLToPath(new URL('../../../../node_modules/jest/bin/jest.js', import.meta.url));

/** Test titles, as declared in `lazy-view.test.ts`. */
const titles = {
  leaf: 'a nested leaf read requests only its path and records exactly one consumed leaf',
  parity: 'every supported operation records the same evidence as an in-memory tracked wrapper',
  length: 'array length is recorded only when a consumer reads it, and loops record only visited fields',
  output: 'explicit output detaches a lazy subtree, records its MDS1 snapshot and loads it only then',
  lifetime: 'a view inherited by work that outlives its capture frame fails before any source request',
  source: 'source answers for a different address, kind or operation are rejected before recording',
};

/** Each wrong behavior: an exact emitted anchor, its replacement, and the assertions that must reject it. */
const controls = [
  {
    name: 'container navigation observes and loads the whole container',
    anchor: 'return wrapLazy(binding, root, next);',
    replacement: 'recordLazyFact(binding, Object.freeze({ operation: \'value\', address: next.address, fact: root.source.subtree(next.address) })); return wrapLazy(binding, root, next);',
    mustFail: [titles.leaf, titles.parity, titles.length],
  },
  {
    name: 'array length is recorded when an array is navigated rather than read',
    anchor: 'return wrapLazy(binding, root, next);',
    replacement: 'if (next.kind === \'array\') { recordLazyFact(binding, Object.freeze({ operation: \'length\', address: next.address, fact: next.length })); } return wrapLazy(binding, root, next);',
    mustFail: [titles.length],
  },
  {
    name: '`in` records own presence instead of lookup-chain membership',
    anchor: "root.source.select(nextAddress, 'membership'), nextAddress, 'membership')",
    replacement: "root.source.select(nextAddress, 'own'), nextAddress, 'own')",
    mustFail: [titles.parity],
  },
  {
    name: 'work inherited from a closed capture frame may still request retained content',
    anchor: 'function assertLazyFrameOpen() {',
    replacement: 'function assertLazyFrameOpen() { return;',
    mustFail: [titles.lifetime],
  },
  {
    name: 'a source answer for a different address is accepted',
    anchor: 'if (!sameAddress(answered, address)) {',
    replacement: 'if (false) {',
    mustFail: [titles.source],
  },
  {
    name: 'two navigations to one retained subtree are separate output sources',
    anchor: 'let identity = owned.root.identities.get(key);',
    replacement: 'let identity = Object.freeze({});',
    mustFail: [titles.output],
  },
];

/** Run the lazy-view suite and return its failing test titles. */
function failingTitles() {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', jest, '--runInBand', '--json', '--runTestsByPath', suite], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const report = JSON.parse(result.stdout);
  return report.testResults.flatMap((file) => file.assertionResults)
    .filter((assertion) => assertion.status !== 'passed')
    .map((assertion) => assertion.title);
}

const original = readFileSync(emitted, 'utf8');
const problems = [];
try {
  for (const control of controls) {
    const occurrences = original.split(control.anchor).length - 1;
    if (occurrences !== 1) {
      problems.push(`${control.name}: anchor matched ${String(occurrences)} times; update the control with the implementation`);
      continue;
    }
    writeFileSync(emitted, original.replace(control.anchor, control.replacement));
    const failed = failingTitles();
    const survived = control.mustFail.filter((title) => !failed.includes(title));
    console.log(`control: ${control.name}\n  rejected by: ${failed.length === 0 ? '(nothing)' : failed.join(' | ')}`);
    if (survived.length > 0) {
      problems.push(`${control.name}: not rejected by ${survived.join(' | ')}`);
    }
  }
} finally {
  writeFileSync(emitted, original);
}
const restored = failingTitles();
console.log(`restored implementation: ${restored.length === 0 ? 'all lazy-view tests pass' : `failing ${restored.join(' | ')}`}`);
if (restored.length > 0) {
  problems.push('the restored implementation does not pass the lazy-view suite');
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
