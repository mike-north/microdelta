/**
 * Value Semantics defines canonical values, structured addresses, and selected
 * observation facts without deciding which evidence Tracking captures or
 * whether a retained result may be reused.
 * @packageDocumentation
 */

import type { ISha256Capability } from '@microdelta/machine';

/** Canonical wire versions fail closed rather than guessing a migration. */
const VALUE_VERSION = 'MDV1|';
/** Snapshot transport keeps order that a later explicit keys read could consume. */
const SNAPSHOT_VERSION = 'MDS1|';
/** Observation evidence binds one operation and address to its selected fact. */
const OBSERVATION_VERSION = 'MDO1|';
/** Explicit prototype chains are bounded so lookup meaning stays inspectable. */
const MAX_CUSTOM_PROTOTYPES = 2;

/** @alpha A path segment whose kind follows the container's operation semantics. */
export type IAddressSegment =
  /** A literal string-keyed record lookup, including keys containing punctuation. */
  | { readonly kind: 'property'; readonly key: string }
  /** A positional array lookup; it does not designate a logical member identity. */
  | { readonly kind: 'index'; readonly index: number };

/** @alpha A supported JavaScript observation operation with its own fact meaning. */
export type IOperation = 'value' | 'own' | 'membership' | 'length' | 'keys';

/**
 * One immediate lookup result for a caller-supplied root, address, and
 * operation. The fact may be the selected object reference itself, so it is
 * neither a detached snapshot nor retained Tracking evidence. Tracking adds
 * binding and capture relationships and decides what data to encode as evidence.
 * @alpha
 */
export interface ISelectedFact {
  /** The literal access whose result was selected. */
  readonly operation: IOperation;
  /** Ordered container-aware steps from the supplied root to the selected location. */
  readonly address: readonly IAddressSegment[];
  /** The selected value or structural fact; an object value remains the source reference. */
  readonly fact: unknown;
}

/** Reject unsupported data with a location instead of JSON-style omission. */
function unsupported(path: string, reason: string): never {
  throw new TypeError(`Unsupported value at ${path}: ${reason}`);
}

/** Own descriptors distinguish data from accessors without executing getters. */
function ownData(record: object, key: string, path: string): { readonly present: boolean; readonly value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    return { present: false, value: undefined };
  }
  if (!('value' in descriptor)) {
    unsupported(path, 'accessor');
  }
  const value: unknown = descriptor.value;
  return { present: true, value };
}

/** Sort keys by UTF-16 code-unit order, independent of insertion history. */
function sortedKeys(record: object): string[] {
  return Object.keys(record).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

/** A canonical index cannot name an arbitrary extra property on an array. */
function isArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) {
    return false;
  }
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

/** Check a record's supported own surface before reading its values. */
function assertRecordSurface(record: object, path: string): void {
  if (Object.getOwnPropertySymbols(record).length !== 0) {
    unsupported(path, 'user symbol key');
  }
  for (const key of Object.getOwnPropertyNames(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      unsupported(`${path}.${key}`, 'nonenumerable or accessor property');
    }
  }
}

/** Validate an array's observable shape without reading any element payload. */
function assertArraySurface(array: unknown[], path: string): void {
  if (Object.getPrototypeOf(array) !== Array.prototype) {
    unsupported(path, 'array prototype');
  }
  if (Object.getOwnPropertySymbols(array).length !== 0) {
    unsupported(path, 'user symbol key');
  }
  for (const key of Object.getOwnPropertyNames(array)) {
    if (key === 'length') {
      continue;
    }
    if (!isArrayIndex(key, array.length)) {
      unsupported(`${path}[${key}]`, 'extra or noncanonical array property');
    }
    const descriptor = Object.getOwnPropertyDescriptor(array, key);
    if (descriptor?.enumerable !== true || !('value' in descriptor)) {
      unsupported(`${path}[${key}]`, 'hidden or accessor array slot');
    }
  }
}

/** Check the prototype domain without opening unread own data values. */
function assertRecordChain(record: object, path: string, depth = 0): void {
  if (depth > MAX_CUSTOM_PROTOTYPES) {
    unsupported(path, 'prototype depth');
  }
  assertRecordSurface(record, path);
  const prototype: unknown = Object.getPrototypeOf(record);
  if (prototype === null || prototype === Object.prototype) {
    return;
  }
  if (typeof prototype !== 'object' || Array.isArray(prototype)) {
    unsupported(path, 'custom prototype');
  }
  assertRecordChain(prototype, `${path}[[Prototype]]`, depth + 1);
}

/** Serialize numbers without JSON's null coercion or loss of negative zero. */
function numberToken(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (value === Infinity) {
    return '+Infinity';
  }
  if (value === -Infinity) {
    return '-Infinity';
  }
  if (Object.is(value, -0)) {
    return '-0';
  }
  return String(value);
}

/** Encode only the declared JSON-like domain and its bounded prototype chain. */
function toWire(value: unknown, path: string, seen: WeakSet<object>, prototypeDepth: number, preserveOrder: boolean): unknown {
  if (value === undefined) {
    return ['u'];
  }
  if (value === null) {
    return ['n'];
  }
  if (typeof value === 'boolean') {
    return [value ? 't' : 'f'];
  }
  if (typeof value === 'string') {
    return ['s', value];
  }
  if (typeof value === 'number') {
    return ['d', numberToken(value)];
  }
  if (typeof value !== 'object') {
    unsupported(path, typeof value);
  }
  if (seen.has(value)) {
    unsupported(path, 'cycle or shared reference');
  }
  seen.add(value);
  if (Array.isArray(value)) {
    assertArraySurface(value, path);
    const entries: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const slot = ownData(value, String(index), `${path}[${index}]`);
      if (slot.present) {
        entries.push(toWire(slot.value, `${path}[${index}]`, seen, prototypeDepth, preserveOrder));
      } else {
        entries.push(['h']);
      }
    }
    return ['a', entries];
  }
  assertRecordSurface(value, path);
  const prototype: unknown = Object.getPrototypeOf(value);
  let prototypeWire: unknown;
  if (prototype === null) {
    prototypeWire = ['p-null'];
  } else if (prototype === Object.prototype) {
    prototypeWire = ['p-object'];
  } else {
    if (Array.isArray(prototype)) {
      unsupported(path, 'array prototype for record');
    }
    if (prototypeDepth >= MAX_CUSTOM_PROTOTYPES) {
      unsupported(path, 'prototype depth');
    }
    prototypeWire = ['p-custom', toWire(prototype, `${path}[[Prototype]]`, seen, prototypeDepth + 1, preserveOrder)];
  }
  const keys = preserveOrder ? Object.keys(value) : sortedKeys(value);
  const entries = keys.map((key): readonly [string, unknown] => {
    const property = ownData(value, key, `${path}.${key}`);
    return [key, toWire(property.value, `${path}.${key}`, seen, prototypeDepth, preserveOrder)];
  });
  return ['o', entries, prototypeWire];
}

/** Normalized value evidence ignores dictionary insertion order. */
/** @alpha Encode supported data as versioned, key-order-independent equality input. */
export function encodeValue(value: unknown): string {
  return `${VALUE_VERSION}${JSON.stringify(toWire(value, '$', new WeakSet(), 0, false))}`;
}

/** Preserve a snapshot's observable record order across process boundaries. */
/** @alpha Encode a detached snapshot while preserving observable record key order. */
export function encodeSnapshot(value: unknown): string {
  return `${SNAPSHOT_VERSION}${JSON.stringify(toWire(value, '$', new WeakSet(), 0, true))}`;
}

/** Restore an immutable snapshot without normalizing its key enumeration order. */
/** @alpha Restore and freeze a snapshot while retaining supported lookup meaning. */
export function decodeSnapshot(encoded: string): unknown {
  return decodeCanonical(encoded, SNAPSHOT_VERSION, encodeSnapshot);
}

/** Narrow a parsed JSON node without accepting arbitrary unvalidated shapes. */
function arrayNode(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    unsupported(path, 'malformed wire node');
  }
  return value;
}

/** Decode a canonical node, rejecting duplicate keys before construction. */
function fromWire(raw: unknown, path: string): unknown {
  const node = arrayNode(raw, path);
  const tag = node[0];
  if (tag === 'u' && node.length === 1) {
    return undefined;
  }
  if (tag === 'n' && node.length === 1) {
    return null;
  }
  if (tag === 't' && node.length === 1) {
    return true;
  }
  if (tag === 'f' && node.length === 1) {
    return false;
  }
  if (tag === 's' && node.length === 2 && typeof node[1] === 'string') {
    return node[1];
  }
  if (tag === 'd' && node.length === 2 && typeof node[1] === 'string') {
    switch (node[1]) {
      case 'NaN': return Number.NaN;
      case '+Infinity': return Infinity;
      case '-Infinity': return -Infinity;
      case '-0': return -0;
      default: {
        const number = Number(node[1]);
        if (Number.isFinite(number) && numberToken(number) === node[1]) {
          return number;
        }
      }
    }
  }
  if (tag === 'a' && node.length === 2) {
    const rawEntries = arrayNode(node[1], path);
    const array = new Array<unknown>(rawEntries.length);
    rawEntries.forEach((entry, index) => {
      const slot = arrayNode(entry, `${path}[${index}]`);
      if (slot.length === 1 && slot[0] === 'h') {
        return;
      }
      array[index] = fromWire(entry, `${path}[${index}]`);
    });
    return array;
  }
  if (tag === 'o' && node.length === 3) {
    const rawPrototype = arrayNode(node[2], path);
    let prototype: object | null;
    if (rawPrototype.length === 1 && rawPrototype[0] === 'p-null') {
      prototype = null;
    } else if (rawPrototype.length === 1 && rawPrototype[0] === 'p-object') {
      prototype = Object.prototype as object;
    } else if (rawPrototype.length === 2 && rawPrototype[0] === 'p-custom') {
      const candidate = fromWire(rawPrototype[1], `${path}[[Prototype]]`);
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
        unsupported(path, 'malformed prototype');
      }
      prototype = candidate;
    } else {
      unsupported(path, 'malformed prototype');
    }
    const rawEntries = arrayNode(node[1], path);
    const entries: Array<readonly [string, unknown]> = rawEntries.map((entry, index) => {
      const pair = arrayNode(entry, `${path}[${index}]`);
      if (pair.length !== 2 || typeof pair[0] !== 'string') {
        unsupported(path, 'malformed record entry');
      }
      return [pair[0], fromWire(pair[1], `${path}.${pair[0]}`)];
    });
    return recordFromEntries(entries, prototype);
  }
  unsupported(path, 'malformed or unsupported wire tag');
}

/** Freeze only decoded nodes, never the shared intrinsic prototype. */
function freezeSnapshot(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (Array.isArray(value) && key === 'length') {
      continue;
    }
    const child = ownData(value, key, key);
    freezeSnapshot(child.value);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype && prototype !== Array.prototype) {
    freezeSnapshot(prototype);
  }
  Object.freeze(value);
}

/** Decode one versioned grammar and reject any noncanonical or lossy input. */
function decodeCanonical(encoded: string, version: string, reencode: (value: unknown) => string): unknown {
  if (!encoded.startsWith(version)) {
    throw new TypeError('Unsupported canonical format version');
  }
  const raw: unknown = JSON.parse(encoded.slice(version.length));
  const decoded = fromWire(raw, '$');
  if (reencode(decoded) !== encoded) {
    throw new TypeError('Unsupported noncanonical value encoding');
  }
  freezeSnapshot(decoded);
  return decoded;
}

/** Decode an unordered equality normal form; use snapshot transport for later keys reads. */
/** @alpha Decode and freeze the normalized equality form for validation or comparison. */
export function decodeValue(encoded: string): unknown {
  return decodeCanonical(encoded, VALUE_VERSION, encodeValue);
}

/** Construct plain data records without losing a duplicate input key. */
/** @alpha Construct a record from entries while rejecting duplicate keys explicitly. */
export function recordFromEntries(entries: readonly (readonly [string, unknown])[], prototype: object | null): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  Object.setPrototypeOf(record, prototype);
  const keys = new Set<string>();
  for (const [key, value] of entries) {
    if (keys.has(key)) {
      throw new TypeError(`Duplicate record key: ${key}`);
    }
    keys.add(key);
    Object.defineProperty(record, key, { value, writable: true, enumerable: true, configurable: true });
  }
  return record;
}

/** Resolve one supported own or inherited data lookup without invoking getters. */
function lookup(record: object, key: string, depth = 0): { readonly present: boolean; readonly own: boolean; readonly value: unknown } {
  assertRecordSurface(record, key);
  if (depth > MAX_CUSTOM_PROTOTYPES) {
    unsupported(key, 'prototype depth');
  }
  const own = ownData(record, key, key);
  if (own.present) {
    return { present: true, own: true, value: own.value };
  }
  const prototype: unknown = Object.getPrototypeOf(record);
  if (prototype === null) {
    return { present: false, own: false, value: undefined };
  }
  if (prototype === Object.prototype) {
    if (Object.prototype.hasOwnProperty.call(Object.prototype, key)) {
      unsupported(key, 'intrinsic inherited data');
    }
    return { present: false, own: false, value: undefined };
  }
  if (typeof prototype !== 'object') {
    unsupported(key, 'prototype');
  }
  const inherited = lookup(prototype, key, depth + 1);
  return { present: inherited.present, own: false, value: inherited.value };
}

/** Observe exactly the requested fact; no sibling or whole-tree read is implied. */
/**
 * Compute one literal supported fact without traversing unrelated descendants
 * or capturing run/binding context. A value operation may return a navigable
 * object reference; Tracking decides which consumed or materialized facts to
 * encode as retained evidence.
 * @alpha
 */
export function observe(root: unknown, address: readonly IAddressSegment[], operation: IOperation): ISelectedFact {
  if (operation === 'length' || operation === 'keys') {
    let target = root;
    for (const segment of address) {
      target = observe(target, [segment], 'value').fact;
    }
    if (operation === 'length') {
      if (!Array.isArray(target)) {
        unsupported('$', 'length needs an array');
      }
      assertArraySurface(target, '$');
      return { operation, address, fact: target.length };
    }
    if (target === null || typeof target !== 'object' || Array.isArray(target)) {
      unsupported('$', 'keys needs a record');
    }
    assertRecordChain(target, '$');
    return { operation, address, fact: Object.keys(target) };
  }
  if (address.length === 0) {
    unsupported('$', 'member operation needs an address');
  }
  let parent = root;
  for (const segment of address.slice(0, -1)) {
    parent = observe(parent, [segment], 'value').fact;
  }
  const last = address[address.length - 1];
  if (last === undefined) {
    unsupported('$', 'missing address');
  }
  if (last.kind === 'index') {
    if (!Array.isArray(parent) || !Number.isSafeInteger(last.index) || last.index < 0) {
      unsupported('$', 'index needs array and nonnegative integer');
    }
    assertArraySurface(parent, '$');
    const selected = ownData(parent, String(last.index), '$');
    const fact = operation === 'value' ? selected.value : selected.present;
    return { operation, address, fact };
  }
  if (parent === null || typeof parent !== 'object' || Array.isArray(parent)) {
    unsupported('$', 'property needs record');
  }
  assertRecordChain(parent, '$');
  const selected = lookup(parent, last.key);
  const fact = operation === 'value' ? selected.value : operation === 'own' ? selected.own : selected.present;
  return { operation, address, fact };
}

/** Encode operation and structural address independently from the selected fact. */
/**
 * Synchronously encode one supplied fact's operation, structured address, and
 * complete supported value. An object fact is traversed in full here, even if
 * it came from a shallow navigation lookup. Callers must select consumed or
 * materialized facts; passing through a container alone is not evidence that
 * its entire contents were consumed. The MDO1 encoding has no binding or
 * capture provenance; Tracking owns those execution relationships.
 * @alpha
 */
export function encodeSelectedFact(selectedFact: ISelectedFact): string {
  for (const segment of selectedFact.address) {
    if (segment.kind === 'index') {
      if (!Number.isSafeInteger(segment.index) || segment.index < 0) {
        throw new TypeError('Unsupported array index address');
      }
    } else if (segment.kind !== 'property' || typeof segment.key !== 'string') {
      throw new TypeError('Unsupported property address');
    }
  }
  switch (selectedFact.operation) {
    case 'value':
      break;
    case 'own':
    case 'membership':
      if (typeof selectedFact.fact !== 'boolean') {
        throw new TypeError('Presence observation needs a boolean fact');
      }
      break;
    case 'length':
      if (typeof selectedFact.fact !== 'number' || !Number.isSafeInteger(selectedFact.fact) || selectedFact.fact < 0) {
        throw new TypeError('Length observation needs a nonnegative integer fact');
      }
      break;
    case 'keys':
      if (!Array.isArray(selectedFact.fact)) {
        throw new TypeError('Key enumeration needs an ordered string-key sequence');
      }
      {
        const keys = new Set<string>();
        for (let index = 0; index < selectedFact.fact.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(selectedFact.fact, String(index));
          if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string' || keys.has(descriptor.value)) {
            throw new TypeError('Key enumeration needs a dense sequence of unique strings');
          }
          keys.add(descriptor.value);
        }
      }
      break;
    default:
      throw new TypeError('Unsupported observation operation');
  }
  const address = selectedFact.address.map(segment => segment.kind === 'property'
    ? ['property', segment.key]
    : ['index', segment.index]);
  return `${OBSERVATION_VERSION}${JSON.stringify([
    selectedFact.operation, address, encodeValue(selectedFact.fact),
  ])}`;
}

/** A digest over canonical text is content evidence, never a binding locator. */
/** @alpha Hash canonical UTF-8 evidence through the host capability; this is not identity. */
export function fingerprint(encoded: string, capability: ISha256Capability): string {
  const result = capability.sha256(encoded);
  if (!/^[0-9a-f]{64}$/.test(result)) {
    throw new TypeError('Unsupported SHA-256 adapter output');
  }
  return result;
}
