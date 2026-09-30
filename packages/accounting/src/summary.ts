/**
 * The storage-independent derivation of a usage summary from the durable facts
 * already selected for its scope. It is where ACC-005 and ACC-006 are decided:
 * an opened request without an acknowledged report is unknown, never zero, and
 * estimates are carried beside observations, never summed into them. It never
 * fabricates a quantity: a unit appears in `observed` only when some
 * acknowledged report stated it.
 * @packageDocumentation
 */
import type { IRecordedEstimate, IUnknownUsage, IUsageAttribution, IUsageQuantity, IUsageSummary } from './contracts.js';

/** One opened request in scope and whether any report for it is acknowledged. */
export interface IIntentFact {
  readonly operation: string;
  readonly request: string;
  readonly attribution: IUsageAttribution;
  readonly reported: boolean;
}

/** The durable facts selected for one summary's scope. */
export interface ISummaryFacts {
  readonly environment: string;
  /** Opened requests in scope, ordered by operation then request. */
  readonly intents: readonly IIntentFact[];
  /** Acknowledged reports in scope. */
  readonly reports: number;
  /** Every quantity of every acknowledged report in scope, unsummed. */
  readonly reportedQuantities: readonly IUsageQuantity[];
  /** Estimates in scope. */
  readonly estimates: readonly IRecordedEstimate[];
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
 * some opened request in scope lacks an acknowledged report, and those
 * requests are listed; `observed` holds only reported sums.
 */
export function summarize(facts: ISummaryFacts): IUsageSummary {
  const base = {
    environment: facts.environment,
    observed: sumQuantities(facts.reportedQuantities),
    operations: new Set(facts.intents.map((intent) => intent.operation)).size,
    requests: facts.intents.length,
    reports: facts.reports,
    estimates: Object.freeze([...facts.estimates]),
  };
  const [first, ...rest] = facts.intents
    .filter((intent) => !intent.reported)
    .map((intent): IUnknownUsage => Object.freeze({ operation: intent.operation, request: intent.request, attribution: intent.attribution }));
  if (first === undefined) {
    const unknown: readonly [] = Object.freeze([]);
    return Object.freeze({ ...base, status: 'known', unknown });
  }
  const unknown: readonly [IUnknownUsage, ...IUnknownUsage[]] = Object.freeze([first, ...rest]);
  return Object.freeze({ ...base, status: 'incomplete', unknown });
}
