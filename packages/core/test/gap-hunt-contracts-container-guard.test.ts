/** Tracked nullable input guards must invalidate a durable memo after reopening the store. */
import { mkdtempSync, rmSync } from 'node:fs';
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
  const worker = fileURLToPath(new URL('./gap-hunt-contracts-guard-worker.js', import.meta.url));
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
