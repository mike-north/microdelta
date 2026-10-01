/**
 * The facade's operational surface (M5 facade assembly): external operations,
 * operator inspection and settlement, the deferral mode, accounting summaries
 * through the caller's injected Accounting port, unique run identifiers,
 * environments and recorded promotion, all through the `microdelta` facade a
 * consumer uses, over the real owner packages.
 *
 * Expected values are written by hand from the owner decisions of 2026-09-30
 * and the supervisor's facade constraints:
 *
 * - a workspace offers external operations only when the caller supplies an
 *   Accounting port; it builds History's operation journal and the host's
 *   random source itself, so the published facade never depends on the
 *   (unpublished) Accounting package;
 * - Accounting summarizes per environment, and the run's summary accessor
 *   reads the run's own environment; three succeeded assessments of the fake
 *   provider report 100 tokens each, so 300 tokens, complete;
 * - a rate limit with a retry time is a durable deferral; in exit mode the
 *   run returns reporting the provider's retry time, and a later run admits
 *   nothing before it;
 * - every run identifier is minted from 128 random host bits, so no two runs,
 *   in one process or across processes, share one (#121 supervisor note);
 * - environments are namespaced within one store; a trial result satisfies
 *   production only through a promotion recorded under the writer lease.
 *
 * @see ../../../../docs/spec/operations.md (RUN-002, RUN-011, RUN-012, RUN-013, RUN-017, ACC-003, ACC-005)
 * @see ../../../../docs/plans/m5-operations.md (Consumer outcome; Facade and example)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';

import { ResolutionError, SupervisionError, WriterBusyError, createStopController, openWorkspace } from '../../src/index.js';
import type { ICompletedResultReference, IMemberOutcome, IRunEvent, IWorkspace, IWorkspaceRunOptions } from '../../src/index.js';
import { analysis, composeFixture, createWorld, installWorld } from './fixture.js';
import type { IFixture, IHelpers, IInputs, IWorld } from './fixture.js';

/** The logical store of every store in this suite. */
const logicalStore = 'store:facade-operations';

/** The production environment. */
const production = 'env:production';

/** A trial environment of the same analysis. */
const trial = 'env:trial';

/** A fixed provider clock reading, so a rate limit's retry time is known exactly. */
const providerNow = Date.UTC(2030, 0, 1);

let directory: string;
let accounting: IDurableAccounting;
let workspace: IWorkspace;
let fixture: IFixture;
let world: IWorld;
let counter = 0;

/** A fresh request key. */
function key(): { readonly requestKey: string } {
  counter += 1;
  return { requestKey: `facade-ops:${String(counter)}` };
}

/** Open a workspace over this test's store files, with the caller's Accounting port unless `withAccounting` is false. */
function open(withAccounting = true): IWorkspace {
  return openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore, ...(withAccounting ? { accounting } : {}) });
}

/** Run options over the fixture composition in `environment`, recording events into `events`. */
function options(environment: string, events: IRunEvent[] = [], extra: Partial<IWorkspaceRunOptions<IInputs, IHelpers>> = {}): IWorkspaceRunOptions<IInputs, IHelpers> {
  return { authoring: fixture.authoring, composition: fixture.composition, environment, observers: [{ observe: (event) => events.push(event) }], ...extra };
}

/** Each member's status by key. */
function statuses(members: readonly IMemberOutcome[]): Readonly<Record<string, string>> {
  return Object.fromEntries(members.map((member) => [member.key, member.status]));
}

/** The provider's received requests for one member. */
function received(memberKey: string): readonly unknown[] {
  return world.provider.ledger().filter((entry) => entry.kind === 'received' && entry.key === memberKey);
}

/** The Supervision code of a rejection or throw, or a description of anything else. */
async function codeOf(action: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof action === 'function' ? action() : action);
  } catch (error: unknown) {
    return error instanceof SupervisionError ? error.code : `not a SupervisionError: ${String(error)}`;
  }
  return undefined;
}

/** The exact reference of a succeeded strict fold outcome. */
function foldReference(outcome: { readonly status: string; readonly outcome?: { readonly reference: ICompletedResultReference } }): ICompletedResultReference {
  if (outcome.status !== 'succeeded' || outcome.outcome === undefined) {
    throw new Error(`expected a succeeded fold, observed ${outcome.status}`);
  }
  return outcome.outcome.reference;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'microdelta-facade-operations-'));
  accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore });
  world = installWorld(createWorld(() => providerNow));
  fixture = composeFixture();
  workspace = open();
});

afterEach(() => {
  workspace.close();
  accounting.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('external operations through the facade (RUN-011, RUN-012, RUN-013, ACC-003)', () => {
  test('a workspace given an Accounting port offers external operations: each is journaled, and usage is summarized for the run\'s environment only', async () => {
    const events: IRunEvent[] = [];
    const result = await workspace.run(options(production, events), async (run) => {
      const report = await run.resolveMembers({ template: 'pr', step: 'assess' }, key());
      return { report, operations: await run.inspectOperations(), usage: run.usage() };
    });
    expect(statuses(result.value.report.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(result.value.operations.map((view) => [view.member, view.name, view.status, view.subject.environment])).toEqual([
      ['pr-1', 'assess', 'succeeded', production],
      ['pr-2', 'assess', 'succeeded', production],
      ['pr-3', 'assess', 'succeeded', production],
    ]);
    // Three succeeded assessments of 100 tokens each, every report counted once.
    expect(result.value.usage).toEqual(expect.objectContaining({
      environment: production,
      status: 'complete',
      observed: [{ unit: 'tokens', amount: 300 }],
      unknown: [],
      operations: 3,
      reports: 3,
      requestAttempts: 3,
    }));
    // Every operation event names the run that made it.
    const operationEvents = events.filter((event) => event.kind === 'operation');
    expect(operationEvents.length).toBeGreaterThan(0);
    expect(new Set(operationEvents.map((event) => event.runId))).toEqual(new Set([result.context.runId]));
    // Accounting is per environment: a trial run of the same analysis sees nothing of production's usage.
    const inTrial = await workspace.run(options(trial), (run) => run.usage());
    expect(inTrial.value).toEqual(expect.objectContaining({ environment: trial, status: 'complete', observed: [], operations: 0 }));
  });

  test('the usage accessor narrows by member and by run, and refuses a closed run', async () => {
    const first = await workspace.run(options(production), async (run) => {
      await run.resolveMembers({ template: 'pr', step: 'assess' }, key());
      return { member: run.usage({ member: 'pr-2' }), byRun: run.usage({ run: run.context.runId }), other: run.usage({ run: 'run:none' }) };
    });
    expect(first.value.member).toEqual(expect.objectContaining({ observed: [{ unit: 'tokens', amount: 100 }], operations: 1 }));
    expect(first.value.byRun).toEqual(expect.objectContaining({ observed: [{ unit: 'tokens', amount: 300 }], operations: 3 }));
    expect(first.value.other).toEqual(expect.objectContaining({ observed: [], operations: 0 }));
    let kept: { usage(): unknown } | undefined;
    await workspace.run(options(production), (run) => {
      kept = run;
    });
    expect(await codeOf(() => kept?.usage())).toBe('run-closed');
  });

  test('without an Accounting port a workspace offers no external operations: the operation fails its member, and operator inspection and usage are invalid requests', async () => {
    workspace.close();
    workspace = open(false);
    const result = await workspace.run(options(production), async (run) => ({
      report: await run.resolveMembers({ template: 'pr', step: 'assess' }, key()),
      inspect: await codeOf(run.inspectOperations()),
      usage: await codeOf(() => run.usage()),
    }));
    expect(statuses(result.value.report.members)).toEqual({ 'pr-1': 'failed', 'pr-2': 'failed', 'pr-3': 'failed' });
    for (const member of result.value.report.members) {
      const cause: unknown = member.status === 'failed' && member.error instanceof ResolutionError ? member.error.cause : undefined;
      expect(cause instanceof SupervisionError ? cause.code : undefined).toBe('invalid-request');
    }
    expect(result.value.inspect).toBe('invalid-request');
    expect(result.value.usage).toBe('invalid-request');
    expect(world.provider.ledger()).toEqual([]);
  });

  test('an untyped caller\'s Accounting port without a usage summary accessor is refused when the workspace opens', () => {
    // Untyped configuration (for example from JavaScript) can omit what the type requires; the facade refuses it at once.
    const port = { recordUsageIntent: () => 'recorded', acknowledgeUsage: () => ({ kind: 'acknowledged' }) };
    let code: string | undefined;
    try {
      Reflect.apply(openWorkspace, undefined, [{ location: join(directory, 'other.sqlite'), logicalStore, accounting: port }]);
    } catch (error: unknown) {
      code = error instanceof SupervisionError ? error.code : String(error);
    }
    expect(code).toBe('invalid-request');
  });

  test('exit mode: a rate limit with a retry time ends the run reporting that time; a later run admits nothing before it and sends nothing', async () => {
    const retryAt = providerNow + 3_600_000;
    world.provider.script('assess', 'pr-1', ['rate-limit:3600000']);
    const first = await workspace.run(options(production, [], { deferral: 'exit' }), (run) => run.resolveMembers({ template: 'pr', step: 'assess' }, key()));
    expect(statuses(first.value.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(first.waitingUntil).toBe(retryAt);
    const second = await workspace.run(options(production, [], { deferral: 'exit' }), (run) => run.resolveMembers({ template: 'pr', step: 'assess' }, key()));
    const pr1 = second.value.members.find((member) => member.key === 'pr-1');
    expect(pr1?.status === 'pending' ? pr1.blocked : undefined).toEqual(expect.objectContaining({ kind: 'deferred', notBefore: retryAt }));
    expect(second.waitingUntil).toBe(retryAt);
    expect(received('pr-1')).toHaveLength(1);
  });

  test('an operator inspects an unknown operation and abandons it through the run; the member is then free to run again', async () => {
    world.provider.script('assess', 'pr-1', ['lost', 'ok']);
    const first = await workspace.run(options(production), async (run) => {
      const report = await run.resolveMembers({ template: 'pr', step: 'assess' }, key());
      return { report, unknown: await run.inspectOperations({ status: 'unknown' }) };
    });
    expect(statuses(first.value.report.members)).toEqual({ 'pr-1': 'pending', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(first.value.unknown.map((view) => view.member)).toEqual(['pr-1']);
    const operation = first.value.unknown[0]?.operation ?? '';
    const settled = await workspace.run(options(production), (run) => run.settleOperation({ action: 'abandon', operation, operator: 'operator.ada' }));
    expect(settled.value).toEqual(expect.objectContaining({ operation, status: 'abandoned' }));
    const after = await workspace.run(options(production), (run) => run.resolveMembers({ template: 'pr', step: 'assess' }, key()));
    expect(statuses(after.value.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(received('pr-1')).toHaveLength(2);
  });
});

describe('unique run identifiers (#121 supervisor note)', () => {
  test('every run identifier the facade mints carries 128 random host bits, and no two runs share one, even across workspace objects that each start counting afresh', async () => {
    const identifiers: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      identifiers.push((await workspace.run(options(production), (run) => run.context.runId)).value);
    }
    // A second workspace object stands in for a new process: any per-object or per-process counter starts over.
    workspace.close();
    workspace = open();
    identifiers.push((await workspace.run(options(production), (run) => run.context.runId)).value);
    for (const identifier of identifiers) {
      expect(identifier).toMatch(/^run:[0-9a-f]{32}$/u);
    }
    expect(new Set(identifiers).size).toBe(4);
  });

  test('a caller-supplied run identifier must be an identifier, and never the facade\'s own reserved form', async () => {
    const accepted = await workspace.run(options(production, [], { runId: 'run:nightly-2026.10.01' }), (run) => run.context.runId);
    expect(accepted.value).toBe('run:nightly-2026.10.01');
    for (const runId of ['', 'Nightly run for Ada', 'run:' + '0123456789abcdef'.repeat(2)]) {
      expect(await codeOf(workspace.run(options(production, [], { runId }), () => 'never'))).toBe('invalid-request');
    }
  });

  test('journal records attribute each request attempt to the run that sent it', async () => {
    // A real provider clock and a short retry time: the second run (sleep mode, the default) resumes the deferral once it is due.
    world = installWorld(createWorld(() => Date.now()));
    world.provider.script('assess', 'pr-1', ['rate-limit:200', 'ok']);
    const first = await workspace.run(options(production, [], { deferral: 'exit' }), (run) => run.resolveMembers({ template: 'pr', step: 'assess' }, key()));
    const second = await workspace.run(options(production), async (run) => {
      await run.resolveMembers({ template: 'pr', step: 'assess' }, key());
      return run.inspectOperations();
    });
    const pr1 = second.value.find((view) => view.member === 'pr-1');
    expect(pr1?.attempts.map((attempt) => attempt.run)).toEqual([first.context.runId, second.context.runId]);
    expect(first.context.runId).not.toBe(second.context.runId);
  });
});

describe('environments and recorded promotion (RUN-016, RUN-017)', () => {
  test('a trial fold satisfies production only through a promotion the run records under the writer lease, keeping its exact trial reference', async () => {
    const inTrial = await workspace.run(options(trial), (run) => run.resolveFold(fixture.report, key()));
    const trialReport = foldReference(inTrial.value.outcome);
    const events: IRunEvent[] = [];
    const promoted = await workspace.run(options(trial, events), async (run) => ({
      none: await run.promotions(),
      record: await run.promote({ into: production, references: [trialReport], evidence: { format: 'test.promotion', formatVersion: 1, content: { reason: 'trial reviewed' } } }),
    }));
    expect(promoted.value.none).toEqual([]);
    // The run offers an identifier-only promotion event: the target and exact references, never the evidence.
    expect(events.filter((event) => event.kind === 'promotion')).toEqual([{
      kind: 'promotion',
      runId: promoted.context.runId,
      promotionId: promoted.value.record.promotionId,
      analysis,
      into: production,
      references: [trialReport],
    }]);
    expect(promoted.value.record).toEqual(expect.objectContaining({
      target: { analysis, environment: production },
      references: [trialReport],
      evidence: { format: 'test.promotion', formatVersion: 1, content: { reason: 'trial reviewed' } },
    }));
    const inProduction = await workspace.run(options(production), async (run) => ({ report: await run.resolveFold(fixture.report, key()), promotions: await run.promotions() }));
    // The promoted fold is reused with its exact trial reference; production's members were resolved, and paid for, in production.
    expect(inProduction.value.report.outcome).toEqual({ status: 'succeeded', outcome: expect.objectContaining({ kind: 'reused', reference: trialReport }) });
    expect(statuses(inProduction.value.report.members)).toEqual({ 'pr-1': 'succeeded', 'pr-2': 'succeeded', 'pr-3': 'succeeded' });
    expect(received('pr-1')).toHaveLength(2);
    expect(inProduction.value.promotions).toEqual([promoted.value.record]);
  });

  test('without a promotion production publishes its own fold', async () => {
    const inTrial = await workspace.run(options(trial), (run) => run.resolveFold(fixture.report, key()));
    const inProduction = await workspace.run(options(production), (run) => run.resolveFold(fixture.report, key()));
    expect(inProduction.value.outcome).toEqual({ status: 'succeeded', outcome: expect.objectContaining({ kind: 'published' }) });
    expect(foldReference(inProduction.value.outcome)).not.toEqual(foldReference(inTrial.value.outcome));
  });

  test('a result cannot be promoted into the environment it was published in', async () => {
    const inTrial = await workspace.run(options(trial), (run) => run.resolveFold(fixture.report, key()));
    const trialReport = foldReference(inTrial.value.outcome);
    const refused = await workspace.run(options(trial), (run) => run.promote({ into: trial, references: [trialReport], evidence: { format: 'test.promotion', formatVersion: 1, content: null } }).then(() => 'promoted', (error: unknown) => error instanceof Error ? error.name : 'other'));
    expect(refused.value).toBe('HistoryIntegrityError');
    expect((await workspace.run(options(trial), (run) => run.promotions())).value).toEqual([]);
  });

  test('a promotion waits for the writer lease another run holds, and fails with WriterBusyError naming that run at the operator deadline', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const holder = workspace.run(options(trial), async (run) => {
      const report = await run.resolveFold(fixture.report, key());
      holding();
      await held;
      return foldReference(report.outcome);
    });
    await started;
    const busy = await workspace.run(options(trial, [], { writerWait: { deadline: Date.now() + 200, pollMilliseconds: 50 } }), (run) => run.promote({
      into: production,
      references: [{ kind: 'completed-result', locator: 'unused' }],
      evidence: { format: 'test.promotion', formatVersion: 1, content: null },
    }).then(() => undefined, (error: unknown) => error));
    release();
    const holderResult = await holder;
    expect(busy.value).toBeInstanceOf(WriterBusyError);
    expect(busy.value instanceof WriterBusyError ? busy.value.holder : undefined).toBe(`microdelta-run:${holderResult.context.runId}`);
    // Once the holder released the lease, the same promotion is recorded.
    const recorded = await workspace.run(options(trial), (run) => run.promote({ into: production, references: [holderResult.value], evidence: { format: 'test.promotion', formatVersion: 1, content: null } }));
    expect(recorded.value.references).toEqual([holderResult.value]);
  });

  test('without a deadline a promotion waits while another run holds the lease, and is recorded once that run releases it', async () => {
    const inTrial = await workspace.run(options(trial), (run) => run.resolveFold(fixture.report, key()));
    const trialReport = foldReference(inTrial.value.outcome);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      holding = resolve;
    });
    // Another run takes the writer lease with a normal request and keeps it until released.
    const holder = workspace.run(options(trial), async (run) => {
      await run.resolveFold(fixture.report, key());
      holding();
      await held;
    });
    await started;
    const waiting = workspace.run(options(trial, [], { writerWait: { pollMilliseconds: 50 } }), (run) => run.promote({
      into: production,
      references: [trialReport],
      evidence: { format: 'test.promotion', formatVersion: 1, content: null },
    }));
    let settled = false;
    void waiting.then(() => {
      settled = true;
    }, () => {
      settled = true;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    // Still waiting for the held lease: it neither failed nor recorded anything.
    expect(settled).toBe(false);
    expect((await workspace.run(options(production), (run) => run.promotions())).value).toEqual([]);
    release();
    await holder;
    expect((await waiting).value.references).toEqual([trialReport]);
  });

  test('with stop intent in force a promotion is refused with stopped, and nothing is recorded', async () => {
    const inTrial = await workspace.run(options(trial), (run) => run.resolveFold(fixture.report, key()));
    const trialReport = foldReference(inTrial.value.outcome);
    const stop = createStopController();
    stop.request({ level: 'soft' });
    const refused = await workspace.run(options(trial, [], { stop }), (run) => codeOf(run.promote({ into: production, references: [trialReport], evidence: { format: 'test.promotion', formatVersion: 1, content: null } })));
    expect(refused.value).toBe('stopped');
    expect((await workspace.run(options(production), (run) => run.promotions())).value).toEqual([]);
  });
});
