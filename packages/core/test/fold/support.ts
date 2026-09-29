/**
 * Assembly support for strict-fold tests. A session stands in for one
 * process lifetime: the facade's workspace over a durable SQLite History file
 * and a freshly composed fold fixture. One workspace run resolves the
 * `report` fold through Run Supervision, which first resolves the consumed
 * template step for every current member, and reports discovery, each
 * member's typed outcome and the fold's typed outcome. The same session code
 * runs inside the separate worker processes of the restart suite, so
 * in-process and cross-process evidence share one assembly and one JSON-safe
 * report.
 *
 * @see ../../../../docs/plans/m4-composition.md ("Strict fold", planned evidence names)
 */
import { randomUUID } from 'node:crypto';

import { ResolutionError, openWorkspace } from '../../src/index.js';
import type { IAdmissionDecision, IAdmissionRequest, IFoldReport, IRunEvent } from '../../src/index.js';
import { openHistory } from '../durable-history/support.js';
import { analysis, composeFold, reportSubject, world } from './fixture.js';
import type { IFoldFixture, IVariation } from './fixture.js';

/** The environment every fold session selects. */
export const environment = 'env:fold';

/** The logical store every fold session uses. */
export const logicalStore = 'store:fold';

/** A JSON-safe description of one member's typed outcome. */
export interface IMemberJson {
  readonly status: 'succeeded' | 'skipped' | 'pending' | 'failed' | 'cancelled';
  /** For succeeded members: reused or published, and the exact reference. */
  readonly kind?: string;
  readonly reference?: string;
  /** For pending and cancelled members: the refusal reason. */
  readonly reason?: string;
  /** For failed members: the typed code. */
  readonly code?: string;
}

/** A JSON-safe description of how discovery settled. */
export type IDiscoveryJson =
  | { readonly kind: 'keyed'; readonly completion: string; readonly keys: readonly string[] }
  | { readonly kind: 'rejected'; readonly reason: string; readonly key: string | null; readonly message: string }
  | { readonly kind: 'pending' | 'cancelled'; readonly reason: string };

/** Framework coverage as JSON. */
export interface ICoverageJson {
  readonly required: readonly string[];
  readonly skipped: readonly string[];
  readonly closed: boolean;
}

/**
 * A JSON-safe description of the fold's typed outcome, or of the typed
 * failure the fold request rejected with (`error`).
 */
export type IFoldJson =
  | {
      readonly status: 'succeeded';
      readonly kind: 'reused' | 'published';
      readonly reference: string;
      /** Why earlier fold candidates were not reused. */
      readonly misses: readonly string[];
      readonly coverage: ICoverageJson;
      /** For a reuse: the exact current member results its acceptance followed. */
      readonly accepted?: readonly string[];
    }
  | { readonly status: 'waiting'; readonly pending: readonly string[]; readonly openDiscovery: boolean }
  | {
      readonly status: 'failed';
      readonly failed: readonly string[];
      readonly cancelled: readonly string[];
      readonly pending: readonly string[];
      readonly openDiscovery: boolean;
      readonly diagnostic: string;
    }
  | { readonly status: 'pending' | 'cancelled'; readonly reason: string; readonly refused: string }
  | { readonly status: 'error'; readonly code: string; readonly message: string; readonly cause: string | null };

/** Everything one fold run reports. */
export interface IFoldRunReport {
  /** How discovery settled; absent when the fold request itself rejected. */
  readonly discovery?: IDiscoveryJson;
  /** Every current member's typed outcome, by key; empty when the fold request itself rejected. */
  readonly members: Readonly<Record<string, IMemberJson>>;
  readonly fold: IFoldJson;
  /** Every admission request, in order, as `<kind>:<subject>`. */
  readonly admissions: readonly string[];
  /** Every framework lifecycle event, in order, as `<slot>/<member key>:<phase>`. */
  readonly events: readonly string[];
  /** The helper log of this process. */
  readonly log: readonly string[];
  /** The run's post-commit diagnostics. */
  readonly diagnostics: readonly string[];
}

/**
 * The world's admission decision: by member key for a template instance,
 * `@<slot>` for a composition-level step; otherwise admitted. A target the
 * world lists as faulty makes the admission port itself throw.
 */
function decide(request: IAdmissionRequest): IAdmissionDecision {
  const target = request.step.template !== undefined ? request.step.memberKey : `@${request.step.slot}`;
  if (target !== undefined && world.admissionFaults.includes(target)) {
    throw new Error(`admission service unavailable for ${target}`);
  }
  const decision = target === undefined ? undefined : world.decisions[target];
  return decision === undefined ? { kind: 'admitted' } : { kind: decision, reason: `${decision} by the fixture policy for ${target ?? ''}` };
}

/** Describe an event step compactly. */
function eventName(event: IRunEvent): string | undefined {
  return event.kind === 'step' ? `${event.event.step.slot}/${event.event.step.memberKey ?? ''}:${event.event.phase}` : undefined;
}

/** A readable cause of a typed failure. */
function causeOf(error: Error): string | null {
  const cause: unknown = error.cause;
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : cause === undefined ? null : String(cause);
}

/** The JSON-safe discovery of a fold report. */
function discoveryJson(report: IFoldReport): IDiscoveryJson {
  const discovery = report.discovery;
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

/** The JSON-safe member outcomes of a fold report, by key. */
function membersJson(report: IFoldReport): Record<string, IMemberJson> {
  const members: Record<string, IMemberJson> = {};
  for (const member of report.members) {
    switch (member.status) {
      case 'succeeded':
        members[member.key] = { status: member.status, kind: member.outcome.kind, reference: member.outcome.reference.locator };
        break;
      case 'skipped':
        members[member.key] = { status: member.status };
        break;
      case 'pending':
      case 'cancelled':
        members[member.key] = { status: member.status, reason: member.reason };
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

/** The JSON-safe fold outcome of a fold report. */
function foldJson(report: IFoldReport): IFoldJson {
  const outcome = report.outcome;
  switch (outcome.status) {
    case 'succeeded': {
      const settled = outcome.outcome;
      const coverage = { required: [...settled.coverage.required], skipped: [...settled.coverage.skipped], closed: settled.coverage.closed };
      const base = { status: outcome.status, kind: settled.kind, reference: settled.reference.locator, misses: settled.misses.map((item) => item.reason), coverage };
      if (settled.kind === 'published') {
        return base;
      }
      return { ...base, accepted: settled.acceptance.dependencies.map((dependency) => dependency.locator) };
    }
    case 'waiting':
      return { status: outcome.status, pending: outcome.pending, openDiscovery: outcome.openDiscovery };
    case 'failed':
      return { status: outcome.status, failed: outcome.failed, cancelled: outcome.cancelled, pending: outcome.pending, openDiscovery: outcome.openDiscovery, diagnostic: outcome.diagnostic };
    case 'pending':
    case 'cancelled':
      return { status: outcome.status, reason: outcome.reason, refused: outcome.refused.slot };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** A fresh request key. */
export function requestKey(): { readonly requestKey: string } {
  return { requestKey: `fold-request:${randomUUID()}` };
}

/**
 * Open a workspace over `location`, compose the fixture afresh, resolve the
 * `report` fold in one supervised run and close the workspace. Only durable
 * History and the world survive. A typed failure of the fold request itself
 * is reported as the fold's `error`, never thrown.
 */
export async function runFold(location: string, variation: IVariation = {}): Promise<IFoldRunReport> {
  const workspace = openWorkspace({ location, logicalStore });
  const fixture: IFoldFixture = composeFold(variation);
  const admissions: string[] = [];
  const events: string[] = [];
  try {
    const result = await workspace.run({
      authoring: fixture.builders,
      composition: fixture.composition,
      environment,
      admission: {
        admit(request) {
          admissions.push(`${request.kind}:${request.subject.subject}`);
          return decide(request);
        },
      },
      observers: [{
        observe(event) {
          const name = eventName(event);
          if (name !== undefined) {
            events.push(name);
          }
        },
      }],
    }, (run) => run.resolveFold(fixture.report, requestKey()).then(
      (report) => ({ settled: 'report' as const, report }),
      (error: unknown) => {
        if (!(error instanceof ResolutionError)) {
          throw error;
        }
        return { settled: 'error' as const, error };
      },
    ));
    const common = { admissions, events, log: [...world.log], diagnostics: result.diagnostics };
    if (result.value.settled === 'error') {
      const { error } = result.value;
      return { ...common, members: {}, fold: { status: 'error', code: error.code, message: error.message, cause: causeOf(error) } };
    }
    const { report } = result.value;
    return { ...common, discovery: discoveryJson(report), members: membersJson(report), fold: foldJson(report) };
  } finally {
    workspace.close();
  }
}

/** The helper log entries starting with `prefix`, without it. */
export function logged(report: Pick<IFoldRunReport, 'log'>, prefix: string): readonly string[] {
  return report.log.filter((entry) => entry.startsWith(`${prefix}:`)).map((entry) => entry.slice(prefix.length + 1));
}

/** The exact reference of a succeeded member, or a failure naming what was there. */
export function memberReference(report: IFoldRunReport, key: string): string {
  const member = report.members[key];
  if (member?.reference === undefined) {
    throw new Error(`expected ${key} to succeed, observed ${JSON.stringify(member)}`);
  }
  return member.reference;
}

/** The exact reference of a succeeded fold, or a failure naming what was there. */
export function foldReference(report: IFoldRunReport): string {
  if (report.fold.status !== 'succeeded') {
    throw new Error(`expected the fold to succeed, observed ${JSON.stringify(report.fold)}`);
  }
  return report.fold.reference;
}

/** The summary instance subject of one member key. */
export function summarySubject(key: string): string {
  return `summary:acme/widget:2026-Q1:${key}`;
}

/** Exact candidate locators of one scoped subject, latest publication first, read through History's real authority. */
export function candidates(location: string, subject: string): readonly string[] {
  const history = openHistory({ location, store: logicalStore });
  try {
    return history.findCandidates({ analysis, environment, subject, version: 1 }).map((candidate) => candidate.reference.locator);
  } finally {
    history.close();
  }
}

/** The fold's candidate locators, latest publication first. */
export function foldCandidates(location: string): readonly string[] {
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

/**
 * Publish a crafted candidate beside an existing result, under its subject
 * and compatibility group and with its payload, carrying `provenance` and
 * `dependencies` (the original's by default). It stands in for stored
 * evidence written by another version or damaged in storage; it becomes the
 * subject's newest candidate. Returns its exact locator.
 */
export function publishCrafted(location: string, from: string, provenance: IStoredRecord, dependencies?: readonly string[]): string {
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
      subject: original.subject,
      version: original.version,
      attemptKey: `crafted:${randomUUID()}`,
      intentDigest: 'crafted',
    });
    history.stageAttempt(lease, {
      attemptId: attempt.attemptId,
      payload: history.reader.readSubtree(original.reference, []),
      provenance,
      dependencies: dependencies === undefined ? original.dependencies : dependencies.map((locator) => ({ kind: 'completed-result' as const, locator })),
    });
    const published = history.publishAttempt(lease, attempt.attemptId);
    history.releaseWriter(lease);
    return published.locator;
  } finally {
    history.close();
  }
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
