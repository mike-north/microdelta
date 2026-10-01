/**
 * Keeps the M5 concurrency mutation controls meaningful between on-demand
 * runs. Each control's anchors must each occur exactly once in History's
 * current emitted build, so a refactor cannot silently disarm it, and the
 * planted build must differ from the original. Each control must also name a
 * distinct fault of its model, and that fault must have a known-bad
 * configuration. Runs in the facade's `npm test` after the build.
 *
 * @see ../../../../../experiments/exp-7/WriterLease.tla
 * @see ../../../../../experiments/exp-7/Publication.tla
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { controls, plant, repositoryRoot, target } from './controls.mjs';

const emitted = readFileSync(join(repositoryRoot, target), 'utf8');

/** The known-bad configuration file of a model fault. */
function badConfiguration(model, fault) {
  return join(repositoryRoot, `experiments/exp-7/${model}Bad-${fault}.cfg`);
}

test('the fence check and the expiry check are the first two controls, as the M5 issue requires', () => {
  assert.deepEqual(controls.slice(0, 2).map((control) => control.fault), ['holder-ignores-fence', 'holder-ignores-expiry']);
});

test('every control anchor occurs exactly once in the emitted History build and planting changes it', () => {
  for (const control of controls) {
    assert.ok(control.edits.length > 0, `${control.name}: has edits`);
    for (const edit of control.edits) {
      assert.equal(emitted.split(edit.anchor).length - 1, 1, `${control.name}: anchor count`);
      assert.notEqual(edit.replacement, edit.anchor, `${control.name}: replacement is a change`);
    }
    assert.notEqual(plant(emitted, control), emitted, `${control.name}: planted build differs`);
  }
});

test('every control names a distinct model fault with a known-bad configuration', () => {
  const faults = controls.map((control) => `${control.model}:${control.fault}`);
  assert.equal(new Set(faults).size, faults.length);
  for (const control of controls) {
    assert.ok(['WriterLease', 'Publication'].includes(control.model), `${control.name}: known model`);
    const model = readFileSync(join(repositoryRoot, `experiments/exp-7/${control.model}.tla`), 'utf8');
    assert.ok(model.includes(`"${control.fault}"`), `${control.fault} is a ${control.model} fault`);
    assert.ok(existsSync(badConfiguration(control.model, control.fault)), `${control.fault} has a known-bad configuration`);
  }
});
