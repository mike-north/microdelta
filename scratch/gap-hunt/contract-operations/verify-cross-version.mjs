/** Use independently installed runtimes against one store; never share a native binding. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const [node24, root24, node26, root26] = process.argv.slice(2);
if (!node24 || !root24 || !node26 || !root26) throw new Error('usage: node verify-cross-version.mjs NODE24 ROOT24 NODE26 ROOT26');
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
assert.match(run(node24, ['--version']), /^v24\./);
assert.match(run(node26, ['--version']), /^v26\./);
const head24 = run('git', ['-C', root24, 'rev-parse', 'HEAD']);
assert.equal(run('git', ['-C', root26, 'rev-parse', 'HEAD']), head24, 'runtime checkouts must have identical source commits');
const binding = (root) => realpathSync(createRequire(join(resolve(root), 'package.json')).resolve('better-sqlite3/build/Release/better_sqlite3.node'));
assert.notEqual(binding(root24), binding(root26), 'native bindings must be independently installed');
console.log(JSON.stringify({ sourceCommit: head24, binding24: binding(root24), binding26: binding(root26) }));
const worker = join(dirname(fileURLToPath(import.meta.url)), 'cross-version-worker.mjs');
const directory = mkdtempSync(join(tmpdir(), 'microdelta-cross-node-'));
const expected = { title: 'retained', list: [1, 2, 3], nested: { empty: null, enabled: true, text: 'Unicode: café 🚀' } };
try {
  for (const [label, sequence] of [
    ['24-26-24', [[node24, root24], [node26, root26], [node24, root24]]],
    ['26-24-26', [[node26, root26], [node24, root24], [node26, root26]]],
  ]) {
    let reference;
    for (const [index, [binary, root]] of sequence.entries()) {
      const result = JSON.parse(run(binary, [worker, root, join(directory, `${label}.sqlite`), `${label}:${index}`]));
      console.log(JSON.stringify({ sequence: label, index, ...result }));
      assert.equal(result.calls, index === 0 ? 1 : 0, 'unchanged cross-version restart must not execute a body');
      assert.equal(result.kind, index === 0 ? 'published' : 'reused');
      assert.deepEqual(result.payload, expected);
      if (index === 0) reference = result.reference;
      else assert.deepEqual(result.reference, reference, 'exact locator must survive each cross-version restart');
    }
  }
  console.log('PASS: both independently installed cross-version shared-store sequences preserve bodies, payload and exact references');
} finally { rmSync(directory, { recursive: true, force: true }); }
