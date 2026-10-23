/** REUSE-003: authored finality belongs to this source and current inputs. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@jest/globals';

import { authoring, openWorkspace, sourceOutcome } from '../src/index.js';
import type { IPreviousResult, ISourceOutcome, ITrackedView } from '../src/index.js';

interface IObservation { readonly at: number; readonly text: string }
interface IWindowInputs { readonly window: { readonly start: number; readonly end: number } }
interface IWindowHelpers {
  readonly read: () => ISourceOutcome<IObservation>;
  readonly final: (previous: IPreviousResult<IObservation>, start: number) => boolean;
  readonly render: (value: ITrackedView<IObservation>, start: number, end: number) => { readonly text: string };
}

test('widening the observation window revokes an excluded source finality decision and refreshes current data under its consumer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-window-policy-'));
  let upstream = 'old';
  let reads = 0;
  const policies: { readonly start: number; readonly accepted: boolean }[] = [];
  const read = (): ISourceOutcome<IObservation> => { reads += 1; return sourceOutcome.fresh<IObservation>({ at: 20, text: upstream }); };
  const final = (previous: IPreviousResult<IObservation>, start: number): boolean => {
    const accepted = previous.data.at < start;
    policies.push({ start, accepted });
    return accepted;
  };
  const render = (value: ITrackedView<IObservation>, start: number, end: number): { readonly text: string } => ({ text: value.at >= start && value.at < end ? value.text : 'excluded' });
  const start = async (from: number, key: string) => {
    const builders = authoring<IWindowInputs, IWindowHelpers>();
    // Retrieval returns the raw event. Only the authored finality policy uses
    // exclusion to skip refreshing data that the current window cannot consume.
    const observation = builders.source<IObservation>({ subject: 'event', finality: ({ previous, inputs, helpers }) => helpers.final(previous, inputs.window.start), run: ({ helpers }) => helpers.read() });
    const summary = builders.memo({ subject: 'window-summary', children: { observation }, run: async ({ calls, inputs, helpers }) => helpers.render((await calls.observation()).data, inputs.window.start, inputs.window.end) });
    const composition = builders.compose({ scope: 'window-policy', inputs: [{ slot: 'window', value: { start: from, end: 40 } }], helpers: [{ slot: 'read', helper: read }, { slot: 'final', helper: final }, { slot: 'render', helper: render }], steps: [{ slot: 'observation', declaration: observation }, { slot: 'summary', declaration: summary }] });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'window-policy' });
    try {
      return await workspace.run({ authoring: builders, composition, environment: 'same' }, async (run) => {
        const outcome = await run.resolve({ scope: 'window-policy', role: 'step', slot: 'summary' }, { requestKey: key });
        if (outcome.kind !== 'published' && outcome.kind !== 'reused') { throw new Error(`unexpected ${outcome.kind}`); }
        return { outcome, value: run.read<{ readonly text: string }>(outcome.reference) };
      });
    } finally { workspace.close(); }
  };
  try {
    const cold = await start(30, 'cold');
    expect(cold.value.value).toEqual({ text: 'excluded' });
    expect(reads).toBe(1);
    upstream = 'current';
    const excluded = await start(30, 'still-excluded');
    expect(excluded.value.outcome).toMatchObject({ kind: 'reused', reference: cold.value.outcome.reference });
    expect(excluded.value.value).toEqual({ text: 'excluded' });
    expect(reads).toBe(1);
    expect(policies).toEqual([{ start: 30, accepted: true }]);
    const included = await start(10, 'widened');
    expect(included.value.outcome.kind).toBe('published');
    expect(included.value.value).toEqual({ text: 'current' });
    expect(included.value.outcome.reference).not.toEqual(cold.value.outcome.reference);
    expect(reads).toBe(2);
    expect(policies).toEqual([{ start: 30, accepted: true }, { start: 10, accepted: false }]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

interface IAlias { readonly artifact: 'A' | 'B' }
interface IArtifact { readonly text: string }
interface IAliasHelpers {
  readonly alias: () => ISourceOutcome<IAlias>;
  readonly artifact: (name: 'A' | 'B') => ISourceOutcome<IArtifact>;
  readonly mutable: () => boolean;
  readonly immutable: () => boolean;
  readonly render: (value: ITrackedView<IArtifact>) => IArtifact;
}

test('an immutable artifact retains its exact result while its mutable alias refreshes and redirects the consumer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-alias-policy-'));
  let target: 'A' | 'B' = 'A';
  const reads = { alias: 0, A: 0, B: 0 };
  const hooks = { mutable: 0, immutable: 0 };
  const alias = (): ISourceOutcome<IAlias> => { reads.alias += 1; return sourceOutcome.fresh<IAlias>({ artifact: target }); };
  const artifact = (name: 'A' | 'B'): ISourceOutcome<IArtifact> => { reads[name] += 1; return sourceOutcome.fresh<IArtifact>({ text: `artifact-${name}` }); };
  const mutable = (): boolean => { hooks.mutable += 1; return false; };
  const immutable = (): boolean => { hooks.immutable += 1; return true; };
  const render = (value: ITrackedView<IArtifact>): IArtifact => ({ text: value.text });
  const start = async (key: string) => {
    const builders = authoring<object, IAliasHelpers>();
    const pointer = builders.source<IAlias>({ subject: 'release-alias', finality: ({ helpers }) => helpers.mutable(), run: ({ helpers }) => helpers.alias() });
    const a = builders.source<IArtifact>({ subject: 'artifact-A', finality: ({ helpers }) => helpers.immutable(), run: ({ helpers }) => helpers.artifact('A') });
    const b = builders.source<IArtifact>({ subject: 'artifact-B', finality: ({ helpers }) => helpers.immutable(), run: ({ helpers }) => helpers.artifact('B') });
    const summary = builders.memo({ subject: 'release-summary', children: { pointer, a, b }, run: async ({ calls, helpers }) => {
      const current = await calls.pointer();
      const content = current.data.artifact === 'A' ? await calls.a() : await calls.b();
      return helpers.render(content.data);
    } });
    const composition = builders.compose({ scope: 'alias-policy', inputs: [], helpers: [{ slot: 'alias', helper: alias }, { slot: 'artifact', helper: artifact }, { slot: 'mutable', helper: mutable }, { slot: 'immutable', helper: immutable }, { slot: 'render', helper: render }], steps: [{ slot: 'pointer', declaration: pointer }, { slot: 'a', declaration: a }, { slot: 'b', declaration: b }, { slot: 'summary', declaration: summary }] });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'alias-policy' });
    try {
      return await workspace.run({ authoring: builders, composition, environment: 'same' }, async (run) => {
        const outcome = await run.resolve({ scope: 'alias-policy', role: 'step', slot: 'summary' }, { requestKey: key });
        const oldArtifact = await run.resolve({ scope: 'alias-policy', role: 'step', slot: 'a' }, { requestKey: `${key}:artifact-A` });
        if ((outcome.kind !== 'published' && outcome.kind !== 'reused') || (oldArtifact.kind !== 'published' && oldArtifact.kind !== 'reused')) { throw new Error('expected completed source and summary'); }
        return { outcome, oldArtifact, value: run.read<IArtifact>(outcome.reference), oldValue: run.read<IArtifact>(oldArtifact.reference) };
      });
    } finally { workspace.close(); }
  };
  try {
    const cold = await start('cold');
    expect(cold.value.value).toEqual({ text: 'artifact-A' });
    const stable = await start('stable-alias');
    expect(stable.value.outcome).toMatchObject({ kind: 'reused', reference: cold.value.outcome.reference });
    expect(reads).toEqual({ alias: 2, A: 1, B: 0 });
    target = 'B';
    const redirected = await start('redirected');
    expect(redirected.value.outcome.kind).toBe('published');
    expect(redirected.value.value).toEqual({ text: 'artifact-B' });
    expect(redirected.value.oldArtifact).toMatchObject({ kind: 'reused', reference: cold.value.oldArtifact.reference });
    expect(redirected.value.oldValue).toEqual({ text: 'artifact-A' });
    expect(reads).toEqual({ alias: 3, A: 1, B: 1 });
    expect(hooks.mutable).toBe(2);
    expect(hooks.immutable).toBeGreaterThan(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
