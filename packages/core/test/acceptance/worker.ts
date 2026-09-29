/**
 * One independent acceptance process. It is started as
 * `node --import register.js worker.js <job-json>`, so the built facade runs
 * over the instrumented host (real Machine, clock and SQLite, observed and
 * optionally killed at a History commit boundary). It composes the analysis
 * afresh from the job's variation, opens the workspace over the shared store
 * file, performs one caller command through the facade's alpha entry
 * operations, and reports on fd 1:
 *
 * - `{ t: 'trace', ... }` lines from author helpers (bodies, checks, finality);
 * - `{ t: 'event', ... }` lines from a run observer (step and ordinary events);
 * - `{ t: 'result', ... }` or `{ t: 'error', ... }` as the final line.
 *
 * Every line is written synchronously, so a SIGKILL leaves an honest trace of
 * what ran before it. Request keys come from a file the caller saved before
 * starting this process; the worker never derives them.
 */
import { readFileSync, writeSync } from 'node:fs';

import { openWorkspace } from 'microdelta';
import type { IAdmissionDecision, IAdmissionRequest, IResolutionOutcome, IRunEvent, IWorkspaceRun } from 'microdelta';

import { composeAnalysis, memberKeys } from './analysis.js';
import type { IMemberKey, ISummary, IVariation } from './analysis.js';
import { markReads, readEvidence } from './instrumented-host.js';

/** One caller command. */
export type ICommand =
  | { readonly kind: 'report'; readonly order?: readonly IMemberKey[] }
  | { readonly kind: 'resolve'; readonly member: IMemberKey }
  | { readonly kind: 'recover'; readonly member: IMemberKey }
  | { readonly kind: 'check'; readonly member: IMemberKey }
  | { readonly kind: 'read'; readonly locators: readonly string[] };

/** Everything one worker process is told. */
export interface IJob {
  readonly location: string;
  readonly logicalStore: string;
  readonly environment: string;
  readonly world: string;
  readonly variation: IVariation;
  readonly command: ICommand;
  /** File holding the caller's saved request keys, one per member. */
  readonly requestKeys?: string;
  /** Writer lease duration; short so a killed holder's lease expires quickly. */
  readonly leaseMilliseconds?: number;
  /** Admission denies these step kinds or member slots. */
  readonly deny?: readonly ({ readonly kind: 'source' | 'memo' } | { readonly memberKey: IMemberKey; readonly slot: string })[];
  /** A run observer throws at this step lifecycle position. */
  readonly throwAt?: { readonly phase: string; readonly memberKey: IMemberKey; readonly slot: string };
}

/** Write one line synchronously. */
function emit(entry: Readonly<Record<string, unknown>>): void {
  writeSync(1, `${JSON.stringify(entry)}\n`);
}

/** A JSON-safe description of one normal outcome. */
function describeOutcome(outcome: IResolutionOutcome): Readonly<Record<string, unknown>> {
  switch (outcome.kind) {
    case 'reused':
      return { kind: 'reused', basis: outcome.basis, reference: outcome.reference.locator, accepted: outcome.acceptance.dependencies.map((reference) => reference.locator), diagnostics: outcome.diagnostics };
    case 'published':
      return { kind: 'published', reference: outcome.reference.locator, diagnostics: outcome.diagnostics };
    case 'refused':
      return { kind: 'refused', refused: outcome.refused, reason: outcome.reason, diagnostics: outcome.diagnostics };
    case 'skipped':
      throw new Error('the acceptance fixture declares no gated template instance');
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Read the caller's saved keys. */
function savedKeys(path: string | undefined): Readonly<Record<string, string>> {
  if (path === undefined) {
    throw new Error('this command needs the caller-saved request keys');
  }
  // Written by the harness parent as `{ member: key }` before this process started.
  return JSON.parse(readFileSync(path, 'utf8')) as Readonly<Record<string, string>>;
}

/** The key the caller saved for a member. */
function keyFor(keys: Readonly<Record<string, string>>, member: IMemberKey): string {
  const key = keys[member];
  if (key === undefined) {
    throw new Error(`no saved request key for ${member}`);
  }
  return key;
}

/** Perform the job's command inside one workspace run. */
async function perform(job: IJob, run: IWorkspaceRun, analysis: ReturnType<typeof composeAnalysis>): Promise<Readonly<Record<string, unknown>>> {
  const command = job.command;
  switch (command.kind) {
    case 'report': {
      const keys = savedKeys(job.requestKeys);
      const order = command.order ?? memberKeys;
      const outcomes: Partial<Record<IMemberKey, IResolutionOutcome>> = {};
      const validationStart = markReads();
      for (const member of order) {
        outcomes[member] = await run.resolve(analysis.summaries[member], { requestKey: keyFor(keys, member) });
      }
      const validation = readEvidence(validationStart);
      const reportStart = markReads();
      const report = await run.ordinary('report', () => [...memberKeys].sort().map((member) => {
        const outcome = outcomes[member];
        if (outcome === undefined || outcome.kind === 'refused' || outcome.kind === 'skipped') {
          return { key: member, refused: true };
        }
        return { key: member, ...run.read<ISummary>(outcome.reference) };
      }));
      return {
        outcomes: Object.fromEntries(Object.entries(outcomes).map(([member, outcome]) => [member, describeOutcome(outcome)])),
        report,
        reads: { validation, report: readEvidence(reportStart) },
      };
    }
    case 'resolve': {
      const keys = savedKeys(job.requestKeys);
      const start = markReads();
      const outcome = await run.resolve(analysis.summaries[command.member], { requestKey: keyFor(keys, command.member) });
      return { outcome: describeOutcome(outcome), reads: readEvidence(start) };
    }
    case 'recover': {
      const keys = savedKeys(job.requestKeys);
      const start = markReads();
      const recovered = await run.recover(analysis.summaries[command.member], { requestKey: keyFor(keys, command.member) });
      return { recovered: recovered.kind === 'recovered' ? { kind: recovered.kind, reference: recovered.reference.locator } : recovered, reads: readEvidence(start) };
    }
    case 'check': {
      const checked = await run.check(analysis.summaries[command.member]);
      return { checked: checked.kind === 'reusable'
        ? { kind: checked.kind, basis: checked.basis, reference: checked.reference.locator }
        : checked.kind === 'uncertain' ? { kind: checked.kind, boundary: checked.boundary } : { kind: checked.kind } };
    }
    case 'read': {
      const reads = command.locators.map((locator) => {
        try {
          return { locator, data: run.read<unknown>({ kind: 'completed-result', locator }) };
        } catch (error: unknown) {
          return { locator, error: error instanceof Error ? error.name : String(error), message: error instanceof Error ? error.message : String(error) };
        }
      });
      return { reads };
    }
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}

/** Run the job. */
async function main(job: IJob): Promise<void> {
  const analysis = composeAnalysis(job.variation, job.world);
  const workspace = openWorkspace({ location: job.location, logicalStore: job.logicalStore, ...(job.leaseMilliseconds === undefined ? {} : { leaseMilliseconds: job.leaseMilliseconds }) });
  try {
    const deny = job.deny ?? [];
    const result = await workspace.run({
      authoring: analysis.authoring,
      composition: analysis.composition,
      environment: job.environment,
      admission: {
        admit(request: IAdmissionRequest): IAdmissionDecision {
          const denied = deny.some((rule) => ('kind' in rule ? rule.kind === request.kind : rule.memberKey === request.step.memberKey && rule.slot === request.step.slot));
          emit({ t: 'admission', member: request.step.memberKey, slot: request.step.slot, kind: request.kind, reason: request.reason, denied });
          return denied ? { kind: 'denied', reason: 'acceptance budget exhausted' } : { kind: 'admitted' };
        },
      },
      observers: [{
        observe(event: IRunEvent): void {
          if (event.kind === 'ordinary') {
            emit({ t: 'event', label: event.label, phase: event.phase });
            return;
          }
          const { step, phase, reference } = event.event;
          emit({ t: 'event', member: step.memberKey, slot: step.slot, phase, ...(reference === undefined ? {} : { reference: reference.locator }) });
          if (job.throwAt !== undefined && job.throwAt.phase === phase && job.throwAt.memberKey === step.memberKey && job.throwAt.slot === step.slot) {
            throw new Error(`acceptance observer failure at ${phase}`);
          }
        },
      }],
    }, (run) => perform(job, run, analysis));
    emit({ t: 'result', ...result.value, diagnostics: result.diagnostics });
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
  throw new Error('the acceptance worker needs a JSON job argument');
}
// The harness parent builds the job in this exact shape.
await main(JSON.parse(encoded) as IJob);
