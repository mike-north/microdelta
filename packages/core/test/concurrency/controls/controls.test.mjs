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

import { anchorSourceOf, controls, groupOf, groups, plant, rejectionHolds, repositoryRoot, targetOf, targets } from './controls.mjs';

/** The emitted text that proves a control's anchors: its target, or that target's package build. */
function emittedFor(control) {
  assert.ok(targets.includes(targetOf(control)), `${control.name}: known target`);
  return readFileSync(join(repositoryRoot, anchorSourceOf(control)), 'utf8');
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

test('every rejectedBy is a non-empty list of { test, message } entries whose message is a non-empty list of fragments', () => {
  for (const control of controls.filter((entry) => entry.rejectedBy !== undefined)) {
    assert.ok(Array.isArray(control.rejectedBy) && control.rejectedBy.length > 0, `${control.name}: rejectedBy is a non-empty array`);
    for (const entry of control.rejectedBy) {
      assert.ok(typeof entry === 'object' && entry !== null && !Array.isArray(entry), `${control.name}: rejectedBy entry is an object`);
      assert.deepEqual(Object.keys(entry).sort(), ['message', 'test'], `${control.name}: rejectedBy entry has exactly test and message`);
      assert.ok(typeof entry.test === 'string' && entry.test.length > 0, `${control.name}: rejectedBy test is a non-empty string`);
      assert.ok(Array.isArray(entry.message) && entry.message.length > 0, `${control.name}: rejectedBy message is a non-empty array, never a bare string`);
      for (const fragment of entry.message) {
        assert.ok(typeof fragment === 'string' && fragment.length > 0, `${control.name}: every message fragment is a non-empty string`);
      }
    }
  }
});

test('a rejection holds only when one failure message of a named test contains every fragment', () => {
  const expected = { test: '(C3)', message: ['q1FirstTry', '"kind": "acquired"'] };
  const title = 'real waiters contending (C3) four processes';
  const judged = (message) => rejectionHolds(expected, [title], new Map([[title, message]]));
  assert.equal(judged('Object {\n  "q1FirstTry": Object {\n-   "kind": "held",\n+   "kind": "acquired",'), true);
  // The generic fragment alone, from another assertion's diff, is not the intended reason.
  assert.equal(judged('Object {\n  "beforeQ0Expiry": false,\n  "kind": "acquired",'), false);
  assert.equal(judged('q1FirstTry was fine; another check failed'), false);
  // A failure of some other test does not count.
  assert.equal(rejectionHolds(expected, ['L1: a waiter polls'], new Map([['L1: a waiter polls', 'q1FirstTry "kind": "acquired"']])), false);
});

test('every control names a known run group', () => {
  for (const control of controls) {
    assert.ok(Object.hasOwn(groups, groupOf(control)), `${control.name}: known run group`);
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
