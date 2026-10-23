/** Untyped callers cannot publish a result outside the synchronous numeric boundary. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { openWorkspace } from 'microdelta';
import type { IRunEvent } from 'microdelta';
import { analysis, memo } from '../src/protocol.js';
import { execute } from '../src/execute.js';

/** Deliberately bypass TypeScript through reflection, as a JavaScript caller could. */
test.each(['promise', 'thenable', 'record', 'string', 'null'])('rejects unsupported %s callback output without publication', async (kind) => {
  const entry = analysis<object>(() => {
    const options = { name: 'invalid', from: {}, run: () => 1 };
    Reflect.defineProperty(options, 'run', { value: kind === 'promise' ? async () => 1
      : kind === 'thenable' ? () => ({ then: () => 1 }) : kind === 'record' ? () => ({ value: 1 }) : kind === 'string' ? () => '1' : () => null });
    // eslint-disable-next-line microdelta/tracked-captures -- Adversarial JavaScript-boundary fixture deliberately replaces the typed callback through reflection to prove runtime rejects unsupported results; this is not a supported author callback.
    return memo(options);
  });
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-invalid-authoring-'));
  const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'invalid-authoring' });
  const events: IRunEvent[] = [];
  try {
    await expect(execute(workspace, entry, { analysis: 'invalid', environment: 'test', requestKey: kind, inputs: {}, observers: [{ observe(event): void { events.push(event); } }] })).rejects.toMatchObject({ code: 'execution-failure', cause: expect.any(TypeError) });
    expect(events.filter((event) => event.kind === 'step' && event.event.phase === 'publish')).toHaveLength(0);
  } finally { await workspace.close(); rmSync(directory, { recursive: true, force: true }); }
});
