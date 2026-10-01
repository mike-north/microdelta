/**
 * Command-line entry for the contribution-report example.
 *
 *   node examples/contribution-report/dist/main.js run --store DIR [options] [--open-discovery] [--reverse] [--json]
 *   node examples/contribution-report/dist/main.js status --store DIR [options] [--json]
 *   node examples/contribution-report/dist/main.js recover --store DIR [--member KEY]... [--json]
 *   node examples/contribution-report/dist/main.js check --store DIR [options] [--open-discovery] [--reverse] [--json]
 *   node examples/contribution-report/dist/main.js operations --store DIR [--environment ENV] [--json]
 *   node examples/contribution-report/dist/main.js settle --store DIR --operation ID (--abandon | --resolve succeeded|failed) [--json]
 *   node examples/contribution-report/dist/main.js promote --store DIR --from ENV --to ENV [options] [--json]
 *
 * Options select author-visible composition choices: `--rubric A|B|C|P` (the
 * supplied assessor; `P` is the paid-like assessor), `--minimum-authored N`
 * (the gate threshold input) and `--key key|id` (designated identity or the
 * custom key). `--open-discovery` makes the fixture upstream report its
 * contributor listing as still open. `--reverse` registers helpers and steps
 * in reverse order. `--environment` selects the run's environment (`fixture`
 * by default, or `trial` or `production`). `run` and `status` also take the
 * operator's run controls: `--deferral sleep|exit`, `--permits N`, `--window
 * N`, `--lease-ms N` and `--writer-deadline-ms N` (a deadline that many
 * milliseconds after start; without it a run waits for the writer lease with
 * no deadline). A first interrupt (SIGINT) requests a soft stop and a second a
 * hard stop.
 *
 * `run` saves a fresh request key, its composition choices and environment
 * to `DIR/requests.json` *before* starting work, then resolves the strict
 * report through the workspace's fold entry operation, which settles
 * discovery and every member first. `status` resolves the outcome (tolerant)
 * status report the same way. `recover` reads the saved key and choices and
 * asks the recovery entry operation what the identified executions durably
 * produced: discovery's, the report's, and the summary of every member the
 * recovered discovery listing keys, the recovered report lists or `--member`
 * names. It runs no source hook, finality policy or step body; under `--key
 * id` keying the recovered listing runs the declared custom-key projection.
 * `check` reports what a normal run would do for discovery and each member
 * summary without doing it. Observers count executed bodies and finality
 * evaluations by step, and collect the run's operation, wait and stop events.
 *
 * Every command opens the store's History file and its Resource Accounting
 * file (`DIR/accounting.sqlite`), which the workspace receives as its injected
 * Accounting port, and the paid-like provider's directory (`DIR/provider`).
 * `operations` inspects the environment's external operations, usage summary
 * and promotions; `settle` records an operator's settlement of one unknown
 * operation; `promote` promotes every result the source environment's current
 * report rests on into the target environment, executing nothing.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { createStopController, openWorkspace } from 'microdelta';
import type {
  IAdmissionPolicy,
  ICompletedResultReference,
  IDiscoveryReport,
  IMemberOutcome,
  IOutcomeFoldRunOutcome,
  IPromotionRecord,
  IRecoveryResult,
  IRunEvent,
  IRunResult,
  IStopState,
  IStrictFoldOutcome,
  IWorkspace,
  IWorkspaceRun,
  IWorkspaceRunOptions,
} from 'microdelta';

import { composeAnalysis, templateSlot } from './analysis.js';
import type { IAnalysis, IHelpers, IInputs, IReport, IStatusReport, ISummary, IVariation } from './analysis.js';
import { isKeyChoice, isRubric, parseArguments } from './arguments.js';
import type { IArguments, IRunControls } from './arguments.js';
import { usePaidAssessor } from './assessment.js';
import { fixtureEnvironment, isEnvironment, setUpstreamListing } from './fixture.js';
import type { IEnvironment } from './fixture.js';
import { paidAssessor } from './provider.js';
import { renderReport, renderStatus, renderStatusUnfinished, renderUnfinished } from './report.js';

/** The logical store identity of the example's History and Accounting files. */
const logicalStore = 'example:contribution-report';

/** Counts and operational events a run observed. */
interface IObserved {
  /** Executed source checks and memo, supplied-step and fold bodies, by step (`member/slot`, or the slot of a composition-level step or supplied slot). */
  readonly executions: Record<string, number>;
  /** Finality evaluations, by step. */
  readonly finality: Record<string, number>;
  /** The run's operation, wait and stop events, in order: identifiers, statuses, times and usage figures, never values. */
  readonly events: IRunEvent[];
}

/** An observer that counts executions and finality evaluations and collects operational events. */
function observer(): { readonly observed: IObserved; readonly observe: (event: IRunEvent) => void } {
  const observed: IObserved = { executions: {}, finality: {}, events: [] };
  const bump = (record: Record<string, number>, name: string): void => {
    record[name] = (record[name] ?? 0) + 1;
  };
  return {
    observed,
    observe(event: IRunEvent): void {
      if (event.kind === 'operation' || event.kind === 'wait' || event.kind === 'stop') {
        observed.events.push(event);
        return;
      }
      if (event.kind !== 'step') {
        return;
      }
      const { step, phase } = event.event;
      const name = step.memberKey === undefined ? step.slot : `${step.memberKey}/${step.slot}`;
      if (phase === 'execute') {
        bump(observed.executions, name);
      } else if (phase === 'finality') {
        bump(observed.finality, name);
      }
    },
  };
}

/** A JSON-safe description of how discovery settled. */
function describeDiscovery(discovery: IDiscoveryReport): Record<string, unknown> {
  switch (discovery.kind) {
    case 'keyed':
      return { kind: discovery.kind, completion: discovery.completion, keys: discovery.keys };
    case 'rejected':
      return { kind: discovery.kind, reason: discovery.diagnostic.reason, key: discovery.diagnostic.key ?? null, message: discovery.diagnostic.message };
    case 'pending':
    case 'cancelled':
      return { kind: discovery.kind, reason: discovery.reason };
    default: {
      const exhaustive: never = discovery;
      return exhaustive;
    }
  }
}

/** A JSON-safe description of one member's typed outcome; a pending member names the operation that holds it back, if any. */
function describeMember(member: IMemberOutcome): Record<string, unknown> {
  switch (member.status) {
    case 'succeeded':
      return { status: member.status, kind: member.outcome.kind, reference: member.outcome.reference.locator };
    case 'skipped':
      return { status: member.status };
    case 'pending':
    case 'cancelled':
      return { status: member.status, reason: member.reason, ...(member.blocked === undefined ? {} : { blocked: member.blocked }) };
    case 'failed':
      return { status: member.status, code: member.error.code, message: member.error.message };
    default: {
      const exhaustive: never = member;
      return exhaustive;
    }
  }
}

/** A JSON-safe description of the strict report's typed outcome. */
function describeFold(outcome: IStrictFoldOutcome): Record<string, unknown> {
  switch (outcome.status) {
    case 'succeeded': {
      const settled = outcome.outcome;
      const { required, skipped, closed } = settled.coverage;
      return {
        status: outcome.status,
        kind: settled.kind,
        reference: settled.reference.locator,
        misses: settled.misses.map((miss) => miss.reason),
        coverage: { required, skipped, closed },
      };
    }
    case 'waiting':
      return { status: outcome.status, pending: outcome.pending, openDiscovery: outcome.openDiscovery };
    case 'failed':
      return { status: outcome.status, failed: outcome.failed, cancelled: outcome.cancelled, pending: outcome.pending, openDiscovery: outcome.openDiscovery, diagnostic: outcome.diagnostic };
    case 'pending':
    case 'cancelled':
      return { status: outcome.status, reason: outcome.reason };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** A JSON-safe description of the status report's typed outcome, with the framework's coverage. */
function describeOutcomeFold(outcome: IOutcomeFoldRunOutcome): Record<string, unknown> {
  switch (outcome.status) {
    case 'folded':
      return { status: outcome.status, kind: outcome.outcome.kind, reference: outcome.outcome.reference.locator, coverage: outcome.outcome.coverage };
    case 'waiting':
      return { status: outcome.status, coverage: outcome.coverage };
    case 'failed':
      return { status: outcome.status, diagnostic: outcome.diagnostic };
    case 'pending':
    case 'cancelled':
      return { status: outcome.status, reason: outcome.reason, coverage: outcome.coverage };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** A JSON-safe description of one recorded promotion. */
function describePromotion(promotion: IPromotionRecord): Record<string, unknown> {
  return {
    promotionId: promotion.promotionId,
    target: promotion.target,
    references: promotion.references.map((reference) => reference.locator),
    evidence: promotion.evidence,
  };
}

/** A JSON-safe description of the stop intent a run closed under. */
function describeStop(stop: IStopState): Record<string, unknown> {
  return { level: stop.level, cause: stop.cause ?? null, deadline: stop.deadline ?? null };
}

/** The example's workspace over the store directory, with its Accounting port; closing it closes both files. */
interface IOpened {
  readonly workspace: IWorkspace;
  close(): void;
}

/**
 * Open the example's workspace inside the store directory. The caller opens
 * Resource Accounting's durable adapter over its own file and injects it: the
 * published facade never depends on the Accounting package.
 */
function open(store: string, leaseMilliseconds?: number): IOpened {
  mkdirSync(store, { recursive: true });
  const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(store, 'accounting.sqlite'), logicalStore });
  try {
    const workspace = openWorkspace({
      location: join(store, 'history.sqlite'),
      logicalStore,
      accounting,
      ...(leaseMilliseconds === undefined ? {} : { leaseMilliseconds }),
    });
    return {
      workspace,
      close(): void {
        workspace.close();
        accounting.close();
      },
    };
  } catch (error: unknown) {
    accounting.close();
    throw error;
  }
}

/** The saved request file. */
function requestsFile(store: string): string {
  return join(store, 'requests.json');
}

/** A saved request: the key identifying its admitted executions, the composition choices and the environment it ran under. */
interface ISavedRequest {
  readonly requestKey: string;
  readonly variation: IVariation;
  readonly environment: IEnvironment;
}

/** Run options of one command over the analysis, in the command's environment, observed by `observe`. */
function runOptions(analysis: IAnalysis, environment: IEnvironment, observe: (event: IRunEvent) => void, extra: Partial<IWorkspaceRunOptions<IInputs, IHelpers>> = {}): IWorkspaceRunOptions<IInputs, IHelpers> {
  return { authoring: analysis.authoring, composition: analysis.composition, environment, observers: [{ observe }], ...extra };
}

/**
 * Run `body` as one supervised run under the operator's controls. A first
 * interrupt requests a soft stop (no new admission; admitted steps drain) and
 * a second a hard stop (in-flight sends abort); the handler is removed when
 * the run closes.
 */
async function supervised<T>(args: IArguments, analysis: IAnalysis, observe: (event: IRunEvent) => void, body: (run: IWorkspaceRun) => Promise<T>): Promise<IRunResult<T>> {
  const controls: IRunControls = args.controls;
  const stop = createStopController();
  let interrupts = 0;
  const interrupt = (): void => {
    interrupts += 1;
    stop.request({ level: interrupts === 1 ? 'soft' : 'hard' });
  };
  process.on('SIGINT', interrupt);
  const opened = open(args.store, controls.leaseMilliseconds);
  try {
    return await opened.workspace.run(runOptions(analysis, args.environment, observe, {
      stop,
      ...(controls.deferral === undefined ? {} : { deferral: controls.deferral }),
      ...(controls.permits === undefined ? {} : { permits: controls.permits }),
      ...(controls.window === undefined ? {} : { window: controls.window }),
      ...(controls.writerDeadlineMilliseconds === undefined ? {} : { writerWait: { deadline: Date.now() + controls.writerDeadlineMilliseconds } }),
    }), body);
  } finally {
    process.off('SIGINT', interrupt);
    opened.close();
  }
}

/** The operational part of a supervised command's output: run identity, wait, stop, events and usage. */
function operational(result: IRunResult<unknown>, observed: IObserved, usage: unknown): Record<string, unknown> {
  return {
    environment: result.context.environment,
    runId: result.context.runId,
    waitingUntil: result.waitingUntil ?? null,
    stop: describeStop(result.stop),
    events: observed.events,
    usage,
    executions: observed.executions,
    finality: observed.finality,
    diagnostics: result.diagnostics,
  };
}

/** Text lines reporting a deferral's wait and a stop, appended to a command's text. */
function operationalText(result: IRunResult<unknown>): string[] {
  return [
    ...(result.waitingUntil === undefined ? [] : [`Deferred work waits until ${new Date(result.waitingUntil).toISOString()}`]),
    ...(result.stop.level === 'none' ? [] : [`Stopped: a ${result.stop.level} stop was requested by the ${result.stop.cause ?? 'operator'}`]),
  ];
}

/** Run the strict report: save a fresh request key first, then resolve the fold and read its exact results. */
async function runReport(args: IArguments, analysis: IAnalysis): Promise<Record<string, unknown>> {
  const saved: ISavedRequest = { requestKey: `report:${randomUUID()}`, variation: args.variation, environment: args.environment };
  mkdirSync(args.store, { recursive: true });
  // The caller owns key persistence: saved before any work starts, so a lost acknowledgment can be recovered.
  writeFileSync(requestsFile(args.store), `${JSON.stringify(saved, null, 2)}\n`);
  const { observed, observe } = observer();
  const result = await supervised(args, analysis, observe, async (run) => {
    const folded = await run.resolveFold(analysis.report, { requestKey: saved.requestKey });
    // Exact reads of what this request settled: each succeeded member's summary and the completed report.
    const summaries: Record<string, ISummary> = {};
    for (const member of folded.members) {
      if (member.status === 'succeeded') {
        summaries[member.key] = run.read<ISummary>(member.outcome.reference);
      }
    }
    const outcome = folded.outcome;
    const usage = run.usage();
    if (outcome.status === 'succeeded') {
      const report = run.read<IReport>(outcome.outcome.reference);
      return { folded, summaries, report, usage, text: renderReport(report, outcome.outcome.coverage) };
    }
    return { folded, summaries, report: null, usage, text: renderUnfinished(outcome) };
  });
  const { folded, summaries, report, usage, text } = result.value;
  return {
    command: 'run',
    options: { ...args.variation, openDiscovery: args.openDiscovery },
    text: [text, ...operationalText(result)].join('\n'),
    discovery: describeDiscovery(folded.discovery),
    members: Object.fromEntries(folded.members.map((member) => [member.key, describeMember(member)])),
    summaries,
    fold: describeFold(folded.outcome),
    report,
    ...operational(result, observed, usage),
  };
}

/** Run the outcome (tolerant) status report, which lists every contributor's settled status with coverage. */
async function runStatus(args: IArguments, analysis: IAnalysis): Promise<Record<string, unknown>> {
  const { observed, observe } = observer();
  const result = await supervised(args, analysis, observe, async (run) => {
    const folded = await run.resolveOutcomeFold(analysis.status, { requestKey: `status:${randomUUID()}` });
    const outcome = folded.outcome;
    const usage = run.usage();
    if (outcome.status === 'folded') {
      const report = run.read<IStatusReport>(outcome.outcome.reference);
      return { folded, report, usage, text: renderStatus(report, outcome.outcome.coverage) };
    }
    return { folded, report: null, usage, text: renderStatusUnfinished(outcome) };
  });
  const { folded, report, usage, text } = result.value;
  return {
    command: 'status',
    options: { ...args.variation, openDiscovery: args.openDiscovery },
    text: [text, ...operationalText(result)].join('\n'),
    discovery: describeDiscovery(folded.discovery),
    members: Object.fromEntries(folded.members.map((member) => [member.key, describeMember(member)])),
    outcome: describeOutcomeFold(folded.outcome),
    report,
    ...operational(result, observed, usage),
  };
}

/** Read the saved request, rejecting anything but a nonempty key, a complete, valid variation and a served environment. */
function savedRequest(store: string): ISavedRequest {
  const saved: unknown = JSON.parse(readFileSync(requestsFile(store), 'utf8'));
  const field = (record: unknown, name: string): unknown => (typeof record === 'object' && record !== null ? Reflect.get(record, name) : undefined);
  const requestKey = field(saved, 'requestKey');
  const variation = field(saved, 'variation');
  const rubric = field(variation, 'rubric');
  const minimumAuthored = field(variation, 'minimumAuthored');
  const key = field(variation, 'key');
  const reverse = field(variation, 'reverse');
  const environment = field(saved, 'environment') ?? fixtureEnvironment;
  if (typeof requestKey !== 'string' || requestKey.length === 0 || typeof rubric !== 'string' || !isRubric(rubric) ||
      typeof minimumAuthored !== 'number' || !Number.isSafeInteger(minimumAuthored) || minimumAuthored < 0 ||
      typeof key !== 'string' || !isKeyChoice(key) || typeof reverse !== 'boolean' || typeof environment !== 'string' || !isEnvironment(environment)) {
    throw new Error(`${requestsFile(store)} does not hold a saved request`);
  }
  return { requestKey, variation: { rubric, minimumAuthored, key, reverse }, environment };
}

/** A JSON-safe description of one recovery result. */
function describeRecovery(recovered: IRecoveryResult): Record<string, unknown> {
  return recovered.kind === 'recovered' ? { kind: recovered.kind, reference: recovered.reference.locator } : { kind: recovered.kind };
}

/**
 * Recover the executions the saved request key identifies, without running a
 * source hook, finality policy or step body. It recovers discovery's and the
 * report fold's executions, then the summary of every member named by any of:
 * the recovered discovery listing (keyed by the composition, which runs the
 * declared custom-key projection under `--key id`), the recovered report's
 * required members, or `--member`. An interrupted run whose report never
 * executed still recovers its members from its discovery; a run that reused
 * discovery and the report lists members only through `--member`.
 */
async function recover(store: string, named: readonly string[]): Promise<Record<string, unknown>> {
  const saved = savedRequest(store);
  const analysis = composeAnalysis(saved.variation);
  const { observed, observe } = observer();
  const opened = open(store);
  try {
    const result = await opened.workspace.run(runOptions(analysis, saved.environment, observe), async (run) => {
      const request = { requestKey: saved.requestKey };
      const discovery = await run.recover(analysis.discovery, request);
      const report = await run.recover(analysis.report, request);
      const keys = new Set(named);
      if (discovery.kind === 'recovered') {
        const keyed = analysis.composition.keyMembers(templateSlot, run.read<unknown>(discovery.reference));
        if (keyed.status === 'keyed') {
          for (const member of keyed.members) {
            keys.add(member.key);
          }
        }
      }
      if (report.kind === 'recovered') {
        for (const entry of run.read<IReport>(report.reference).required) {
          keys.add(entry.key);
        }
      }
      const members: Record<string, unknown> = {};
      // Canonical code-unit order, whichever source named a member.
      for (const key of [...keys].sort()) {
        members[key] = describeRecovery(await run.recover(analysis.summary(key), request));
      }
      return { discovery: describeRecovery(discovery), report: describeRecovery(report), members };
    });
    return { command: 'recover', options: saved.variation, recovered: result.value, executions: observed.executions, finality: observed.finality };
  } finally {
    opened.close();
  }
}

/**
 * Report what a normal run would do for discovery and, once discovery is
 * reusable, for each keyed member's summary, without admission, bodies or
 * writes. A strict fold has no check-only request; `run` resolves it.
 */
async function check(args: IArguments, analysis: IAnalysis): Promise<Record<string, unknown>> {
  const { observed, observe } = observer();
  const opened = open(args.store);
  try {
    const result = await opened.workspace.run(runOptions(analysis, args.environment, observe), async (run) => {
      const discovery = await run.check(analysis.discovery);
      if (discovery.kind !== 'reusable') {
        return { discovery: { kind: discovery.kind }, members: {} };
      }
      const keyed = analysis.composition.keyMembers(templateSlot, run.read<unknown>(discovery.reference));
      if (keyed.status === 'rejected') {
        return { discovery: { kind: 'rejected', reason: keyed.diagnostic.reason, message: keyed.diagnostic.message }, members: {} };
      }
      const members: Record<string, unknown> = {};
      for (const { key } of keyed.members) {
        const checked = await run.check(analysis.summary(key));
        members[key] = checked.kind === 'reusable' ? { kind: checked.kind, reference: checked.reference.locator } : { kind: checked.kind };
      }
      return { discovery: { kind: discovery.kind, reference: discovery.reference.locator, completion: keyed.completion }, members };
    });
    return { command: 'check', options: { ...args.variation, openDiscovery: args.openDiscovery }, environment: args.environment, checked: result.value, executions: observed.executions, finality: observed.finality };
  } finally {
    opened.close();
  }
}

/** Inspect the environment's external operations, its usage summary and the promotions recorded into it. Needs no writer lease. */
async function operations(args: IArguments): Promise<Record<string, unknown>> {
  const opened = open(args.store);
  try {
    const result = await opened.workspace.run(runOptions(composeAnalysis(), args.environment, () => undefined), async (run) => ({
      operations: await run.inspectOperations(),
      usage: run.usage(),
      promotions: run.promotions().map(describePromotion),
    }));
    return { command: 'operations', environment: args.environment, ...result.value };
  } finally {
    opened.close();
  }
}

/** Record the operator's settlement of one unknown operation, under the writer lease. */
async function settle(args: IArguments): Promise<Record<string, unknown>> {
  const choice = args.settlement;
  if (choice === undefined) {
    throw new Error('settle needs a settlement');
  }
  const opened = open(args.store);
  try {
    const result = await opened.workspace.run(runOptions(composeAnalysis(), args.environment, () => undefined), (run) => run.settleOperation(choice.action === 'abandon'
      ? { action: 'abandon', operation: choice.operation, operator: choice.operator }
      : { action: 'resolve', outcome: choice.outcome, operation: choice.operation, operator: choice.operator }));
    return { command: 'settle', environment: args.environment, operation: result.value };
  } finally {
    opened.close();
  }
}

/** Admits nothing: a promotion names results that already exist, and never executes or pays for new work. */
const admitNothing: IAdmissionPolicy = Object.freeze({
  admit: () => Object.freeze({ kind: 'denied', reason: 'a promotion executes no new work' }),
});

/**
 * Promote every result the source environment's current report rests on into
 * the target environment: discovery, each member's activity, assessments and
 * summary, and the report itself, as the source environment validates them
 * now (each step's accepted or published result). Admission denies all new
 * work, so a report that is not complete in the source environment is
 * refused rather than computed (and paid for) on the way.
 */
async function promote(args: IArguments, analysis: IAnalysis): Promise<Record<string, unknown>> {
  const promotion = args.promotion;
  if (promotion === undefined) {
    throw new Error('promote needs a source and a target environment');
  }
  const references = new Map<string, ICompletedResultReference>();
  const collect = (event: IRunEvent): void => {
    if (event.kind === 'step' && (event.event.phase === 'accept' || event.event.phase === 'publish') && event.event.reference !== undefined) {
      references.set(event.event.reference.locator, event.event.reference);
    }
  };
  const opened = open(args.store);
  try {
    const result = await opened.workspace.run(runOptions(analysis, promotion.from, collect, { admission: admitNothing }), async (run) => {
      const folded = await run.resolveFold(analysis.report, { requestKey: `promote:${randomUUID()}` });
      if (folded.outcome.status !== 'succeeded') {
        throw new Error(`the ${promotion.from} report is not complete (${folded.outcome.status}); run it in ${promotion.from} before promoting it`);
      }
      return run.promote({
        into: promotion.to,
        references: [...references.values()],
        evidence: { format: 'example.contribution-report.promotion', formatVersion: 1, content: { from: promotion.from, report: folded.outcome.outcome.reference.locator } },
      });
    });
    return { command: 'promote', from: promotion.from, to: promotion.to, promotion: describePromotion(result.value) };
  } finally {
    opened.close();
  }
}

/** Run the command a parsed command line selects. */
function dispatch(args: IArguments): Promise<Record<string, unknown>> {
  switch (args.command) {
    case 'run':
      return runReport(args, composeAnalysis(args.variation));
    case 'status':
      return runStatus(args, composeAnalysis(args.variation));
    case 'recover':
      return recover(args.store, args.members);
    case 'check':
      return check(args, composeAnalysis(args.variation));
    case 'operations':
      return operations(args);
    case 'settle':
      return settle(args);
    case 'promote':
      return promote(args, composeAnalysis(args.variation));
    default: {
      const exhaustive: never = args.command;
      return exhaustive;
    }
  }
}

/** Run one command and print its result. */
async function main(argv: readonly string[]): Promise<void> {
  const args = parseArguments(argv);
  setUpstreamListing(args.openDiscovery ? 'open' : 'complete');
  usePaidAssessor(paidAssessor(join(args.store, 'provider')));
  const output = await dispatch(args);
  process.stdout.write(args.json ? `${JSON.stringify(output, null, 2)}\n` : `${typeof output.text === 'string' ? output.text : JSON.stringify(output, null, 2)}\n`);
}

/** The diagnostic printed for a failure: a coded framework error leads with its code (for example `writer-busy`). */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? `${code}: ${error.message}` : error.message;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${describeFailure(error)}\n`);
  process.exitCode = 1;
});
