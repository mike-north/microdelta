/**
 * Keeps every facade mutation-control runner armed between on-demand runs.
 *
 * A control plants its fault by replacing an anchor in an emitted build, so a
 * refactor that renames, moves or duplicates the anchored text silently turns
 * the control into evidence of nothing. Every runner therefore exposes
 * `--check-anchors`, which verifies that each of its anchors matches exactly
 * once in the current builds and runs no test suite; this file runs that mode
 * for every runner in `npm test`, after the builds exist, so drift fails at the
 * moment it happens rather than the next time someone runs the minutes-long
 * full controls.
 *
 * The concurrency runner's anchors are additionally covered by its own
 * `controls.test.mjs`; the tracking package guards its single runner by running
 * it in its own `npm test`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { anchorProblems, checkAnchorsFlag, countAnchor, reportAnchorCheck } from './anchor-check.mjs';

const testRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Every mutation-control runner under `packages/core/test/*\/controls`, as absolute paths. */
function runners() {
  return readdirSync(testRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const controls = join(testRoot, entry.name, 'controls');
      try {
        return readdirSync(controls)
          .filter((name) => name.endsWith('-mutation-controls.mjs'))
          .map((name) => join(controls, name));
      } catch {
        return [];
      }
    })
    .sort();
}

describe('anchor counting', () => {
  test('an anchor that occurs exactly once matches', () => {
    assert.equal(countAnchor('a b c', 'b'), 1);
    assert.deepEqual(anchorProblems([{ control: 'c', file: 'f.js', text: 'a b c', anchor: 'b' }]), []);
  });

  test('a stale anchor (no match) is reported with its control and file', () => {
    assert.deepEqual(anchorProblems([{ control: 'the fault', file: 'f.js', text: 'a b c', anchor: 'z' }]), ['ANCHOR 0x in f.js: the fault']);
  });

  test('an ambiguous anchor (two matches) is reported', () => {
    assert.deepEqual(anchorProblems([{ control: 'the fault', file: 'f.js', text: 'b a b', anchor: 'b' }]), ['ANCHOR 2x in f.js: the fault']);
  });

  test('an empty anchor never counts as a match', () => {
    assert.equal(countAnchor('abc', ''), 0);
  });

  test('every plant is checked, so one stale plant of a multi-file control is not hidden by a good one', () => {
    const plants = [
      { control: 'two files', file: 'dist.js', text: 'x', anchor: 'x' },
      { control: 'two files', file: 'built.js', text: 'y', anchor: 'x' },
    ];
    assert.deepEqual(anchorProblems(plants), ['ANCHOR 0x in built.js: two files']);
  });

  test('the report exits nonzero only when a problem exists', () => {
    const log = console.log;
    console.log = () => undefined;
    try {
      assert.equal(reportAnchorCheck([], 3), 0);
      assert.equal(reportAnchorCheck(['ANCHOR 0x in f.js: c'], 3), 1);
    } finally {
      console.log = log;
    }
  });
});

describe('every mutation-control runner keeps its anchors matching exactly once', () => {
  const found = runners();

  test('the runners are discovered', () => {
    assert.ok(found.length >= 10, `expected the facade's control runners, found ${String(found.length)}`);
  });

  for (const runner of found) {
    test(runner.slice(testRoot.length), () => {
      // A runner that ignored the flag would run its full controls and mutate builds; the timeout stops it quickly.
      const result = spawnSync(process.execPath, [runner, checkAnchorsFlag], { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGTERM' });
      assert.equal(result.error, undefined, `the runner did not finish its anchor check within 60 s (does it support ${checkAnchorsFlag}?)`);
      assert.equal(result.status, 0, `anchor drift (build first with npm run build and npm run test:unit --workspace microdelta):\n${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /^ANCHORS OK: \d+ controls$/mu);
    });
  }
});
