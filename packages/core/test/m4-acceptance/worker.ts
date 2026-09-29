/**
 * One independent M4 acceptance process, started as `node worker.js <job>`.
 * It selects the world file the parent wrote, composes the contribution
 * analysis afresh from the job's variation, opens the built facade's
 * workspace over the scenario's SQLite History file and, in one supervised
 * run, optionally checks named member summaries, then resolves the strict
 * report through the fold entry operation (which settles discovery and every
 * member first) and reads the exact results it settled. It reports on fd 1:
 *
 * - `{ t: 'trace', ... }` lines from author helpers (bodies);
 * - `{ t: 'event', ... }` lines for framework step lifecycle events;
 * - `{ t: 'admission', ... }` lines for each admission request;
 * - `{ t: 'result', ... }` or `{ t: 'error', ... }` as the final line.
 *
 * Every line is written synchronously. Only durable History and the parent's
 * files survive between processes.
 */
import { randomUUID } from 'node:crypto';
import { writeSync } from 'node:fs';

import { openWorkspace } from 'microdelta';
import type { IAdmissionDecision, IAdmissionRequest, ICheckOutcome, IDiscoveryReport, IFoldReport, IMemberOutcome, IRunEvent, IStrictFoldOutcome } from 'microdelta';

import { composeAnalysis, readWorld, useWorld } from './analysis.js';
import type { IReport, ISummary, IVariation } from './analysis.js';

/** Everything one worker process is told. */
export interface IJob {
  readonly location: string;
  readonly logicalStore: string;
  readonly environment: string;
  readonly world: string;
  readonly variation: IVariation;
  /** Member keys whose summary is checked (no admission, bodies or writes) before the fold request. */
  readonly check?: readonly string[];
}

/** A JSON-safe description of how discovery settled. */
export type IDiscoveryJson =
  | { readonly kind: 'keyed'; readonly completion: string; readonly keys: readonly string[]; readonly reference: string }
  | {
      readonly kind: 'rejected';
      readonly reason: string;
      readonly key: string | null;
      readonly collection: string;
      readonly template: string;
      readonly identity: string | null;
      readonly customKey: boolean;
      readonly message: string;
    }
  | { readonly kind: 'pending' | 'cancelled'; readonly reason: string };

/** A JSON-safe description of one member's typed outcome. */
export interface IMemberJson {
  readonly status: 'succeeded' | 'skipped' | 'pending' | 'failed' | 'cancelled';
  /** For succeeded members: reused or published, the exact reference and why earlier candidates missed. */
  readonly kind?: string;
  readonly reference?: string;
  readonly misses?: readonly string[];
  /**
   * For reused members: the exact current results this run's acceptance
   * followed. Kept apart from the reused result's own recorded dependencies
   * (its original provenance), which a restart never rewrites.
   */
  readonly accepted?: readonly string[];
  /** For pending and cancelled members: the refused step (`<slot>/<member key>`) and reason. */
  readonly refused?: string;
  readonly reason?: string;
  /** For failed members: the typed code, message and underlying cause. */
  readonly code?: string;
  readonly message?: string;
  readonly cause?: string | null;
}

/** Framework coverage as JSON. */
export interface ICoverageJson {
  readonly required: readonly string[];
  readonly skipped: readonly string[];
  readonly closed: boolean;
}

/** A JSON-safe description of the strict fold's typed outcome. */
export type IFoldJson =
  | {
      readonly status: 'succeeded';
      readonly kind: 'reused' | 'published';
      readonly reference: string;
      readonly misses: readonly string[];
      readonly coverage: ICoverageJson;
      /** For a reuse: the exact current results its acceptance followed. */
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
  | { readonly status: 'pending' | 'cancelled'; readonly reason: string };

/** A JSON-safe check-only outcome of one member summary. */
export interface ICheckJson {
  readonly kind: string;
  readonly misses: readonly { readonly reason: string; readonly detail: string }[];
}

/** The final result line of one process. */
export interface IResultJson {
  readonly discovery: IDiscoveryJson;
  readonly members: Readonly<Record<string, IMemberJson>>;
  readonly fold: IFoldJson;
  /** Exact reads of every succeeded member's summary. */
  readonly summaries: Readonly<Record<string, ISummary>>;
  /** Exact read of the settled report, when the fold succeeded. */
  readonly report: IReport | null;
  /** Check-only outcomes of the job's `check` members. */
  readonly checks: Readonly<Record<string, ICheckJson>>;
  /** Template step-factory invocations in this process, read after the run settled. */
  readonly factoryCalls: number;
  /** The frozen composition topology, as JSON. */
  readonly topology: string;
  /** The run's post-commit diagnostics. */
  readonly diagnostics: readonly string[];
}

/** Write one line synchronously. */
function emit(entry: Readonly<Record<string, unknown>>): void {
  writeSync(1, `${JSON.stringify(entry)}\n`);
}

/** A readable underlying cause. */
function causeOf(error: Error): string | null {
  const cause: unknown = error.cause;
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : cause === undefined ? null : String(cause);
}

/** Describe how discovery settled. */
function describeDiscovery(discovery: IDiscoveryReport): IDiscoveryJson {
  switch (discovery.kind) {
    case 'keyed':
      return { kind: discovery.kind, completion: discovery.completion, keys: discovery.keys, reference: discovery.reference.locator };
    case 'rejected':
      return {
        kind: discovery.kind,
        reason: discovery.diagnostic.reason,
        key: discovery.diagnostic.key ?? null,
        collection: discovery.diagnostic.collection,
        template: discovery.diagnostic.template,
        identity: discovery.diagnostic.identity ?? null,
        customKey: discovery.diagnostic.customKey,
        message: discovery.diagnostic.message,
      };
    case 'pending':
    case 'cancelled':
      return { kind: discovery.kind, reason: discovery.reason };
    default: {
      const exhaustive: never = discovery;
      return exhaustive;
    }
  }
}

/** Describe one member's typed outcome. */
function describeMember(member: IMemberOutcome): IMemberJson {
  switch (member.status) {
    case 'succeeded': {
      const settled = member.outcome;
      const base = { status: member.status, kind: settled.kind, reference: settled.reference.locator, misses: settled.misses.map((miss) => miss.reason) };
      return settled.kind === 'reused' ? { ...base, accepted: settled.acceptance.dependencies.map((dependency) => dependency.locator) } : base;
    }
    case 'skipped':
      return { status: member.status };
    case 'pending':
    case 'cancelled':
      return { status: member.status, refused: `${member.refused.slot}/${member.refused.memberKey ?? ''}`, reason: member.reason };
    case 'failed':
      return { status: member.status, code: member.error.code, message: member.error.message, cause: causeOf(member.error) };
    default: {
      const exhaustive: never = member;
      return exhaustive;
    }
  }
}

/** Describe the strict fold's typed outcome. */
function describeFold(outcome: IStrictFoldOutcome): IFoldJson {
  switch (outcome.status) {
    case 'succeeded': {
      const settled = outcome.outcome;
      const coverage = { required: [...settled.coverage.required], skipped: [...settled.coverage.skipped], closed: settled.coverage.closed };
      const base = { status: outcome.status, kind: settled.kind, reference: settled.reference.locator, misses: settled.misses.map((miss) => miss.reason), coverage };
      return settled.kind === 'published' ? base : { ...base, accepted: settled.acceptance.dependencies.map((dependency) => dependency.locator) };
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

/** Describe a check-only outcome. */
function describeCheck(checked: ICheckOutcome): ICheckJson {
  return { kind: checked.kind, misses: checked.misses.map((miss) => ({ reason: miss.reason, detail: miss.detail })) };
}

/**
 * The world's admission decision for one request: by `<slot>/<member key>`
 * for a member step, or by `<slot>` for a composition-level step.
 */
function decide(request: IAdmissionRequest): IAdmissionDecision {
  const name = request.step.memberKey === undefined ? request.step.slot : `${request.step.slot}/${request.step.memberKey}`;
  const decision = readWorld().decisions[name];
  return decision === undefined ? { kind: 'admitted' } : { kind: decision, reason: `${decision} by the acceptance world's policy for ${name}` };
}

/** Run the job. */
async function main(job: IJob): Promise<void> {
  useWorld(job.world);
  const analysis = composeAnalysis(job.variation);
  const workspace = openWorkspace({ location: job.location, logicalStore: job.logicalStore });
  try {
    const result = await workspace.run({
      authoring: analysis.authoring,
      composition: analysis.composition,
      environment: job.environment,
      admission: {
        admit(request: IAdmissionRequest): IAdmissionDecision {
          const decision = decide(request);
          emit({ t: 'admission', kind: request.kind, subject: request.subject.subject, slot: request.step.slot, member: request.step.memberKey ?? null, decision: decision.kind });
          return decision;
        },
      },
      observers: [{
        observe(event: IRunEvent): void {
          if (event.kind === 'step') {
            const { step, phase } = event.event;
            emit({ t: 'event', slot: step.slot, member: step.memberKey ?? null, phase });
          }
        },
      }],
    }, async (run) => {
      const checks: Record<string, ICheckJson> = {};
      for (const key of job.check ?? []) {
        checks[key] = describeCheck(await run.check(analysis.summary(key)));
      }
      const folded: IFoldReport = await run.resolveFold(analysis.report, { requestKey: `m4-acceptance:${randomUUID()}` });
      const summaries: Record<string, ISummary> = {};
      for (const member of folded.members) {
        if (member.status === 'succeeded') {
          summaries[member.key] = run.read<ISummary>(member.outcome.reference);
        }
      }
      const report = folded.outcome.status === 'succeeded' ? run.read<IReport>(folded.outcome.outcome.reference) : null;
      return { folded, summaries, report, checks };
    });
    const { folded, summaries, report, checks } = result.value;
    const line: IResultJson = {
      discovery: describeDiscovery(folded.discovery),
      members: Object.fromEntries(folded.members.map((member) => [member.key, describeMember(member)])),
      fold: describeFold(folded.outcome),
      summaries,
      report,
      checks,
      // Read after the run, so a factory re-invoked per instance or per request would be counted.
      factoryCalls: analysis.factoryCalls,
      topology: JSON.stringify(analysis.composition.topology),
      diagnostics: result.diagnostics,
    };
    emit({ t: 'result', ...line });
  } catch (error: unknown) {
    const code: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
    emit({ t: 'error', name: error instanceof Error ? error.name : 'unknown', code: typeof code === 'string' ? code : null, message: error instanceof Error ? error.message : String(error) });
    process.exitCode = 3;
  } finally {
    workspace.close();
  }
}

const encoded = process.argv[2];
if (encoded === undefined) {
  throw new Error('the M4 acceptance worker needs a JSON job argument');
}
// The harness parent builds the job in this exact shape.
await main(JSON.parse(encoded) as IJob);
