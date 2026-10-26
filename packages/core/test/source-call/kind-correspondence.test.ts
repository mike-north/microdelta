/**
 * A callable slot's cached occupancy cannot authorize an edge of the other kind.
 * These strict facade consumers also preserve distinct handles as aliases when
 * their declared source/memo kind agrees with the shared current target.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { authoring, openWorkspace } from 'microdelta';
import { openHistory } from '../durable-history/support.js';

/** The same result shape lets kind correspondence stand apart from payload typing. */
interface IValue { readonly value: number }
/** Author execution is observed through an explicit helper, never outside orchestration. */
interface IHelpers { readonly hit: (boundary: string) => void }
/** The current target kind and the first declared edge agree in each ordering. */
const kinds = ['source', 'memo'] as const;
/** Stable addresses make absence of publication inspectable through real History. */
const scope = 'source-call:kind-correspondence';
const environment = 'production';
const logicalStore = 'source-call:kind-correspondence';

/** Read-only History inspection verifies that rejected edges published no parent or child result. */
function publishedSubjects(location: string): readonly string[] {
  const history = openHistory({ location, store: logicalStore });
  try {
    return ['parent', 'child:id'].filter(subject => history.findCandidates({ analysis: scope, environment, subject, version: 1 }).length > 0);
  } finally { history.close(); }
}

describe('callable source/memo kind correspondence', () => {
  test.each(kinds)('%s-first cached occupancy rejects an opposite-kind edge before author code or publication', async bound => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-source-kind-'));
    const location = join(directory, 'history.sqlite');
    const workspace = openWorkspace({ location, logicalStore });
    try {
      const events: string[] = [];
      const phases: string[] = [];
      const api = authoring<Record<never, never>, IHelpers>();
      const source = api.sourceSlot<readonly [string], IValue>({ slot: 'same' });
      const memo = api.stepSlot<readonly [string], IValue>({ slot: 'same' });
      const sourceImplementation = api.suppliedSource<readonly [string], IValue>({
        finality: ({ helpers }) => { helpers.hit('source-finality'); return true; },
        run: ({ helpers, outcome }) => { helpers.hit('source-body'); return outcome.fresh<IValue>({ value: 73 }); },
      });
      const memoImplementation = api.suppliedStep<readonly [string], IValue>({ run: ({ helpers }) => { helpers.hit('memo-body'); return { value: 73 }; } });
      const parent = bound === 'source'
        ? api.memo({ subject: 'parent', children: { source, memo }, run: async ({ calls, helpers }) => {
          helpers.hit('parent-body');
          const child = await calls.memo('id');
          return { value: child.data.value };
        } })
        : api.memo({ subject: 'parent', children: { memo, source }, run: async ({ calls, helpers }) => {
          helpers.hit('parent-body');
          const child = await calls.source('id');
          return { value: child.data.value };
        } });
      const subject = ([id]: readonly (string | undefined)[]): string => { events.push('subject'); return `child:${String(id)}`; };
      const supplied = bound === 'source'
        ? api.supplySource({ slot: source, declaration: sourceImplementation, subject })
        : api.supply({ slot: memo, declaration: memoImplementation, subject });
      const composition = api.compose({ scope, helpers: [{ slot: 'hit', helper: (boundary: string): void => { events.push(boundary); } }], steps: [{ slot: 'parent', declaration: parent }], supplied: [supplied] });
      await expect(workspace.run({ authoring: api, composition, environment, observers: [{ observe: event => { if (event.kind === 'step') { phases.push(event.event.phase); } } }] }, run => run.resolve({ scope, role: 'step', slot: 'parent' }, { requestKey: `wrong-kind:${bound}` }))).rejects.toMatchObject({ code: 'unbound-step' });
      expect(events).toEqual([]);
      expect(phases).not.toContain('publish');
      expect(publishedSubjects(location)).toEqual([]);
    } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  test.each(kinds)('%s aliases with the same slot remain callable and share compatible work', async bound => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-source-kind-alias-'));
    const location = join(directory, 'history.sqlite');
    const workspace = openWorkspace({ location, logicalStore });
    try {
      const events: string[] = [];
      const api = authoring<Record<never, never>, IHelpers>();
      const source = api.sourceSlot<readonly [string], IValue>({ slot: 'same' });
      const sourceAlias = api.sourceSlot<readonly [string], IValue>({ slot: 'same' });
      const memo = api.stepSlot<readonly [string], IValue>({ slot: 'same' });
      const memoAlias = api.stepSlot<readonly [string], IValue>({ slot: 'same' });
      const sourceImplementation = api.suppliedSource<readonly [string], IValue>({ run: ({ helpers, outcome }) => { helpers.hit('source-body'); return outcome.fresh<IValue>({ value: 73 }); } });
      const memoImplementation = api.suppliedStep<readonly [string], IValue>({ run: ({ helpers }) => { helpers.hit('memo-body'); return { value: 73 }; } });
      const parent = api.memo({ subject: 'parent', children: bound === 'source' ? { first: source, second: sourceAlias } : { first: memo, second: memoAlias }, run: async ({ calls, helpers }) => {
        helpers.hit('parent-body');
        const first = await calls.first('id');
        const second = await calls.second('id');
        return { value: first.data.value + second.data.value };
      } });
      const supplied = bound === 'source'
        ? api.supplySource({ slot: source, declaration: sourceImplementation, subject: ([id]) => `child:${String(id)}` })
        : api.supply({ slot: memo, declaration: memoImplementation, subject: ([id]) => `child:${String(id)}` });
      const composition = api.compose({ scope, helpers: [{ slot: 'hit', helper: (boundary: string): void => { events.push(boundary); } }], steps: [{ slot: 'parent', declaration: parent }], supplied: [supplied] });
      const result = await workspace.run({ authoring: api, composition, environment }, async run => {
        const outcome = await run.resolve({ scope, role: 'step', slot: 'parent' }, { requestKey: `same-kind:${bound}` });
        return { outcome, data: outcome.kind === 'published' || outcome.kind === 'reused' ? run.read<IValue>(outcome.reference) : undefined };
      });
      expect(result.value.outcome.kind).toBe('published');
      expect(result.value.data).toEqual({ value: 146 });
      expect(events).toEqual(['parent-body', `${bound}-body`]);
      expect(publishedSubjects(location)).toEqual(['parent', 'child:id']);
    } finally { workspace.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
