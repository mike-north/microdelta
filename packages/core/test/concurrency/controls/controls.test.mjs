/**
 * Keeps the M5 concurrency mutation controls meaningful between on-demand
 * runs: each control's anchor must occur exactly once in History's current
 * emitted build (so a refactor cannot silently disarm it), must change that
 * build, and must name a distinct fault of the WriterLease model, whose
 * known-bad configuration must exist. Runs in the facade's `npm test` after
 * the build.
 *
 * @see ../../../../../experiments/exp-7/WriterLease.tla
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { controls, repositoryRoot, target } from './controls.mjs';

const emitted = readFileSync(join(repositoryRoot, target), 'utf8');

test('the fence check and the expiry check are the first two controls, as the M5 issue requires', () => {
  assert.deepEqual(controls.slice(0, 2).map((control) => control.fault), ['holder-ignores-fence', 'holder-ignores-expiry']);
});

test('every control anchor occurs exactly once in the emitted History build and its replacement changes it', () => {
  for (const control of controls) {
    assert.equal(emitted.split(control.anchor).length - 1, 1, `${control.name}: anchor count`);
    assert.notEqual(control.replacement, control.anchor, `${control.name}: replacement is a change`);
  }
});

test('every control names a distinct WriterLease fault with a known-bad configuration', () => {
  const faults = controls.map((control) => control.fault);
  assert.equal(new Set(faults).size, faults.length);
  const model = readFileSync(join(repositoryRoot, 'experiments/exp-7/WriterLease.tla'), 'utf8');
  for (const fault of faults) {
    assert.ok(model.includes(`"${fault}"`), `${fault} is a model fault`);
    assert.ok(existsSync(join(repositoryRoot, `experiments/exp-7/WriterLeaseBad-${fault}.cfg`)), `${fault} has a known-bad configuration`);
  }
});
