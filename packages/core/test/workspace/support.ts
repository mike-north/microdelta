/**
 * Assembly support for the workspace run path. A "session" stands in for one
 * process lifetime: it opens the facade's workspace over a durable store file
 * and builds a fresh composition. Closing it closes the file, so the next
 * session reopens the same store with nothing surviving but durable History.
 * Everything goes through the facade's alpha surface and the real owner
 * implementations (Definition, Resolution, Supervision, History over Node's
 * real SQLite, Tracking, Materialization); nothing is replaced by a test
 * persistence facade. Independent-process proof belongs to the later
 * acceptance harness; these sessions prove the assembled path in one process.
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openWorkspace } from '../../src/index.js';
import type {
  IAdmissionPolicy,
  IResolutionOutcome,
  IRunEvent,
  IRunObserver,
  IRunResult,
  IWorkspace,
  IWorkspaceRun,
} from '../../src/index.js';
import { composeContributors, defaultConfig, memberKeys } from './fixture.js';
import type { IContributors, IMemberKey, ISummary, IVariation } from './fixture.js';

/** The environment every fixture run selects. */
export const environment = 'env:fixture';

/** The logical store identity of every fixture store. */
export const logicalStore = 'store:contribution-fixture';

/** A temporary store directory and its file location. */
export interface ITempStore {
  readonly location: string;
  remove(): void;
}

/** Create a temporary directory holding one store file location. */
export function tempStore(): ITempStore {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-workspace-'));
  return { location: join(directory, 'history.sqlite'), remove: () => rmSync(directory, { recursive: true, force: true }) };
}

/** One simulated process lifetime over a durable store. */
export interface ISession {
  readonly workspace: IWorkspace;
  readonly contributors: IContributors;
  close(): void;
}

/** Open a session: a workspace over `location` and a freshly allocated composition. */
export function openSession(location: string, variation: IVariation = {}): ISession {
  const workspace = openWorkspace({ location, logicalStore });
  return { workspace, contributors: composeContributors(variation), close: () => workspace.close() };
}

/** Records every event its observer is offered. */
export interface IRecorder extends IRunObserver {
  readonly events: IRunEvent[];
  /** Step lifecycle phases seen for one member slot, in order. */
  phases(memberKey: IMemberKey, slot: string): string[];
  /** How many times one member slot's body or check executed. */
  executions(memberKey: IMemberKey, slot: string): number;
  /** Ordinary work phases seen for one label, in order. */
  ordinary(label: string): string[];
}

/** A recording observer. */
export function recorder(): IRecorder {
  const events: IRunEvent[] = [];
  const phases = (memberKey: IMemberKey, slot: string): string[] => events.flatMap((event) =>
    event.kind === 'step' && event.event.step.memberKey === memberKey && event.event.step.slot === slot ? [event.event.phase] : []);
  return {
    events,
    observe(event: IRunEvent): void {
      events.push(event);
    },
    phases,
    executions: (memberKey, slot) => phases(memberKey, slot).filter((phase) => phase === 'execute').length,
    ordinary: (label) => events.flatMap((event) => event.kind === 'ordinary' && event.label === label ? [event.phase] : []),
  };
}

/** The ordinary (nonmemoized) repository report assembled from the two summaries. */
export interface IReport {
  readonly repository: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly contributors: readonly (ISummary & { readonly key: IMemberKey })[];
}

/** Counts ordinary report assemblies, which must happen on every run. */
export const assemblies = { count: 0 };

/**
 * Assemble the report from the summaries' exact results. Contributors are
 * ordered by their stable member keys, whatever order they were resolved in.
 */
export function assembleReport(run: IWorkspaceRun, outcomes: Readonly<Record<IMemberKey, IResolutionOutcome>>): IReport {
  assemblies.count += 1;
  const contributors = [...memberKeys].sort().map((key) => {
    const outcome = outcomes[key];
    if (outcome.kind === 'refused' || outcome.kind === 'skipped') {
      throw new Error(`summary of ${key} was ${outcome.kind}`);
    }
    return { key, ...run.read<ISummary>(outcome.reference) };
  });
  return { repository: defaultConfig.repository, window: defaultConfig.window, contributors };
}

/** Options for one report run. */
export interface IReportRun {
  /** Order in which the two summaries are resolved. */
  readonly order?: readonly IMemberKey[];
  /** Request keys the caller saved before starting, per member. Fresh keys are generated otherwise. */
  readonly requestKeys?: Partial<Record<IMemberKey, string>>;
  readonly admission?: IAdmissionPolicy;
  readonly observers?: readonly IRunObserver[];
}

/** What one report run produced. */
export interface IReportResult {
  readonly outcomes: Readonly<Record<IMemberKey, IResolutionOutcome>>;
  readonly report: IReport;
  readonly run: IRunResult<unknown>;
}

/** Monotonic counter for fresh request keys. */
let requestCounter = 0;

/** A fresh opaque request key, as a caller would save before starting work. */
export function freshRequestKey(): string {
  requestCounter += 1;
  return `request:${String(requestCounter)}`;
}

/** Resolve both summaries in `order`, then assemble the report as ordinary work. */
export async function runReport(session: ISession, options: IReportRun = {}): Promise<IReportResult> {
  const order = options.order ?? memberKeys;
  const keys: Record<IMemberKey, string> = {
    'person:ada': options.requestKeys?.['person:ada'] ?? freshRequestKey(),
    'person:ben': options.requestKeys?.['person:ben'] ?? freshRequestKey(),
  };
  const { contributors } = session;
  const result = await session.workspace.run({
    authoring: contributors.authoring,
    composition: contributors.composition,
    environment,
    ...(options.admission === undefined ? {} : { admission: options.admission }),
    ...(options.observers === undefined ? {} : { observers: options.observers }),
  }, async (run) => {
    const outcomes: Partial<Record<IMemberKey, IResolutionOutcome>> = {};
    for (const key of order) {
      outcomes[key] = await run.resolve(contributors.steps[key].summary, { requestKey: keys[key] });
    }
    const ada = outcomes['person:ada'];
    const ben = outcomes['person:ben'];
    if (ada === undefined || ben === undefined) {
      throw new Error('both summaries must resolve');
    }
    const resolved = { 'person:ada': ada, 'person:ben': ben };
    const report = await run.ordinary('report', () => assembleReport(run, resolved));
    return { outcomes: resolved, report };
  });
  return { outcomes: result.value.outcomes, report: result.value.report, run: result };
}

/** The exact reference locator of an outcome that produced or reused a result. */
export function locatorOf(outcome: IResolutionOutcome): string {
  if (outcome.kind === 'refused') {
    throw new Error(`expected a result, observed refusal of ${JSON.stringify(outcome.refused)}: ${outcome.reason}`);
  }
  if (outcome.kind === 'skipped') {
    throw new Error('expected a result, observed a gated-out skip');
  }
  return outcome.reference.locator;
}

/** Assert a rejection carries a facade error with the expected code. */
export async function caughtCode(action: Promise<unknown> | (() => unknown)): Promise<string | undefined> {
  try {
    await (typeof action === 'function' ? action() : action);
  } catch (error: unknown) {
    return typeof error === 'object' && error !== null && typeof Reflect.get(error, 'code') === 'string' ? String(Reflect.get(error, 'code')) : `uncoded: ${String(error)}`;
  }
  return undefined;
}
