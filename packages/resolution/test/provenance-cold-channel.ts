/**
 * Test-only JSON bridge for one dense ordinary cold-listing corpus. JSON is not
 * a general transport for Resolution or Value data: valid sparse/-0/witness
 * evidence stays in direct owner tests and must never inherit this restriction.
 */
import { createHash } from 'node:crypto';
import type { IAddressSegment } from '@microdelta/tracking';

/** A fixture-channel refusal, distinct from production evidence integrity. */
export class ColdChannelError extends Error {
  public constructor(detail: string) { super(`Cold JSON channel refused: ${detail}`); this.name = 'ColdChannelError'; }
}
/** Each bridge artifact is bounded independently of compiler/repository processes. */
const maximumBytes = 1048576;
/** Reject before allocation/emission when an exact raw-JSON byte budget would be exceeded. */
function add(left: number, right: number, cap: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result > cap) { throw new ColdChannelError('output budget'); }
  return result;
}
/** Exact UTF8 byte width of JSON string quoting, including well-formed lone-surrogate escapes. */
function quotedBytes(value: string, cap: number): number {
  let bytes = add(0, 2, cap);
  for (let position = 0; position < value.length; position++) {
    const unit = value.charCodeAt(position);
    if (unit === 34 || unit === 92 || unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13) { bytes = add(bytes, 2, cap); }
    else if (unit < 32) { bytes = add(bytes, 6, cap); }
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(position + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { bytes = add(bytes, 4, cap); position++; } else { bytes = add(bytes, 6, cap); }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) { bytes = add(bytes, 6, cap); }
    else { bytes = add(bytes, unit < 128 ? 1 : unit < 2048 ? 2 : 3, cap); }
  }
  return bytes;
}
/** Own data inspection neither invokes getters nor mistakes absent slots for present undefined. */
function own(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) { throw new ColdChannelError('non-data slot'); }
  return descriptor.value as unknown;
}
/**
 * Check the cold channel's strictly smaller domain and exact raw JSON budget.
 * Mutability flags are not Value meaning; prototypes/order/slots/scalars are.
 */
function jsonBytes(value: unknown, cap: number): number {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > maximumBytes) { throw new ColdChannelError('invalid budget'); }
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (item: unknown, depth: number): number => {
    if (++nodes > 65536 || depth > 64) { throw new ColdChannelError('node/depth budget'); }
    if (typeof item === 'string') { return quotedBytes(item, cap); }
    if (typeof item === 'number' && Number.isSafeInteger(item) && !Object.is(item, -0)) { return add(0, String(item).length, cap); }
    if (typeof item !== 'object' || item === null || seen.has(item)) { throw new ColdChannelError('unsupported scalar or identity'); }
    seen.add(item);
    const array = Array.isArray(item); const prototype: unknown = Object.getPrototypeOf(item);
    if (prototype !== (array ? Array.prototype : Object.prototype)) { throw new ColdChannelError('prototype'); }
    if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') !== undefined || Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON') !== undefined || Object.hasOwn(item, 'toJSON')) { throw new ColdChannelError('toJSON'); }
    const keys = Reflect.ownKeys(item); const visible = Object.keys(item);
    if (keys.length !== visible.length + (array ? 1 : 0) || keys.some((key) => typeof key !== 'string')) { throw new ColdChannelError('hidden/symbol surface'); }
    if (array && (visible.length !== item.length || item.length > cap)) { throw new ColdChannelError('sparse/oversized array'); }
    let result = add(0, 2, cap);
    for (let position = 0; position < visible.length; position++) {
      const key = visible[position]; if (key === undefined || (array && key !== String(position))) { throw new ColdChannelError('extra/noncanonical array slot'); }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) { throw new ColdChannelError('accessor/hidden slot'); }
      if (position > 0) { result = add(result, 1, cap); }
      if (!array) { result = add(result, add(quotedBytes(key, cap), 1, cap), cap); }
      const child: unknown = descriptor.value; result = add(result, visit(child, depth + 1), cap);
    }
    return result;
  };
  return visit(value, 0);
}
/** Compare data after parsing, including exact record order and numeric identity. */
function compare(left: unknown, right: unknown): void {
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    if (!Object.is(left, right)) { throw new ColdChannelError('parsed scalar changed'); } return;
  }
  if (Array.isArray(left) !== Array.isArray(right) || Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) { throw new ColdChannelError('parsed prototype changed'); }
  const first = Reflect.ownKeys(left); const second = Reflect.ownKeys(right);
  if (first.length !== second.length || first.some((key, position) => key !== second[position])) { throw new ColdChannelError('parsed own order/slots changed'); }
  for (const key of first) { compare(own(left, key), own(right, key)); }
}
/** Prove parsing did not change any Value-relevant property of this cold tree. */
export function _sameColdTree(left: unknown, right: unknown): void { jsonBytes(left, maximumBytes); jsonBytes(right, maximumBytes); compare(left, right); }
/** Serialize only after preflight; postparse equality is checked before returning emitted text. */
export function _coldJson(value: unknown, cap = maximumBytes): string {
  const bytes = jsonBytes(value, cap); const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded) !== bytes || bytes > cap) { throw new ColdChannelError('serialization budget/width mismatch'); }
  const parsed: unknown = JSON.parse(encoded); _sameColdTree(value, parsed); return encoded;
}
/** A copied address avoids introducing shared container identity into a fixture tree. */
function copied(address: readonly IAddressSegment[]): readonly IAddressSegment[] { return address.map((segment) => ({ ...segment })); }
/** SHA256 checks retain the actual encoded fixture facts rather than trusting a declared count. */
function digest(encoded: string): string { return createHash('sha256').update(encoded).digest('hex'); }
/**
 * Recognize only the already proved ordinary cold source shape. These fixed
 * scalar fixture spellings are not a second general Value encoder; generated
 * Value remains the independent transport oracle in the assembly experiment.
 */
export function _assertColdCorpus(value: unknown, n: number): void {
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) { throw new ColdChannelError('population'); }
  jsonBytes(value, maximumBytes);
  if (typeof value !== 'object' || value === null) { throw new ColdChannelError('content'); }
  const observations = own(value, 'observations');
  if (!Array.isArray(observations) || observations.length !== 4 * n + 3) { throw new ColdChannelError('observation count'); }
  const first: unknown = own(observations, '0');
  if (typeof first !== 'object' || first === null) { throw new ColdChannelError('implementation'); }
  const encoded = own(first, 'encoded');
  if (typeof encoded !== 'string' || !/^MDF1\|[0-9a-f]{64}$/u.test(encoded)) { throw new ColdChannelError('implementation encoding'); }
  const expected: unknown[] = [{ binding: { path: ['self'] }, address: [], selection: { kind: 'implementation', address: [], encodingVersion: 'MDF1' }, kind: 'implementation', operation: 'implementation', encodingVersion: 'MDF1', encoded, fingerprint: digest(encoded) }];
  const fact = (address: readonly IAddressSegment[], operation: string, scalar: string | number): void => {
    const path = address.map((segment) => segment.kind === 'property' ? ['property', segment.key] : ['index', segment.index]);
    const text = 'MDO1|' + JSON.stringify([operation, path, 'MDV1|' + JSON.stringify([typeof scalar === 'string' ? 's' : 'd', String(scalar)])]);
    expected.push({ binding: { path: ['inputs'] }, address: copied(address), selection: { kind: 'selected', operation, address: copied(address), encodingVersion: 'MDO1' }, kind: 'fact', operation, encodingVersion: 'MDO1', encoded: text, fingerprint: digest(text) });
  };
  const rows: IAddressSegment = { kind: 'property', key: 'rows' };
  fact([rows], 'container-kind', 'array'); fact([rows], 'length', n);
  for (let position = 0; position < n; position++) {
    const at: readonly IAddressSegment[] = [rows, { kind: 'index', index: position }];
    fact(at, 'container-kind', 'record');
    fact([...at, { kind: 'property', key: 'key' }], 'value', `acme/widget#${String(position + 1)}`);
    fact([...at, { kind: 'property', key: 'score' }], 'value', position + 1);
    fact([...at, { kind: 'property', key: 'unread' }], 'value', 'baseline');
  }
  _sameColdTree(value, { trackingSemantics: 2, kind: 'source', step: { scope: 'test5-selected-read', role: 'step', slot: 'listing' }, observations: expected, children: [] });
}
