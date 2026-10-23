/** RUN-013: author access to a real child failure cannot grant mutable text runtime provenance. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { authoring, openWorkspace, ResolutionError } from 'microdelta';
import { createNodeSqlite } from '@microdelta/machine-node';

/** Only this bound helper owns author mutation and the synthetic text. */
interface IHelpers { readonly mutate: (error: unknown) => void }
const marker = 'SYNTHETIC-RELABELED-CHILD-8b42';
for (const mode of ['unmodified', 'mutate-rethrow', 'mutate-swallow'] as const) {
  test(`${mode}: real child failure preserves safe outer text and refuses parent publication`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-child-mutation-'));
    const location = join(directory, 'history.sqlite');
    const api = authoring<object, IHelpers>();
    let mutations = 0;
    let mutated: unknown;
    const mutate = (error: unknown): void => {
      if (!(error instanceof Error)) { throw new Error('Expected an ordinary public Error instance'); }
      mutations += 1;
      mutated = error;
      error.message = marker;
      Reflect.set(error, 'code', 'policy-failure');
    };
    const child = api.memo({ subject: 'invalid-child', run: () => ({ amount: () => 0 }) });
    const parent = mode === 'unmodified'
      ? api.memo({ subject: 'parent', children: { child }, run: async ({ calls }) => { const result = await calls.child(); return { amount: result.data.amount }; } })
      : mode === 'mutate-rethrow'
        ? api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => { try { const result = await calls.child(); return { amount: result.data.amount }; } catch (error: unknown) { helpers.mutate(error); throw error; } } })
        : api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => { try { await calls.child(); } catch (error: unknown) { helpers.mutate(error); } return { amount: 0 }; } });
    const composition = api.compose({ scope: 'child-mutation', helpers: [{ slot: 'mutate', helper: mutate }], steps: [{ slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }] });
    const workspace = openWorkspace({ location, logicalStore: 'child-mutation' });
    let completed = false;
    let failure: unknown;
    try {
      failure = await workspace.run({ authoring: api, composition, environment: 'env:test' }, run => run.resolve({ scope: 'child-mutation', role: 'step', slot: 'parent' }, { requestKey: 'first' })).then(() => { completed = true; return undefined; }, (error: unknown) => error);
    } finally { workspace.close(); }
    const sqlite = createNodeSqlite().openSqlite(location);
    try {
      const rows = sqlite.prepare('SELECT count(*) AS count FROM history_results').get();
      expect(failure).toBeInstanceOf(ResolutionError);
      expect(completed).toBe(false);
      expect(rows).toEqual({ count: 0 });
      expect(mutations).toBe(mode === 'unmodified' ? 0 : 1);
      if (!(failure instanceof ResolutionError)) { throw new Error('Expected typed runtime failure'); }
      expect(failure.code).toBe('unsupported-result');
      expect(failure.message).not.toContain(marker);
      if (mode !== 'unmodified') { expect(failure.cause).toBe(mutated); }
    } finally { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

/** Direct source-child failure uses the legacy call witness and must retain its runtime presentation. */
for (const mode of ['rethrow', 'swallow'] as const) {
  test(`direct source child / ${mode}: author mutation does not change parent failure presentation`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-direct-child-mutation-'));
    const location = join(directory, 'history.sqlite');
    const api = authoring<object, IHelpers>();
    let original: unknown;
    const mutate = (error: unknown): void => {
      if (!(error instanceof Error)) { throw new Error('Expected a real child Error'); }
      original = error;
      error.message = marker;
      Reflect.set(error, 'code', 'policy-failure');
    };
    const child = api.source<{ readonly amount: () => number }>({ subject: 'invalid-source-child', run: ({ outcome }) => outcome.fresh({ amount: () => 0 }) });
    const parent = mode === 'rethrow'
      ? api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => {
        try { await calls.child(); } catch (error: unknown) { helpers.mutate(error); throw error; }
        return { amount: 0 };
      } })
      : api.memo({ subject: 'parent', children: { child }, run: async ({ calls, helpers }) => {
        try { await calls.child(); } catch (error: unknown) { helpers.mutate(error); }
        return { amount: 0 };
      } });
    const composition = api.compose({ scope: 'direct-child-mutation', helpers: [{ slot: 'mutate', helper: mutate }], steps: [{ slot: 'child', declaration: child }, { slot: 'parent', declaration: parent }] });
    const workspace = openWorkspace({ location, logicalStore: 'direct-child-mutation' });
    let failure: unknown;
    try {
      failure = await workspace.run({ authoring: api, composition, environment: 'env:test' }, run => run.resolve({ scope: 'direct-child-mutation', role: 'step', slot: 'parent' }, { requestKey: 'first' })).then(() => undefined, (error: unknown) => error);
    } finally { workspace.close(); }
    const sqlite = createNodeSqlite().openSqlite(location);
    try {
      expect(failure).toBeInstanceOf(ResolutionError);
      if (!(failure instanceof ResolutionError)) { throw new Error('Expected typed runtime failure'); }
      expect(failure.code).toBe('unsupported-result');
      expect(failure.message).toContain('child');
      expect(failure.message).not.toContain(marker);
      expect(failure.cause).toBe(original);
      expect(sqlite.prepare('SELECT count(*) AS count FROM history_results').get()).toEqual({ count: 0 });
    } finally { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
  });
}

/** A cached failed child can reach another parent after the first parent's author code mutates its public error. */
test('a second parent sees the original runtime classification and safe text after shared-child mutation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-shared-child-mutation-'));
  const location = join(directory, 'history.sqlite');
  interface ISharedHelpers extends IHelpers { readonly observe: (error: unknown) => void }
  const api = authoring<object, ISharedHelpers>();
  let original: unknown;
  let second: unknown;
  let mutationCount = 0;
  const mutate = (error: unknown): void => {
    if (!(error instanceof Error)) { throw new Error('Expected a real shared child Error'); }
    original = error;
    mutationCount += 1;
    error.message = marker;
    Reflect.set(error, 'code', 'policy-failure');
  };
  const observe = (error: unknown): void => { second = error; };
  const shared = api.memo({ subject: 'invalid-shared-child', run: () => ({ amount: () => 0 }) });
  const first = api.memo({ subject: 'first', children: { shared }, run: async ({ calls, helpers }) => {
    try { await calls.shared(); } catch (error: unknown) { helpers.mutate(error); throw error; }
    return { amount: 0 };
  } });
  const later = api.memo({ subject: 'later', children: { shared }, run: async ({ calls }) => {
    const result = await calls.shared();
    return { amount: result.data.amount };
  } });
  const root = api.memo({ subject: 'root', children: { first, later }, run: async ({ calls, helpers }) => {
    try { await calls.first(); } catch { /* The second declared call still must run. */ }
    try { await calls.later(); } catch (error: unknown) { helpers.observe(error); }
    return { amount: 0 };
  } });
  const composition = api.compose({ scope: 'shared-child-mutation', helpers: [{ slot: 'mutate', helper: mutate }, { slot: 'observe', helper: observe }], steps: [{ slot: 'shared', declaration: shared }, { slot: 'first', declaration: first }, { slot: 'later', declaration: later }, { slot: 'root', declaration: root }] });
  const workspace = openWorkspace({ location, logicalStore: 'shared-child-mutation' });
  let failure: unknown;
  try {
    failure = await workspace.run({ authoring: api, composition, environment: 'env:test' }, run => run.resolve({ scope: 'shared-child-mutation', role: 'step', slot: 'root' }, { requestKey: 'first' })).then(() => undefined, (error: unknown) => error);
  } finally { workspace.close(); }
  const sqlite = createNodeSqlite().openSqlite(location);
  try {
    expect(mutationCount).toBe(1);
    expect(second).toBeInstanceOf(ResolutionError);
    if (!(second instanceof ResolutionError)) { throw new Error("Expected second parent's typed failure"); }
    expect(second.code).toBe('unsupported-result');
    expect(second.message).not.toContain(marker);
    expect(second).not.toBe(original);
    expect(second.cause).toBe(original);
    expect(failure).toBeInstanceOf(ResolutionError);
    expect(failure instanceof ResolutionError ? failure.message : '').not.toContain(marker);
    expect(sqlite.prepare('SELECT count(*) AS count FROM history_results').get()).toEqual({ count: 0 });
  } finally { sqlite.close(); rmSync(directory, { recursive: true, force: true }); }
});
