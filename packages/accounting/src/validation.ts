/**
 * Boundary validation for Accounting's port arguments. Every argument is
 * checked and copied before storage is touched, so a malformed call fails with
 * `TypeError` and records nothing, and later mutation of a caller's object
 * cannot change a recorded fact. Quantity lists are returned in unit order so
 * equal facts have one canonical form. Validation decides only shape; whether
 * a fact is attributable or conflicts with recorded facts is decided against
 * storage.
 * @packageDocumentation
 */
import type {
  IEstimateBasis,
  IUsageAttribution,
  IUsageEstimate,
  IUsageIntent,
  IUsageQuantity,
  IUsageQuery,
  IUsageReport,
} from './contracts.js';

/**
 * A unit is an identifier naming a kind of quantity, never a value: a letter,
 * then letters, digits, `.`, `_`, `:` or `-`, at most 128 characters. The
 * grammar keeps units safe to show in summaries and events.
 */
const unitPattern = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;

/** Read a named field of an argument that may not be an object at runtime. */
function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined;
}

/** Require a non-empty string identity. */
export function requireIdentity(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

/** Require a non-empty string identity or `null` for an absent owner. */
function nullableIdentity(value: unknown, name: string): string | null {
  return value === null ? null : requireIdentity(value, `${name} (or null)`);
}

/** Require a positive safe integer. */
function requirePositive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

/** Validate and copy an attribution. */
function attributionArgument(value: unknown): IUsageAttribution {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('attribution must be an object naming run, member and stepAttempt');
  }
  return Object.freeze({
    run: requireIdentity(field(value, 'run'), 'attribution run'),
    member: nullableIdentity(field(value, 'member'), 'attribution member'),
    stepAttempt: nullableIdentity(field(value, 'stepAttempt'), 'attribution stepAttempt'),
  });
}

/** Validate a quantity list and return a frozen copy in unit order. */
export function quantitiesArgument(value: readonly IUsageQuantity[], name: string): readonly IUsageQuantity[] {
  return quantitiesFrom(value, name);
}

/** Validate a candidate quantity list that may not be an array at runtime. */
function quantitiesFrom(candidate: unknown, name: string): readonly IUsageQuantity[] {
  if (!Array.isArray(candidate)) {
    throw new TypeError(`${name} must be an array of { unit, amount }`);
  }
  const quantities = candidate.map((entry: unknown, index): IUsageQuantity => {
    const unit = field(entry, 'unit');
    const amount = field(entry, 'amount');
    if (typeof unit !== 'string' || !unitPattern.test(unit)) {
      throw new TypeError(`${name}[${String(index)}] unit must be an identifier of at most 128 characters`);
    }
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError(`${name}[${String(index)}] amount must be a nonnegative safe integer`);
    }
    return Object.freeze({ unit, amount });
  });
  quantities.sort((left, right) => (left.unit < right.unit ? -1 : left.unit > right.unit ? 1 : 0));
  for (let index = 1; index < quantities.length; index += 1) {
    const unit = quantities[index]?.unit;
    if (unit !== undefined && unit === quantities[index - 1]?.unit) {
      throw new TypeError(`${name} has a duplicate unit ${unit}; report one amount per unit`);
    }
  }
  return Object.freeze(quantities);
}

/** Validate and copy an intent. */
export function intentArgument(value: IUsageIntent): IUsageIntent {
  return Object.freeze({
    environment: requireIdentity(field(value, 'environment'), 'environment'),
    operation: requireIdentity(field(value, 'operation'), 'operation'),
    request: requireIdentity(field(value, 'request'), 'request'),
    attribution: attributionArgument(field(value, 'attribution')),
  });
}

/** Validate and copy a usage report, with quantities in unit order. */
export function reportArgument(value: IUsageReport): IUsageReport {
  return Object.freeze({
    environment: requireIdentity(field(value, 'environment'), 'environment'),
    operation: requireIdentity(field(value, 'operation'), 'operation'),
    request: requireIdentity(field(value, 'request'), 'request'),
    report: requireIdentity(field(value, 'report'), 'report'),
    quantities: quantitiesFrom(field(value, 'quantities'), 'quantities'),
  });
}

/** Validate an estimate basis's version tag; its assumptions are encoded by Value. */
function basisArgument(value: unknown): IEstimateBasis {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('basis must be an object with format, formatVersion and assumptions');
  }
  return {
    format: requireIdentity(field(value, 'format'), 'basis format'),
    formatVersion: requirePositive(field(value, 'formatVersion'), 'basis formatVersion'),
    assumptions: field(value, 'assumptions'),
  };
}

/** Validate and copy an estimate, with quantities in unit order. */
export function estimateArgument(value: IUsageEstimate): IUsageEstimate {
  return Object.freeze({
    environment: requireIdentity(field(value, 'environment'), 'environment'),
    estimate: requireIdentity(field(value, 'estimate'), 'estimate'),
    attribution: attributionArgument(field(value, 'attribution')),
    quantities: quantitiesFrom(field(value, 'quantities'), 'quantities'),
    basis: basisArgument(field(value, 'basis')),
  });
}

/** Validate and copy a summary query, keeping only present filters. */
export function queryArgument(value: IUsageQuery): IUsageQuery {
  const environment = requireIdentity(field(value, 'environment'), 'environment');
  const filter = (name: 'run' | 'member' | 'stepAttempt' | 'operation'): string | undefined => {
    const candidate = field(value, name);
    return candidate === undefined ? undefined : requireIdentity(candidate, `${name} filter`);
  };
  const run = filter('run');
  const member = filter('member');
  const stepAttempt = filter('stepAttempt');
  const operation = filter('operation');
  return Object.freeze({
    environment,
    ...(run === undefined ? {} : { run }),
    ...(member === undefined ? {} : { member }),
    ...(stepAttempt === undefined ? {} : { stepAttempt }),
    ...(operation === undefined ? {} : { operation }),
  });
}
