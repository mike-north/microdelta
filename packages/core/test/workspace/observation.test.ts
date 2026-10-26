/**
 * CLI-005 facade assembly proof. Observed workspace outcomes use the real
 * History/Resolution/Supervision composition and an independently reopenable
 * exact observation artifact; application assertions remain separate from both
 * body results and terminal execution facts.
 * @see ../../../../docs/spec/acceptance.md (A-21a, A-21b, A-21c, A-21f, A-21g)
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';

import { SupervisionError, openExecutionObservationReader } from '../../src/index.js';
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
      if (document.result.kind === 'observed') {
        expect(document.result.observation.eventCounts.step).toBeGreaterThan(0);
        expect(document.result.observation.eventCounts.ordinary).toBe(2);
      }
      expect(JSON.stringify(document)).not.toContain('generic-return.txt');
      reader.close();
    } finally {
      session.close();
      store.remove();
      rmSync(observationDirectory, { recursive: true, force: true });
    }
  });

  test('a rejected facade body preserves its error while its finite acknowledgment and exact evidence survive workspace closure', async () => {
    const store = tempStore();
    const observationDirectory = mkdtempSync(join(tmpdir(), 'microdelta-facade-observation-rejection-'));
    resetWorld();
    const session = openSession(store.location);
    const observationLocation = join(observationDirectory, 'rejected.sqlite');
    const failure = new Error('facade body failure stays with the caller');
    const eventKinds: string[] = [];
    try {
      const observed = session.workspace.startObserved({
        authoring: session.contributors.authoring,
        composition: session.contributors.composition,
        environment,
        runId: 'nightly-rejected',
        observationLocation,
        observers: [{ observe(event) { eventKinds.push(event.kind); } }],
      }, async (run, application) => {
        const resolved = await run.resolve(session.contributors.steps['person:ada'].summary, { requestKey: freshRequestKey() });
        expect(resolved.kind).toBe('published');
        application.submit({ kind: 'incomplete', reasons: ['required-work'] });
        throw failure;
      });

      await expect(observed.result).rejects.toBe(failure);
      const acknowledgment = await observed.acknowledgment;
      expect(acknowledgment.kind).toBe('acknowledged');
      if (acknowledgment.kind !== 'acknowledged') {
        throw new Error(`Expected terminal acknowledgment, received ${acknowledgment.kind}`);
      }
      expect(Number.isSafeInteger(acknowledgment.revision)).toBe(true);
      expect(acknowledgment.revision).toBeGreaterThan(1);
      expect(Object.keys(acknowledgment).sort()).toEqual(['kind', 'revision']);
      expect(JSON.stringify(acknowledgment)).not.toContain(failure.message);
      expect(eventKinds).toContain('step');

      session.close();
      const reader = openExecutionObservationReader(observed.locator);
      const document = reader.read();
      expect(document.result.kind).toBe('observed');
      if (document.result.kind === 'observed') {
        expect(document.result.observation).toMatchObject({
          executionId: observed.locator.executionId,
          phase: 'closed',
          body: 'threw',
          context: { runId: 'nightly-rejected' },
          application: { kind: 'incomplete', reasons: ['required-work'] },
          executionFailure: { kind: 'other' },
        });
        expect(document.result.observation.eventCounts.step).toBeGreaterThan(0);
      }
      expect(JSON.stringify(document)).not.toContain(failure.message);
      reader.close();
    } finally {
      session.close();
      store.remove();
      rmSync(observationDirectory, { recursive: true, force: true });
    }
  });
});

/** Launch preconditions refuse calls before they acquire an exact execution identity. */
describe('observed workspace launch preconditions', () => {
  test('a closed workspace refuses synchronously before a body or artifact exists', () => {
    const store = tempStore();
    const observationDirectory = mkdtempSync(join(tmpdir(), 'microdelta-facade-closed-'));
    resetWorld();
    const session = openSession(store.location);
    const observationLocation = join(observationDirectory, 'closed.sqlite');
    let bodyCalls = 0;
    try {
      session.close();
      let refusal: unknown;
      try {
        session.workspace.startObserved({
          authoring: session.contributors.authoring,
          composition: session.contributors.composition,
          environment,
          runId: 'closed-observed',
          observationLocation,
        }, () => { bodyCalls += 1; });
      } catch (error: unknown) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(SupervisionError);
      expect(refusal instanceof SupervisionError ? refusal.code : undefined).toBe('invalid-request');
      expect(bodyCalls).toBe(0);
      expect(existsSync(observationLocation)).toBe(false);
    } finally {
      session.close();
      store.remove();
      rmSync(observationDirectory, { recursive: true, force: true });
    }
  });

  test('a same-store nested launch refuses synchronously while the outer run remains usable', async () => {
    const store = tempStore();
    const observationDirectory = mkdtempSync(join(tmpdir(), 'microdelta-facade-nested-'));
    resetWorld();
    const session = openSession(store.location);
    const observationLocation = join(observationDirectory, 'nested.sqlite');
    let bodyCalls = 0;
    try {
      const outer = await session.workspace.run({
        authoring: session.contributors.authoring,
        composition: session.contributors.composition,
        environment,
        runId: 'outer-observed-boundary',
      }, async (run) => {
        let refusal: unknown;
        try {
          session.workspace.startObserved({
            authoring: session.contributors.authoring,
            composition: session.contributors.composition,
            environment,
            runId: 'nested-observed',
            observationLocation,
          }, () => { bodyCalls += 1; });
        } catch (error: unknown) {
          refusal = error;
        }
        expect(refusal).toBeInstanceOf(SupervisionError);
        expect(refusal instanceof SupervisionError ? refusal.code : undefined).toBe('invalid-request');
        expect(bodyCalls).toBe(0);
        expect(existsSync(observationLocation)).toBe(false);
        return run.ordinary('outer-after-observed-refusal', () => 'outer-still-usable');
      });
      expect(outer.value).toBe('outer-still-usable');
      expect(existsSync(observationLocation)).toBe(false);
    } finally {
      session.close();
      store.remove();
      rmSync(observationDirectory, { recursive: true, force: true });
    }
  });

  test('an invalid caller runId refuses synchronously before a body or artifact exists', () => {
    const store = tempStore();
    const observationDirectory = mkdtempSync(join(tmpdir(), 'microdelta-facade-invalid-id-'));
    resetWorld();
    const session = openSession(store.location);
    const observationLocation = join(observationDirectory, 'invalid-id.sqlite');
    let bodyCalls = 0;
    try {
      let refusal: unknown;
      try {
        session.workspace.startObserved({
          authoring: session.contributors.authoring,
          composition: session.contributors.composition,
          environment,
          runId: 'INVALID CALLER ID',
          observationLocation,
        }, () => { bodyCalls += 1; });
      } catch (error: unknown) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(SupervisionError);
      expect(refusal instanceof SupervisionError ? refusal.code : undefined).toBe('invalid-request');
      expect(bodyCalls).toBe(0);
      expect(existsSync(observationLocation)).toBe(false);
    } finally {
      session.close();
      store.remove();
      rmSync(observationDirectory, { recursive: true, force: true });
    }
  });
});
