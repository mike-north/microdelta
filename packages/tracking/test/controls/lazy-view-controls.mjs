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
 * Every Jest run is judged by `control-outcome.mjs`: only named assertions that
 * actually failed in a valid execution of the complete suite reject a control,
 * and the restored implementation must execute that suite with every assertion
 * passing and a successful exit. Abnormal, empty, incomplete, pending or
 * skipped runs never clear the gate.
 *
 * Prerequisite: the emitted `.test-build`. The package `test:controls` script
 * compiles it first (`tsc -p tsconfig.test.json`) and runs the judgment tests
 * before this script. Run serially: it rewrites one emitted file, which is
 * restored in `finally` on normal completion or error, but not after a kill.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { rejectsControl, restoredPasses } from './control-outcome.mjs';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const emitted = fileURLToPath(new URL('../../.test-build/src/observer.js', import.meta.url));
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

/** The complete intended suite: its emitted file and every declared test title. */
const suite = {
  path: '.test-build/test/lazy-view.test.js',
  titles: [
    ...Object.values(titles),
    'lazy views are observer-owned, immutable and reject native reflection',
    'reads outside any capture return values without recording evidence',
  ],
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

/** Run the intended lazy-view suite once and return the raw process result. */
function runSuite() {
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', jest, '--runInBand', '--json', '--runTestsByPath', suite.path], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? '' };
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
    const verdict = rejectsControl(runSuite(), suite, control.mustFail);
    console.log(`control: ${control.name}\n  rejected by: ${verdict.failed.length === 0 ? '(nothing)' : verdict.failed.join(' | ')}`);
    if (!verdict.rejected) {
      problems.push(`${control.name}: ${verdict.reason}`);
    }
  }
} finally {
  writeFileSync(emitted, original);
}
const restored = restoredPasses(runSuite(), suite);
console.log(`restored implementation: ${restored.passed ? `all ${String(suite.titles.length)} lazy-view tests executed and passed` : restored.reason}`);
if (!restored.passed) {
  problems.push(`the restored implementation did not pass the complete lazy-view suite: ${restored.reason}`);
}
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
}
