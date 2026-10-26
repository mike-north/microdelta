/**
 * CLI-005 facade assembly proof. An observed workspace run uses the real
 * History/Resolution/Supervision composition and an independently reopenable
 * exact observation artifact; the application statement remains separate from
 * both its return value and the run's terminal facts.
 * @see ../../../../docs/spec/acceptance.md (A-21a, A-21b, A-21f, A-21g)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';

import { openExecutionObservationReader } from '../../src/index.js';
import { resetWorld } from './fixture.js';
import { environment, freshRequestKey, openSession, tempStore } from './support.js';

/** A facade run never turns a generic body value into an application assertion. */
describe('observed workspace assembly (A-21a/b/f/g)', () => {
  test('one facade body has only statement submission, and a separate reader survives workspace closure', async () => {
    const store = tempStore();
    const observationDirectory = mkdtempSync(join(tmpdir(), 'microdelta-facade-observation-'));
    resetWorld();
    const session = openSession(store.location);
    const eventKinds: string[] = [];
    try {
      const observed = session.workspace.startObserved({
        authoring: session.contributors.authoring,
        composition: session.contributors.composition,
        environment,
        runId: 'nightly',
        observationLocation: join(observationDirectory, 'run.sqlite'),
        observers: [{ observe(event) { eventKinds.push(event.kind); } }],
      }, async (run, application) => {
        expect(Object.keys(application)).toEqual(['submit']);
        expect(run.context.runId).toBe('nightly');
        const resolved = await run.resolve(session.contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        expect(resolved.kind).toBe('published');
        const value = await run.ordinary('facade-work', () => 'body value');
        application.submit({ kind: 'incomplete', reasons: ['required-work'] });
        return { value, file: 'generic-return.txt' };
      });
      expect((await observed.result).value).toEqual({ value: 'body value', file: 'generic-return.txt' });
      expect(await observed.acknowledgment).toMatchObject({ kind: 'acknowledged' });
      expect(eventKinds).toContain('step');
      expect(eventKinds).toContain('ordinary');
      session.close();
      const reader = openExecutionObservationReader(observed.locator);
      const document = reader.read();
      expect(document).toMatchObject({ version: 1, result: { kind: 'observed', observation: { phase: 'closed', body: 'returned', context: { runId: 'nightly' }, application: { kind: 'incomplete', reasons: ['required-work'] } } } });
      expect(JSON.stringify(document)).not.toContain('generic-return.txt');
      reader.close();
    } finally {
      session.close();
      store.remove();
      rmSync(observationDirectory, { recursive: true, force: true });
    }
  });
});
