/** EXP-1 restart outcomes are observed only after writer process A exits. */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from '@jest/globals';

/** The emitted driver and Jest suite share this test tree, but execute in separate OS processes. */
const entry = fileURLToPath(new URL('./process-entry.js', import.meta.url));

/** Exit status and parseable output are evidence that each side completed independently. */
function stage(stageName: 'A' | 'B', file: string, scenario: string): unknown {
  const child = spawnSync(process.execPath, [entry, stageName, file, scenario], { encoding: 'utf8' });
  expect(child.status).toBe(0);
  expect(child.stderr).toBe('');
  const output: unknown = JSON.parse(child.stdout);
  return output;
}

/** Each scenario owns a fresh file; a writer cannot leak live objects to its reader. */
async function restart(scenario: string): Promise<{ readonly first: unknown; readonly second: unknown; readonly persisted: unknown }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'microdelta-exp1-'));
  const file = path.join(directory, 'history.json');
  try {
    const first = stage('A', file, scenario);
    const second = stage('B', file, scenario);
    const persisted: unknown = JSON.parse(await readFile(file, 'utf8'));
    return { first, second, persisted };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('EXP-1 two-process current correspondence', () => {
  test('fresh allocation and reversed registration/member order retain both exact references', async () => {
    const { first, second } = await restart('unchanged');
    expect(first).toMatchObject({ producerExecutions: 2, executions: 2, references: { a: 'result-1', b: 'result-2' } });
    expect(second).toMatchObject({
      invocationOrder: ['b', 'a'],
      producerExecutions: 2,
      executions: 0,
      references: { a: 'result-1', b: 'result-2' },
      decisions: { a: 'hit', b: 'hit' },
    });
  });

  test.each([
    ['consumed-field', { a: 'result-3', b: 'result-2' }, 1],
    ['helper-edit', { a: 'result-4', b: 'result-3' }, 2],
    ['tracked-capture-edit', { a: 'result-4', b: 'result-3' }, 2],
    ['unread-and-label', { a: 'result-1', b: 'result-2' }, 0],
    ['uncalled-helper-edit', { a: 'result-1', b: 'result-2' }, 0],
  ])('%s has only the required invalidations', async (scenario, references, executions) => {
    const { second } = await restart(scenario);
    expect(second).toMatchObject({ references, executions });
    if (scenario === 'unread-and-label') {
      expect(second).toMatchObject({ displayLabel: 'Renamed assessment' });
    }
  });

  test.each([
    ['missing-assessor', 'missing-binding'],
    ['ambiguous-helper', 'ambiguous-binding'],
  ])('%s gives an honest miss without validation replay', async (scenario, reason) => {
    const { second } = await restart(scenario);
    expect(second).toMatchObject({
      executions: 0,
      decisions: { a: reason, b: reason },
      references: { a: 'result-1', b: 'result-2' },
    });
  });

  test('version two then rollback accepts old exact references without pointer rewind', async () => {
    const { second, persisted } = await restart('version-rollback');
    expect(second).toMatchObject({
      executions: 2,
      references: { a: 'result-1', b: 'result-2' },
      rollbackReferences: { a: 'result-1', b: 'result-2' },
      currentPointers: { a: 'result-4', b: 'result-3' },
    });
    expect(persisted).toMatchObject({
      currentPointers: { a: 'result-4', b: 'result-3' },
      nextReference: 5,
    });
  });

  test('version rollback still checks changed input and retains newer history', async () => {
    const { second, persisted } = await restart('version-rollback-changed');
    expect(second).toMatchObject({
      executions: 2,
      decisions: { a: 'changed-evidence', b: 'changed-evidence' },
      currentPointers: { a: 'result-4', b: 'result-3' },
    });
    expect(persisted).toMatchObject({ nextReference: 5 });
  });

  test('writer JSON carries called implementation and field facts without live runtime state', async () => {
    const { persisted } = await restart('unchanged');
    const encoded = JSON.stringify(persisted);
    expect(encoded).toContain('"kind":"implementation"');
    expect(encoded).toContain('"kind":"field"');
    expect(encoded).not.toMatch(/"(__tag|revision|closure|function)"/u);
  });
});
