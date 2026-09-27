/**
 * EXP-2's portable value candidate defines a bounded, versioned observation
 * language. It is experiment evidence, not a public runtime or storage format.
 * @packageDocumentation
 */

/** Canonical wire versions fail closed rather than guessing a migration. */
const VALUE_VERSION = 'MDV1|';
const OBSERVATION_VERSION = 'MDO1|';
/** Explicit prototype chains are bounded so lookup meaning stays inspectable. */
const MAX_CUSTOM_PROTOTYPES = 2;

/** Host hashing receives already canonical text and owns no value semantics. */
export interface IDigestCapability {
  /** Return lowercase SHA-256 hex for the supplied UTF-8 text. */
  sha256(input: string): string;
}

/** Path segment meaning follows the container, not numeric source syntax. */
export type IAddressSegment =
  | { readonly kind: 'property'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number };

/** Only literal operations in this bounded experiment are representable. */
export type IOperation = 'value' | 'own' | 'membership' | 'length' | 'keys';

/** A current observation retains its operation, structured address, and fact. */
export interface IObservation {
  readonly operation: IOperation;
  readonly address: readonly IAddressSegment[];
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
function toWire(value: unknown, path: string, seen: WeakSet<object>, prototypeDepth: number): unknown {
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
        entries.push(toWire(slot.value, `${path}[${index}]`, seen, prototypeDepth));
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
    if (prototypeDepth >= MAX_CUSTOM_PROTOTYPES) {
      unsupported(path, 'prototype depth');
    }
    prototypeWire = ['p-custom', toWire(prototype, `${path}[[Prototype]]`, seen, prototypeDepth + 1)];
  }
  const entries = sortedKeys(value).map((key): readonly [string, unknown] => {
    const property = ownData(value, key, `${path}.${key}`);
    return [key, toWire(property.value, `${path}.${key}`, seen, prototypeDepth)];
  });
  return ['o', entries, prototypeWire];
}

/** Canonical snapshots preserve structure that individual reads may ignore. */
export function encodeValue(value: unknown): string {
  return `${VALUE_VERSION}${JSON.stringify(toWire(value, '$', new WeakSet(), 0))}`;
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

/** A decoder accepts only canonical v1 bytes, including unique ordered keys. */
export function decodeValue(encoded: string): unknown {
  if (!encoded.startsWith(VALUE_VERSION)) {
    throw new TypeError('Unsupported canonical value version');
  }
  const raw: unknown = JSON.parse(encoded.slice(VALUE_VERSION.length));
  const decoded = fromWire(raw, '$');
  if (encodeValue(decoded) !== encoded) {
    throw new TypeError('Unsupported noncanonical value encoding');
  }
  freezeSnapshot(decoded);
  return decoded;
}

/** Construct plain data records without losing a duplicate input key. */
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
export function observe(root: unknown, address: readonly IAddressSegment[], operation: IOperation): IObservation {
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
export function encodeObservation(observation: IObservation): string {
  for (const segment of observation.address) {
    if (segment.kind === 'index') {
      if (!Number.isSafeInteger(segment.index) || segment.index < 0) {
        throw new TypeError('Unsupported array index address');
      }
    } else if (segment.kind !== 'property' || typeof segment.key !== 'string') {
      throw new TypeError('Unsupported property address');
    }
  }
  switch (observation.operation) {
    case 'value':
      break;
    case 'own':
    case 'membership':
      if (typeof observation.fact !== 'boolean') {
        throw new TypeError('Presence observation needs a boolean fact');
      }
      break;
    case 'length':
      if (typeof observation.fact !== 'number' || !Number.isSafeInteger(observation.fact) || observation.fact < 0) {
        throw new TypeError('Length observation needs a nonnegative integer fact');
      }
      break;
    case 'keys':
      if (!Array.isArray(observation.fact) || observation.fact.some(key => typeof key !== 'string')) {
        throw new TypeError('Key enumeration needs an ordered string-key sequence');
      }
      break;
    default:
      throw new TypeError('Unsupported observation operation');
  }
  const address = observation.address.map(segment => segment.kind === 'property'
    ? ['property', segment.key]
    : ['index', segment.index]);
  return `${OBSERVATION_VERSION}${JSON.stringify([
    observation.operation, address, encodeValue(observation.fact),
  ])}`;
}

/** A digest over canonical text is content evidence, never a binding locator. */
export function fingerprint(encoded: string, capability: IDigestCapability): string {
  const result = capability.sha256(encoded);
  if (!/^[0-9a-f]{64}$/.test(result)) {
    throw new TypeError('Unsupported SHA-256 adapter output');
  }
  return result;
}
