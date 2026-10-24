/**
 * TRK-5/8, REUSE-001 and A-01: complete process restarts must compare an
 * explicit tracked subtree against its current binding, not a historical copy
 * or the surrounding input. Every worker recreates authoring from scratch.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@jest/globals';
import { createNodeSqlite } from '@microdelta/machine-node';

/** One independently published result or exact retained result from a worker. */
interface IResult {
  readonly kind: 'published' | 'reused';
  readonly reference: unknown;
  readonly output: string;
  readonly bodyCalls: number;
}

const worker = fileURLToPath(new URL('./output-revalidation-worker.js', import.meta.url));

/** A new Node process observes only the current scenario and shared SQLite file. */
function resolve(location: string, variant: string, requestKey: string): IResult {
  const child = spawnSync(process.execPath, [worker, location, variant, requestKey], { encoding: 'utf8', timeout: 60_000 });
  if (child.status !== 0) {
    throw new Error(`Output worker failed (${String(child.status)}/${String(child.signal)}): ${child.stderr}`);
  }
  const value: unknown = JSON.parse(child.stdout);
  if (typeof value !== 'object' || value === null || !('kind' in value) || (value.kind !== 'published' && value.kind !== 'reused')
    || !('reference' in value) || !('output' in value) || typeof value.output !== 'string'
    || !('bodyCalls' in value) || typeof value.bodyCalls !== 'number') {
    throw new Error('Malformed output worker report');
  }
  return { kind: value.kind, reference: value.reference, output: value.output, bodyCalls: value.bodyCalls };
}

/** A publication count observes durable History, independently of the worker report. */
function publications(location: string): number {
  const database = createNodeSqlite().openSqlite(location);
  try {
    const row = database.prepare("SELECT COUNT(*) AS count FROM history_results WHERE subject = 'output-revalidation'").get();
    if (typeof row !== 'object' || row === null || !('count' in row) || typeof row.count !== 'number') {
      throw new Error('Malformed publication count');
    }
    return row.count;
  } finally {
    database.close();
  }
}

test('selected output keeps original reference with zero bodies/publications on unchanged and unread-sibling restarts, then reuses it after rollback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-output-revalidation-'));
  const retained = join(directory, 'retained.sqlite');
  try {
    const original = resolve(retained, 'base', 'first');
    expect(original).toMatchObject({ kind: 'published', bodyCalls: 1 });
    expect(publications(retained)).toBe(1);

    for (const [variant, requestKey] of [['base', 'same'], ['unread', 'unread']] as const) {
      const current = resolve(retained, variant, requestKey);
      expect(current).toMatchObject({ kind: 'reused', bodyCalls: 0, reference: original.reference, output: original.output });
      expect(publications(retained)).toBe(1);
    }

    const changed = resolve(retained, 'changed', 'changed');
    const coldChanged = resolve(join(directory, 'cold.sqlite'), 'changed', 'cold');
    expect(changed).toMatchObject({ kind: 'published', bodyCalls: 1, output: coldChanged.output });
    expect(changed.reference).not.toEqual(original.reference);
    expect(publications(retained)).toBe(2);

    const restored = resolve(retained, 'base', 'rollback');
    expect(restored).toMatchObject({ kind: 'reused', bodyCalls: 0, reference: original.reference, output: original.output });
    expect(publications(retained)).toBe(2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
