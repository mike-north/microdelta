/** Raw time-qualified provider evidence, independent of usage attribution or execution policy. @packageDocumentation */
import type { IClockCapability, ISqliteCapability, ISqliteReadCapability, ITimerCapability } from '@microdelta/machine';

/** One observation with stable caller identity; all labels must be opaque and credential-free. @alpha */
export interface IResourceReport {
  /** Isolation boundary of this observation. */
  readonly environment: string;
  /** Caller identity, unique within the environment; never reused or retimed on redelivery. */
  readonly report: string;
  /** Original observation in safe UTC epoch milliseconds, no later than intake's clock. */
  readonly observedAt: number;
  /** Explicit source validity/reset boundary, or unknown. Must follow observation. */
  readonly validUntil: number | null;
  /** Optional local fallback lifetime; never supersedes source validity. */
  readonly localRetentionMilliseconds?: number | null;
  /** Provider label, or unknown. */
  readonly provider: string | null;
  /** Service label, or unknown. */
  readonly service: string | null;
  /** Opaque account label, never an access credential, or unknown. */
  readonly account: string | null;
  /** Pool qualification, or unknown. */
  readonly pool: string | null;
  /** Resource qualification, or unknown. */
  readonly resource: string | null;
  /** Unit qualification, or unknown; no conversion is performed. */
  readonly unit: string | null;
  /** Source window label, or unknown; local expiry never supplies one. */
  readonly window: string | null;
  /** Allowed quantity in the stated unit, or unknown. Zero is explicit evidence. */
  readonly allowed: number | null;
  /** Remaining quantity in the stated unit, or unknown. Never a consumption delta. */
  readonly remaining: number | null;
}

/** Retained evidence together with the reason and boundary for local removal. @alpha */
export interface IRetainedResourceReport extends IResourceReport {
  /** Normalized local override, or null when the default was used or no override was supplied. */
  readonly localRetentionMilliseconds: number | null;
  /** Exclusive expiry boundary; the report is omitted at or after this time. */
  readonly expiresAt: number;
  /** Distinguishes source validity from local retention without inferring a source window. */
  readonly retentionBasis: 'provider' | 'local-default' | 'local-override';
}

/** Write authority over expiring evidence, with automatic idle maintenance until closed. @alpha */
export interface IResourceReports {
  /** Acknowledge only after commit; identical retained identity is duplicate, conflicting identity throws. */
  record(report: IResourceReport): 'recorded' | 'duplicate';
  /** Remove all expired reports now and reschedule the next expiry; returns physically deleted row count. */
  maintain(): number;
  /** Cancel future maintenance and release storage; repeated close is harmless. */
  close(): void;
}

/** Inspection authority with no storage initialization, cleanup or execution ports. @alpha */
export interface IResourceReportReader {
  /** Return retained raw evidence for exactly one environment, in report-id order (not source order). */
  query(environment: string): readonly IRetainedResourceReport[];
  /** Release inspection storage. */
  close(): void;
}

/** Dedicated-file writer assembly; callers own closing and handling reported maintenance failures. @alpha */
export interface IResourceReportsOptions {
  /** Writable host storage; this file must not hold usage, History or other schemas. */
  readonly sqlite: ISqliteCapability;
  /** Injected host time and scheduling; observation and expiry policy remain Accounting-owned. */
  readonly timer: ITimerCapability;
  /** Dedicated expiring-report file. */
  readonly location: string;
  /** Expected logical store identity. */
  readonly logicalStore: string;
  /** Receives cleanup failure and any retry-allocation failure separately; observer exceptions are contained. A failed retry allocation leaves no promised future timer. */
  readonly onMaintenanceError: (error: unknown) => void;
}

/** Read-only assembly of existing report evidence. @alpha */
export interface IResourceReportReaderOptions {
  /** Inspection-only host storage, with no writable open. */
  readonly sqlite: ISqliteReadCapability;
  /** Time used only to filter expired evidence. */
  readonly clock: IClockCapability;
  /** Existing dedicated report file; missing or foreign storage is refused. */
  readonly location: string;
  /** Expected logical store identity. */
  readonly logicalStore: string;
}
