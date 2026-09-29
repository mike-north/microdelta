/**
 * EXP-4's plain value grammar. Every observed fact, derived argument and step
 * output is JSON-like data compared through one canonical text form. This is
 * fixture infrastructure for the nested-argument mechanisms, not EXP-2's
 * selected value encoding: record key order is not semantic (COL-3), array
 * order is, and there is no hashing, lazy navigation or selected loading.
 */

/** A finite scalar; `-0` and non-finite numbers have no stable canonical text. @internal */
export type IScalar = string | number | boolean | null;

/** Plain JSON-like data: scalars, ordered arrays and string-keyed records. @internal */
export type IData = IScalar | readonly IData[] | { readonly [field: string]: IData };

/** One navigation step: a record field or an array index. @internal */
export type IPathSegment = string | number;

/** A binding path; its first segment names the binding family the frame resolves. @internal */
export type IPath = readonly IPathSegment[];

/** Navigation reports absence explicitly so presence itself can be observed. @internal */
export type ILookup = { readonly found: true; readonly value: IData } | { readonly found: false };

/**
 * Decide whether a value belongs to the bounded grammar. Accessors, symbols,
 * non-plain prototypes, functions and `undefined` are outside it; a function is
 * therefore never mistaken for reconstructible data.
 * @internal
 */
export function isData(value: unknown): value is IData {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.every(isData);
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return false;
  }
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string')) {
    return false;
  }
  return Object.values(Object.getOwnPropertyDescriptors(value))
    .every(property => 'value' in property && isData(property.value));
}

/** Narrow data to an ordered list without widening through `any`. @internal */
export function isList(value: IData): value is readonly IData[] {
  return Array.isArray(value);
}

/** Records are rebuilt with sorted keys so insertion order never reaches a fact. */
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

/** The canonical text of a successful `undefined` output; it is not valid JSON, so no data encodes to it. */
const undefinedText = 'undefined';

/**
 * Canonical text for data or a successful `undefined` output. Equal text means
 * equal fact; it is the fixture's comparison and digest input (VAL-2's SHA-256
 * digest is deliberately not reproduced here).
 * @internal
 */
export function encode(value: IData | undefined): string {
  return value === undefined ? undefinedText : JSON.stringify(sorted(value));
}

/** Parse canonical text written by `encode`, rejecting anything outside the grammar. @internal */
export function decode(text: string): IData | undefined {
  if (text === undefinedText) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(text);
  if (!isData(parsed)) {
    throw new TypeError('EXP-4 canonical text does not decode to plain data');
  }
  return parsed;
}

/** Follow own record fields and in-range array indexes only; inherited members are never data. @internal */
export function lookup(root: IData, path: IPath): ILookup {
  let current: IData = root;
  for (const segment of path) {
    if (isList(current)) {
      const item = typeof segment === 'number' ? current[segment] : undefined;
      if (item === undefined) {
        return { found: false };
      }
      current = item;
      continue;
    }
    if (current === null || typeof current !== 'object' || typeof segment !== 'string') {
      return { found: false };
    }
    const record: { readonly [field: string]: IData } = current;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) {
      return { found: false };
    }
    const field = record[segment];
    if (field === undefined) {
      return { found: false };
    }
    current = field;
  }
  return { found: true, value: current };
}
