/**
 * Assembly support for outcome-fold tests. A session stands in for one
 * process lifetime: the facade's workspace over a durable SQLite History file
 * and a freshly composed fixture. One workspace run resolves the `tally`
 * outcome fold (and, when asked, the strict `report` fold) through Run
 * Supervision, which first resolves the consumed template step for every
 * current member, and reports discovery, each member's typed outcome and each
 * fold's typed outcome as JSON. The same session code runs inside the
 * separate worker processes of the restart suite, so in-process and
 * cross-process evidence share one assembly and one JSON-safe report.
 *
 * @see ../../../../docs/plans/m5-operations.md (outcome-fold-coverage)
 */
import { randomUUID } from 'node:crypto';

import { ResolutionError, openWorkspace } from '../../src/index.js';
import type {
  IAdmissionDecision,
  IAdmissionRequest,
  IFoldReport,
  IOutcomeFoldCoverage,
  IOutcomeFoldReport,
  IRunEvent,
  IStopController,
} from '../../src/index.js';
import { openHistory } from '../durable-history/support.js';
import { analysis, composeTally, reportSubject, tallySubject, world } from './fixture.js';
import type { IVariation } from './fixture.js';

/** The environment outcome-fold sessions select unless a test chooses another. */
export const defaultEnvironment = 'env:outcome-fold';

/** The logical store every outcome-fold session uses. */
export const logicalStore = 'store:outcome-fold';

/** A JSON-safe description of one member's typed outcome. */
export interface IMemberJson {
  readonly status: 'succeeded' | 'skipped' | 'pending' | 'failed' | 'cancelled';
  /** For succeeded members: reused or published, and the exact reference. */
  readonly kind?: string;
  readonly reference?: string;
  /** For failed members: the typed code. */
  readonly code?: string;
}

/** Outcome-fold coverage as JSON. */
export interface ICoverageJson {
  readonly succeeded: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly string[];
  readonly cancelled: readonly string[];
  readonly pending: readonly string[];
  readonly openDiscovery: boolean;
  readonly complete: boolean;
}

/** A JSON-safe description of the outcome fold's typed outcome, or of the typed failure its request rejected with. */
export type ITallyJson =
  | {
      readonly status: 'folded';
      readonly kind: 'reused' | 'published';
      readonly reference: string;
      /** Why earlier candidates were not reused. */
      readonly misses: readonly string[];
      readonly coverage: ICoverageJson;
      /** For a reuse: the exact current member results its acceptance followed. */
      readonly accepted?: readonly string[];
    }
  | { readonly status: 'waiting'; readonly coverage: ICoverageJson }
  | { readonly status: 'failed'; readonly diagnostic: string }
  | { readonly status: 'pending' | 'cancelled'; readonly reason: string; readonly refused: string; readonly coverage: ICoverageJson }
  | { readonly status: 'error'; readonly code: string; readonly message: string };

/** The strict fold's typed status, compactly. */
export type IStrictJson = { readonly status: string; readonly reference?: string };

/** Everything one outcome-fold run reports. */
export interface ITallyRunReport {
  /** Every current member's typed outcome, by key; empty when the request itself rejected. */
  readonly members: Readonly<Record<string, IMemberJson>>;
  readonly tally: ITallyJson;
  /** The strict fold's status, when the run also resolved it. */
  readonly report?: IStrictJson;
  /** Every admission request, in order, as `<kind>:<subject>`. */
  readonly admissions: readonly string[];
  /** Every framework step lifecycle event, in order, as `<slot>/<member key>:<phase>`. */
  readonly events: readonly string[];
  /** Every run event offered to observers, serialized whole. */
  readonly rawEvents: readonly string[];
  /** The helper log of this process. */
  readonly log: readonly string[];
}

/** Options of one outcome-fold run. */
export interface ITallyRunOptions extends IVariation {
  /** The environment the run selects. */
  readonly environment?: string;
  /** Also resolve the strict `report` fold, after the outcome fold, in the same run. */
  readonly strict?: boolean;
  /** Operator stop intent for the run. */
  readonly stop?: IStopController;
  /** The fan-out window. */
  readonly window?: number;
}

/**
 * The world's admission decision: by member key for a template instance,
 * `@<slot>` for a composition-level step; otherwise admitted.
 */
function decide(request: IAdmissionRequest): IAdmissionDecision {
  const target = request.step.template !== undefined ? request.step.memberKey : `@${request.step.slot}`;
  const decision = target === undefined ? undefined : world.decisions[target];
  return decision === undefined ? { kind: 'admitted' } : { kind: decision, reason: `${decision} by the fixture policy for ${target ?? ''}` };
}

/** Describe an event step compactly. */
function eventName(event: IRunEvent): string | undefined {
  return event.kind === 'step' ? `${event.event.step.slot}/${event.event.step.memberKey ?? ''}:${event.event.phase}` : undefined;
}

/** Outcome-fold coverage as JSON. */
function coverageJson(coverage: IOutcomeFoldCoverage): ICoverageJson {
  return {
    succeeded: [...coverage.succeeded],
    skipped: [...coverage.skipped],
    failed: [...coverage.failed],
    cancelled: [...coverage.cancelled],
    pending: [...coverage.pending],
    openDiscovery: coverage.openDiscovery,
    complete: coverage.complete,
  };
}

/** The JSON-safe member outcomes of a report, by key. */
function membersJson(report: IOutcomeFoldReport): Record<string, IMemberJson> {
  const members: Record<string, IMemberJson> = {};
  for (const member of report.members) {
    switch (member.status) {
      case 'succeeded':
        members[member.key] = { status: member.status, kind: member.outcome.kind, reference: member.outcome.reference.locator };
        break;
      case 'skipped':
      case 'pending':
      case 'cancelled':
        members[member.key] = { status: member.status };
        break;
      case 'failed':
        members[member.key] = { status: member.status, code: member.error.code };
        break;
      default: {
        const exhaustive: never = member;
        return exhaustive;
      }
    }
  }
  return members;
}

/** The JSON-safe outcome fold outcome of a report. */
function tallyJson(report: IOutcomeFoldReport): ITallyJson {
  const outcome = report.outcome;
  switch (outcome.status) {
    case 'folded': {
      const settled = outcome.outcome;
      const base = { status: outcome.status, kind: settled.kind, reference: settled.reference.locator, misses: settled.misses.map((item) => item.reason), coverage: coverageJson(settled.coverage) };
      return settled.kind === 'published' ? base : { ...base, accepted: settled.acceptance.dependencies.map((dependency) => dependency.locator) };
    }
    case 'waiting':
      return { status: outcome.status, coverage: coverageJson(outcome.coverage) };
    case 'failed':
      return { status: outcome.status, diagnostic: outcome.diagnostic };
    case 'pending':
    case 'cancelled':
      return { status: outcome.status, reason: outcome.reason, refused: outcome.refused.slot, coverage: coverageJson(outcome.coverage) };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** The strict fold's status, compactly. */
function strictJson(report: IFoldReport): IStrictJson {
  return report.outcome.status === 'succeeded' ? { status: 'succeeded', reference: report.outcome.outcome.reference.locator } : { status: report.outcome.status };
}

/** A fresh request key. */
export function requestKey(): { readonly requestKey: string } {
  return { requestKey: `outcome-fold-request:${randomUUID()}` };
}

/**
 * Open a workspace over `location`, compose the fixture afresh, resolve the
 * `tally` outcome fold (then, when asked, the strict `report` fold) in one
 * supervised run and close the workspace. Only durable History and the world
 * survive. A typed failure of the outcome fold request is reported as its
 * `error`, never thrown.
 */
export async function runTally(location: string, options: ITallyRunOptions = {}): Promise<ITallyRunReport> {
  const workspace = openWorkspace({ location, logicalStore });
  const fixture = composeTally(options);
  const admissions: string[] = [];
  const events: string[] = [];
  const rawEvents: string[] = [];
  try {
    const result = await workspace.run({
      authoring: fixture.builders,
      composition: fixture.composition,
      environment: options.environment ?? defaultEnvironment,
      ...(options.stop === undefined ? {} : { stop: options.stop }),
      ...(options.window === undefined ? {} : { window: options.window }),
      admission: {
        admit(request) {
          admissions.push(`${request.kind}:${request.subject.subject}`);
          return decide(request);
        },
      },
      observers: [{
        observe(event) {
          rawEvents.push(JSON.stringify(event));
          const name = eventName(event);
          if (name !== undefined) {
            events.push(name);
          }
        },
      }],
    }, async (run) => {
      let tally: { readonly settled: 'report'; readonly report: IOutcomeFoldReport } | { readonly settled: 'error'; readonly error: ResolutionError };
      try {
        tally = { settled: 'report', report: await run.resolveOutcomeFold(fixture.tally, requestKey()) };
      } catch (error: unknown) {
        if (!(error instanceof ResolutionError)) {
          throw error;
        }
        tally = { settled: 'error', error };
      }
      const strict = options.strict === true ? await run.resolveFold(fixture.report, requestKey()) : undefined;
      return { tally, strict };
    });
    const common = { admissions, events, rawEvents, log: [...world.log], ...(result.value.strict === undefined ? {} : { report: strictJson(result.value.strict) }) };
    const { tally } = result.value;
    if (tally.settled === 'error') {
      return { ...common, members: {}, tally: { status: 'error', code: tally.error.code, message: tally.error.message } };
    }
    return { ...common, members: membersJson(tally.report), tally: tallyJson(tally.report) };
  } finally {
    workspace.close();
  }
}

/** The helper log entries starting with `prefix`, without it. */
export function logged(report: Pick<ITallyRunReport, 'log'>, prefix: string): readonly string[] {
  return report.log.filter((entry) => entry.startsWith(`${prefix}:`)).map((entry) => entry.slice(prefix.length + 1));
}

/** The exact reference of a succeeded member, or a failure naming what was there. */
export function memberReference(report: ITallyRunReport, key: string): string {
  const member = report.members[key];
  if (member?.reference === undefined) {
    throw new Error(`expected ${key} to succeed, observed ${JSON.stringify(member)}`);
  }
  return member.reference;
}

/** The exact reference of a folded outcome fold, or a failure naming what was there. */
export function tallyReference(report: ITallyRunReport): string {
  if (report.tally.status !== 'folded') {
    throw new Error(`expected the outcome fold to fold, observed ${JSON.stringify(report.tally)}`);
  }
  return report.tally.reference;
}

/** The summary instance subject of one member key. */
export function summarySubject(key: string): string {
  return `summary:acme/widget:2026-Q1:${key}`;
}

/** Exact candidate locators of one scoped subject in `environment`, latest publication first. */
export function candidates(location: string, subject: string, environment: string = defaultEnvironment): readonly string[] {
  const history = openHistory({ location, store: logicalStore });
  try {
    return history.findCandidates({ analysis, environment, subject, version: 1 }).map((candidate) => candidate.reference.locator);
  } finally {
    history.close();
  }
}

/** The outcome fold's candidate locators, latest publication first. */
export function tallyCandidates(location: string, environment: string = defaultEnvironment): readonly string[] {
  return candidates(location, tallySubject, environment);
}

/** The strict fold's candidate locators, latest publication first. */
export function reportCandidates(location: string): readonly string[] {
  return candidates(location, reportSubject);
}

/** The exact data of one completed result. */
export function readResult(location: string, locator: string): unknown {
  const history = openHistory({ location, store: logicalStore });
  try {
    return history.reader.readSubtree({ kind: 'completed-result', locator }, []);
  } finally {
    history.close();
  }
}

/** A stored versioned record as History accepts it. */
export interface IStoredRecord {
  readonly format: string;
  readonly formatVersion: number;
  readonly content: unknown;
}

/** The stored provenance record of one completed result. */
export function readProvenanceRecord(location: string, locator: string): IStoredRecord {
  const history = openHistory({ location, store: logicalStore });
  try {
    const { format, formatVersion, content } = history.readEnvelope({ kind: 'completed-result', locator }).provenance;
    return { format, formatVersion, content };
  } finally {
    history.close();
  }
}

/**
 * Publish a crafted candidate under `subject`, carrying the payload,
 * provenance and dependencies of an existing result `from`. It stands in for
 * a result another fold contract recorded under that subject; it becomes the
 * subject's newest candidate. Returns its exact locator.
 */
export function publishUnder(location: string, subject: string, from: string): string {
  const history = openHistory({ location, store: logicalStore });
  try {
    const acquisition = history.acquireWriter({ holder: 'crafted-evidence', leaseMilliseconds: 60_000 });
    if (acquisition.kind !== 'acquired') {
      throw new Error(`expected the writer lease, observed ${JSON.stringify(acquisition)}`);
    }
    const { lease } = acquisition;
    const original = history.readEnvelope({ kind: 'completed-result', locator: from });
    const attempt = history.allocateAttempt(lease, {
      analysis: original.analysis,
      environment: original.environment,
      subject,
      version: original.version,
      attemptKey: `crafted:${randomUUID()}`,
      intentDigest: 'crafted',
    });
    history.stageAttempt(lease, {
      attemptId: attempt.attemptId,
      payload: history.reader.readSubtree(original.reference, []),
      provenance: original.provenance,
      dependencies: original.dependencies,
    });
    const published = history.publishAttempt(lease, attempt.attemptId);
    history.releaseWriter(lease);
    return published.locator;
  } finally {
    history.close();
  }
}
