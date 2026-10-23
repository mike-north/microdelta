/** Supplemental artifact outcomes: own-callback changes, rollback retention and exact rebinding body counts. */
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@jest/globals';

import { baseWorld, outcomeOf, referenceOf, scenario } from './acceptance/harness.js';
import { openHistory } from './durable-history/support.js';

/** Checked subprocess output contains only observations needed by the independent oracle. */
interface IObservation { readonly reference: string; readonly bodyCalls: number }
/** Run fresh declarations in a separate process; no JSON trust cast hides malformed evidence. */
function execute(directory: string, implementation: 'A' | 'B', version: 1 | 2): IObservation {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./gap-hunt-durability-reuse-artifact-worker.js', import.meta.url)), directory, implementation, String(version)], { encoding: 'utf8', timeout: 15000 });
  expect({ status: child.status, signal: child.signal, stderr: child.stderr }).toEqual({ status: 0, signal: null, stderr: '' });
  const parsed: unknown = JSON.parse(child.stdout);
  assert.ok(typeof parsed === 'object' && parsed !== null);
  const reference: unknown = Reflect.get(parsed, 'reference');
  const bodyCalls: unknown = Reflect.get(parsed, 'bodyCalls');
  assert.ok(typeof reference === 'string' && typeof bodyCalls === 'number');
  expect(parsed).toMatchObject({ value: { value: 'same', complete: true } });
  return { reference, bodyCalls };
}

test('F-09 own implementation and version change both miss; rollback reuses exact original while version2 remains readable', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-artifact-f09-'));
  try {
    const first = execute(directory, 'A', 1);
    const second = execute(directory, 'B', 2);
    const third = execute(directory, 'A', 1);
    expect([first.bodyCalls, second.bodyCalls, third.bodyCalls]).toEqual([1, 1, 0]);
    expect(second.reference).not.toBe(first.reference);
    expect(third.reference).toBe(first.reference);
    const history = openHistory({ location: join(directory, 'history.sqlite'), store: 'reuse-artifact' });
    try {
      expect(history.reader.readSubtree({ kind: 'completed-result', locator: second.reference }, [])).toEqual({ value: 'same', complete: true });
      expect(history.reader.readSubtree({ kind: 'completed-result', locator: first.reference }, [])).toEqual({ value: 'same', complete: true });
      expect(history.readCurrent({ analysis: 'reuse-artifact', environment: 'same', subject: 'artifact-consumer' })?.locator).toBe(second.reference);
    } finally { history.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('F-10 changing only own implementation at the same version runs once and publishes a distinct exact reference despite equal output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-artifact-f10-'));
  try {
    const first = execute(directory, 'A', 1);
    const second = execute(directory, 'B', 1);
    expect([first.bodyCalls, second.bodyCalls]).toEqual([1, 1]);
    expect(second.reference).not.toBe(first.reference);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('F-03 equal-name profile replacement executes zero consumer bodies, then current name change executes exactly once', () => {
  const fixture = scenario();
  try {
    fixture.writeWorld(baseWorld());
    const first = fixture.run({ kind: 'report' }, { keys: fixture.saveKeys('original').file });
    const world = baseWorld();
    const replacement = { ...world, final: { 'person:ada': false, 'person:ben': true }, profiles: world.profiles.map((profile) => profile.key === 'person:ada' ? { ...profile, id: 'gh:9001' } : profile) };
    fixture.writeWorld(replacement);
    const second = fixture.run({ kind: 'report' }, { keys: fixture.saveKeys('replacement').file });
    expect(outcomeOf(second, 'person:ada')).toMatchObject({ kind: 'reused', reference: referenceOf(first, 'person:ada') });
    expect(second.count('summary', 'person:ada')).toBe(0);
    fixture.writeWorld({ ...replacement, profiles: replacement.profiles.map((profile) => profile.key === 'person:ada' ? { ...profile, name: 'Ada L.' } : profile) });
    const third = fixture.run({ kind: 'report' }, { keys: fixture.saveKeys('new-name').file });
    expect(third.count('summary', 'person:ada')).toBe(1);
    expect(outcomeOf(third, 'person:ada')['kind']).toBe('published');
    expect(referenceOf(third, 'person:ada')).not.toBe(referenceOf(first, 'person:ada'));
  } finally { fixture.remove(); }
});
