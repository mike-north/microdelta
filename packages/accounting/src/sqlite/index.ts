/**
 * Accounting's durable SQLite adapter: the only implementation of the
 * {@link IDurableAccounting} port. It owns every SQL statement of the
 * `accounting_` namespace and reaches storage only through the injected Machine
 * SQLite capability; Node access stays in the host implementation.
 *
 * Each write is one IMMEDIATE transaction that reads the recorded facts it
 * depends on and writes at most one new fact:
 *
 * | Write | Durable change | Death before commit | Death after commit, before return |
 * | --- | --- | --- | --- |
 * | open | intent row | no intent; the caller must not send | intent durable; redelivery is `already-open` |
 * | acknowledge | report and its quantities | usage stays unknown; redelivery records it | report durable; redelivery is `duplicate` |
 * | estimate | estimate and its quantities | nothing | estimate durable; redelivery is `duplicate` |
 *
 * No write consults a writer lease or fence: every fact is keyed and
 * idempotent, so concurrent or late writers from any process record each fact
 * at most once (M5 plan, "Accounting write authority"). A transaction that ran
 * to completion but whose commit did not confirm is reported as
 * {@link AccountingDurabilityUnknownError}, never as a durable acknowledgment
 * and never as certainly lost. This is single-file process-termination scope,
 * not a power-loss or distributed guarantee.
 * @packageDocumentation
 */
import type { ISqliteConnection, ISqliteRow } from '@microdelta/machine';
import { decodeSnapshot, encodeSnapshot } from '@microdelta/value';

import type {
  IDurableAccounting,
  IDurableAccountingOptions,
  IEstimateOutcome,
  IIntentOutcome,
  IRecordedEstimate,
  IRecordedReport,
  IUsageAcknowledgment,
  IUsageAttribution,
  IUsageEstimate,
  IUsageIntent,
  IUsageQuantity,
  IUsageQuery,
  IUsageReport,
  IUsageSummary,
} from '../contracts.js';
import { AccountingDurabilityUnknownError, AccountingIntegrityError, UnattributableUsageError, UsageIntentConflictError } from '../errors.js';
import { summarize } from '../summary.js';
import type { IIntentFact } from '../summary.js';
import { estimateArgument, intentArgument, queryArgument, reportArgument, requireIdentity } from '../validation.js';
import { initializeSchema } from './schema.js';

/** Identity tag for embedded SQL; the text is passed through unchanged. */
const sql = String.raw;

/**
 * The attribution and operation filters of a summary query, as a SQL predicate
 * over the aliased table `alias`. Each filter is bound twice, as `? IS NULL OR
 * column = ?`, so an absent filter does not narrow.
 */
function scopePredicate(alias: string, withOperation: boolean): string {
  const columns = ['run', 'member', 'step_attempt', ...(withOperation ? ['operation'] : [])];
  return columns.map((column) => `(? IS NULL OR ${alias}.${column} = ?)`).join(' AND ');
}

/** The bound values for {@link scopePredicate}, in the same order. */
function scopeValues(query: IUsageQuery, withOperation: boolean): readonly (string | null)[] {
  const filters = [query.run, query.member, query.stepAttempt, ...(withOperation ? [query.operation] : [])];
  return filters.flatMap((filter) => [filter ?? null, filter ?? null]);
}

/** Narrow a stored cell to text. */
function text(row: ISqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AccountingIntegrityError(`Stored accounting column ${column} is not text`);
  }
  return value;
}

/** Narrow a stored cell to text or SQL NULL. */
function nullableText(row: ISqliteRow, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

/** Narrow a stored cell to a nonnegative safe integer. */
function amount(row: ISqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AccountingIntegrityError(`Stored accounting column ${column} is not a nonnegative integer`);
  }
  return value;
}

/** Read the attribution columns of an intent or estimate row. */
function attributionOf(row: ISqliteRow): IUsageAttribution {
  return Object.freeze({ run: text(row, 'run'), member: nullableText(row, 'member'), stepAttempt: nullableText(row, 'step_attempt') });
}

/** Read quantity rows, stored and selected in unit order. */
function quantitiesOf(rows: readonly ISqliteRow[]): readonly IUsageQuantity[] {
  return Object.freeze(rows.map((row) => Object.freeze({ unit: text(row, 'unit'), amount: amount(row, 'amount') })));
}

/** Whether two attributions name the same run, member and step attempt. */
function sameAttribution(left: IUsageAttribution, right: IUsageAttribution): boolean {
  return left.run === right.run && left.member === right.member && left.stepAttempt === right.stepAttempt;
}

/** Whether two canonical (unit-ordered) quantity lists are equal. */
function sameQuantities(left: readonly IUsageQuantity[], right: readonly IUsageQuantity[]): boolean {
  return left.length === right.length && left.every((quantity, index) => quantity.unit === right[index]?.unit && quantity.amount === right[index]?.amount);
}

/** Decode a stored estimate basis into frozen data, or fail as corruption. */
function basisOf(row: ISqliteRow): IRecordedEstimate['basis'] {
  const format = text(row, 'basis_format');
  const formatVersion = amount(row, 'basis_version');
  let assumptions: unknown;
  try {
    assumptions = decodeSnapshot(text(row, 'basis'));
  } catch (error: unknown) {
    throw new AccountingIntegrityError(`Stored estimate basis is not canonical MDS1: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze({ format, formatVersion, assumptions });
}

/**
 * Open (creating when empty) the durable accounting store for one logical
 * store. The file is rejected before any work unless it is empty or holds
 * exactly this schema version for this logical store.
 * @alpha
 */
export function openDurableAccounting(options: IDurableAccountingOptions): IDurableAccounting {
  const logicalStore = requireIdentity(options.logicalStore, 'logicalStore');
  const connection: ISqliteConnection = options.sqlite.openSqlite(options.location);
  try {
    initializeSchema(connection, logicalStore);
  } catch (error: unknown) {
    connection.close();
    throw error;
  }

  const statements = {
    request: connection.prepare(sql`/* intent */ SELECT operation, run, member, step_attempt FROM accounting_requests WHERE environment = ? AND request = ?`),
    insertRequest: connection.prepare(sql`/* intent */ INSERT INTO accounting_requests (environment, request, operation, run, member, step_attempt) VALUES (?, ?, ?, ?, ?, ?)`),
    operationKnown: connection.prepare(sql`/* report */ SELECT 1 AS known FROM accounting_requests WHERE environment = ? AND operation = ? LIMIT 1`),
    reportRequest: connection.prepare(sql`/* report */ SELECT operation FROM accounting_requests WHERE environment = ? AND request = ?`),
    report: connection.prepare(sql`/* report */ SELECT request FROM accounting_reports WHERE environment = ? AND operation = ? AND report = ?`),
    reportQuantities: connection.prepare(sql`/* report */ SELECT unit, amount FROM accounting_report_quantities
      WHERE environment = ? AND operation = ? AND report = ? ORDER BY unit`),
    insertReport: connection.prepare(sql`/* report */ INSERT INTO accounting_reports (environment, operation, report, request) VALUES (?, ?, ?, ?)`),
    insertReportQuantity: connection.prepare(sql`/* report */ INSERT INTO accounting_report_quantities (environment, operation, report, unit, amount) VALUES (?, ?, ?, ?, ?)`),
    estimate: connection.prepare(sql`/* estimate */ SELECT estimate, run, member, step_attempt, basis_format, basis_version, basis
      FROM accounting_estimates WHERE environment = ? AND estimate = ?`),
    estimateQuantities: connection.prepare(sql`/* estimate */ SELECT unit, amount FROM accounting_estimate_quantities WHERE environment = ? AND estimate = ? ORDER BY unit`),
    insertEstimate: connection.prepare(sql`/* estimate */ INSERT INTO accounting_estimates
      (environment, estimate, run, member, step_attempt, basis_format, basis_version, basis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    insertEstimateQuantity: connection.prepare(sql`/* estimate */ INSERT INTO accounting_estimate_quantities (environment, estimate, unit, amount) VALUES (?, ?, ?, ?)`),
    scopedIntents: connection.prepare(sql`/* summary */ SELECT r.operation, r.request, r.run, r.member, r.step_attempt,
      EXISTS (SELECT 1 FROM accounting_reports p WHERE p.environment = r.environment AND p.operation = r.operation AND p.request = r.request) AS reported
      FROM accounting_requests r WHERE r.environment = ? AND ${scopePredicate('r', true)} ORDER BY r.operation, r.request`),
    scopedReports: connection.prepare(sql`/* summary */ SELECT count(*) AS reports FROM accounting_reports p
      JOIN accounting_requests r ON r.environment = p.environment AND r.operation = p.operation AND r.request = p.request
      WHERE p.environment = ? AND ${scopePredicate('r', true)}`),
    scopedQuantities: connection.prepare(sql`/* summary */ SELECT q.unit, q.amount FROM accounting_report_quantities q
      JOIN accounting_reports p ON p.environment = q.environment AND p.operation = q.operation AND p.report = q.report
      JOIN accounting_requests r ON r.environment = p.environment AND r.operation = p.operation AND r.request = p.request
      WHERE q.environment = ? AND ${scopePredicate('r', true)}`),
    scopedEstimates: connection.prepare(sql`/* summary */ SELECT e.estimate, e.run, e.member, e.step_attempt, e.basis_format, e.basis_version, e.basis
      FROM accounting_estimates e WHERE e.environment = ? AND ${scopePredicate('e', false)} ORDER BY e.estimate`),
  };

  /**
   * Run one write transaction. A failure raised while the transaction's work
   * runs rolls everything back and is rethrown unchanged: nothing was written.
   * A failure after the work completed can only come from the commit, whose
   * outcome is then unknown.
   */
  function write<T>(description: string, work: () => T): T {
    let outcome: { readonly value: T } | undefined;
    try {
      connection.transaction(() => {
        outcome = { value: work() };
        return undefined;
      });
    } catch (error: unknown) {
      if (outcome === undefined) {
        throw error;
      }
      throw new AccountingDurabilityUnknownError(`The commit of ${description} did not confirm; redeliver the same fact to resolve whether it is durable`, error);
    }
    if (outcome === undefined) {
      throw new AccountingIntegrityError(`The transaction for ${description} returned without running`);
    }
    return outcome.value;
  }

  /** Read one recorded report inside the caller's transaction. */
  function recordedReport(environment: string, operation: string, report: string): IRecordedReport | undefined {
    const row = statements.report.get(environment, operation, report);
    if (row === undefined) {
      return undefined;
    }
    return Object.freeze({
      environment,
      operation,
      request: text(row, 'request'),
      report,
      quantities: quantitiesOf(statements.reportQuantities.all(environment, operation, report)),
    });
  }

  /** Read one recorded estimate row with its quantities. */
  function estimateOf(environment: string, row: ISqliteRow): IRecordedEstimate {
    const estimate = text(row, 'estimate');
    return Object.freeze({
      environment,
      estimate,
      attribution: attributionOf(row),
      quantities: quantitiesOf(statements.estimateQuantities.all(environment, estimate)),
      basis: basisOf(row),
    });
  }

  /** Refuse a report that does not name an opened request of its operation in its environment. */
  function requireAttributable(report: IUsageReport): void {
    if (statements.operationKnown.get(report.environment, report.operation) === undefined) {
      throw new UnattributableUsageError('unknown-operation', `No request of operation ${report.operation} was opened in environment ${report.environment}`);
    }
    const request = statements.reportRequest.get(report.environment, report.request);
    if (request === undefined) {
      throw new UnattributableUsageError('unknown-request', `Request ${report.request} of operation ${report.operation} was never opened in environment ${report.environment}`);
    }
    if (text(request, 'operation') !== report.operation) {
      throw new UnattributableUsageError('request-of-another-operation', `Request ${report.request} belongs to another operation than ${report.operation}`);
    }
  }

  return {
    openOperation(candidate: IUsageIntent): IIntentOutcome {
      const intent = intentArgument(candidate);
      return write(`intent ${intent.request}`, () => {
        const existing = statements.request.get(intent.environment, intent.request);
        if (existing !== undefined) {
          if (text(existing, 'operation') !== intent.operation || !sameAttribution(attributionOf(existing), intent.attribution)) {
            throw new UsageIntentConflictError(`Request ${intent.request} is already opened in environment ${intent.environment} for another operation or attribution`);
          }
          return 'already-open';
        }
        const { run, member, stepAttempt } = intent.attribution;
        statements.insertRequest.run(intent.environment, intent.request, intent.operation, run, member, stepAttempt);
        return 'opened';
      });
    },

    acknowledgeUsage(candidate: IUsageReport): IUsageAcknowledgment {
      const report = reportArgument(candidate);
      return write(`usage report ${report.report}`, (): IUsageAcknowledgment => {
        requireAttributable(report);
        const recorded = recordedReport(report.environment, report.operation, report.report);
        if (recorded !== undefined) {
          const same = recorded.request === report.request && sameQuantities(recorded.quantities, report.quantities);
          return Object.freeze({ kind: same ? 'duplicate' : 'conflict', report: recorded });
        }
        statements.insertReport.run(report.environment, report.operation, report.report, report.request);
        for (const { unit, amount: quantity } of report.quantities) {
          statements.insertReportQuantity.run(report.environment, report.operation, report.report, unit, quantity);
        }
        return Object.freeze({ kind: 'acknowledged', report });
      });
    },

    recordEstimate(candidate: IUsageEstimate): IEstimateOutcome {
      const estimate = estimateArgument(candidate);
      const basis = encodeSnapshot(estimate.basis.assumptions);
      return write(`estimate ${estimate.estimate}`, (): IEstimateOutcome => {
        const row = statements.estimate.get(estimate.environment, estimate.estimate);
        if (row !== undefined) {
          const recorded = estimateOf(estimate.environment, row);
          const same = sameAttribution(recorded.attribution, estimate.attribution)
            && sameQuantities(recorded.quantities, estimate.quantities)
            && recorded.basis.format === estimate.basis.format
            && recorded.basis.formatVersion === estimate.basis.formatVersion
            && text(row, 'basis') === basis;
          return Object.freeze({ kind: same ? 'duplicate' : 'conflict', estimate: recorded });
        }
        const { run, member, stepAttempt } = estimate.attribution;
        statements.insertEstimate.run(estimate.environment, estimate.estimate, run, member, stepAttempt, estimate.basis.format, estimate.basis.formatVersion, basis);
        for (const { unit, amount: quantity } of estimate.quantities) {
          statements.insertEstimateQuantity.run(estimate.environment, estimate.estimate, unit, quantity);
        }
        // Return the stored form, so the caller sees exactly what a later summary reports.
        const stored = statements.estimate.get(estimate.environment, estimate.estimate);
        if (stored === undefined) {
          throw new AccountingIntegrityError(`Estimate ${estimate.estimate} was not stored`);
        }
        return Object.freeze({ kind: 'recorded', estimate: estimateOf(estimate.environment, stored) });
      });
    },

    summarizeUsage(candidate: IUsageQuery): IUsageSummary {
      const query = queryArgument(candidate);
      const withOperation = scopeValues(query, true);
      // One transaction gives every statement the same durable snapshot.
      return connection.transaction(() => {
        const intents = statements.scopedIntents.all(query.environment, ...withOperation).map((row): IIntentFact => ({
          operation: text(row, 'operation'),
          request: text(row, 'request'),
          attribution: attributionOf(row),
          reported: row.reported === 1,
        }));
        const counted = statements.scopedReports.get(query.environment, ...withOperation);
        const reports = counted === undefined ? 0 : amount(counted, 'reports');
        const reportedQuantities = quantitiesOf(statements.scopedQuantities.all(query.environment, ...withOperation));
        // Estimates are not operation-scoped, so an operation filter selects none of them.
        const estimates = query.operation === undefined
          ? statements.scopedEstimates.all(query.environment, ...scopeValues(query, false)).map((row) => estimateOf(query.environment, row))
          : [];
        return summarize({ environment: query.environment, intents, reports, reportedQuantities, estimates });
      });
    },

    close(): void {
      connection.close();
    },
  };
}
