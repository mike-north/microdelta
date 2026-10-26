/** Compact failure evidence belongs to the qualification harness, outside application and runtime contracts. */
import type { IFoldReport, IStopState, IUsageSummary } from 'microdelta';
import type { IWorkloadStats } from './workload-harness.js';
import type { IWorkloadMemorySnapshot } from './workload-measurement.js';

/** Discovery retains the runtime's own closure vocabulary. */
type IWorkloadDiscoveryCompletion = Extract<IFoldReport['discovery'], { readonly kind: 'keyed' }>['completion'];

/** Both success and failure report observations from the same byte-valued sampler and process high-water mark. */
export interface IWorkloadMemoryReceipt extends IWorkloadMemorySnapshot {
  readonly samplingLimitation: string;
  readonly rawMaxRss: number;
  readonly maxRssUnit: 'kibibytes';
  readonly maxRssBytes: number;
}

/** Only fields used by the projection cross this seam; result values and accounting identities stay in their stores. */
export interface IWorkloadFailureInput {
  readonly fold: {
    readonly outcome: Pick<IFoldReport['outcome'], 'status'>;
    readonly discovery: { readonly kind: IFoldReport['discovery']['kind']; readonly completion?: IWorkloadDiscoveryCompletion; readonly keys?: readonly string[] };
    readonly members: readonly { readonly key: string; readonly status: IFoldReport['members'][number]['status']; readonly reason?: string }[];
  };
  readonly usage: Pick<IUsageSummary, 'status' | 'operations' | 'requestAttempts' | 'reports' | 'unknown'>;
  readonly diagnostics: readonly string[];
  readonly stop: IStopState;
  readonly waitingUntil: number | undefined;
}

/** Counts retain scale and incompleteness; nullable fields distinguish absence from a measured zero. */
export interface IWorkloadFailureSummary {
  readonly foldStatus: IFoldReport['outcome']['status'];
  readonly discovery: { readonly kind: IFoldReport['discovery']['kind']; readonly completion: IWorkloadDiscoveryCompletion | null; readonly keys: number | null };
  readonly memberStatuses: Readonly<Record<string, number>>;
  readonly firstPending: { readonly key: string; readonly status: 'pending'; readonly reason: string | null } | null;
  readonly diagnostic: { readonly first: string | null; readonly count: number; readonly firstTruncated: boolean };
  readonly stop: { readonly level: IStopState['level']; readonly cause: IStopState['cause'] | null; readonly deadline: number | null };
  readonly waitingUntil: number | null;
  readonly usage: { readonly status: IUsageSummary['status']; readonly operations: number; readonly requestAttempts: number; readonly reports: number; readonly unknown: number };
}

/** These measurements stop at an incomplete run's return and cannot stand for completed-workload counts or peaks. */
export interface IWorkloadFailureReceipt extends IWorkloadFailureSummary {
  readonly phase: 'cold' | 'restart';
  readonly status: 'incomplete';
  readonly measurementScope: 'partial-through-run-return';
  readonly observed: IWorkloadStats;
  readonly memory: IWorkloadMemoryReceipt;
}

/** A parent can retain an incomplete worker's bounded evidence, or an explicit process-level evidence gap. */
export interface IWorkloadProcessFailure {
  readonly phase: 'cold' | 'restart';
  readonly status: 'process-failed';
  readonly elapsedMilliseconds: number;
  readonly exitStatus: number | null;
  readonly processError: string | null;
  /** Parsed child evidence is retained as data, never treated as proof that the workload completed. */
  readonly workerReceipt: unknown;
  readonly stderrTail: string | null;
}

/** Keep one bounded child receipt; abnormal exits without one leave their resource measurements unavailable. */
export function captureWorkloadProcessFailure(phase: 'cold' | 'restart', elapsedMilliseconds: number, exitStatus: number | null,
  stderr: string, processError: string | undefined): IWorkloadProcessFailure {
  const tail = stderr.slice(-8_192);
  const lastLine = tail.trimEnd().split('\n').at(-1);
  let workerReceipt: unknown = null;
  if (lastLine !== undefined) {
    try {
      const decoded: unknown = JSON.parse(lastLine);
      if (typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded) && Reflect.get(decoded, 'status') === 'incomplete') { workerReceipt = decoded; }
    } catch { /* A killed worker may not have emitted JSON; its bounded stderr remains diagnostic evidence. */ }
  }
  return { phase, status: 'process-failed', elapsedMilliseconds, exitStatus, processError: processError?.slice(0, 512) ?? null,
    workerReceipt, stderrTail: workerReceipt === null ? tail : null };
}

/** This error carries a bounded receipt; CLI code can emit the structure without serializing the complete run. */
export class WorkloadIncompleteError extends Error {
  constructor(readonly receipt: IWorkloadFailureReceipt) { super('controlled workload did not complete'); this.name = 'WorkloadIncompleteError'; }
}

/** Project facts from a failed run without exposing whole membership, usage or diagnostic arrays. */
export function summarizeWorkloadFailure(input: IWorkloadFailureInput): IWorkloadFailureSummary {
  const memberStatuses: Record<string, number> = {};
  for (const member of input.fold.members) { memberStatuses[member.status] = (memberStatuses[member.status] ?? 0) + 1; }
  const pending = input.fold.members.find(member => member.status === 'pending');
  const firstDiagnostic = input.diagnostics[0];
  return {
    foldStatus: input.fold.outcome.status,
    discovery: { kind: input.fold.discovery.kind, completion: input.fold.discovery.completion ?? null, keys: input.fold.discovery.keys?.length ?? null },
    memberStatuses,
    firstPending: pending === undefined ? null : { key: pending.key.slice(0, 128), status: 'pending', reason: pending.reason?.slice(0, 512) ?? null },
    diagnostic: { first: firstDiagnostic?.slice(0, 512) ?? null, count: input.diagnostics.length, firstTruncated: firstDiagnostic !== undefined && firstDiagnostic.length > 512 },
    stop: { level: input.stop.level, cause: input.stop.cause ?? null, deadline: input.stop.deadline ?? null },
    waitingUntil: input.waitingUntil ?? null,
    usage: { status: input.usage.status, operations: input.usage.operations, requestAttempts: input.usage.requestAttempts, reports: input.usage.reports, unknown: input.usage.unknown.length },
  };
}
