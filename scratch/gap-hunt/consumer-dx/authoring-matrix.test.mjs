/** Expected values are independent arithmetic and source fixture keys, never captured snapshots. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const worker = fileURLToPath(new URL('./dist/authoring-matrix.js', import.meta.url));
function resolve(location, request) {
  const child = spawnSync(process.execPath, [worker, location, request], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
test('array source, async array memo and readonly tuple child publish and retain exact summary across process exits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-alpha-matrix-'));
  try {
    const location = join(directory, 'history.sqlite');
    const first = resolve(location, 'first');
    const second = resolve(location, 'second');
    assert.equal(first.kind, 'published');
    assert.deepEqual(first.value, { key: 'ada', score: 6, name: 'ada', length: 1 });
    assert.equal(second.kind, 'reused');
    assert.deepEqual(second.reference, first.reference);
    assert.deepEqual(second.value, first.value);
    for (const output of [first, second]) {
      assert.deepEqual(output.members.members.map(member => member.status), ['succeeded', 'skipped']);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
