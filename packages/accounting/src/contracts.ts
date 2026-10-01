/**
 * Resource Accounting's port: the durable facts it records about paid work and
 * the summaries it derives from them (ARC-001, ACC-001–ACC-008).
 *
 * The facts are:
 *
 * - a **usage intent** that one request attempt of one external operation is
 *   about to be sent, so usage is expected from it (ACC-007 "intent before
 *   send");
 * - a **usage report** that the provider observed consumption for that
 *   operation, identified by (operation, report) and acknowledged only once
 *   durable (ACC-003, ACC-007);
 * - an **estimate** with its stated basis, which never becomes an observation
 *   (ACC-006).
 *
 * Every fact belongs to exactly one environment; nothing crosses environments
 * (RUN-017). Every fact is immutable once recorded and every write is an
 * idempotent keyed fact, so no write needs the History writer fence: a stale
 * writer's late report is still recorded because the usage happened (M5 plan,
 * "Accounting write authority").
 *
 * Accounting never invents usage, never counts an estimate as observed, and
 * never decides execution policy such as retry, budgets or deletion (ACC-005,
 * ACC-006, ACC-008). External operations and their request attempts are Run
 * Supervision's: it mints and owns their identities, and Accounting records
 * usage expected from and reported for them as opaque identifiers. Accounting
 * never opens, settles or resolves an operation.
 *
 * Operator resolution of an operation whose usage is unknown needs no other
 * Accounting fact: usage the operator learns is acknowledged as an ordinary
 * report under an operator-namespaced report identity, and an abandoned
 * operation is a Supervision and History fact, after which Accounting
 * correctly keeps reporting its usage as unknown.
 * @packageDocumentation
 */
import type { ISqliteCapability } from '@microdelta/machine';

/**
 * Whom an intent or estimate belongs to: the run it happened in and, where the
 * work belongs to one, the collection member and step attempt. These are the
 * correlation identities of RUN-013 and the roll-up keys of ACC-002. Accounting
 * records them as supplied and never interprets them. `null` means the work has
 * no such owner (for example ordinary work outside any member).
 * @alpha
 */
export interface IUsageAttribution {
  /** The run that sent the request attempt or produced the estimate. */
  readonly run: string;
  /** The designated member key the work belongs to, or `null` when none applies. */
  readonly member: string | null;
  /** The step attempt the work belongs to, or `null` when none applies. */
  readonly stepAttempt: string | null;
}

/**
 * A usage intent: request attempt `requestAttempt` of external operation
 * `operation` is about to be sent. It must be durably recorded before the paid
 * call is sent. From then on the attempt's usage is expected: until a report
 * for it is acknowledged, every summary that includes it reports its usage as
 * unknown, never zero (ACC-005). A request attempt identity belongs to one
 * operation within its environment. A request attempt is one network try of the
 * operation (EXP-8); it is unrelated to a run's request key.
 * @alpha
 */
export interface IUsageIntent {
  /** The environment whose accounting records this fact. */
  readonly environment: string;
  /** The stable identity of the logical external operation, minted by Run Supervision (RUN-012). */
  readonly operation: string;
  /** The identity of this request attempt, unique within the environment. */
  readonly requestAttempt: string;
  /** The run, member and step attempt the request attempt is sent for. */
  readonly attribution: IUsageAttribution;
}

/**
 * The durable outcome of recording a usage intent. `recorded` means this call
 * wrote it; `duplicate` means an identical intent was already durable, so a
 * redelivery after an unknown commit is harmless. Both confirm durability.
 * @alpha
 */
export type IUsageIntentOutcome = 'recorded' | 'duplicate';

/**
 * One observed quantity: a nonnegative safe-integer `amount` of `unit`. A unit
 * names a kind of quantity, including any provider, pool or currency that
 * distinguishes it (`tokens.input`, `requests`, `github:graphql-points`,
 * `usd.micros`); it never carries a value. Units are never converted into one
 * another and only equal units are summed (ACC-001). A fractional quantity is
 * reported in a finer unit.
 * @alpha
 */
export interface IUsageQuantity {
  /** An identifier: a letter followed by letters, digits, `.`, `_`, `:` or `-`, at most 128 characters. */
  readonly unit: string;
  /** A nonnegative safe integer amount of `unit`. */
  readonly amount: number;
}

/**
 * One usage report delivered for a recorded request attempt. The report
 * identity is unique per operation, not globally: the same report identity on
 * two operations is two reports, and a redelivery of the same (operation,
 * report) is never summed twice (ACC-003). Quantities are additive deltas of
 * observed consumption, one entry per unit; an empty list is the reporter's
 * explicit observation that the attempt consumed nothing. Cumulative
 * snapshots and corrections are not part of this contract.
 * @alpha
 */
export interface IUsageReport {
  /** The environment whose accounting records this fact. */
  readonly environment: string;
  /** The operation the usage is attributed to. */
  readonly operation: string;
  /** The recorded request attempt of that operation that incurred the usage. */
  readonly requestAttempt: string;
  /**
   * The report identity, unique within the operation. It must be stable across
   * redelivery: derive it from the provider's response (for example its usage
   * record or response identifier), never mint it per delivery. Deduplication
   * rests on it alone, so a fresh identity on a redelivery after
   * {@link AccountingDurabilityUnknownError} is counted a second time.
   */
  readonly report: string;
  /** Observed deltas, at most one per unit. */
  readonly quantities: readonly IUsageQuantity[];
}

/**
 * A usage report as durably recorded, with its quantities in unit order.
 * @alpha
 */
export interface IRecordedReport {
  /** The environment that recorded it. */
  readonly environment: string;
  /** The operation it is attributed to. */
  readonly operation: string;
  /** The request attempt that incurred it. */
  readonly requestAttempt: string;
  /** The report identity within the operation. */
  readonly report: string;
  /** Observed deltas in unit order. */
  readonly quantities: readonly IUsageQuantity[];
}

/**
 * This delivery wrote the report durably before returning (ACC-007).
 * @alpha
 */
export interface IAcknowledgedUsage {
  /** Discriminates the acknowledgment outcome. */
  readonly kind: 'acknowledged';
  /** The durable report. */
  readonly report: IRecordedReport;
}

/**
 * An identical report (same request attempt and quantities) was already durable, so
 * nothing was written and nothing is counted again. This confirms durability
 * as fully as `acknowledged` and is how a lost acknowledgment is resolved.
 * @alpha
 */
export interface IDuplicateUsage {
  /** Discriminates the acknowledgment outcome. */
  readonly kind: 'duplicate';
  /** The durable report this delivery repeats. */
  readonly report: IRecordedReport;
}

/**
 * A different report with the same (operation, report) identity was already
 * durable. The first delivery is kept unchanged and this one is not recorded;
 * the caller decides how to diagnose the disagreement.
 * @alpha
 */
export interface IConflictingUsage {
  /** Discriminates the acknowledgment outcome. */
  readonly kind: 'conflict';
  /** The durable first delivery, which remains the recorded report. */
  readonly report: IRecordedReport;
}

/**
 * The outcome of acknowledging a usage report. Returning `acknowledged` or
 * `duplicate` means the report is durable and counted exactly once. Any thrown
 * error means no acknowledgment was issued; see
 * {@link AccountingDurabilityUnknownError} for the case where the write may
 * nevertheless have landed.
 * @alpha
 */
export type IUsageAcknowledgment = IAcknowledgedUsage | IDuplicateUsage | IConflictingUsage;

/**
 * The stated basis of an estimate: the assumptions it rests on, in an
 * owner-defined versioned format. Accounting stores the assumptions canonically
 * and never interprets them (ACC-006).
 * @alpha
 */
export interface IEstimateBasis {
  /** Identifies the shape of `assumptions`, such as `example.token-pricing`. */
  readonly format: string;
  /** A positive integer version of `format`. */
  readonly formatVersion: number;
  /** The assumptions, as data Value can encode canonically. */
  readonly assumptions: unknown;
}

/**
 * An estimate of consumption, such as a monetary conversion of observed tokens
 * or an extrapolation of a trial. It is kept apart from observations: it is
 * never summed into observed totals and is reported with its basis (ACC-006).
 * @alpha
 */
export interface IUsageEstimate {
  /** The environment whose accounting records this fact. */
  readonly environment: string;
  /** The estimate identity, unique within the environment. */
  readonly estimate: string;
  /** The run, member and step attempt the estimate is about. */
  readonly attribution: IUsageAttribution;
  /** Estimated amounts, at most one per unit. */
  readonly quantities: readonly IUsageQuantity[];
  /** The assumptions the estimate rests on. */
  readonly basis: IEstimateBasis;
}

/**
 * An estimate as durably recorded, with its quantities in unit order and its
 * assumptions decoded as frozen data.
 * @alpha
 */
export interface IRecordedEstimate {
  /** The environment that recorded it. */
  readonly environment: string;
  /** The estimate identity. */
  readonly estimate: string;
  /** Whom the estimate is about. */
  readonly attribution: IUsageAttribution;
  /** Estimated amounts in unit order. */
  readonly quantities: readonly IUsageQuantity[];
  /** The recorded basis. */
  readonly basis: IEstimateBasis;
}

/**
 * This call wrote the estimate durably, or an identical estimate was already
 * durable (`duplicate`). Either way exactly one copy is recorded.
 * @alpha
 */
export interface IEstimateRecorded {
  /** Discriminates the estimate outcome. */
  readonly kind: 'recorded' | 'duplicate';
  /** The durable estimate. */
  readonly estimate: IRecordedEstimate;
}

/**
 * A different estimate was already recorded under the same identity. It is
 * kept unchanged and this one is not recorded.
 * @alpha
 */
export interface IEstimateConflict {
  /** Discriminates the estimate outcome. */
  readonly kind: 'conflict';
  /** The durable first estimate, which remains the recorded one. */
  readonly estimate: IRecordedEstimate;
}

/**
 * The outcome of recording an estimate, keyed by its identity within its
 * environment.
 * @alpha
 */
export type IEstimateOutcome = IEstimateRecorded | IEstimateConflict;

/**
 * Selects what a summary covers. `environment` is required: a summary never
 * spans environments. Each other field narrows the summary to intents (and
 * their reports) and estimates whose attribution or operation equals it; an
 * absent field does not narrow. Work recorded without a member or step attempt
 * is excluded by a filter on that field. Estimates are not operation-scoped,
 * so an `operation` filter excludes every estimate.
 * @alpha
 */
export interface IUsageQuery {
  /** The environment to summarize. */
  readonly environment: string;
  /** Only work of this run. */
  readonly run?: string;
  /** Only work of this member. */
  readonly member?: string;
  /** Only work of this step attempt. */
  readonly stepAttempt?: string;
  /** Only this operation. */
  readonly operation?: string;
}

/**
 * One recorded request attempt with no acknowledged report: its usage is
 * unknown. It may still be in flight, or its process may have died on either
 * side of the send; Accounting cannot tell and never reports it as zero
 * (ACC-005). Another attempt's report never covers it.
 * @alpha
 */
export interface IUnknownUsage {
  /** The operation whose request attempt has no report. */
  readonly operation: string;
  /** The request attempt with no report. */
  readonly requestAttempt: string;
  /** Whom the request attempt was sent for. */
  readonly attribution: IUsageAttribution;
}

/**
 * What every summary states, whether or not usage is complete.
 * @alpha
 */
export interface IUsageSummaryBase {
  /** The summarized environment. */
  readonly environment: string;
  /**
   * The sum, per unit, of every acknowledged report in scope, each counted
   * once, in unit order. These are observed or reported quantities, never a
   * guaranteed bill (ACC-005). An absent unit means no report stated it.
   */
  readonly observed: readonly IUsageQuantity[];
  /** Distinct operations with a recorded request attempt in scope. */
  readonly operations: number;
  /** Recorded request attempts (usage intents) in scope. */
  readonly requestAttempts: number;
  /** Acknowledged reports in scope. */
  readonly reports: number;
  /** Estimates in scope, each with its own basis; never part of `observed`. */
  readonly estimates: readonly IRecordedEstimate[];
}

/**
 * Every recorded request attempt in scope has an acknowledged report, so
 * `observed` is all the usage reported for the scope.
 * @alpha
 */
export interface ICompleteUsageSummary extends IUsageSummaryBase {
  /** Discriminates a summary with no usage gap. */
  readonly status: 'complete';
  /** No request attempt in scope lacks a report. */
  readonly unknown: readonly [];
}

/**
 * At least one recorded request attempt in scope has no acknowledged report.
 * `observed` is what was reported; the usage of each `unknown` attempt is
 * unknown, so the scope's actual consumption is not known (ACC-005).
 * @alpha
 */
export interface IIncompleteUsageSummary extends IUsageSummaryBase {
  /** Discriminates a summary with a known usage gap. */
  readonly status: 'incomplete';
  /** The request attempts whose usage is unknown, ordered by operation then request attempt. */
  readonly unknown: readonly [IUnknownUsage, ...IUnknownUsage[]];
}

/**
 * A usage summary for one environment, optionally narrowed. The discriminant
 * makes a usage gap impossible to read as zero.
 * @alpha
 */
export type IUsageSummary = ICompleteUsageSummary | IIncompleteUsageSummary;

/**
 * Resource Accounting's durable port. Every method is synchronous and every
 * write commits before it returns. Writes need no writer lease or fence; they
 * are idempotent keyed facts, safe to redeliver from any process. Summaries are
 * reads: they take no write lock, so they never block a write and a held write
 * lock never makes them fail.
 *
 * A write waits a bounded time for another connection's write lock. When the
 * wait is exhausted the write fails with {@link AccountingBusyError}, whose
 * cause is the host's typed `SqliteBusyError`. Such a write did no work:
 * nothing was recorded, no acknowledgment was issued, and the same fact may be
 * redelivered later.
 * @alpha
 */
export interface IDurableAccounting {
  /**
   * Durably record the usage intent for a request attempt about to be sent.
   * Call before the send; send only after this returns. A redelivered
   * identical intent returns `duplicate`. A request attempt identity already
   * recorded for a different operation or attribution is refused with
   * {@link UsageIntentConflictError}. Recording an intent does not open or own
   * the operation, whose identity and lifecycle are Run Supervision's.
   */
  recordUsageIntent(intent: IUsageIntent): IUsageIntentOutcome;

  /**
   * Durably acknowledge a usage report, keyed by (operation, report) within its
   * environment. The report identity must be stable across redelivery (derived
   * from the provider's response, never minted per delivery): after
   * {@link AccountingDurabilityUnknownError}, redeliver the same report with the
   * same identity, or it is counted twice. A report naming an operation or
   * request attempt never recorded in its environment, or a request attempt of
   * another operation, is refused with {@link UnattributableUsageError}.
   */
  acknowledgeUsage(report: IUsageReport): IUsageAcknowledgment;

  /** Durably record an estimate, keyed by its identity within its environment. */
  recordEstimate(estimate: IUsageEstimate): IEstimateOutcome;

  /** Summarize one environment's durable facts, optionally narrowed. */
  summarizeUsage(query: IUsageQuery): IUsageSummary;

  /** Release the database connection. Later calls fail. */
  close(): void;
}

/**
 * What opening the SQLite-backed accounting store needs: the Machine SQLite
 * capability, the database location and the logical store the file must hold.
 * @alpha
 */
export interface IDurableAccountingOptions {
  /** The host's persistent SQLite capability. */
  readonly sqlite: ISqliteCapability;
  /** The database file location, as the capability accepts it. */
  readonly location: string;
  /** The logical store this file belongs to; a file of another store is refused. */
  readonly logicalStore: string;
}
