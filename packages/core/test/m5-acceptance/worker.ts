/**
 * One independent M5 acceptance process, started as `node worker.js <job>`.
 * It composes the paid-like analysis afresh, opens the built facade's
 * workspace over the scenario's SQLite History file with Resource
 * Accounting's durable adapter injected over its own file, performs one
 * caller command through the facade's alpha entry operations, and reports on
 * fd 1:
 *
 * - `{ t: 'event', ... }` for every run event, exactly as observers receive it;
 * - `{ t: 'trace', ... }` from author helpers (bodies and their run context);
 * - `{ t: 'idle' }` when an interleaving holder finished its first request
 *   and waits for the parent;
 * - `{ t: 'result', ... }` or `{ t: 'error', ... }` as the final line.
 *
 * Every line is written synchronously, so a SIGKILL leaves an honest trace of
 * what ran before it. Nothing survives between processes except the History
 * and Accounting files, the world file and the provider directory.
 *
 * Faults are injected only at the caller's boundaries, never inside the
 * facade or an owner: a SIGKILL from the provider or from the caller's
 * Accounting port, an Accounting acknowledgment that fails, an observer that
 * throws, a presenter that fails, operator stop requests, and the host wall
 * clock. A job may set the host clock forward (`clockOffsetMs`), standing in
 * for hours passing between processes: the facade reads it unmodified
 * through the Node Machine's clock and timer.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, writeSync } from 'node:fs';

import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { ResolutionError, SupervisionError, WriterBusyError, createStopController, currentExecution, currentRun, openWorkspace } from 'microdelta';
import type {
  ICompletedResultReference,
  IDeferralMode,
  IDiscoveryReport,
  IMemberOutcome,
  IOperationUsage,
  IOperationView,
  IOutcomeFoldRunOutcome,
  IPromotionRecord,
  IRunEvent,
  IRunResult,
  IStrictFoldOutcome,
  IUsageSummary,
  IWorkspace,
  IWorkspaceAccounting,
  IWorkspaceRun,
  IWorkspaceRunOptions,
} from 'microdelta';

import { composeAnalysis, stepSlot, templateSlot, useProvider, useWorld } from './analysis.js';
import type { IAnalysis, IHelpers, IInputs, IReport, ITally } from './analysis.js';
import { gateFile, readLedger } from './provider.js';

/** One store a job opens: its History file and its Accounting file. */
export interface IStoreFiles {
  readonly location: string;
  readonly accounting: string;
}

/** What makes a planned stop fire: a provider receipt, a member body starting, or the run starting to sleep. */
export type IStopTrigger = { readonly received: string } | { readonly execute: string } | { readonly sleeping: true };

/** An operator stop request the worker makes when its trigger is first observed. */
export interface IStopPlan {
  readonly on: IStopTrigger;
  readonly level: 'soft' | 'hard';
  /** Milliseconds after the trigger; at once, synchronously within the observation, when absent. */
  readonly afterMs?: number;
}

/**
 * A planned process death with SIGKILL, with no JavaScript cleanup, at one
 * boundary of `key`'s request:
 * - `before-send`: the intent and usage intent are durable; the provider has received nothing;
 * - `after-send`: the provider applied the effect; no response reached Supervision;
 * - `after-usage`: the usage report was acknowledged durably; the outcome was never committed;
 * - `after-answer`: the operation's outcome is committed and its answer is back in the author body
 *   of `step`, which has not returned, so nothing of that step is published;
 * - `after-publish`: an observer sees `step`'s `publish` position, so its result is committed.
 */
export interface IKillPlan {
  readonly at: 'before-send' | 'after-send' | 'after-usage' | 'after-answer' | 'after-publish';
  readonly key: string;
  /** The member step `after-answer` and `after-publish` concern: `assess` when absent. */
  readonly step?: 'assess' | 'isolated';
}

/**
 * A failing usage acknowledgment for `key`'s report at the caller's
 * Accounting port: `landed` commits it and then loses the acknowledgment
 * (an unconfirmed commit), `unrecorded` fails before anything is recorded.
 */
export interface IAckFault {
  readonly key: string;
  readonly kind: 'landed' | 'unrecorded';
}

/** One caller command. */
export type ICommand =
  | { readonly kind: 'members'; readonly step?: 'assess' | 'isolated' }
  | { readonly kind: 'fold' }
  | { readonly kind: 'tally' }
  | { readonly kind: 'check'; readonly key: string }
  | { readonly kind: 'inspect' }
  | { readonly kind: 'settle'; readonly operation: string; readonly action: 'resolve' | 'abandon'; readonly outcome?: 'succeeded' | 'failed'; readonly usage?: IOperationUsage }
  | { readonly kind: 'promote'; readonly into: string }
  | { readonly kind: 'interleave'; readonly late: 'publish' | 'renew' | 'release'; readonly gate: string }
  | { readonly kind: 'same-run'; readonly next: string }
  | { readonly kind: 'lifecycle'; readonly second: IStoreFiles };

/** Everything one worker process is told. */
export interface IJob extends IStoreFiles {
  readonly logicalStore: string;
  readonly world: string;
  readonly provider: string;
  readonly environment: string;
  readonly command: ICommand;
  readonly leaseMilliseconds?: number;
  readonly deferral?: IDeferralMode;
  readonly permits?: number;
  readonly window?: number;
  /** The operator's writer deadline, this many milliseconds after the process starts; none when absent. */
  readonly writerDeadlineMs?: number;
  /** The host wall clock reads this many milliseconds ahead of real time in this process. */
  readonly clockOffsetMs?: number;
  readonly stops?: readonly IStopPlan[];
  readonly kill?: IKillPlan;
  readonly ackFault?: IAckFault;
  /** A run observer throws at this step lifecycle phase of this member's assessment. */
  readonly throwObserverAt?: { readonly phase: string; readonly key: string };
  /** The presenter (ordinary report assembly after the command) fails. */
  readonly failPresenter?: boolean;
}

/** A JSON-safe description of one member's typed outcome. */
export interface IMemberJson {
  readonly status: IMemberOutcome['status'];
  readonly kind?: 'reused' | 'published';
  readonly reference?: string;
  readonly reason?: string;
  readonly blocked?: unknown;
  readonly code?: string;
  readonly message?: string;
  /** The Supervision code behind a failure, if any; a code, never a value. */
  readonly cause?: string;
}

/** A JSON-safe description of a strict fold's typed outcome. */
export interface IFoldJson {
  readonly status: IStrictFoldOutcome['status'];
  readonly kind?: 'reused' | 'published';
  readonly reference?: string;
  readonly failed?: readonly string[];
  readonly pending?: readonly string[];
  readonly cancelled?: readonly string[];
  /** Why strict completion is impossible, as the framework words it, for a failed fold. */
  readonly diagnostic?: string;
}

/** A JSON-safe description of an outcome fold's typed outcome. */
export interface ITallyJson {
  readonly status: IOutcomeFoldRunOutcome['status'];
  readonly kind?: 'reused' | 'published';
  readonly reference?: string;
  readonly coverage?: unknown;
}

/** Observations of the lifecycle command. */
export interface ILifecycleJson {
  readonly alpha: { readonly runId: string; readonly stop: string; readonly interruptions: number; readonly outcome: string };
  readonly beta: { readonly runId: string; readonly stop: string; readonly interruptions: number; readonly outcome: string };
  /** Run context and step attribution after a thrown nested frame, inside the alpha run. */
  readonly afterThrow: { readonly runId: string; readonly environment: string; readonly step: string | null; readonly error: string };
  /** What each late use from a callback that escaped the closed alpha run met: an error code, or `succeeded`. */
  readonly late: Readonly<Record<string, string>>;
}

/** The final result line of one process. */
export interface IResultJson {
  readonly runId: string;
  readonly members: Readonly<Record<string, IMemberJson>>;
  readonly discovery: string | null;
  /** What the framework says about discovery that did not key: a refusal's reason or a rejection's diagnostic message. */
  readonly discoveryDetail: string | null;
  readonly fold: IFoldJson | null;
  readonly report: IReport | null;
  readonly tally: ITallyJson | null;
  readonly tallied: ITally | null;
  readonly check: { readonly kind: string; readonly misses: readonly string[] } | null;
  readonly usage: IUsageSummary | null;
  readonly operations: readonly IOperationView[];
  readonly promotions: readonly IPromotionRecord[];
  readonly promotion: IPromotionRecord | null;
  readonly settled: IOperationView | null;
  readonly stop: { readonly level: string; readonly cause: string | null };
  readonly interruptions: readonly { readonly label: string; readonly remote: string }[];
  readonly waitingUntil: number | null;
  readonly diagnostics: readonly string[];
  readonly lifecycle: ILifecycleJson | null;
  /** The interleaving holder's outcome of its late action: `published`, `reused`, a refusal, or an error name. */
  readonly late: string | null;
  /** The same-run case's second request outcome, which took the run's next lease. */
  readonly second: string | null;
}

/** Write one line synchronously. */
function emit(entry: Readonly<Record<string, unknown>>): void {
  writeSync(1, `${JSON.stringify(entry)}\n`);
}

/** Die at once, as a crash would. */
function die(): never {
  process.kill(process.pid, 'SIGKILL');
  throw new Error('unreachable after SIGKILL');
}

/** The Supervision code behind an error, if any: a code, never a value. */
function supervisionCause(error: unknown): string | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof SupervisionError) {
      return current.code;
    }
  }
  return undefined;
}

/** Describe one member's typed outcome. */
function describeMember(member: IMemberOutcome): IMemberJson {
  switch (member.status) {
    case 'succeeded':
      return { status: member.status, kind: member.outcome.kind, reference: member.outcome.reference.locator };
    case 'skipped':
      return { status: member.status };
    case 'pending':
    case 'cancelled':
      return { status: member.status, reason: member.reason, ...(member.blocked === undefined ? {} : { blocked: member.blocked }) };
    case 'failed': {
      const cause = supervisionCause(member.error);
      return { status: member.status, code: member.error.code, message: member.error.message, ...(cause === undefined ? {} : { cause }) };
    }
    default: {
      const exhaustive: never = member;
      return exhaustive;
    }
  }
}

/** What the framework says about discovery that did not key, as a consumer would print it. */
function discoveryDetail(discovery: IDiscoveryReport): string | null {
  switch (discovery.kind) {
    case 'keyed':
      return null;
    case 'rejected':
      return discovery.diagnostic.message;
    case 'pending':
    case 'cancelled':
      return discovery.reason;
    default: {
      const exhaustive: never = discovery;
      return exhaustive;
    }
  }
}

/** Describe a strict fold's typed outcome. */
function describeFold(outcome: IStrictFoldOutcome): IFoldJson {
  switch (outcome.status) {
    case 'succeeded':
      return { status: outcome.status, kind: outcome.outcome.kind, reference: outcome.outcome.reference.locator };
    case 'waiting':
      return { status: outcome.status, pending: outcome.pending };
    case 'failed':
      return { status: outcome.status, failed: outcome.failed, cancelled: outcome.cancelled, pending: outcome.pending, diagnostic: outcome.diagnostic };
    case 'pending':
    case 'cancelled':
      return { status: outcome.status };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Describe an outcome fold's typed outcome. */
function describeTally(outcome: IOutcomeFoldRunOutcome): ITallyJson {
  switch (outcome.status) {
    case 'folded':
      return { status: outcome.status, kind: outcome.outcome.kind, reference: outcome.outcome.reference.locator, coverage: outcome.outcome.coverage };
    case 'waiting':
      return { status: outcome.status, coverage: outcome.coverage };
    case 'failed':
      return { status: outcome.status };
    case 'pending':
    case 'cancelled':
      return { status: outcome.status, coverage: outcome.coverage };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Describe what one late use met: `succeeded`, or the Supervision code it failed with. */
async function lateUse(use: () => unknown): Promise<string> {
  try {
    await use();
    return 'succeeded';
  } catch (error: unknown) {
    return supervisionCause(error) ?? (error instanceof Error ? error.name : 'unknown');
  }
}

/** A promise and its resolver. */
function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

/** Wait until the parent creates `file`. */
async function waitForFile(file: string): Promise<void> {
  while (!existsSync(file)) {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

/** An empty result, filled in by each command. */
function emptyResult(runId: string): IResultJson {
  return {
    runId,
    members: {},
    discovery: null,
    discoveryDetail: null,
    fold: null,
    report: null,
    tally: null,
    tallied: null,
    check: null,
    usage: null,
    operations: [],
    promotions: [],
    promotion: null,
    settled: null,
    stop: { level: 'none', cause: null },
    interruptions: [],
    waitingUntil: null,
    diagnostics: [],
    lifecycle: null,
    late: null,
    second: null,
  };
}

/** Fold the run's own report into a command's result. */
function withRun<T>(result: IResultJson, run: IRunResult<T>): IResultJson {
  return {
    ...result,
    runId: run.context.runId,
    stop: { level: run.stop.level, cause: run.stop.cause ?? null },
    interruptions: run.interruptions.map((interruption) => ({ label: interruption.label, remote: interruption.remote })),
    waitingUntil: run.waitingUntil ?? null,
    diagnostics: run.diagnostics,
  };
}

/** Run the job. */
async function main(job: IJob): Promise<void> {
  const offset = job.clockOffsetMs;
  if (offset !== undefined) {
    // The host's wall clock as this process reads it: set forward, standing in for time passing between processes.
    const host = Date.now.bind(Date);
    Date.now = () => host() + offset;
  }
  const stop = createStopController();
  const fired = new Set<IStopPlan>();
  /** Fire every stop plan whose trigger `matches` this observation, once each. */
  const trigger = (matches: (on: IStopTrigger) => boolean): void => {
    for (const plan of job.stops ?? []) {
      if (!fired.has(plan) && matches(plan.on)) {
        fired.add(plan);
        if (plan.afterMs === undefined) {
          // At once, synchronously inside the observation: an interrupt arriving exactly then.
          stop.request({ level: plan.level });
        } else {
          setTimeout(() => {
            stop.request({ level: plan.level });
          }, plan.afterMs);
        }
      }
    }
  };
  const kill = job.kill;
  useWorld(job.world);
  useProvider({
    directory: job.provider,
    onSend: (key) => {
      if (kill?.at === 'before-send' && kill.key === key) {
        die();
      }
    },
    onReceived: (key) => {
      trigger((on) => 'received' in on && on.received === key);
    },
    onApplied: (key) => {
      if (kill?.at === 'after-send' && kill.key === key) {
        die();
      }
    },
    onAnswered: (key, step) => {
      if (kill?.at === 'after-answer' && kill.key === key && step === (kill.step ?? 'assess')) {
        die();
      }
    },
  });
  const analysis = composeAnalysis();
  const opened: { readonly workspace: IWorkspace; close(): void }[] = [];
  /** Open a workspace over `files`, with Accounting's durable adapter injected through the caller's port. */
  const open = (files: IStoreFiles): IWorkspace => {
    const real = openDurableAccounting({ sqlite: createNodeSqlite(), location: files.accounting, logicalStore: job.logicalStore });
    const fault = job.ackFault;
    const accounting: IWorkspaceAccounting = {
      recordUsageIntent: (intent) => real.recordUsageIntent(intent),
      acknowledgeUsage: (report) => {
        const concerns = (key: string): boolean => report.report.includes(`-${key}-`);
        if (fault !== undefined && concerns(fault.key)) {
          if (fault.kind === 'landed') {
            real.acknowledgeUsage(report);
            // The commit landed, but its confirmation was lost: the port marks the write as possibly durable.
            throw Object.assign(new Error('the usage acknowledgment was lost after its commit'), { durability: 'unknown' });
          }
          throw new Error('the usage acknowledgment failed before anything was recorded');
        }
        const acknowledged = real.acknowledgeUsage(report);
        if (kill?.at === 'after-usage' && concerns(kill.key)) {
          die();
        }
        return acknowledged;
      },
      summarizeUsage: (query) => real.summarizeUsage(query),
    };
    const workspace = openWorkspace({ location: files.location, logicalStore: job.logicalStore, accounting, ...(job.leaseMilliseconds === undefined ? {} : { leaseMilliseconds: job.leaseMilliseconds }) });
    opened.push({ workspace, close: () => {
      workspace.close();
      real.close();
    } });
    return workspace;
  };
  const observer = {
    observe(event: IRunEvent): void {
      emit({ t: 'event', ...event });
      if (event.kind === 'step' && event.event.phase === 'execute' && event.event.step.memberKey !== undefined) {
        const key = event.event.step.memberKey;
        trigger((on) => 'execute' in on && on.execute === key);
      }
      if (event.kind === 'wait' && event.phase === 'sleeping') {
        trigger((on) => 'sleeping' in on);
      }
      if (kill?.at === 'after-publish' && event.kind === 'step' && event.event.phase === 'publish' && event.event.step.memberKey === kill.key && event.event.step.slot === (kill.step ?? 'assess')) {
        die();
      }
      const throwAt = job.throwObserverAt;
      if (throwAt !== undefined && event.kind === 'step' && event.event.phase === throwAt.phase && event.event.step.memberKey === throwAt.key) {
        throw new Error('acceptance observer failure');
      }
    },
  };
  const options: IOptions = {
    authoring: analysis.authoring,
    composition: analysis.composition,
    environment: job.environment,
    observers: [observer],
    stop,
    ...(job.deferral === undefined ? {} : { deferral: job.deferral }),
    ...(job.permits === undefined ? {} : { permits: job.permits }),
    ...(job.window === undefined ? {} : { window: job.window }),
    ...(job.writerDeadlineMs === undefined ? {} : { writerWait: { deadline: Date.now() + job.writerDeadlineMs } }),
  };
  try {
    const result = job.command.kind === 'lifecycle'
      ? await lifecycle(job, job.command.second, analysis, open, observer)
      : await command(job, job.command, analysis, open(job), options);
    emit({ t: 'result', ...result });
  } catch (error: unknown) {
    emit({
      t: 'error',
      name: error instanceof Error ? error.name : 'unknown',
      code: supervisionCause(error) ?? null,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof WriterBusyError ? { holder: error.holder ?? null, expiresAt: error.expiresAt ?? null, deadline: error.deadline } : {}),
      // Resolution's typed failure code, which names the kind of failure without any author text.
      ...(error instanceof ResolutionError ? { resolution: error.code } : {}),
    });
    process.exitCode = 3;
  } finally {
    for (const entry of opened) {
      entry.close();
    }
  }
}

/** The run options every command shares. */
type IOptions = IWorkspaceRunOptions<IInputs, IHelpers>;

/** Perform one caller command in one run. */
async function command(job: IJob, given: Exclude<ICommand, { readonly kind: 'lifecycle' }>, analysis: IAnalysis, workspace: IWorkspace, options: IOptions): Promise<IResultJson> {
  const requestKey = (): { readonly requestKey: string } => ({ requestKey: `m5-acceptance:${randomUUID()}` });
  const references = new Map<string, ICompletedResultReference>();
  const collect = {
    observe(event: IRunEvent): void {
      if (event.kind === 'step' && (event.event.phase === 'accept' || event.event.phase === 'publish') && event.event.reference !== undefined) {
        references.set(event.event.reference.locator, event.event.reference);
      }
    },
  };
  const run = await workspace.run({ ...options, observers: [...(options.observers ?? []), collect] }, async (live: IWorkspaceRun): Promise<IResultJson> => {
    let result = emptyResult(live.context.runId);
    switch (given.kind) {
      case 'members': {
        const report = await live.resolveMembers({ template: templateSlot, step: given.step ?? stepSlot }, requestKey());
        result = { ...result, discovery: report.discovery.kind, discoveryDetail: discoveryDetail(report.discovery), members: Object.fromEntries(report.members.map((member) => [member.key, describeMember(member)])) };
        break;
      }
      case 'fold': {
        const folded = await live.resolveFold(analysis.report, requestKey());
        const report = folded.outcome.status === 'succeeded' ? live.read<IReport>(folded.outcome.outcome.reference) : null;
        result = { ...result, discovery: folded.discovery.kind, discoveryDetail: discoveryDetail(folded.discovery), members: Object.fromEntries(folded.members.map((member) => [member.key, describeMember(member)])), fold: describeFold(folded.outcome), report };
        break;
      }
      case 'tally': {
        const folded = await live.resolveOutcomeFold(analysis.tally, requestKey());
        const tallied = folded.outcome.status === 'folded' ? live.read<ITally>(folded.outcome.outcome.reference) : null;
        result = { ...result, discovery: folded.discovery.kind, discoveryDetail: discoveryDetail(folded.discovery), members: Object.fromEntries(folded.members.map((member) => [member.key, describeMember(member)])), tally: describeTally(folded.outcome), tallied };
        break;
      }
      case 'check': {
        const checked = await live.check(analysis.assessment(given.key));
        result = { ...result, check: { kind: checked.kind, misses: checked.misses.map((miss) => miss.reason) } };
        break;
      }
      case 'inspect':
        result = { ...result, promotions: await live.promotions() };
        break;
      case 'settle': {
        const settled = given.action === 'abandon'
          ? await live.settleOperation({ action: 'abandon', operation: given.operation, operator: 'operator.ada' })
          : await live.settleOperation({ action: 'resolve', operation: given.operation, operator: 'operator.ada', outcome: given.outcome ?? 'succeeded', ...(given.usage === undefined ? {} : { usage: given.usage }) });
        result = { ...result, settled };
        break;
      }
      case 'promote': {
        const folded = await live.resolveFold(analysis.report, requestKey());
        if (folded.outcome.status !== 'succeeded') {
          throw new Error(`only a succeeded report is promoted, not a ${folded.outcome.status} one`);
        }
        const promotion = await live.promote({
          into: given.into,
          references: [...references.values()],
          evidence: { format: 'm5-acceptance.promotion', formatVersion: 1, content: { from: job.environment, report: folded.outcome.outcome.reference.locator } },
        });
        result = { ...result, fold: describeFold(folded.outcome), promotion };
        break;
      }
      case 'same-run': {
        const sameRun = await sameRunTenures(live, analysis, given, job, requestKey);
        result = { ...result, ...sameRun };
        break;
      }
      case 'interleave':
        result = { ...result, late: await interleave(live, analysis, given, job, requestKey) };
        break;
      default: {
        const exhaustive: never = given;
        return exhaustive;
      }
    }
    if (job.failPresenter === true) {
      await live.ordinary('present', () => {
        throw new Error('acceptance presenter failure');
      });
    }
    // Operator inspection and the environment's usage summary, read-only, before the run closes.
    return { ...result, operations: await live.inspectOperations(), usage: live.usage() };
  });
  return withRun(run.value, run);
}

/**
 * The interleaving holder's run. Its first request takes the writer lease;
 * then the parent lets that lease expire before the holder's late action:
 *
 * - `publish`: the first request's assessment of pr-1 is held at the
 *   provider's gate, so its completion (outcome commit and publication) is
 *   the late action;
 * - `renew`: after pr-1 is published, the holder waits for the gate and then
 *   makes its next normal request (pr-2), whose renewal is the late action;
 * - `release`: after pr-1 is published, the holder waits for the gate and
 *   then closes, so releasing its lease is the late action.
 */
async function interleave(live: IWorkspaceRun, analysis: IAnalysis, given: { readonly late: 'publish' | 'renew' | 'release'; readonly gate: string }, job: IJob, requestKey: () => { readonly requestKey: string }): Promise<string> {
  const describe = (outcome: Awaited<ReturnType<IWorkspaceRun['resolve']>>): string => outcome.kind === 'refused' ? `refused:${outcome.disposition}` : outcome.kind;
  if (given.late === 'publish') {
    try {
      return describe(await live.resolve(analysis.assessment('pr-1'), requestKey()));
    } catch (error: unknown) {
      return error instanceof Error ? error.name : 'unknown';
    }
  }
  const first = describe(await live.resolve(analysis.assessment('pr-1'), requestKey()));
  emit({ t: 'idle', first });
  await waitForFile(gateFile(job.provider, given.gate));
  if (given.late === 'renew') {
    return describe(await live.resolve(analysis.assessment('pr-2'), requestKey()));
  }
  return first;
}

/**
 * One run, two tenures of its own writer lease (PUB-004). The first request
 * resolves pr-1, whose request the provider holds at gate `late`; while it is
 * held, the parent lets the run's lease expire and opens gate `next`. The
 * run's second request (pr-2) then takes the lease again under the *same*
 * holder name with the next fence, and publishes. Only then does the parent
 * open `late`, so the first request's late completion presents the run's own
 * holder name with the old fence: History's fence check alone must refuse it.
 */
async function sameRunTenures(live: IWorkspaceRun, analysis: IAnalysis, given: { readonly next: string }, job: IJob, requestKey: () => { readonly requestKey: string }): Promise<{ readonly late: string; readonly second: string }> {
  const describe = (outcome: Awaited<ReturnType<IWorkspaceRun['resolve']>>): string => outcome.kind === 'refused' ? `refused:${outcome.disposition}` : outcome.kind;
  const first = live.resolve(analysis.assessment('pr-1'), requestKey()).then(describe, (error: unknown) => error instanceof Error ? error.name : 'unknown');
  emit({ t: 'idle' });
  await waitForFile(gateFile(job.provider, given.next));
  const second = describe(await live.resolve(analysis.assessment('pr-2'), requestKey()));
  emit({ t: 'second', outcome: second });
  return { late: await first, second };
}

/**
 * The lifecycle command (A-18, RUN-001): two runs of one process, over two
 * stores in two environments, interleaving across awaits. The alpha run
 * assesses pr-1, held at the provider's gate `alpha`; the beta run assesses
 * pr-2, which stalls. Once both requests reached the provider, beta is hard
 * stopped through its own controller, then the gate opens. Inside alpha, a
 * nested frame throws; afterwards the run's context and attribution are its
 * own again. A callback that escaped the alpha run then tries to use it after
 * it closed.
 */
async function lifecycle(job: IJob, second: IStoreFiles, analysis: IAnalysis, open: (files: IStoreFiles) => IWorkspace, observer: { observe(event: IRunEvent): void }): Promise<IResultJson> {
  const alphaStop = createStopController();
  const betaStop = createStopController();
  const shared = { authoring: analysis.authoring, composition: analysis.composition, observers: [observer], deferral: 'exit' as const };
  const alphaWorkspace = open(job);
  const betaWorkspace = open(second);
  const released = deferred();
  let escaped: Promise<Readonly<Record<string, string>>> | undefined;
  let afterThrow: ILifecycleJson['afterThrow'] | undefined;
  const received = (key: string): boolean => readLedger(job.provider).some((entry) => entry.kind === 'received' && entry.key === key);
  const alpha = alphaWorkspace.run({ ...shared, environment: 'env:alpha', stop: alphaStop }, async (live) => {
    const outcome = await live.resolve(analysis.assessment('pr-1'), { requestKey: `m5-acceptance:${randomUUID()}` });
    try {
      await live.ordinary('nested', async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        throw new Error('a nested frame failed');
      });
    } catch (error: unknown) {
      const context = currentRun();
      afterThrow = { runId: context.runId, environment: context.environment, step: currentExecution().step?.slot ?? null, error: supervisionCause(error) ?? (error instanceof Error ? error.message : 'unknown') };
    }
    // A continuation registered inside the run, run only after the run has closed: an escaped callback.
    escaped = released.promise.then(async () => ({
      currentRun: await lateUse(() => currentRun()),
      currentExecution: await lateUse(() => currentExecution()),
      resolve: await lateUse(() => live.resolve(analysis.assessment('pr-3'), { requestKey: `m5-acceptance:${randomUUID()}` })),
      read: await lateUse(() => 'reference' in outcome ? live.read(outcome.reference) : undefined),
    }));
    return outcome.kind;
  });
  const beta = betaWorkspace.run({ ...shared, environment: 'env:beta', stop: betaStop }, async (live) => {
    const outcome = await live.resolve(analysis.assessment('pr-2'), { requestKey: `m5-acceptance:${randomUUID()}` });
    return outcome.kind === 'refused' ? `refused:${outcome.disposition}` : outcome.kind;
  });
  alpha.catch(() => undefined);
  beta.catch(() => undefined);
  while (!(received('pr-1') && received('pr-2'))) {
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  betaStop.request({ level: 'hard' });
  const betaResult = await beta;
  emit({ t: 'beta-closed' });
  // Alpha's request is still held at the provider's gate, which the parent opens only after seeing beta close.
  const alphaResult = await alpha;
  released.resolve();
  const late = escaped === undefined ? {} : await escaped;
  if (afterThrow === undefined) {
    throw new Error('the nested frame did not throw');
  }
  return {
    ...emptyResult(alphaResult.context.runId),
    lifecycle: {
      alpha: { runId: alphaResult.context.runId, stop: alphaResult.stop.level, interruptions: alphaResult.interruptions.length, outcome: alphaResult.value },
      beta: { runId: betaResult.context.runId, stop: betaResult.stop.level, interruptions: betaResult.interruptions.length, outcome: betaResult.value },
      afterThrow,
      late,
    },
  };
}

const encoded = process.argv[2];
if (encoded === undefined) {
  throw new Error('the M5 acceptance worker needs a JSON job argument');
}
// The harness parent builds the job in this exact shape.
await main(JSON.parse(encoded) as IJob);
