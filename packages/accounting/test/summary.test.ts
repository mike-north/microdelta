/**
 * Owner tests for the storage-independent summary derivation: an opened
 * request without an acknowledged report is unknown, never zero; each
 * acknowledged report is counted once; units are never merged; estimates stay
 * beside observations, never inside them. The same outcomes are exercised over
 * real SQLite storage in the facade's assembly suite
 * (`packages/core/test/accounting`).
 *
 * @see ../../../docs/spec/operations.md (ACC-001, ACC-003, ACC-005, ACC-006)
 */
import { describe, expect, test } from '@jest/globals';

import type { IRecordedEstimate, IUsageAttribution } from '../src/contracts.js';
import { sumQuantities, summarize } from '../src/summary.js';
import type { IIntentFact } from '../src/summary.js';

/** Attribution of the run under test. */
const attribution: IUsageAttribution = { run: 'run-1', member: 'ada', stepAttempt: 'attempt-1' };

/** One opened request of `operation`, reported or not. */
function intent(operation: string, request: string, reported: boolean): IIntentFact {
  return { operation, request, attribution, reported };
}

/** An estimate with an explicit pricing basis. */
const pricing: IRecordedEstimate = {
  environment: 'production',
  estimate: 'estimate-1',
  attribution,
  quantities: [{ unit: 'usd.micros', amount: 1_500 }],
  basis: { format: 'test.token-pricing', formatVersion: 1, assumptions: { inputRate: 3 } },
};

describe('summaries', () => {
  test('usage is known when every opened request has an acknowledged report', () => {
    const summary = summarize({
      environment: 'production',
      intents: [intent('op-1', 'req-1', true), intent('op-2', 'req-2', true)],
      reports: 2,
      reportedQuantities: [{ unit: 'tokens.input', amount: 100 }, { unit: 'tokens.input', amount: 50 }, { unit: 'requests', amount: 1 }],
      estimates: [],
    });
    expect(summary).toEqual({
      environment: 'production',
      status: 'known',
      observed: [{ unit: 'requests', amount: 1 }, { unit: 'tokens.input', amount: 150 }],
      unknown: [],
      operations: 2,
      requests: 2,
      reports: 2,
      estimates: [],
    });
  });

  test('ACC-005: an opened request without a report is unknown, never zero', () => {
    const summary = summarize({
      environment: 'production',
      intents: [intent('op-1', 'req-1', false)],
      reports: 0,
      reportedQuantities: [],
      estimates: [],
    });
    expect(summary.status).toBe('incomplete');
    expect(summary.unknown).toEqual([{ operation: 'op-1', request: 'req-1', attribution }]);
    // No zero-valued quantity is fabricated for the unreported request.
    expect(summary.observed).toEqual([]);
  });

  test('ACC-005 validation: 100 observed units and the known gap, not an exact total', () => {
    const summary = summarize({
      environment: 'production',
      intents: [intent('op-1', 'req-1', true), intent('op-2', 'req-2', false)],
      reports: 1,
      reportedQuantities: [{ unit: 'units', amount: 100 }],
      estimates: [],
    });
    expect(summary).toMatchObject({ status: 'incomplete', observed: [{ unit: 'units', amount: 100 }], operations: 2, requests: 2, reports: 1 });
    expect(summary.unknown.map((gap) => gap.request)).toEqual(['req-2']);
  });

  test('a scope with no opened work records no usage and no gap', () => {
    expect(summarize({ environment: 'trial', intents: [], reports: 0, reportedQuantities: [], estimates: [] }))
      .toEqual({ environment: 'trial', status: 'known', observed: [], unknown: [], operations: 0, requests: 0, reports: 0, estimates: [] });
  });

  test('operations are counted once however many of their requests are open', () => {
    const summary = summarize({
      environment: 'production',
      intents: [intent('op-1', 'req-1', true), intent('op-1', 'req-2', false)],
      reports: 1,
      reportedQuantities: [{ unit: 'requests', amount: 1 }],
      estimates: [],
    });
    expect(summary).toMatchObject({ operations: 1, requests: 2, status: 'incomplete' });
  });

  test('ACC-006: estimates are listed with their basis and never enter observed totals', () => {
    const summary = summarize({
      environment: 'production',
      intents: [intent('op-1', 'req-1', true)],
      reports: 1,
      reportedQuantities: [{ unit: 'tokens.input', amount: 100 }],
      estimates: [pricing],
    });
    expect(summary.observed).toEqual([{ unit: 'tokens.input', amount: 100 }]);
    expect(summary.estimates).toEqual([pricing]);
    expect(summary.observed.some((quantity) => quantity.unit === 'usd.micros')).toBe(false);
  });

  test('summaries are frozen', () => {
    const summary = summarize({ environment: 'production', intents: [intent('op-1', 'req-1', false)], reports: 0, reportedQuantities: [], estimates: [] });
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary.observed)).toBe(true);
    expect(Object.isFrozen(summary.unknown)).toBe(true);
  });
});

describe('quantity sums', () => {
  test('ACC-001: distinct units are never combined', () => {
    expect(sumQuantities([
      { unit: 'tokens.output', amount: 5 },
      { unit: 'tokens.input', amount: 7 },
      { unit: 'tokens.output', amount: 6 },
    ])).toEqual([{ unit: 'tokens.input', amount: 7 }, { unit: 'tokens.output', amount: 11 }]);
  });

  test('a sum beyond the safe-integer range fails rather than rounds', () => {
    expect(() => sumQuantities([{ unit: 'tokens', amount: Number.MAX_SAFE_INTEGER }, { unit: 'tokens', amount: 1 }])).toThrow(RangeError);
  });
});
