/** Independent bounded provenance length analysis; never constructs a canonical wire tree. @packageDocumentation */

/** @internal Canonical transport lengths; UTF-8 bytes and UTF-16 code units remain distinct. */
export interface ILengths { readonly utf16: number; readonly utf8: number }

/** @internal Add nonnegative exact quantities, refusing silently rounded evidence. */
export function exactAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0 || !Number.isSafeInteger(left + right)) {
    throw new Error('unsafe length arithmetic');
  }
  return left + right;
}

/** Combine independent fragments without allocating their concatenation. */
function plus(left: ILengths, right: ILengths): ILengths {
  return { utf16: exactAdd(left.utf16, right.utf16), utf8: exactAdd(left.utf8, right.utf8) };
}

/** Literal grammar scaffolding is ASCII, so both units coincide. */
function ascii(length: number): ILengths { return { utf16: length, utf8: length }; }

/** JSON string quoting, including well-formed lone-surrogate escaping, without JSON text allocation. */
function quoted(value: string): ILengths {
  let result = ascii(2);
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 34 || unit === 92 || [8, 9, 10, 12, 13].includes(unit)) {
      result = plus(result, ascii(2));
    } else if (unit < 32) {
      result = plus(result, ascii(6));
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result = plus(result, { utf16: 2, utf8: 4 }); index++;
      } else {
        result = plus(result, ascii(6));
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      result = plus(result, ascii(6));
    } else {
      result = plus(result, { utf16: 1, utf8: unit < 128 ? 1 : unit < 2048 ? 2 : 3 });
    }
  }
  return result;
}

/** @internal Sum inclusive nonnegative decimal-width groups; no population is materialized. */
export function digitSum(start: number, end: number): number {
  exactAdd(start, end);
  if (start > end) { throw new Error('reversed decimal range'); }
  let total = 0;
  let lower = 0;
  for (let width = 1; width <= 16; width++) {
    const upper = Math.min(Number.MAX_SAFE_INTEGER, 10 ** width - 1);
    const count = Math.max(0, Math.min(end, upper) - Math.max(start, lower) + 1);
    total = exactAdd(total, count * width);
    if (end <= upper) { return total; }
    lower = upper + 1;
  }
  throw new Error('unsupported decimal range');
}

/**
 * @internal Count MDS1 for only the selected provenance domain: ordinary/null-prototype
 * records, dense ordinary arrays, strings and finite safe integers. Shared identity,
 * exotic surfaces and other Value features reject rather than broadening this experiment
 * into a second codec. Record order follows actual own keys; no wire tree is constructed.
 */
export function snapshotLengths(value: unknown): ILengths {
  const seen = new WeakSet<object>();
  const visit = (item: unknown): ILengths => {
    if (typeof item === 'string') { return plus(ascii(6), quoted(item)); }
    if (typeof item === 'number' && Number.isSafeInteger(item)) {
      return plus(ascii(6), quoted(Object.is(item, -0) ? '-0' : String(item)));
    }
    if (typeof item !== 'object' || item === null || seen.has(item)) { throw new Error('unsupported provenance domain'); }
    seen.add(item);
    const prototype: unknown = Object.getPrototypeOf(item);
    const array = Array.isArray(item);
    if (array ? prototype !== Array.prototype : prototype !== null && prototype !== Object.prototype) { throw new Error('unsupported prototype'); }
    const keys = Reflect.ownKeys(item);
    const entries: readonly string[] = Object.keys(item);
    if (keys.some((key) => typeof key !== 'string') || keys.length !== entries.length + (array ? 1 : 0)) { throw new Error('unsupported surface'); }
    let result = ascii(array ? '["a",['.length + ']]'.length : '["o",['.length + (prototype === null ? '],["p-null"]]' : '],["p-object"]]').length);
    if (array && entries.length !== item.length) { throw new Error('sparse array'); }
    for (let index = 0; index < entries.length; index++) {
      const key = entries[index];
      if (key === undefined || (array && key !== String(index))) { throw new Error('extra array property'); }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor === undefined || !('value' in descriptor)) { throw new Error('accessor'); }
      const child: unknown = descriptor.value;
      if (index > 0) { result = plus(result, ascii(1)); }
      if (!array) { result = plus(result, plus(ascii(3), quoted(key))); }
      result = plus(result, visit(child));
    }
    return result;
  };
  return plus(ascii(5), visit(value));
}
