/**
 * Resource Accounting (ARC-001): durable, keyed usage observations with known
 * and unknown usage kept apart, estimates kept apart from observations, and
 * the summaries derived from them (ACC-001–ACC-008).
 *
 * Supervision records a usage intent for each request attempt before its paid
 * call and acknowledges each usage report keyed by (operation, report); both
 * are idempotent facts that need no writer fence. A recorded request attempt
 * without an acknowledged report is unknown, never zero, in every summary. Everything is scoped per environment.
 * The SQLite adapter owns its schema, version and `accounting_` namespace and
 * reaches storage only through the injected Machine capability.
 *
 * Every export is a project-private `@alpha` contract; spellings are not a
 * public API.
 * @packageDocumentation
 */
export type {
  IAcknowledgedUsage,
  ICompleteUsageSummary,
  IConflictingUsage,
  IDuplicateUsage,
  IDurableAccounting,
  IDurableAccountingOptions,
  IEstimateBasis,
  IEstimateConflict,
  IEstimateOutcome,
  IEstimateRecorded,
  IIncompleteUsageSummary,
  IRecordedEstimate,
  IRecordedReport,
  IUnknownUsage,
  IUsageAcknowledgment,
  IUsageAttribution,
  IUsageEstimate,
  IUsageIntent,
  IUsageIntentOutcome,
  IUsageQuantity,
  IUsageQuery,
  IUsageReport,
  IUsageSummary,
  IUsageSummaryBase,
} from './contracts.js';
export {
  AccountingDurabilityUnknownError,
  AccountingIntegrityError,
  AccountingSchemaError,
  UnattributableUsageError,
  UsageIntentConflictError,
  type IUnattributableReason,
} from './errors.js';
export { openDurableAccounting } from './sqlite/index.js';
