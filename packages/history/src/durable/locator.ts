/**
 * Exact completed-result locators of the durable authority (RES-002). A
 * locator names one immutable result together with the logical store,
 * analysis and environment that scope it, so resolution never guesses the
 * current environment and never consults a current pointer. The grammar is
 * versioned and canonical: `mdh1|` followed by the JSON array
 * `[logicalStore, analysis, environment, resultId]`. Any other text, including
 * a noncanonical spelling of the same components, is an integrity failure.
 * @packageDocumentation
 */
import type { ICompletedResultReference } from '../completed-results.js';
import { HistoryIntegrityError } from './errors.js';

/** The only locator grammar version this implementation issues or accepts. */
const locatorPrefix = 'mdh1|';

/** The decoded components of one exact locator. */
export interface ILocatorParts {
  /** The logical store that issued the result. */
  readonly logicalStore: string;
  /** The analysis scoping the result. */
  readonly analysis: string;
  /** The environment scoping the result. */
  readonly environment: string;
  /** The store-wide result identity, equal to its producing attempt identity. */
  readonly resultId: number;
}

/** Issue the frozen exact reference for one result. */
export function referenceFor(parts: ILocatorParts): ICompletedResultReference {
  const locator = `${locatorPrefix}${JSON.stringify([parts.logicalStore, parts.analysis, parts.environment, parts.resultId])}`;
  return Object.freeze({ kind: 'completed-result', locator });
}

/** Whether a decoded component is a non-empty string. */
function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Decode an exact reference. The reference must be a completed-result
 * reference whose locator uses this grammar exactly; the caller then checks
 * the components against the store and its rows.
 */
export function parseReference(reference: unknown): ILocatorParts {
  if (typeof reference !== 'object' || reference === null) {
    throw new HistoryIntegrityError('A completed-result reference must be an object');
  }
  const kind: unknown = Reflect.get(reference, 'kind');
  const locator: unknown = Reflect.get(reference, 'locator');
  if (kind !== 'completed-result' || typeof locator !== 'string') {
    throw new HistoryIntegrityError('A completed-result reference needs kind "completed-result" and a string locator');
  }
  if (!locator.startsWith(locatorPrefix)) {
    throw new HistoryIntegrityError(`Unsupported completed-result locator grammar: ${JSON.stringify(locator.slice(0, 8))}`);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(locator.slice(locatorPrefix.length));
  } catch {
    throw new HistoryIntegrityError('Malformed completed-result locator');
  }
  if (!Array.isArray(decoded) || decoded.length !== 4) {
    throw new HistoryIntegrityError('Malformed completed-result locator');
  }
  const [logicalStore, analysis, environment, resultId] = decoded as readonly unknown[];
  if (!isName(logicalStore) || !isName(analysis) || !isName(environment) || typeof resultId !== 'number' || !Number.isSafeInteger(resultId) || resultId <= 0) {
    throw new HistoryIntegrityError('Malformed completed-result locator components');
  }
  const parts: ILocatorParts = { logicalStore, analysis, environment, resultId };
  if (referenceFor(parts).locator !== locator) {
    throw new HistoryIntegrityError('Noncanonical completed-result locator');
  }
  return parts;
}
