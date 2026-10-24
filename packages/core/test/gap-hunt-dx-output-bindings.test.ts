/** TRK-8/RES-7: publishing tracked output preserves reuse for equal member/argument bindings. */
import { createNodeSqlite } from '@microdelta/machine-node';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@jest/globals';
interface IOutcome { readonly kind: string; readonly reference: unknown; readonly value: unknown; readonly misses: unknown }
const worker = fileURLToPath(new URL('../../../../scratch/gap-hunt/consumer-dx/dist/output-bindings.js', import.meta.url));
/** Independent process and explicit result narrowing prevent the harness from providing retained state. */
function resolve(location: string, request: string, mode: string): IOutcome {
  const child = spawnSync(process.execPath, [worker, location, request, mode], { encoding: 'utf8' });
  if (child.status !== 0) { throw new Error(child.stderr); }
  const value: unknown = JSON.parse(child.stdout);
  if (typeof value !== 'object' || value === null || !('kind' in value) || typeof value.kind !== 'string' || !('reference' in value) || !('value' in value) || !('misses' in value)) { throw new Error('Malformed output fixture'); }
  return { kind: value.kind, reference: value.reference, value: value.value, misses: value.misses };
}
test.each(['scalar', 'subtree', 'argument'])('%s output retains its exact reference on an identical restart', mode => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-dx-bindings-'));
  try {
    const first = resolve(join(directory, 'store.sqlite'), 'first', mode);
    const second = resolve(join(directory, 'store.sqlite'), 'second', mode);
    expect(first.kind).toBe('published');
    expect(second.value).toEqual(first.value);
    expect(second).toMatchObject({ kind: 'reused', reference: first.reference });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

/** A retained parent may hide unnecessary child execution behind output cutoff. */
test('forwarded argument output avoids another child publication on identical restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-dx-argument-'));
  const location = join(directory, 'store.sqlite');
  try {
    const first = resolve(location, 'first', 'argument');
    const second = resolve(location, 'second', 'argument');
    expect(second).toMatchObject({ kind: 'reused', reference: first.reference });
    const database = createNodeSqlite().openSqlite(location);
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM history_results WHERE subject = 'description'").get()).toMatchObject({ count: 1 });
    } finally { database.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
