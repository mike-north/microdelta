/**
 * ACC-002 attributes consumption to work, not consumers or reused payloads.
 * These are the selected M5 serialized writer waiters, not a new shared-work
 * scheduler. The waiter case uses real facade operations; the retention case explicitly
 * supplies synchronous fixture reports through the real Accounting adapter.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';

import { authoring, currentExecution, openWorkspace, sourceOutcome } from '../src/index.js';
import type { IPreviousResult, IRunEvent, ISourceOutcome } from '../src/index.js';
import { until } from './operations/harness.js';
import { composeFixture, createWorld, installWorld } from './workspace-operations/fixture.js';

interface IPayload { readonly retained: boolean }
interface IHelpers {
  readonly load: (previous: IPreviousResult<IPayload> | undefined) => ISourceOutcome<IPayload>;
  readonly finality: () => boolean;
}

describe('GAP HUNT actual-work Accounting attribution (ACC-002)', () => {
  test('two same-scope waiters reuse one paid execution and report; a different environment performs its own work', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-accounting-waiters-'));
    const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore: 'attribution' });
    const world = installWorld(createWorld(() => Date.now(), ['pr-1']));
    world.provider.script('assess', 'pr-1', ['hang']);
    const fixture = composeFixture();
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'attribution', accounting });
    const events: IRunEvent[] = [];
    const options = { authoring: fixture.authoring, composition: fixture.composition, environment: 'same', writerWait: { pollMilliseconds: 1 }, observers: [{ observe: (event: IRunEvent): void => { events.push(event); } }] };
    let entered = 0;
    let settledWaiters = 0;
    const start = () => workspace.run(options, async (run) => {
      entered += 1;
      const report = await run.resolveMembers({ template: 'pr', step: 'assess' }, { requestKey: run.context.runId });
      return { report, usage: run.usage({ run: run.context.runId }) };
    });
    try {
      const owner = start();
      await until(() => world.provider.inFlight === 1, 'the one paid owner request is held');
      const waiters = [start(), start()].map(async (pending) => {
        const result = await pending;
        settledWaiters += 1;
        return result;
      });
      await until(() => entered === 3, 'both callers have demanded the same subject');
      expect(settledWaiters).toBe(0);
      expect(world.provider.ledger().filter((entry) => entry.kind === 'received')).toHaveLength(1);
      expect(accounting.summarizeUsage({ environment: 'same' })).toMatchObject({ operations: 1, reports: 0, unknown: [expect.anything()] });
      world.provider.release('assess', 'pr-1');
      const completed = await owner;
      const resumed = await Promise.all(waiters);
      const original = completed.value.report.members[0];
      expect(original).toMatchObject({ status: 'succeeded', outcome: { kind: 'published' } });
      if (original?.status !== 'succeeded') { throw new Error('owner did not publish'); }
      for (const waiter of resumed) {
        expect(waiter.value.report.members[0]).toMatchObject({ status: 'succeeded', outcome: { kind: 'reused', reference: original.outcome.reference } });
        expect(waiter.value.usage).toMatchObject({ status: 'complete', observed: [], operations: 0, reports: 0, requestAttempts: 0, unknown: [] });
      }
      expect(completed.value.usage).toMatchObject({ observed: [{ unit: 'tokens', amount: 100 }], operations: 1, reports: 1, requestAttempts: 1, unknown: [] });
      expect(accounting.summarizeUsage({ environment: 'same' })).toMatchObject({ observed: [{ unit: 'tokens', amount: 100 }], operations: 1, reports: 1 });
      expect(events.filter((event) => event.kind === 'step' && event.event.phase === 'execute' && event.event.step.slot === 'assess')).toHaveLength(1);
      expect(world.provider.ledger().filter((entry) => entry.kind === 'received')).toHaveLength(1);
      // Same subject text in another namespace is independent work, not free reuse.
      const control = await workspace.run({ ...options, environment: 'other' }, async (run) => {
        const report = await run.resolveMembers({ template: 'pr', step: 'assess' }, { requestKey: run.context.runId });
        return { report, usage: run.usage({ run: run.context.runId }) };
      });
      expect(control.value.report.members[0]).toMatchObject({ status: 'succeeded', outcome: { kind: 'published' } });
      expect(control.value.usage).toMatchObject({ observed: [{ unit: 'tokens', amount: 100 }], operations: 1, reports: 1 });
      expect(world.provider.ledger().filter((entry) => entry.kind === 'received')).toHaveLength(2);
      expect(accounting.summarizeUsage({ environment: 'same' }).observed).toEqual([{ unit: 'tokens', amount: 100 }]);
    } finally { world.provider.release('assess', 'pr-1'); workspace.close(); accounting.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  test('a retaining source check reports its new request without charging historical execution to it or a later free reuse', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'microdelta-accounting-retain-'));
    const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore: 'attribution' });
    const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'attribution', accounting });
    const builders = authoring<object, IHelpers>();
    let final = false;
    const sends: { readonly previous: boolean; readonly run: string }[] = [];
    // These are adapter fixture facts, not Supervision-minted operation identities.
    // This proves summary attribution alongside retention, not provider journaling.
    const load = (previous: IPreviousResult<IPayload> | undefined): ISourceOutcome<IPayload> => {
      const controls = currentExecution();
      const operation = `fixture:${controls.runId}`;
      const requestAttempt = `${operation}:request`;
      sends.push({ previous: previous !== undefined, run: controls.runId });
      accounting.recordUsageIntent({ environment: 'same', operation, requestAttempt, attribution: { run: controls.runId, member: null, stepAttempt: null } });
      accounting.acknowledgeUsage({ environment: 'same', operation, requestAttempt, report: 'fixture-report', quantities: [{ unit: previous === undefined ? 'tokens' : 'requests', amount: previous === undefined ? 100 : 1 }] });
      return previous === undefined ? sourceOutcome.fresh<IPayload>({ retained: true }) : sourceOutcome.retain(previous);
    };
    const finality = (): boolean => final;
    const value = builders.source<IPayload>({ subject: 'same-source', finality: ({ helpers }) => helpers.finality(), run: ({ previous, helpers }) => helpers.load(previous) });
    const composition = builders.compose({ scope: 'retaining-charge', inputs: [], helpers: [{ slot: 'load', helper: load }, { slot: 'finality', helper: finality }], steps: [{ slot: 'value', declaration: value }] });
    const options = { authoring: builders, composition, environment: 'same' };
    const target = { scope: 'retaining-charge', role: 'step', slot: 'value' } as const;
    const start = () => workspace.run(options, async (run) => {
      const outcome = await run.resolve(target, { requestKey: run.context.runId });
      return { outcome, usage: run.usage({ run: run.context.runId }) };
    });
    try {
      const cold = await start();
      expect(cold.value.outcome.kind).toBe('published');
      expect(cold.value.usage).toMatchObject({ observed: [{ unit: 'tokens', amount: 100 }], operations: 1, reports: 1 });
      const check = await start();
      expect(check.value.outcome).toMatchObject({ kind: 'reused', basis: 'check' });
      expect(check.value.usage).toMatchObject({ observed: [{ unit: 'requests', amount: 1 }], operations: 1, reports: 1, unknown: [] });
      final = true;
      const reuse = await start();
      expect(reuse.value.outcome).toMatchObject({ kind: 'reused', basis: 'finality' });
      expect(reuse.value.usage).toMatchObject({ observed: [], operations: 0, reports: 0, requestAttempts: 0, unknown: [] });
      if (cold.value.outcome.kind !== 'published' || check.value.outcome.kind !== 'reused' || reuse.value.outcome.kind !== 'reused') { throw new Error('expected successful source phases'); }
      expect(check.value.outcome.reference).toEqual(cold.value.outcome.reference);
      expect(reuse.value.outcome.reference).toEqual(cold.value.outcome.reference);
      expect(sends).toEqual([{ previous: false, run: cold.context.runId }, { previous: true, run: check.context.runId }]);
      const total = accounting.summarizeUsage({ environment: 'same' });
      expect(total.observed).toEqual(expect.arrayContaining([{ unit: 'tokens', amount: 100 }, { unit: 'requests', amount: 1 }]));
      expect(total.observed).toHaveLength(2);
      expect(total).toMatchObject({ operations: 2, reports: 2, requestAttempts: 2, unknown: [] });
      expect(check.value.outcome.trace.map((event) => event.phase)).toEqual(['verify', 'finality', 'admit', 'claim', 'execute', 'accept', 'release']);
      expect(reuse.value.outcome.trace.map((event) => event.phase)).toEqual(['verify', 'finality', 'accept']);
    } finally { workspace.close(); accounting.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
