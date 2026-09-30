/**
 * EXP-8's plain value grammar for request bindings, provider bodies and step
 * outputs. It is fixture infrastructure only: bindings are compared through a
 * canonical text form to decide whether a call is the same logical operation
 * (RUN-012). It is not EXP-2's selected value encoding and has no hashing.
 */

/** A finite scalar. @internal */
export type IScalar = string | number | boolean | null;

/** Plain JSON-like data: scalars, ordered arrays and string-keyed records. @internal */
export type IData = IScalar | readonly IData[] | { readonly [field: string]: IData };

/**
 * Decide whether an untrusted value (for example, parsed fixture JSON) belongs
 * to the grammar. Functions, `undefined` and non-plain objects are outside it.
 * @internal
 */
export function isData(value: unknown): value is IData {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.every(isData);
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  return Object.values(value).every(isData);
}

/** Narrow data to an ordered list; `Array.isArray` alone does not narrow readonly arrays. */
function isList(value: IData): value is readonly IData[] {
  return Array.isArray(value);
}

/** Records are rebuilt with sorted keys so insertion order never changes a binding's identity. */
function sorted(value: IData): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (isList(value)) {
    return value.map(sorted);
  }
  const record: { readonly [field: string]: IData } = value;
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, sorted(record[key] ?? null)]));
}

/**
 * Canonical text of a value. Equal text means an equivalent request binding.
 * The text is durable operation-addressing evidence; it is never placed in an
 * event (events carry identifiers only).
 * @internal
 */
export function canonical(value: IData): string {
  return JSON.stringify(sorted(value));
}
