/**
 * RUN-001 lazy-work audit: ordinary work that consumes its iterator while
 * awaited owns the yields and cleanup. Returning an iterator is a separate
 * ownership boundary: the generic return type admits it, but no iterator
 * wrapper extends the closed run. The latter is recorded as an interface
 * ambiguity, not assumed to be promised detached execution.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';

import { authoring, currentRun, openWorkspace } from '../src/index.js';
import type { IRunEvent, IWorkspaceRun } from '../src/index.js';

/** Context observed at a lazy execution or cleanup boundary. */
interface IObservation {
  readonly where: string;
  readonly runId: string;
  readonly environment: string;
}

describe('GAP HUNT lazy ordinary lifetime (RUN-001)', () => {
  test.each(['normal', 'return', 'throw'] as const)('%s iteration keeps the run context through yields and cleanup, then refuses late work', async (mode) => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-lazy-audit-'));
    const builders = authoring();
    const composition = builders.compose({ scope: 'lazy-audit', inputs: [], helpers: [], steps: [] });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'lazy-audit' });
    const observations: IObservation[] = [];
    const events: IRunEvent[] = [];
    const observe = (where: string): void => { observations.push({ where, ...currentRun() }); };
    async function* values(): AsyncGenerator<number, void, unknown> {
      try {
        observe('before-yield');
        yield 1;
        await Promise.resolve();
        observe('after-resume');
        if (mode === 'throw') {throw new Error('generator failed');}
        yield 2;
      } finally { observe('cleanup'); }
    }
    try {
      const completed = await workspace.run({ authoring: builders, composition, environment: 'env:lazy', observers: [{ observe: (event): void => { events.push(event); } }] }, async (run) => {
        const work = run.ordinary('iterate', async (): Promise<void> => {
          const iterator = values();
          expect(await iterator.next()).toEqual({ value: 1, done: false });
          expect(events.filter((event) => event.kind === 'ordinary').map((event) => event.phase)).toEqual(['begin']);
          if (mode === 'return') { await iterator.return(undefined); }
          else if (mode === 'throw') { await iterator.next(); }
          else {
            expect(await iterator.next()).toEqual({ value: 2, done: false });
            expect(await iterator.next()).toEqual({ value: undefined, done: true });
          }
        });
        if (mode === 'throw') { await expect(work).rejects.toThrow('generator failed'); }
        else { await work; }
        observe('parent-after-cleanup');
        return run;
      });
      expect(observations.map((observation) => observation.where)).toEqual(mode === 'return' ? ['before-yield', 'cleanup', 'parent-after-cleanup'] : ['before-yield', 'after-resume', 'cleanup', 'parent-after-cleanup']);
      expect(new Set(observations.map((observation) => observation.runId)).size).toBe(1);
      expect(observations.every((observation) => observation.environment === 'env:lazy')).toBe(true);
      expect(events.filter((event) => event.kind === 'ordinary').map((event) => event.phase)).toEqual(['begin', mode === 'throw' ? 'fail' : 'end']);
      expect(completed.value.open).toBe(false);
      await expect(completed.value.ordinary('late', () => 1)).rejects.toMatchObject({ code: 'run-closed' });
    } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  test('records the unwrapped returned-iterator boundary without treating it as promised detached ownership', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-lazy-returned-'));
    const builders = authoring();
    const composition = builders.compose({ scope: 'lazy-returned', inputs: [], helpers: [], steps: [] });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'lazy-returned' });
    async function* values(): AsyncGenerator<number, void, unknown> { currentRun(); yield 1; }
    try {
      const completed = await workspace.run({ authoring: builders, composition, environment: 'env:lazy' }, async (run): Promise<{ readonly run: IWorkspaceRun; readonly iterator: AsyncGenerator<number, void, unknown> }> => {
        // This assignment is also a strict type control: generic ordinary
        // accepts and returns an iterator, without an owning iterator type.
        const iterator: AsyncGenerator<number, void, unknown> = await run.ordinary('create', values);
        return { run, iterator };
      });
      expect(completed.value.run.open).toBe(false);
      await expect(completed.value.iterator.next()).rejects.toMatchObject({ code: 'outside-run' });
    } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
