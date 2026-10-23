/**
 * RUN-015: three requests in one memo remain one unpublished parent body.
 * A completed first request's resource report survives hard cancellation of
 * the second, while the third request never starts. No request checkpoint is
 * promoted to a result or a suspended-JavaScript continuation.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';

import { authoring, createStopController, currentExecution, openWorkspace } from '../src/index.js';
import { until } from './operations/harness.js';
import { fakeProvider } from './operations/provider.js';
import { attemptsAt, publishedSubjects } from './stop/support.js';

interface IHelpers { readonly work: () => Promise<readonly string[]> }

test('cancelling request two of a three-request parent retains report one, sends no third request and publishes no partial parent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-three-request-stop-'));
  const location = join(directory, 'history.sqlite');
  const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore: 'three-request' });
  const workspace = openWorkspace({ location, logicalStore: 'three-request', accounting });
  const provider = fakeProvider(() => Date.now());
  provider.script('request', 'two', ['hang']);
  const work = async (): Promise<readonly string[]> => {
    const values: string[] = [];
    for (const key of ['one', 'two', 'three']) {
      const value = await currentExecution().operation({ name: `request-${key}`, binding: `fixture:${key}`, perform: (send) => provider.perform('request', key, send) });
      values.push(value.key);
    }
    return values;
  };
  const builders = authoring<object, IHelpers>();
  const parent = builders.memo({ subject: 'three-request-parent', run: ({ helpers }) => helpers.work() });
  const composition = builders.compose({ scope: 'three-request', inputs: [], helpers: [{ slot: 'work', helper: work }], steps: [{ slot: 'parent', declaration: parent }] });
  const stop = createStopController();
  try {
    const running = workspace.run({ authoring: builders, composition, environment: 'same', stop }, async (run) => {
      const outcome = await run.resolve({ scope: 'three-request', role: 'step', slot: 'parent' }, { requestKey: 'parent-request' });
      return { outcome, usage: run.usage({ run: run.context.runId }) };
    });
    await until(() => provider.ledger().filter((entry) => entry.kind === 'received').length === 2, 'request one reported and request two is held');
    expect(accounting.summarizeUsage({ environment: 'same' })).toMatchObject({ observed: [{ unit: 'tokens', amount: 100 }], operations: 2, reports: 1, requestAttempts: 2, unknown: [expect.anything()] });
    stop.request({ level: 'hard' });
    const completed = await running;
    expect(completed.value.outcome).toMatchObject({ kind: 'refused', reason: 'a hard stop interrupted the step' });
    expect(completed.value.usage).toMatchObject({ observed: [{ unit: 'tokens', amount: 100 }], operations: 2, reports: 1, requestAttempts: 2, unknown: [expect.anything()] });
    expect(provider.ledger().filter((entry) => entry.kind === 'received').map((entry) => entry.key)).toEqual(['one', 'two']);
    expect(provider.ledger().filter((entry) => entry.kind === 'applied').map((entry) => entry.key)).toEqual(['one']);
    expect(provider.ledger().filter((entry) => entry.kind === 'cancelled').map((entry) => entry.key)).toEqual(['two']);
    expect(publishedSubjects(location)).not.toContain('three-request-parent');
    expect(attemptsAt(location).find((row) => row.subject === 'three-request-parent')).toMatchObject({ state: 'interrupted', ending: 'stopped' });
  } finally {
    provider.release('request', 'two');
    workspace.close();
    accounting.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
