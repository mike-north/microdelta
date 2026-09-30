/**
 * Resource Accounting (ARC-001): durable, keyed usage observations with known
 * and unknown usage kept apart, estimates kept apart from observations, and
 * the summaries derived from them (ACC-001–ACC-008).
 *
 * Supervision records an intent before each paid call and acknowledges each
 * usage report keyed by (operation, report); both are idempotent facts that
 * need no writer fence. An opened request without an acknowledged report is
 * unknown, never zero, in every summary. Everything is scoped per environment.
 * The SQLite adapter owns its schema, version and `accounting_` namespace and
 * reaches storage only through the injected Machine capability.
 *
 * Every export is a project-private `@alpha` contract; spellings are not a
 * public API.
 * @packageDocumentation
 */
export type {
  IAcknowledgedUsage,
  IConflictingUsage,
  IDuplicateUsage,
  IDurableAccounting,
  IDurableAccountingOptions,
  IEstimateBasis,
  IEstimateConflict,
  IEstimateOutcome,
  IEstimateRecorded,
  IIncompleteUsageSummary,
  IIntentOutcome,
  IKnownUsageSummary,
  IRecordedEstimate,
  IRecordedReport,
  IUnknownUsage,
  IUsageAcknowledgment,
  IUsageAttribution,
  IUsageEstimate,
  IUsageIntent,
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
