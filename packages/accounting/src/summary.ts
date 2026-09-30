/**
 * The storage-independent derivation of a usage summary from the durable facts
 * read for its scope. It is where ACC-005 and ACC-006 are decided: a recorded
 * request attempt without an acknowledged report of its own is unknown, never
 * zero, and estimates are carried beside observations, never summed into them.
 * It never fabricates a quantity: a unit appears in `observed` only when some
 * acknowledged report stated it.
 * @packageDocumentation
 */
import type { IRecordedEstimate, IUnknownUsage, IUsageAttribution, IUsageQuantity, IUsageSummary } from './contracts.js';

/** One recorded request attempt in scope and whether a report of its own is acknowledged. */
export interface IIntentFact {
  readonly operation: string;
  readonly requestAttempt: string;
  readonly attribution: IUsageAttribution;
  readonly reported: boolean;
}

/** The durable facts selected for one summary's scope. */
export interface ISummaryFacts {
  readonly environment: string;
  /** Recorded request attempts in scope, ordered by operation then request attempt. */
  readonly intents: readonly IIntentFact[];
  /** Acknowledged reports in scope. */
  readonly reports: number;
  /** Every quantity of every acknowledged report in scope, unsummed. */
  readonly reportedQuantities: readonly IUsageQuantity[];
  /** Estimates in scope. */
  readonly estimates: readonly IRecordedEstimate[];
}

/**
 * One row of a summary's single read: a recorded request attempt in scope,
 * joined with one of its own acknowledged reports (or none) and one of that
 * report's quantities (or none). Rows arrive ordered by operation, request
 * attempt, report and unit, all read by one statement so they form one
 * consistent snapshot.
 */
export interface IScopedUsageRow {
  readonly operation: string;
  readonly requestAttempt: string;
  readonly attribution: IUsageAttribution;
  /** An acknowledged report of this request attempt, or `null` when it has none. */
  readonly report: string | null;
  /** One quantity of that report, or `null` for a report with no quantities or no report. */
  readonly quantity: IUsageQuantity | null;
}

/** A request attempt's attribution and whether a report of its own was seen. */
interface IAttemptState {
  readonly attribution: IUsageAttribution;
  reported: boolean;
}

/**
 * Fold the joined rows of one read into summary facts. A request attempt is
 * reported exactly when some row pairs it with a report of its own; a report
 * is counted once however many quantity rows it has, and each quantity once.
 */
export function factsFromRows(environment: string, rows: readonly IScopedUsageRow[], estimates: readonly IRecordedEstimate[]): ISummaryFacts {
  // Keyed by operation, then request attempt (or report): nested maps keep
  // arbitrary identity strings exact and preserve the rows' order.
  const attempts = new Map<string, Map<string, IAttemptState>>();
  const reports = new Map<string, Set<string>>();
  const reportedQuantities: IUsageQuantity[] = [];
  for (const row of rows) {
    const operationAttempts = attempts.get(row.operation) ?? new Map<string, IAttemptState>();
    attempts.set(row.operation, operationAttempts);
    const attempt = operationAttempts.get(row.requestAttempt) ?? { attribution: row.attribution, reported: false };
    operationAttempts.set(row.requestAttempt, attempt);
    if (row.report !== null) {
      attempt.reported = true;
      const operationReports = reports.get(row.operation) ?? new Set<string>();
      reports.set(row.operation, operationReports);
      operationReports.add(row.report);
      if (row.quantity !== null) {
        reportedQuantities.push(row.quantity);
      }
    }
  }
  return {
    environment,
    intents: [...attempts].flatMap(([operation, operationAttempts]) =>
      [...operationAttempts].map(([requestAttempt, { attribution, reported }]): IIntentFact => ({ operation, requestAttempt, attribution, reported }))),
    reports: [...reports.values()].reduce((count, operationReports) => count + operationReports.size, 0),
    reportedQuantities,
    estimates,
  };
}

/**
 * Sum quantities per unit, in unit order. Equal units only are added; a sum
 * beyond the safe-integer range fails with `RangeError` rather than rounding.
 */
export function sumQuantities(quantities: readonly IUsageQuantity[]): readonly IUsageQuantity[] {
  const totals = new Map<string, number>();
  for (const { unit, amount } of quantities) {
    const sum = (totals.get(unit) ?? 0) + amount;
    if (!Number.isSafeInteger(sum)) {
      throw new RangeError(`Observed ${unit} exceeds the safe integer range`);
    }
    totals.set(unit, sum);
  }
  return Object.freeze(
    [...totals.keys()]
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((unit) => Object.freeze({ unit, amount: totals.get(unit) ?? 0 })),
  );
}

/**
 * Derive the summary for one scope. The status is `incomplete` exactly when
 * some recorded request attempt in scope lacks an acknowledged report of its
 * own, and those attempts are listed; `observed` holds only reported sums.
 */
export function summarize(facts: ISummaryFacts): IUsageSummary {
  const base = {
    environment: facts.environment,
    observed: sumQuantities(facts.reportedQuantities),
    operations: new Set(facts.intents.map((intent) => intent.operation)).size,
    requestAttempts: facts.intents.length,
    reports: facts.reports,
    estimates: Object.freeze([...facts.estimates]),
  };
  const [first, ...rest] = facts.intents
    .filter((intent) => !intent.reported)
    .map((intent): IUnknownUsage => Object.freeze({ operation: intent.operation, requestAttempt: intent.requestAttempt, attribution: intent.attribution }));
  if (first === undefined) {
    const unknown: readonly [] = Object.freeze([]);
    return Object.freeze({ ...base, status: 'complete', unknown });
  }
  const unknown: readonly [IUnknownUsage, ...IUnknownUsage[]] = Object.freeze([first, ...rest]);
  return Object.freeze({ ...base, status: 'incomplete', unknown });
}
