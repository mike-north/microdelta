/**
 * Keeps the M5 concurrency mutation controls meaningful between on-demand
 * runs. Each control's anchors must each occur exactly once in its target's
 * current emitted build (History's, or Run Supervision's writer wait), so a
 * refactor cannot silently disarm it, and the planted build must differ from
 * the original. Each control must also name a distinct fault of its model,
 * and that fault must have a known-bad configuration, or else state why the
 * model cannot express it. Runs in the facade's `npm test` after the build.
 *
 * @see ../../../../../experiments/exp-7/WriterLease.tla
 * @see ../../../../../experiments/exp-7/Publication.tla
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { controls, plant, repositoryRoot, targetOf, targets } from './controls.mjs';

/** The current emitted text of every target, by its repository-relative path. */
const emitted = new Map(targets.map((path) => [path, readFileSync(join(repositoryRoot, path), 'utf8')]));

/** The emitted text a control plants into. */
function emittedFor(control) {
  const text = emitted.get(targetOf(control));
  assert.ok(text !== undefined, `${control.name}: known target`);
  return text;
}

/** The known-bad configuration file of a model fault. */
function badConfiguration(model, fault) {
  return join(repositoryRoot, `experiments/exp-7/${model}Bad-${fault}.cfg`);
}

test('the fence check and the expiry check are the first two controls, as the M5 issue requires', () => {
  assert.deepEqual(controls.slice(0, 2).map((control) => control.fault), ['holder-ignores-fence', 'holder-ignores-expiry']);
});

test('every control anchor occurs exactly once in its emitted target and planting changes it', () => {
  for (const control of controls) {
    const text = emittedFor(control);
    assert.ok(control.edits.length > 0, `${control.name}: has edits`);
    for (const edit of control.edits) {
      assert.equal(text.split(edit.anchor).length - 1, 1, `${control.name}: anchor count`);
      assert.notEqual(edit.replacement, edit.anchor, `${control.name}: replacement is a change`);
    }
    assert.notEqual(plant(text, control), text, `${control.name}: planted build differs`);
  }
});

test('every control without a model counterpart says why the model cannot express it', () => {
  for (const control of controls.filter((entry) => entry.model === null)) {
    assert.equal(control.fault, undefined, `${control.name}: no fault without a model`);
    assert.ok(typeof control.unmodeled === 'string' && control.unmodeled.length > 40, `${control.name}: states why it is unmodeled`);
  }
});

test('every modeled control names a distinct model fault with a known-bad configuration', () => {
  const modeled = controls.filter((control) => control.model !== null);
  const faults = modeled.map((control) => `${control.model}:${control.fault}`);
  assert.equal(new Set(faults).size, faults.length);
  for (const control of modeled) {
    assert.equal(control.unmodeled, undefined, `${control.name}: a modeled control needs no excuse`);
    assert.ok(['WriterLease', 'Publication'].includes(control.model), `${control.name}: known model`);
    const model = readFileSync(join(repositoryRoot, `experiments/exp-7/${control.model}.tla`), 'utf8');
    assert.ok(model.includes(`"${control.fault}"`), `${control.fault} is a ${control.model} fault`);
    assert.ok(existsSync(badConfiguration(control.model, control.fault)), `${control.fault} has a known-bad configuration`);
  }
});
