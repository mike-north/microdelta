/**
 * RUN-013 keeps opaque adapter details and author-thrown text outside framework
 * messages, events and durable facts. These are synthetic values at supported
 * unknown-error boundaries, not a sandbox claim for arbitrary hostile objects.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@jest/globals';
import { ResolutionError } from '@microdelta/resolution';
import { SupervisionError } from '@microdelta/supervision';
import type { IOperationResponse } from '@microdelta/supervision';

import { authoring, openWorkspace } from '../src/index.js';
import { createWorld, installWorld } from './operations/fixture.js';
import { fakeTimer, openSession, statuses, tempStores } from './operations/harness.js';
import { inspect, journalContents, members } from './operations/support.js';
import type { IAssessment } from './operations/provider.js';

/** An intentionally fake provider detail; only its marker is privacy-sensitive. */
const marker = 'SYNTHETIC-OPAQUE-DETAIL-9d72';

/** Opaque conversion hooks let a test distinguish omission from accidental serialization. */
interface ISentinel { readonly value: unknown; readonly reads: () => number }
function sentinel(kind: 'nested-cause' | 'custom-serialization' | 'throwing-getters'): ISentinel {
  let count = 0;
  const convert = (): string => { count += 1; return marker; };
  const rejectRead = (): never => { count += 1; throw new Error(marker); };
  const value: unknown = kind === 'nested-cause'
    ? new Error('adapter detail', { cause: { detail: marker, toJSON: convert } })
    : kind === 'custom-serialization'
      ? { detail: marker, toJSON: convert, toString: convert }
      : { get message(): never { return rejectRead(); }, get cause(): never { return rejectRead(); }, get toJSON(): never { return rejectRead(); }, get toString(): never { return rejectRead(); } };
  return { value, reads: () => count };
}

/** Framework wrappers may expose the author's opaque value only as the final cause. */
function originalCause(error: unknown): unknown {
  let current = error;
  while ((current instanceof ResolutionError || current instanceof SupervisionError) && current.cause !== undefined) { current = current.cause; }
  return current;
}

for (const mode of ['failed-response', 'rejected-perform'] as const) {
  test.each(['nested-cause', 'custom-serialization', 'throwing-getters'] as const)(`${mode}: %s detail remains opaque while a sibling succeeds`, async kind => {
    const stores = tempStores();
    const timer = fakeTimer();
    const world = installWorld(createWorld(() => timer.currentEpochMilliseconds(), ['pr-1', 'pr-2']));
    const opaque = sentinel(kind);
    const original = world.provider;
    const calls: string[] = [];
    world.provider = {
      ...original,
      async perform(name, key, send): Promise<IOperationResponse<IAssessment>> {
        calls.push(key);
        if (key === 'pr-1') {
          if (mode === 'rejected-perform') { throw opaque.value; }
          return { kind: 'failed', transient: false, error: opaque.value };
        }
        return original.perform(name, key, send);
      },
    };
    const session = openSession(stores, timer);
    try {
      const started = members(session);
      const result = await started.done;
      const failed = result.value.members.find(member => member.key === 'pr-1');
      expect(statuses(result.value.members)).toEqual({ 'pr-1': mode === 'failed-response' ? 'failed' : 'pending', 'pr-2': 'succeeded' });
      expect(calls.sort()).toEqual(['pr-1', 'pr-2']);
      if (mode === 'failed-response') {
        if (failed?.status !== 'failed') { throw new Error('Expected typed failed member'); }
        expect(originalCause(failed.error)).toBe(opaque.value);
      }
      const views = await inspect(session);
      expect(views.map(view => view.status).sort()).toEqual([mode === 'failed-response' ? 'failed' : 'unknown', 'succeeded'].sort());
      const presentation = result.value.members.map(member => member.status === 'failed' ? member.error.message : member.status === 'pending' || member.status === 'cancelled' ? member.reason : member.status);
      expect(JSON.stringify([started.events, result.diagnostics, presentation, views, journalContents(session)])).not.toContain(marker);
      // Include actual SQLite/WAL and Accounting bytes, not only the display view.
      expect(readdirSync(join(stores.history, '..')).some(name => readFileSync(join(stores.history, '..', name)).includes(marker))).toBe(false);
      expect(opaque.reads()).toBe(0);
    } finally { session.close(); stores.remove(); }
  });
}

/** The bound helper is the author's allowed side-effect boundary; the body captures no hidden error. */
interface IThrowHelpers { readonly fail: () => never }

for (const mode of ['plain-error', 'author-resolution-error'] as const) {
  test(`${mode}: author text stays in cause rather than the framework failure message`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-author-error-'));
    const builders = authoring<object, IThrowHelpers>();
    const thrown = mode === 'plain-error' ? new Error(marker) : new ResolutionError('unsupported-result', marker);
    const fail = (): never => { throw thrown; };
    const declaration = builders.memo({ subject: 'opaque-author', run: ({ helpers }) => helpers.fail() });
    const composition = builders.compose({ scope: 'opaque-author', inputs: [], helpers: [{ slot: 'fail', helper: fail }], steps: [{ slot: 'value', declaration }] });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'opaque-author' });
    try {
      let completedResult = false;
      const failure: unknown = await workspace.run({ authoring: builders, composition, environment: 'env:test' }, run => run.resolve({ scope: 'opaque-author', role: 'step', slot: 'value' }, { requestKey: 'first' })).then(() => { completedResult = true; return undefined; }, (error: unknown) => error);
      expect(failure).toBeInstanceOf(ResolutionError);
      if (!(failure instanceof ResolutionError)) { throw new Error('Expected typed framework failure'); }
      console.log('author-error-observation', JSON.stringify({ mode, outerCode: failure.code, outerMessage: failure.message, causeIsThrown: failure.cause === thrown, outerIsThrown: failure === thrown, completedResult }));
      expect(failure.message).not.toContain(marker);
      expect(failure.code).toBe('execution-failure');
      expect(failure.cause).toBe(thrown);
    } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

// A genuine child publication error belongs to the runtime, unlike an error
// instance merely constructed by an author helper with arbitrary text.
test('a genuine declared child unsupported result keeps its framework classification', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-trusted-child-'));
  const builders = authoring();
  const child = builders.memo({ subject: 'invalid-child', run: () => ({ amount: () => 0 }) });
  const parent = builders.memo({ subject: 'parent', children: { child }, run: async ({ calls }) => { const result = await calls.child(); return { amount: result.data.amount }; } });
  const composition = builders.compose({ scope: 'trusted-child', inputs: [], helpers: [], steps: [{ slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }] });
  const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'trusted-child' });
  try {
    const failure: unknown = await workspace.run({ authoring: builders, composition, environment: 'env:test' }, run => run.resolve({ scope: 'trusted-child', role: 'step', slot: 'parent' }, { requestKey: 'first' })).then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(ResolutionError);
    if (!(failure instanceof ResolutionError)) { throw new Error('Expected typed child failure'); }
    expect(failure.code).toBe('unsupported-result');
    expect(failure.message).not.toContain(marker);
  } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
});
