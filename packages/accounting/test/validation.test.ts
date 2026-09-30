/**
 * Owner tests for Accounting's argument boundary: malformed facts fail with
 * `TypeError` before storage is touched, quantities keep units apart and are
 * canonical, and recorded copies are detached from the caller's objects.
 *
 * @see ../../../docs/spec/operations.md (ACC-001 units stay identifiable; ACC-003 report identity)
 * @see ../../../docs/spec/architecture.md (ARC-001 Resource Accounting)
 */
import { describe, expect, test } from '@jest/globals';

import type { IUsageAttribution, IUsageEstimate, IUsageIntent, IUsageQuantity, IUsageReport } from '../src/contracts.js';
import { estimateArgument, intentArgument, quantitiesArgument, queryArgument, reportArgument } from '../src/validation.js';

/** A well-formed attribution for a member's step attempt. */
const attribution: IUsageAttribution = { run: 'run-1', member: 'ada', stepAttempt: 'attempt-7' };

/** A well-formed intent. */
const intent: IUsageIntent = { environment: 'production', operation: 'op-1', request: 'req-1', attribution };

/** A well-formed report. */
const report: IUsageReport = {
  environment: 'production',
  operation: 'op-1',
  request: 'req-1',
  report: 'usage-1',
  quantities: [{ unit: 'tokens.output', amount: 20 }, { unit: 'tokens.input', amount: 100 }],
};

/** A well-formed estimate. */
const estimate: IUsageEstimate = {
  environment: 'production',
  estimate: 'estimate-1',
  attribution,
  quantities: [{ unit: 'usd.micros', amount: 1_500 }],
  basis: { format: 'test.token-pricing', formatVersion: 1, assumptions: { inputRate: 3, cachedInput: 'assumed-uncached' } },
};

/**
 * Pass a deliberately malformed value through a typed parameter. Callers that
 * bypass the types (JavaScript, JSON, a stale build) reach the same runtime
 * boundary, so the boundary is exercised with values the types forbid.
 */
function malformed<T>(value: unknown, accept: (argument: T) => unknown): () => unknown {
  return (): unknown => {
    const result: unknown = Reflect.apply(accept, undefined, [value]);
    return result;
  };
}

describe('intent arguments', () => {
  test('a well-formed intent is copied, not retained', () => {
    const mutableAttribution: { run: string; member: string | null; stepAttempt: string | null } = { run: 'run-1', member: 'ada', stepAttempt: 'attempt-7' };
    const copy = intentArgument({ ...intent, attribution: mutableAttribution });
    mutableAttribution.run = 'run-other';
    expect(copy).toEqual(intent);
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.attribution)).toBe(true);
  });

  test('member and step attempt may be absent owners (null)', () => {
    const copy = intentArgument({ ...intent, attribution: { run: 'run-1', member: null, stepAttempt: null } });
    expect(copy.attribution).toEqual({ run: 'run-1', member: null, stepAttempt: null });
  });

  test.each([
    ['environment', { ...intent, environment: '' }],
    ['operation', { ...intent, operation: '' }],
    ['request', { ...intent, request: 42 }],
    ['run', { ...intent, attribution: { ...attribution, run: '' } }],
    ['member', { ...intent, attribution: { ...attribution, member: '' } }],
    ['stepAttempt', { ...intent, attribution: { ...attribution, stepAttempt: undefined } }],
    ['attribution', { ...intent, attribution: null }],
  ])('a malformed %s is refused', (name, value) => {
    expect(malformed(value, intentArgument)).toThrow(new RegExp(name, 'u'));
    expect(malformed(value, intentArgument)).toThrow(TypeError);
  });
});

describe('quantities', () => {
  test('quantities are returned in unit order as a frozen copy', () => {
    const input: IUsageQuantity[] = [{ unit: 'tokens.output', amount: 20 }, { unit: 'requests', amount: 1 }, { unit: 'tokens.input', amount: 100 }];
    const copy = quantitiesArgument(input, 'quantities');
    input.reverse();
    expect(copy).toEqual([{ unit: 'requests', amount: 1 }, { unit: 'tokens.input', amount: 100 }, { unit: 'tokens.output', amount: 20 }]);
    expect(Object.isFrozen(copy)).toBe(true);
    expect(copy.every((quantity) => Object.isFrozen(quantity))).toBe(true);
  });

  test('an empty list is an explicit observation of no consumption', () => {
    expect(quantitiesArgument([], 'quantities')).toEqual([]);
  });

  test('units are identifiers that may qualify provider, pool or currency', () => {
    const units = ['tokens.input', 'github:graphql-points', 'usd.micros', 'quota_units', 'A1'];
    expect(quantitiesArgument(units.map((unit) => ({ unit, amount: 1 })), 'quantities').map((quantity) => quantity.unit)).toEqual([...units].sort());
  });

  test.each([
    ['a negative amount', [{ unit: 'tokens', amount: -1 }], /amount/u],
    ['a fractional amount', [{ unit: 'tokens', amount: 1.5 }], /amount/u],
    ['a non-finite amount', [{ unit: 'tokens', amount: Number.NaN }], /amount/u],
    ['an unsafe amount', [{ unit: 'tokens', amount: Number.MAX_SAFE_INTEGER + 1 }], /amount/u],
    ['an empty unit', [{ unit: '', amount: 1 }], /unit/u],
    ['a unit starting with a digit', [{ unit: '1tokens', amount: 1 }], /unit/u],
    ['a unit containing a space', [{ unit: 'input tokens', amount: 1 }], /unit/u],
    ['an overlong unit', [{ unit: `t${'x'.repeat(128)}`, amount: 1 }], /unit/u],
    ['a duplicate unit', [{ unit: 'tokens', amount: 1 }, { unit: 'tokens', amount: 2 }], /duplicate unit tokens/u],
    ['a non-array', { tokens: 1 }, /array/u],
  ])('%s is refused', (_label, value, message) => {
    const accept = (argument: readonly IUsageQuantity[]): unknown => quantitiesArgument(argument, 'quantities');
    expect(malformed(value, accept)).toThrow(message);
    expect(malformed(value, accept)).toThrow(TypeError);
  });
});

describe('report arguments', () => {
  test('a report is copied with canonical quantities', () => {
    expect(reportArgument(report)).toEqual({ ...report, quantities: [{ unit: 'tokens.input', amount: 100 }, { unit: 'tokens.output', amount: 20 }] });
  });

  test.each([
    ['report', { ...report, report: '' }],
    ['request', { ...report, request: '' }],
    ['operation', { ...report, operation: null }],
    ['environment', { ...report, environment: '' }],
  ])('a report with a malformed %s is refused', (name, value) => {
    expect(malformed(value, reportArgument)).toThrow(new RegExp(name, 'u'));
  });
});

describe('estimate arguments', () => {
  test('an estimate keeps its basis', () => {
    expect(estimateArgument(estimate)).toEqual(estimate);
  });

  test.each([
    ['estimate', { ...estimate, estimate: '' }],
    ['basis format', { ...estimate, basis: { ...estimate.basis, format: '' } }],
    ['basis formatVersion', { ...estimate, basis: { ...estimate.basis, formatVersion: 0 } }],
    ['basis', { ...estimate, basis: undefined }],
  ])('an estimate with a malformed %s is refused', (name, value) => {
    expect(malformed(value, estimateArgument)).toThrow(new RegExp(name, 'u'));
  });
});

describe('summary queries', () => {
  test('absent filters stay absent and present filters are kept', () => {
    expect(queryArgument({ environment: 'production' })).toEqual({ environment: 'production' });
    expect(queryArgument({ environment: 'production', run: 'run-1', member: 'ada', stepAttempt: 'attempt-7', operation: 'op-1' }))
      .toEqual({ environment: 'production', run: 'run-1', member: 'ada', stepAttempt: 'attempt-7', operation: 'op-1' });
  });

  test.each([
    ['environment', { run: 'run-1' }],
    ['run', { environment: 'production', run: '' }],
    ['operation', { environment: 'production', operation: 7 }],
  ])('a query with a malformed %s is refused', (name, value) => {
    expect(malformed(value, queryArgument)).toThrow(new RegExp(name, 'u'));
  });
});
