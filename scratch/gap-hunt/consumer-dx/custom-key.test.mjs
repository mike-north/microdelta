/** Explicit custom identity and absence of any key strategy have different intended outcomes (COL-1). */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const worker = fileURLToPath(new URL('./dist/custom-key.js', import.meta.url));
function run(mode, location = 'unused.sqlite') {
  const child = spawnSync(process.execPath, [worker, mode, location], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
test('a no-identity member with an explicit supported string custom key is accepted without fictional fields', () => {
  assert.equal(run('custom').kind, 'accepted');
});
test('no designated identity and no custom strategy is rejected', () => {
  assert.equal(run('missing').kind, 'rejected');
});
test('an optional string identity annotation allows absent physical identity when a custom key is supplied', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-optional-key-'));
  try {
    const result = run('optional', join(directory, 'history.sqlite'));
    assert.equal(result.kind, 'accepted');
    assert.equal(result.report.discovery.kind, 'keyed');
    assert.deepEqual(result.report.discovery.keys, ['id:7']);
    assert.deepEqual(result.report.members.map(member => member.status), ['succeeded']);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
