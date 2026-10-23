/** REUSE-002/003: author-owned observation and policy inputs remain per source.
 * Hours and boundaries here are synthetic author policy, never a framework clock.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@jest/globals';
import { authoring, openWorkspace, sourceOutcome } from 'microdelta';
import type { ISourceOutcome } from 'microdelta';

interface IFact { readonly at: number; readonly text: string }
interface IPolicy { readonly observation: number; readonly quietLag: number; readonly dailyLag: number }
interface IInputs { readonly policy: IPolicy }
interface IHelpers {
  readonly quiet: () => ISourceOutcome<IFact>;
  readonly daily: () => ISourceOutcome<IFact>;
  readonly rendered: () => void;
}

test('independent lag boundaries retain separately and a same-observation policy correction refreshes only its source', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-source-lags-'));
  const counts = { quiet: 0, daily: 0, parent: 0 };
  const quiet = (): ISourceOutcome<IFact> => {
    counts.quiet += 1;
    return sourceOutcome.fresh<IFact>({ at: 70, text: 'quiet-evidence' });
  };
  const daily = (): ISourceOutcome<IFact> => {
    counts.daily += 1;
    return sourceOutcome.fresh<IFact>({ at: 24, text: 'daily-evidence' });
  };
  const rendered = (): void => { counts.parent += 1; };
  const start = async (policy: IPolicy, requestKey: string) => {
    const builders = authoring<IInputs, IHelpers>();
    const quietSource = builders.source<IFact>({
      subject: 'quiet-source',
      finality: ({ previous, inputs }) => previous.data.at <= inputs.policy.observation - inputs.policy.quietLag,
      run: ({ helpers }) => helpers.quiet(),
    });
    const dailySource = builders.source<IFact>({
      subject: 'daily-source',
      finality: ({ previous, inputs }) => previous.data.at <= Math.floor(inputs.policy.observation / 24) * 24 - inputs.policy.dailyLag,
      run: ({ helpers }) => helpers.daily(),
    });
    const summary = builders.memo({
      subject: 'summary', children: { quietSource, dailySource },
      run: async ({ calls, helpers }) => {
        const a = await calls.quietSource();
        const b = await calls.dailySource();
        helpers.rendered();
        return { quiet: a.data.text, daily: b.data.text };
      },
    });
    const composition = builders.compose({
      scope: 'source-lags', inputs: [{ slot: 'policy', value: policy }],
      helpers: [{ slot: 'quiet', helper: quiet }, { slot: 'daily', helper: daily }, { slot: 'rendered', helper: rendered }],
      steps: [{ slot: 'quietSource', declaration: quietSource }, { slot: 'dailySource', declaration: dailySource }, { slot: 'summary', declaration: summary }],
    });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'source-lags' });
    try {
      return await workspace.run({ authoring: builders, composition, environment: 'synthetic' }, async (run) => {
        const outcome = await run.resolve({ scope: 'source-lags', role: 'step', slot: 'summary' }, { requestKey });
        if (outcome.kind !== 'published' && outcome.kind !== 'reused') {
          throw new Error(`expected completed summary, got ${outcome.kind}`);
        }
        return { outcome, value: run.read(outcome.reference) };
      });
    } finally { workspace.close(); }
  };
  try {
    const cold = await start({ observation: 71, quietLag: 4, dailyLag: 48 }, 'cold');
    expect(counts).toEqual({ quiet: 1, daily: 1, parent: 1 });
    // Daily evidence closes at 72; the quiet source needs observation 74.
    const dailyClosed = await start({ observation: 72, quietLag: 4, dailyLag: 48 }, 'daily-closed');
    expect(counts).toEqual({ quiet: 2, daily: 1, parent: 1 });
    expect(dailyClosed.value.outcome).toMatchObject({ kind: 'reused', reference: cold.value.outcome.reference });
    const bothClosed = await start({ observation: 74, quietLag: 4, dailyLag: 48 }, 'both-closed');
    expect(counts).toEqual({ quiet: 2, daily: 1, parent: 1 });
    expect(bothClosed.value.outcome).toMatchObject({ kind: 'reused', reference: cold.value.outcome.reference });
    // Observation remains 74: correcting one policy revokes only that acceptance.
    const corrected = await start({ observation: 74, quietLag: 10, dailyLag: 48 }, 'corrected');
    expect(counts).toEqual({ quiet: 3, daily: 1, parent: 1 });
    expect(corrected.value.outcome).toMatchObject({ kind: 'reused', reference: cold.value.outcome.reference });
    expect(corrected.value.value).toEqual({ quiet: 'quiet-evidence', daily: 'daily-evidence' });
    if (dailyClosed.value.outcome.kind !== 'reused' || bothClosed.value.outcome.kind !== 'reused' || corrected.value.outcome.kind !== 'reused') {
      throw new Error('all current summaries must retain their exact reference');
    }
    const first = dailyClosed.value.outcome.acceptance.dependencies;
    const stable = bothClosed.value.outcome.acceptance.dependencies;
    const changed = corrected.value.outcome.acceptance.dependencies;
    expect(stable).toEqual(first);
    expect(stable).toHaveLength(2);
    expect(changed).toHaveLength(2);
    expect(changed.filter((reference) => stable.some((old) => old.locator === reference.locator))).toHaveLength(1);
    expect(changed.filter((reference) => stable.every((old) => old.locator !== reference.locator))).toHaveLength(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

interface IItem { readonly key: string }
interface IRoster { readonly members: readonly IItem[]; readonly status: 'open' | 'complete' }
interface IDiscoveryInputs { readonly observation: number }
interface IDiscoveryHelpers {
  readonly discover: () => ISourceOutcome<IRoster>;
  readonly render: () => { readonly count: number };
}

test('an accepting elapsed-time source policy cannot close open discovery or start its strict fold', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-time-open-'));
  let discoveries = 0;
  let renders = 0;
  let completion: 'open' | 'complete' = 'open';
  const discover = (): ISourceOutcome<IRoster> => {
    discoveries += 1;
    return sourceOutcome.fresh<IRoster>({ members: [{ key: 'only-known-member' }], status: completion });
  };
  const render = (): { readonly count: number } => { renders += 1; return { count: 1 }; };
  const start = async (observation: number, requestKey: string) => {
    const builders = authoring<IDiscoveryInputs, IDiscoveryHelpers>();
    const roster = builders.source<IRoster>({
      subject: 'roster', collection: { identity: 'key' },
      // This synthetic author accepts old source evidence after a time threshold.
      // Acceptance grants no authority to rewrite its open continuation status.
      finality: ({ inputs }) => inputs.observation >= 100,
      run: ({ helpers }) => helpers.discover(),
    });
    const item = builders.template({ slot: 'item', collection: roster, steps: (member) => ({
      value: member.memo({ subject: member.subject('value'), run: ({ member: current }) => ({ key: current.key }) }),
    }) });
    const report = builders.fold({ subject: 'report', over: { template: item, step: 'value' }, run: ({ helpers }) => helpers.render() });
    const composition = builders.compose({
      scope: 'time-open', inputs: [{ slot: 'observation', value: observation }],
      helpers: [{ slot: 'discover', helper: discover }, { slot: 'render', helper: render }],
      steps: [{ slot: 'roster', declaration: roster }, { slot: 'report', declaration: report }], templates: [item],
    });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'time-open' });
    try {
      return await workspace.run({ authoring: builders, composition, environment: 'synthetic' }, (run) => run.resolveFold({ scope: 'time-open', role: 'step', slot: 'report' }, { requestKey }));
    } finally { workspace.close(); }
  };
  try {
    for (const observation of [0, 100, 100_000]) {
      const result = await start(observation, `at:${observation}`);
      expect(result.value.discovery).toMatchObject({ kind: 'keyed', completion: 'open', keys: ['only-known-member'] });
      expect(result.value.members.map((member) => [member.key, member.status])).toEqual([['only-known-member', 'succeeded']]);
      expect(result.value.outcome).toEqual({ status: 'waiting', pending: [], openDiscovery: true });
    }
    expect(discoveries).toBe(1);
    expect(renders).toBe(0);
    // A current nonaccepting policy checks again and can observe real closure.
    completion = 'complete';
    const closed = await start(0, 'actual-exhaustion');
    expect(closed.value.discovery).toMatchObject({ completion: 'complete' });
    expect(closed.value.outcome.status).toBe('succeeded');
    expect(discoveries).toBe(2);
    expect(renders).toBe(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
