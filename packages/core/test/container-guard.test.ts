/** Tracked nullable input guards must invalidate a durable memo after reopening the store. */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { openDurableHistory } from '@microdelta/history';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { authoring, openWorkspace } from '../src/index.js';

/** Optional container and scalar control share one ordinary declared configuration binding. */
interface IConfig { readonly detail?: { readonly name: string } | null; readonly enabled: boolean }
interface IInputs { readonly config: IConfig }
type IHelpers = Record<never, never>;

/** Rebuild every declaration and reopen SQLite; only the retained result survives each call. */
async function resolve(location: string, config: IConfig, requestKey: string, mode: 'container' | 'scalar'): Promise<unknown> {
  const builders = authoring<IInputs, IHelpers>();
  const container = builders.memo({ subject: 'container-guard', run: ({ inputs }) => ({ state: inputs.config.detail ? 'present' : 'absent' }) });
  const scalar = builders.memo({ subject: 'scalar-guard', run: ({ inputs }) => ({ state: inputs.config.enabled ? 'present' : 'absent' }) });
  const composition = builders.compose({
    scope: 'guard-analysis', inputs: [{ slot: 'config', value: config }], helpers: [],
    steps: [{ slot: 'container', declaration: container }, { slot: 'scalar', declaration: scalar }],
  });
  const workspace = openWorkspace({ location, logicalStore: 'guard-store' });
  try {
    const result = await workspace.run({ authoring: builders, composition, environment: 'test' }, async (run) => {
      const outcome = await run.resolve({ scope: 'guard-analysis', role: 'step', slot: mode }, { requestKey });
      if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`Unexpected ${outcome.kind}`); }
      return { kind: outcome.kind, value: run.read<unknown>(outcome.reference) };
    });
    return result.value;
  } finally {
    workspace.close();
  }
}

describe('gap hunt facade durable nullable-container guards', () => {
  test.each([null, undefined])('TRK-5/8 replacing a tracked container with %s recomputes its branch', async (replacement) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-guard-'));
    try {
      const location = join(directory, 'history.sqlite');
      expect(await resolve(location, { enabled: true, detail: { name: 'Ada' } }, 'first', 'container')).toEqual({ kind: 'published', value: { state: 'present' } });
      const config: IConfig = replacement === undefined ? { enabled: true } : { enabled: true, detail: replacement };
      expect(await resolve(location, config, 'second', 'container')).toEqual({ kind: 'published', value: { state: 'absent' } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('TRK-5 scalar boolean guard positive control recomputes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-guard-'));
    try {
      const location = join(directory, 'history.sqlite');
      expect(await resolve(location, { enabled: true }, 'first', 'scalar')).toEqual({ kind: 'published', value: { state: 'present' } });
      expect(await resolve(location, { enabled: false }, 'second', 'scalar')).toEqual({ kind: 'published', value: { state: 'absent' } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

/** Each process exits completely before the next reads its retained snapshot. */
test.each(['null', 'missing'])('TRK-8 independent process replacement with %s recomputes the guard', (variant) => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-guard-process-'));
  const worker = fileURLToPath(new URL('./container-guard-worker.js', import.meta.url));
  const run = (choice: string, key: string): unknown => {
    const result = spawnSync(process.execPath, [worker, join(directory, 'history.sqlite'), choice, key], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    if (result.status !== 0) { throw new Error(result.stderr); }
    return JSON.parse(result.stdout) as unknown;
  };
  try {
    expect(run('object', 'first')).toEqual({ kind: 'published', value: { state: 'present' } });
    expect(run(variant, 'second')).toEqual({ kind: 'published', value: { state: 'absent' } });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Durable acceptance compares a reused history against an independent cold current run. */
test.each([
  ['child', 'empty', 'null'], ['child', 'empty', 'missing'],
  ['child', 'null', 'empty'], ['child', 'missing', 'empty'],
  ['childLeaf', 'object', 'edited'], ['childLeaf', 'object', 'changed'],
  ['array', 'array', 'array-null'], ['array', 'array-null', 'array'],
  ['array', 'array', 'missing'], ['array', 'missing', 'array'],
  ['arrayLeaf', 'array', 'array-edited'], ['arrayLeaf', 'array', 'array-changed'],
  ['container', 'object', 'null'], ['container', 'object', 'missing'],
  ['container', 'null', 'object'], ['container', 'missing', 'object'],
  ['explicit', 'object', 'null'], ['explicit', 'null', 'object'],
  ['explicit', 'object', 'missing'], ['explicit', 'missing', 'object'],
  ['type', 'object', 'missing'], ['type', 'missing', 'object'],
  ['nullish', 'object', 'null'], ['nullish', 'object', 'missing'],
  ['nullish', 'null', 'object'], ['nullish', 'missing', 'object'],
  ['branch', 'empty', 'null'], ['branch', 'empty', 'missing'],
  ['nested', 'object', 'edited'], ['nested', 'object', 'changed'],
  ['scalar', 'object', 'false'], ['nested', 'missing', 'undefined'],
])('%s remains equivalent to cold computation across %s → %s', (slot, before, after) => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-guard-oracle-'));
  const worker = fileURLToPath(new URL('./container-guard-worker.js', import.meta.url));
  const execute = (database: string, variant: string, key: string): unknown => {
    const result = spawnSync(process.execPath, [worker, join(directory, database), variant, key, slot], { encoding: 'utf8' });
    if (result.status !== 0) { throw new Error(result.stderr); }
    return JSON.parse(result.stdout) as unknown;
  };
  try {
    execute('history.sqlite', before, 'first');
    const warm = execute('history.sqlite', after, 'second');
    const cold = execute('cold.sqlite', after, 'cold');
    if (cold === null || typeof cold !== 'object' || !('value' in cold)) { throw new Error('Expected cold outcome value'); }
    expect(warm).toMatchObject({ value: cold.value });
    if (((slot === 'nested' || slot === 'childLeaf') && after === 'edited') || after === 'undefined' || after === 'array-edited') {
      expect(warm).toMatchObject({ kind: 'reused' });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

/** Upgrade revalidation preserves old exact history and opaque journal data. */
test('pre-kind runtime history misses once, then the current generation reuses after another restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-guard-upgrade-'));
  const location = join(directory, 'history.sqlite');
  // This is actual SQLite from main 86a4f17, not a synthesized new-runtime provenance record.
  const fixture: unknown = JSON.parse(readFileSync(new URL('../../test/fixtures/container-guard-pre-kind.json', import.meta.url), 'utf8'));
  if (fixture === null || typeof fixture !== 'object' || !('gzipBase64' in fixture) || typeof fixture.gzipBase64 !== 'string'
    || !('sha256' in fixture) || typeof fixture.sha256 !== 'string') { throw new Error('Malformed pre-kind fixture'); }
  const database = gunzipSync(Buffer.from(fixture.gzipBase64, 'base64'));
  expect(createHash('sha256').update(database).digest('hex')).toBe(fixture.sha256);
  writeFileSync(location, database);
  const worker = fileURLToPath(new URL('./container-guard-worker.js', import.meta.url));
  const execute = (key: string): unknown => {
    const result = spawnSync(process.execPath, [worker, location, 'null', key, 'container'], { encoding: 'utf8' });
    if (result.status !== 0) { throw new Error(result.stderr); }
    return JSON.parse(result.stdout) as unknown;
  };
  try {
    expect(execute('upgrade')).toEqual({ kind: 'published', value: { state: 'absent' } });
    expect(execute('current-restart')).toEqual({ kind: 'reused', value: { state: 'absent' } });
    const history = openDurableHistory({ location, logicalStore: 'guard-process-store', sqlite: createNodeSqlite(),
      sha256: createNodeMachine(), clock: { currentEpochMilliseconds: () => Date.now() } });
    try {
      const old = { kind: 'completed-result' as const, locator: 'mdh1|["guard-process-store","guard-process-analysis","test",1]' };
      expect(history.reader.readSubtree(old, [])).toEqual({ state: 'present' });
      const journal = history.openJournal({ formats: [{ format: 'fixture.operation', versions: [1] }] });
      expect(journal.read({ analysis: 'guard-process-analysis', environment: 'test', collection: 'fixture-journal', key: 'retained-operation' }))
        .toMatchObject({ revision: 1, record: { content: { state: 'succeeded', receipt: 'retained-evidence' } } });
    } finally { history.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
