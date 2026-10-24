/**
 * The current alpha result-root boundary is enforced before authoring by
 * generated types and after execution by Resolution/History for untyped JS.
 * Wrapped scalar fields remain supported Value data and count as success.
 *
 * @see ../../../../docs/spec/tracking.md (VAL-2 and bounded M3 root decision)
 * @see ../../../../docs/spec/composition.md (CMP-8)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

/** Only the independent JavaScript worker's observable contract. */
interface IRootReport {
  readonly kind: 'returned' | 'failed';
  readonly code?: string;
  readonly message?: string;
  readonly completed: number;
  readonly bodyCalls: number;
  readonly hasValue?: boolean;
  readonly matches?: boolean;
}

/** Verify subprocess JSON before treating it as a test result. */
function isRootReport(value: unknown): value is IRootReport {
  return typeof value === 'object' && value !== null
    && 'kind' in value && (value.kind === 'returned' || value.kind === 'failed')
    && 'completed' in value && typeof value.completed === 'number'
    && 'bodyCalls' in value && typeof value.bodyCalls === 'number'
    && (!('code' in value) || typeof value.code === 'string')
    && (!('message' in value) || typeof value.message === 'string')
    && (!('hasValue' in value) || typeof value.hasValue === 'boolean')
    && (!('matches' in value) || typeof value.matches === 'boolean');
}

const worker = fileURLToPath(new URL('../../../test/workspace/result-root-worker.mjs', import.meta.url));

/** A fresh store isolates each invalid atom and its publication count. */
function run(kind: 'source' | 'memo' | 'wrapped', atom: string): IRootReport {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-result-root-'));
  try {
    const child = spawnSync(process.execPath, [worker, join(directory, 'history.sqlite'), kind, atom], { encoding: 'utf8' });
    expect(child.status).toBe(0);
    const decoded: unknown = JSON.parse(child.stdout);
    if (!isRootReport(decoded)) { throw new Error(`Invalid result-root report: ${child.stdout}`); }
    return decoded;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Scalar atoms are Value members, but not standalone completed results. */
const atoms = ['string', 'number', 'boolean', 'null', 'undefined'] as const;

describe.each(['source', 'memo'] as const)('%s result root', kind => {
  test.each(atoms)('%s is rejected after one body call without publication', atom => {
    expect(run(kind, atom)).toMatchObject({
      kind: 'failed', code: 'unsupported-result', completed: 0, bodyCalls: 1,
      message: expect.stringContaining('without a record or array root'),
    });
  });
});

test.each([...atoms, 'negative-zero', 'nan', 'infinity'])('record-wrapped %s remains a successful exact Value atom', atom => {
  expect(run('wrapped', atom)).toMatchObject({ kind: 'returned', completed: 1, bodyCalls: 1, hasValue: true, matches: true });
});
