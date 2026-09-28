/**
 * Semantic observation composes process-local reactivity with detached supported
 * values. Tracking owns the facts consumed during evaluation; callers own the
 * structural binding correspondence used to compare those facts later.
 * @packageDocumentation
 */
import type { IAsyncContextCapability, ISha256Capability } from '@microdelta/machine';
import {
  decodeSnapshot,
  encodeProjectionFact,
  encodeSelectedFact,
  encodeSnapshot,
  encodeValue,
  fingerprint,
  normalizeSelectedFact,
  normalizeSelectedNode,
  observe,
} from '@microdelta/value';
import type {
  IAddressSegment,
  IOperation,
  ISelectedFact,
  ISelectedNode,
  IValueProjectionDescriptor,
  IValueProjectionFact,
} from '@microdelta/value';

import { createTracking } from './index.js';
import type { ITracking } from './index.js';
import { createOutputObservationPort } from './output-observation.js';
import type { IDetachedOutput, IOutputFact } from './output-observation.js';

/**
 * A copied composition address; it is correspondence input, never a tracking
 * identity registry.
 * @alpha
 */
export interface ITrackingBinding {
  /** Structural owner path supplied by composition and resolved again for current facts. */
  readonly path: readonly string[];
}

/**
 * Host facilities actually consumed by observation, without requiring snapshot
 * support.
 * @alpha
 */
export interface ITrackingObserverHost extends IAsyncContextCapability, ISha256Capability {}

/** The nominal brand signals that a view came from an observation-aware wrapper. @alpha */
export interface ITrackedBrand {
  readonly __microdeltaTracked: unique symbol;
}

/**
 * The readonly type exposed by navigating a wrapper. Object children remain
 * branded when navigation reaches their wrappers, while scalar leaves and callable
 * signatures retain their normal types. Arrays expose only numeric positions and
 * `length`, matching operations the observer can capture without claiming native methods.
 * @alpha
 */
export type ITrackedView<T> = T extends (...arguments_: never[]) => unknown
  ? T & ITrackedBrand
  : T extends readonly unknown[]
    ? number extends T['length']
      ? { readonly [index: number]: ITrackedView<T[number]>; readonly length: number } & ITrackedBrand
      : { readonly [K in keyof T as K extends `${number}` ? K : never]: ITrackedView<T[K]> }
        & { readonly length: T['length'] }
        & ITrackedBrand
    : T extends object
      ? { readonly [K in keyof T]: ITrackedView<T[K]> } & ITrackedBrand
      : T;

/**
 * A nominal compile-time wrapper for supported object and callable inputs. Nested
 * object views retain the brand; only the observer's private table proves ownership.
 * @alpha
 */
export type ITracked<T extends object> = ITrackedView<T>;

/**
 * One versioned selection that a current-fact provider must resolve exactly.
 * Content fingerprints answer the same selected question and never imply reuse.
 * @alpha
 */
export type ICurrentFactRequest =
  | { readonly kind: 'selected'; readonly operation: IOperation; readonly address: readonly IAddressSegment[]; readonly encodingVersion: 'MDO1' }
  | { readonly kind: 'implementation'; readonly address: readonly IAddressSegment[]; readonly encodingVersion: 'MDF1' }
  | { readonly kind: 'materialized-output'; readonly address: readonly IAddressSegment[]; readonly encodingVersion: 'MDS1' }
  | { readonly kind: 'projection'; readonly descriptor: IValueProjectionDescriptor; readonly encodingVersion: 'MDP1' }
  | { readonly kind: 'collection-order'; readonly keys: readonly string[]; readonly encodingVersion: 'MDV1' };

/** Portable evidence for one selected fact, explicit output, projection, order, or implementation. @alpha */
export interface ITrackingObservation {
  /** The structural binding registered with the tracked root. */
  readonly binding: ITrackingBinding;
  /** Address within the bound value; collection order has no member address. */
  readonly address: readonly IAddressSegment[];
  /** Which exact semantic selection this record represents. */
  readonly selection: ICurrentFactRequest;
  /** Operation-specific category keeps selected facts separate from code evidence. */
  readonly kind: 'fact' | 'implementation' | 'materialized-output' | 'projection' | 'collection-order';
  /** Operation identity is repeated for compact inspection; the request is authoritative. */
  readonly operation: IOperation | 'implementation' | 'materialized-output' | 'projection' | 'collection-order';
  /** Explicit selected-fact wire version retained alongside the digest. */
  readonly encodingVersion: ICurrentFactRequest['encodingVersion'];
  /** Canonical text is retained when the selection stays bounded; aggregate projection text is transient. */
  readonly encoded?: string;
  /** SHA-256 content evidence for the encoded observation. */
  readonly fingerprint: string;
}

/**
 * A completed capture keeps the callback result and owns an immutable evidence
 * snapshot.
 * @alpha
 */
export interface IObservationCapture<T> {
  /** Ordinary callback result; returning a wrapper does not materialize or read it. */
  readonly value: T;
  /** Unique facts consumed during this capture, in first-consumption order. */
  readonly observations: readonly ITrackingObservation[];
}

/**
 * Current correspondence resolves a root before selecting the recorded
 * operation and path.
 * @alpha
 */
export interface ICurrentFactProvider {
  /** Resolve the exact requested fact or return compatible indexed content metadata. */
  resolve(binding: ITrackingBinding, request: ICurrentFactRequest): ICurrentFactResolution;
}

/** Provider outcomes distinguish lost correspondence from an actual changed fact. @alpha */
export type ICurrentFactResolution =
  | { readonly kind: 'available'; readonly fact: unknown }
  | {
      readonly kind: 'compatible-fingerprint';
      readonly selection: ICurrentFactRequest;
      readonly encodingVersion: ICurrentFactRequest['encodingVersion'];
      readonly fingerprint: string;
    }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'incompatible' }
  | { readonly kind: 'ambiguous' };

/** Content comparison is evidence only; it does not authorize cache reuse. @alpha */
export type ICurrentComparison =
  | { readonly kind: 'equal' }
  | { readonly kind: 'changed'; readonly observation: ITrackingObservation }
  | { readonly kind: 'unavailable'; readonly observation: ITrackingObservation }
  | { readonly kind: 'incompatible'; readonly observation: ITrackingObservation }
  | { readonly kind: 'ambiguous'; readonly observation: ITrackingObservation };

/**
 * The observer adds semantic value and implementation facts to the existing
 * local tracker without changing tag/revision behavior or claiming persistence.
 * @alpha
 */
export interface ITrackingObserver {
  /** Process-local tag tracking remains available to composed runtime owners. */
  readonly local: ITracking;
  /** Copy supported data into an immutable owned snapshot and bind its wrapper. */
  tracked<T extends object>(value: T, binding: ITrackingBinding): ITracked<T>;
  /** Capture selected facts across a synchronous callback. */
  capture<T>(callback: () => T): IObservationCapture<T>;
  /** Capture selected facts across asynchronous work and awaits. */
  captureAsync<T>(callback: () => Promise<T>): Promise<IObservationCapture<T>>;
  /** Compare captured content against facts selected by current correspondence. */
  compareCurrent(capture: IObservationCapture<unknown>, provider: ICurrentFactProvider): ICurrentComparison;
  /** Explicitly detach an output graph and observe only its observer-owned subtrees. */
  snapshotOutput<T>(output: T): IDetachedOutput<T>;
  /** Explicit ordered record-key enumeration; native reflection remains rejected. */
  keys(value: ITracked<object>): readonly string[];
  /** Explicit own-member presence without conflating it with inherited membership. */
  hasOwn(value: ITracked<object>, key: string): boolean;
  /** A narrow bridge lets materializers recognize wrappers and read selected fields. */
  readonly materialization: ITrackingMaterialization;
  /** Reactive local derivation that replays semantic facts on cached success and failure. */
  derived<T>(callback: () => T): { get(): T };
}

/**
 * Exact synchronous content behind one lazy tracked view, supplied by a
 * materializer over one immutable retained result. Addresses are absolute from
 * the bound result root, exactly as an in-memory wrapper's addresses are.
 * Tracking decides which answers become observations; the source only answers
 * the single request it receives and must never widen it. Asynchronous-only
 * storage cannot implement this port: a Promise is a malformed answer.
 * @alpha
 */
export interface ITrackedNodeSource {
  /** Navigate to one node: a scalar value fact or a container shape, never a subtree. */
  node(address: readonly IAddressSegment[]): ISelectedNode;
  /** Select one own-presence, lookup-chain membership or key-enumeration fact. */
  select(address: readonly IAddressSegment[], operation: 'own' | 'membership' | 'keys'): ISelectedFact;
  /** Load the complete supported subtree at a container address, only for explicit output detachment. */
  subtree(address: readonly IAddressSegment[]): unknown;
}

/**
 * Materialization can identify a wrapper and use its tracked reads, never unwrap
 * its source.
 * @alpha
 */
export interface ITrackingMaterialization {
  /** Reject explicit materialization work inherited from a capture that has ended. */
  assertFrameOpen(): void;
  /** Identify wrappers by this observer's private ownership, not by the type brand. */
  owns(value: unknown): value is ITracked<object>;
  /**
   * Read a materializable member through the ordinary observer operation. The
   * nominal brand is a compile-time marker, not a source property; open indexes
   * retain possible absence while known members keep their exact value types.
   */
  read<V extends ITracked<object>, K extends keyof V>(
    value: V,
    key: K & (Extract<K, keyof ITrackedBrand> extends never ? unknown : never),
  ): V[K]
    | (K extends string ? string extends keyof V ? undefined : never : never)
    | (K extends number ? number extends keyof V ? undefined : never : never);
  /**
   * Retain a selected fact read from a completed-result source in an active capture.
   * Calls outside a capture are no-ops; calls inherited from a closed capture reject before inspecting content.
   */
  recordSelected(binding: ITrackingBinding, fact: ISelectedFact): void;
  /**
   * Retain one aggregate selected keyed-member projection in an active capture.
   * Calls outside a capture are no-ops; calls inherited from a closed capture reject before inspecting content.
   */
  recordProjection(binding: ITrackingBinding, fact: IValueProjectionFact): void;
  /**
   * Retain order only when a consumer uses the collection's key sequence and an active capture exists.
   * Calls outside a capture are no-ops; calls inherited from a closed capture reject before inspecting content.
   */
  recordCollectionOrder(binding: ITrackingBinding, keys: readonly string[]): void;
  /**
   * Create an observer-owned lazy view over a record or array root supplied by
   * a node source. Every operation records exactly the evidence an in-memory
   * wrapper records for the same data; navigation alone records nothing and
   * requests no sibling, descendant or whole-subtree content.
   */
  lazyView<T extends object>(binding: ITrackingBinding, source: ITrackedNodeSource): ITracked<T>;
}

interface IBindingRecord {
  /** Immutable public descriptor retained with each observation. */
  readonly descriptor: ITrackingBinding;
  /** Copied path used only to distinguish evidence observed at separate bindings. */
  readonly path: readonly string[];
}

/** One in-memory wrapper's frozen source, correspondence and current structured path. */
interface ILocalProxyRecord {
  readonly kind: 'local';
  readonly binding: IBindingRecord;
  /** The snapshot root follows the wrapper closure; it is not indexed by binding identity. */
  readonly root: object;
  /** The container represented by this proxy, used to select supported operations. */
  readonly value: object;
  /** Full path from the wrapper root, re-evaluated by current-fact providers. */
  readonly address: readonly IAddressSegment[];
}

/**
 * The per-root state shared by every lazy view navigated from one
 * {@link ITrackingMaterialization.lazyView} call. Identity tokens make two
 * navigations to the same retained container the same output source, as two
 * in-memory wrappers over one snapshot node are.
 */
interface ILazyRoot {
  readonly source: ITrackedNodeSource;
  readonly identities: Map<string, object>;
}

/** One lazy view: its correspondence, container shape and position within its retained root. */
interface ILazyProxyRecord {
  readonly kind: 'lazy';
  readonly binding: IBindingRecord;
  readonly root: ILazyRoot;
  /** The navigated container shape; array length is transport metadata until read. */
  readonly node: Extract<ISelectedNode, { readonly kind: 'record' | 'array' }>;
  /** Full path from the retained root, re-evaluated by current-fact providers. */
  readonly address: readonly IAddressSegment[];
}

/** Observer ownership of either wrapper form; only this private table proves it. */
type IProxyRecord = ILocalProxyRecord | ILazyProxyRecord;

/** Capture-local facts are mutable only while their async execution is open. */
interface ICaptureFrame {
  /** Distinct consumed facts survive when one path was observed with different values. */
  readonly observations: Map<string, ITrackingObservation>;
  /** Closed frames reject work that inherited their async context after completion. */
  open: boolean;
}

/** Preserve a cached failure together with the same semantic reads as success. */
type IOutcome<T> =
  /** Successful value and reads must be replayed together on a cached hit. */
  | { readonly kind: 'success'; readonly value: T; readonly observations: readonly ITrackingObservation[] }
  /** Failure and reads stay associated so a caught cached error has valid evidence. */
  | { readonly kind: 'failure'; readonly error: unknown; readonly observations: readonly ITrackingObservation[] };

/** Version emitted implementation source before its portable SHA-256 content digest. */
const IMPLEMENTATION_VERSION = 'MDF1|';

/**
 * Return source text only when the runtime exposes inspectable implementation
 * evidence; callers decide whether an uninspectable callable is rejected or
 * treated as unavailable current evidence.
 */
function inspectImplementationSource(target: object): string | undefined {
  const source = Function.prototype.toString.call(target);
  if (isNativeFunctionSource(source)) {
    return undefined;
  }
  return source;
}

/** JSON string escaping preserves UTF-16 code units before the host's UTF-8 hash. */
function encodeImplementationSource(source: string, machine: ISha256Capability): { readonly encoded: string; readonly digest: string } {
  const sourceDigest = fingerprint(JSON.stringify(source), machine);
  const encoded = `${IMPLEMENTATION_VERSION}${sourceDigest}`;
  return { encoded, digest: fingerprint(encoded, machine) };
}

/** Capture requires inspectable code; hash failures remain operational failures. */
function encodeImplementation(target: object, machine: ISha256Capability): { readonly encoded: string; readonly digest: string } {
  const source = inspectImplementationSource(target);
  if (source === undefined) {
    throw new TypeError('Tracked callables need inspectable implementation source');
  }
  return encodeImplementationSource(source, machine);
}

/** Freeze external correspondence at registration so later mutation cannot retarget evidence. */
function copyBinding(binding: ITrackingBinding): IBindingRecord {
  if (binding === null || typeof binding !== 'object') {
    throw new TypeError('Tracking binding needs a structural path');
  }
  const pathDescriptor = Object.getOwnPropertyDescriptor(binding, 'path');
  if (pathDescriptor === undefined || !('value' in pathDescriptor) || !Array.isArray(pathDescriptor.value)) {
    throw new TypeError('Tracking binding path must be an own data property containing an array');
  }
  const suppliedPath: unknown[] = pathDescriptor.value;
  const path: string[] = [];
  for (let index = 0; index < suppliedPath.length; index += 1) {
    const segmentDescriptor = Object.getOwnPropertyDescriptor(suppliedPath, String(index));
    if (segmentDescriptor === undefined || !('value' in segmentDescriptor) || typeof segmentDescriptor.value !== 'string') {
      throw new TypeError('Tracking binding path must contain only string segments');
    }
    path.push(segmentDescriptor.value);
  }
  const frozenPath = Object.freeze(path);
  return Object.freeze({ descriptor: Object.freeze({ path: frozenPath }), path: frozenPath });
}

/** Stable in-frame key deduplicates repeated reads without conflating distinct operations. */
function observationKey(binding: IBindingRecord, address: readonly IAddressSegment[], operation: string, digest: string): string {
  return JSON.stringify([binding.path, operation, address.map((segment) => segment.kind === 'property'
    ? ['property', segment.key]
    : ['index', segment.index]), digest]);
}

/** Copy address descriptors at every retained boundary. */
function copyAddress(address: readonly IAddressSegment[]): readonly IAddressSegment[] {
  return Object.freeze(address.map((segment) => Object.freeze(segment.kind === 'property'
    ? { kind: 'property' as const, key: segment.key }
    : { kind: 'index' as const, index: segment.index })));
}

/** Copy a Value descriptor so provider requests cannot mutate retained evidence. */
function copyProjectionDescriptor(descriptor: IValueProjectionDescriptor): IValueProjectionDescriptor {
  const traversal = descriptor.traversal.kind === 'exhaustive'
    ? Object.freeze({ kind: 'exhaustive' as const, complete: true as const })
    : Object.freeze({ kind: 'visited' as const, complete: false as const, keys: Object.freeze([...descriptor.traversal.keys]) });
  return Object.freeze({ address: copyAddress(descriptor.address), operation: 'value', traversal });
}

/** Retain exact request semantics while copying every caller-owned array boundary. */
function copyRequest(request: ICurrentFactRequest): ICurrentFactRequest {
  switch (request.kind) {
    case 'selected':
    case 'implementation':
    case 'materialized-output':
      return Object.freeze({ ...request, address: copyAddress(request.address) });
    case 'projection':
      return Object.freeze({ ...request, descriptor: copyProjectionDescriptor(request.descriptor) });
    case 'collection-order':
      return Object.freeze({ ...request, keys: Object.freeze([...request.keys]) });
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}

/** Select the path carried by each request variant for its observation envelope. */
function requestAddress(request: ICurrentFactRequest): readonly IAddressSegment[] {
  return request.kind === 'projection' ? request.descriptor.address
    : request.kind === 'collection-order' ? []
      : request.address;
}

/** Accept a current projection only when the Value-owned content encoder validates its full shape. */
function isProjectionFact(value: unknown): value is IValueProjectionFact {
  if (value === null || typeof value !== 'object' || !('descriptor' in value) || !('members' in value)) {
    return false;
  }
  try {
    Reflect.apply(encodeProjectionFact, undefined, [value]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask Value to validate and encode provider data while keeping Machine failures
 * outside this boundary. A Value TypeError means the current fact is incompatible.
 */
function encodeCurrentValue<T>(encode: () => T): T | undefined {
  try {
    return encode();
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return undefined;
    }
    throw error;
  }
}

/** Compare copied provider selections structurally without relying on object identity. */
function sameRequest(left: ICurrentFactRequest, right: ICurrentFactRequest): boolean {
  try {
    return encodeValue(left) === encodeValue(right);
  } catch {
    return false;
  }
}

/**
 * Compare the selected operation and each address segment by its semantic key
 * or index; JavaScript record member insertion order is not part of a path.
 */
function matchesSelectedRequest(fact: ISelectedFact, request: Extract<ICurrentFactRequest, { kind: 'selected' }>): boolean {
  if (fact.operation !== request.operation || fact.address.length !== request.address.length) {
    return false;
  }
  for (let index = 0; index < fact.address.length; index += 1) {
    const actual = fact.address[index];
    const expected = request.address[index];
    if (actual === undefined || expected === undefined || actual.kind !== expected.kind) {
      return false;
    }
    if (actual.kind === 'property') {
      if (expected.kind !== 'property' || actual.key !== expected.key) {
        return false;
      }
    } else if (expected.kind !== 'index' || actual.index !== expected.index) {
      return false;
    }
  }
  return true;
}

/**
 * Copy a supplied key sequence from its indexed own data, reading each slot
 * once, or return undefined when it is not a standard dense array of unique
 * strings without extra own properties. The
 * frozen copy is what callers encode and retain, so an iterator or other array
 * behavior can never substitute a sequence other than the validated one.
 */
function copyUniqueStringSequence(value: unknown): readonly string[] | undefined {
  // Only a standard array whose own properties are exactly its dense slots and length qualifies.
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0
    || Object.getOwnPropertyNames(value).length !== value.length + 1) {
    return undefined;
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(value, String(index));
    const key: unknown = slot !== undefined && 'value' in slot && slot.enumerable === true ? slot.value : undefined;
    if (typeof key !== 'string' || seen.has(key)) {
      return undefined;
    }
    seen.add(key);
    keys.push(key);
  }
  return Object.freeze(keys);
}

/** Classes are not ordinary callable steps or supported plain-data records. */
function isClassConstructor(value: object): boolean {
  return typeof value === 'function' && /^class(?=\s|\/\*|\{)/u.test(Function.prototype.toString.call(value));
}

/** Native functions expose a body containing only the engine's native-code marker. */
function isNativeFunctionSource(source: string): boolean {
  return /^function\b[\s\S]*\{\s*\[native code\]\s*\}\s*$/u.test(source);
}

/** Resolve only canonical decimal array indices; property spellings such as "01" are not aliases. */
function arrayIndex(key: string): number | undefined {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && String(index) === key ? index : undefined;
}

/** Inspect result descriptors without invoking user getters; tracked wrappers remain opaque. */
function isThenableResult(value: unknown, ownership: WeakMap<object, IProxyRecord>): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || ownership.has(value)) {
    return false;
  }
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'then');
    if (descriptor !== undefined) {
      return !('value' in descriptor) || typeof descriptor.value === 'function';
    }
    const prototype: unknown = Object.getPrototypeOf(current);
    if (prototype !== null && typeof prototype !== 'object' && typeof prototype !== 'function') {
      return false;
    }
    current = prototype;
  }
  return false;
}

/** Compare two structured addresses segment by segment. */
function sameAddress(left: readonly IAddressSegment[], right: readonly IAddressSegment[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((segment, position) => {
    const other = right[position];
    return other !== undefined && (segment.kind === 'property'
      ? other.kind === 'property' && other.key === segment.key
      : other.kind === 'index' && other.index === segment.index);
  });
}

/** Stable text key for a structured address, used only for in-process identity interning. */
function addressKey(address: readonly IAddressSegment[]): string {
  return JSON.stringify(address.map((segment) => segment.kind === 'property' ? ['p', segment.key] : ['i', segment.index]));
}

/**
 * Validate a source's navigation answer as a Value node for exactly the
 * requested address. A mismatched, malformed or asynchronous answer fails
 * before anything is recorded or returned to the author.
 */
function checkedNode(candidate: unknown, address: readonly IAddressSegment[]): ISelectedNode {
  const node = normalizeSelectedNode(candidate);
  const answered = node.kind === 'scalar' ? node.selected.address : node.address;
  if (!sameAddress(answered, address)) {
    throw new TypeError('Tracked node source answered a different address');
  }
  return node;
}

/**
 * Validate a source's selected presence or key fact for exactly the requested
 * operation and address. Value copies the envelope in one pass, so the fact
 * returned to the author and recorded as evidence is exactly the one checked.
 */
function checkedSelection(candidate: unknown, address: readonly IAddressSegment[], operation: 'own' | 'membership' | 'keys'): ISelectedFact {
  const fact = normalizeSelectedFact(candidate);
  if (fact.operation !== operation) {
    throw new TypeError('Tracked node source answered a different operation');
  }
  if (!sameAddress(fact.address, address)) {
    throw new TypeError('Tracked node source answered a different address');
  }
  return fact;
}

/**
 * Traps shared by in-memory and lazy container views: tracked views are
 * immutable snapshots and expose no native reflection, so presence and key
 * order stay explicit, observed operations.
 */
const immutableContainerTraps = {
  ownKeys(): ArrayLike<string | symbol> {
    throw new TypeError('Native reflection is unsupported; use observer.keys for supported records');
  },
  getOwnPropertyDescriptor(): PropertyDescriptor | undefined {
    throw new TypeError('Native reflection is unsupported; use observer.hasOwn for supported fields');
  },
  getPrototypeOf(): object | null {
    throw new TypeError('Prototype reflection is unsupported for tracked values');
  },
  setPrototypeOf(): boolean {
    throw new TypeError('Tracked values are immutable snapshots');
  },
  isExtensible(): boolean {
    throw new TypeError('Extensibility reflection is unsupported for tracked values');
  },
  preventExtensions(): boolean {
    throw new TypeError('Tracked values are immutable snapshots');
  },
  set(): boolean {
    throw new TypeError('Tracked values are immutable snapshots');
  },
  defineProperty(): boolean {
    throw new TypeError('Tracked values are immutable snapshots');
  },
  deleteProperty(): boolean {
    throw new TypeError('Tracked values are immutable snapshots');
  },
} as const satisfies ProxyHandler<object>;

/** Map one string member key to the structured segment its container kind implies. */
function memberSegment(isArray: boolean, key: string, unsupportedMessage: string): IAddressSegment {
  if (isArray) {
    const index = arrayIndex(key);
    if (index === undefined) {
      throw new TypeError(unsupportedMessage);
    }
    return { kind: 'index', index };
  }
  return { kind: 'property', key };
}

/** Create one semantic observer over fresh local tag and host capabilities. @alpha */
export function createTrackingObserver(machine: ITrackingObserverHost): ITrackingObserver {
  const local = createTracking(machine);
  const captures = machine.createAsyncContext<ICaptureFrame>();
  const ownership = new WeakMap<object, IProxyRecord>();

  /** Record one consumed fact while rejecting reads that outlive their capture frame. */
  function recordFact(binding: IBindingRecord, root: object, address: readonly IAddressSegment[], operation: IOperation): ISelectedFact {
    const frame = captures.getStore();
    if (frame === undefined) {
      return observeAt(root, address, operation);
    }
    if (!frame.open) {
      throw new Error('Cannot observe tracked input after its capture frame closed');
    }
    const selected = observeAt(root, address, operation);
    const encoded = encodeSelectedFact(selected);
    const digest = fingerprint(encoded, machine);
    const key = observationKey(binding, address, operation, digest);
    if (!frame.observations.has(key)) {
      const selection: ICurrentFactRequest = { kind: 'selected', operation, address, encodingVersion: 'MDO1' };
      frame.observations.set(key, freezeObservation({ binding, selection, kind: 'fact', operation, encoded, digest }));
    }
    return selected;
  }

  /** Select a fact from the wrapper's detached root; correspondence is used only for later comparison. */
  function observeAt(root: object, address: readonly IAddressSegment[], operation: IOperation): ISelectedFact {
    return observe(root, address, operation);
  }

  /** Record actual-called code separately from serializable selected data facts. */
  function recordImplementation(binding: IBindingRecord, address: readonly IAddressSegment[], target: object): void {
    const frame = captures.getStore();
    if (frame === undefined) {
      return;
    }
    if (!frame.open) {
      throw new Error('Cannot invoke tracked function after its capture frame closed');
    }
    const { encoded, digest } = encodeImplementation(target, machine);
    const key = observationKey(binding, address, 'implementation', digest);
    if (!frame.observations.has(key)) {
      const selection: ICurrentFactRequest = { kind: 'implementation', address, encodingVersion: 'MDF1' };
      frame.observations.set(key, freezeObservation({ binding, selection, kind: 'implementation', operation: 'implementation', encoded, digest }));
    }
  }

  /** Detach semantic metadata while projection payload text stays transient and represented by its digest. */
  function freezeObservation(input: {
    readonly binding: IBindingRecord;
    readonly selection: ICurrentFactRequest;
    readonly kind: ITrackingObservation['kind'];
    readonly operation: ITrackingObservation['operation'];
    readonly encoded: string;
    readonly digest: string;
  }): ITrackingObservation {
    const selection = copyRequest(input.selection);
    return Object.freeze({
      binding: input.binding.descriptor,
      address: copyAddress(requestAddress(selection)),
      selection,
      kind: input.kind,
      operation: input.operation,
      encodingVersion: selection.encodingVersion,
      ...(input.kind === 'projection' ? {} : { encoded: input.encoded }),
      fingerprint: input.digest,
    });
  }

  /** Add already selected semantics to an open frame without retaining mutable payload references. */
  function recordExternal(
    binding: IBindingRecord,
    selection: ICurrentFactRequest,
    kind: ITrackingObservation['kind'],
    operation: ITrackingObservation['operation'],
    encoded: string,
  ): void {
    const frame = captures.getStore();
    if (frame === undefined) {
      return;
    }
    if (!frame.open) {
      throw new Error('Cannot record selected materialization after its capture frame closed');
    }
    const address = requestAddress(selection);
    const digest = fingerprint(encoded, machine);
    const key = observationKey(binding, address, operation, digest);
    if (!frame.observations.has(key)) {
      frame.observations.set(key, freezeObservation({ binding, selection, kind, operation, encoded, digest }));
    }
  }

  /** The focused output module sees wrapper-owned values only through this closed-over lookup. */
  const outputObservation = createOutputObservationPort({
    assertFrameOpen(): void {
      const frame = captures.getStore();
      if (frame !== undefined && !frame.open) {
        throw new Error('Cannot materialize output after its capture frame closed');
      }
    },
    ownershipOf(value) {
      const owned = ownership.get(value);
      if (owned === undefined) {
        return undefined;
      }
      if (owned.kind === 'lazy') {
        return {
          binding: owned.binding.descriptor,
          address: owned.address,
          value: loadLazySubtree(owned),
          identity: lazyIdentity(owned),
        };
      }
      return {
        binding: owned.binding.descriptor,
        address: owned.address,
        value: owned.value,
        identity: owned.value,
      };
    },
    record(fact: IOutputFact): void {
      const binding = copyBinding(fact.ownership.binding);
      const selection: ICurrentFactRequest = {
        kind: 'materialized-output',
        address: fact.ownership.address,
        encodingVersion: 'MDS1',
      };
      recordExternal(binding, selection, 'materialized-output', 'materialized-output', fact.encoded);
    },
  }, machine);

  /** Select an object or array member without turning navigation into a whole-value fact. */
  function wrapContainer(binding: IBindingRecord, root: object, value: object, address: readonly IAddressSegment[]): object {
    const target: object = Array.isArray(value) ? [] : Object.create(null) as object;
    const proxy = new Proxy(target, {
      get(_target, key): unknown {
        if (typeof key === 'symbol') {
          throw new TypeError('Symbol reflection and native array methods are unsupported by tracked values');
        }
        if (Array.isArray(value) && key === 'length') {
          return recordFact(binding, root, address, 'length').fact;
        }
        let segment: IAddressSegment;
        if (Array.isArray(value)) {
          const index = arrayIndex(key);
          if (index === undefined) {
            throw new TypeError(`Unsupported array property ${key}`);
          }
          segment = { kind: 'index', index };
        } else {
          segment = { kind: 'property', key };
        }
        const nextAddress = [...address, segment];
        const selected = observe(value, [segment], 'value').fact;
        if (typeof selected === 'function') {
          throw new TypeError('Functions as data fields are unsupported; wrap a callable binding directly');
        }
        if (selected !== null && typeof selected === 'object') {
          return wrapContainer(binding, root, selected, nextAddress);
        }
        return recordFact(binding, root, nextAddress, 'value').fact;
      },
      has(_target, key): boolean {
        if (typeof key !== 'string') {
          throw new TypeError('Symbol membership is unsupported by tracked values');
        }
        let segment: IAddressSegment;
        if (Array.isArray(value)) {
          const index = arrayIndex(key);
          if (index === undefined) {
            throw new TypeError('Unsupported array membership key');
          }
          segment = { kind: 'index', index };
        } else {
          segment = { kind: 'property', key };
        }
        return Boolean(recordFact(binding, root, [...address, segment], 'membership').fact);
      },
      ...immutableContainerTraps,
    });
    ownership.set(proxy, { kind: 'local', binding, root, value, address: copyAddress(address) });
    return proxy;
  }

  /** Reject lazy work inherited from a closed frame before it can request retained content. */
  function assertLazyFrameOpen(): void {
    const frame = captures.getStore();
    if (frame !== undefined && !frame.open) {
      throw new Error('Cannot observe tracked input after its capture frame closed');
    }
  }

  /** Record one validated selected fact from a lazy source; outside a capture nothing is encoded. */
  function recordLazyFact(binding: IBindingRecord, fact: ISelectedFact): void {
    if (captures.getStore() === undefined) {
      return;
    }
    const selection: ICurrentFactRequest = { kind: 'selected', operation: fact.operation, address: fact.address, encodingVersion: 'MDO1' };
    recordExternal(binding, selection, 'fact', fact.operation, encodeSelectedFact(fact));
  }

  /**
   * Wrap one navigated container from a lazy source. Traps mirror
   * {@link wrapContainer} operation for operation, but each read asks the
   * source for exactly one node or fact at its full address, after first
   * rejecting work inherited from a closed frame.
   */
  function wrapLazy(binding: IBindingRecord, root: ILazyRoot, node: ILazyProxyRecord['node']): object {
    const isArray = node.kind === 'array';
    const target: object = isArray ? [] : Object.create(null) as object;
    const proxy = new Proxy(target, {
      get(_target, key): unknown {
        assertLazyFrameOpen();
        if (typeof key === 'symbol') {
          throw new TypeError('Symbol reflection and native array methods are unsupported by tracked values');
        }
        if (node.kind === 'array' && key === 'length') {
          const fact: ISelectedFact = Object.freeze({ operation: 'length', address: node.address, fact: node.length });
          recordLazyFact(binding, fact);
          return node.length;
        }
        const nextAddress = copyAddress([...node.address, memberSegment(isArray, key, `Unsupported array property ${key}`)]);
        const next = checkedNode(root.source.node(nextAddress), nextAddress);
        if (next.kind === 'scalar') {
          recordLazyFact(binding, next.selected);
          return next.selected.fact;
        }
        return wrapLazy(binding, root, next);
      },
      has(_target, key): boolean {
        assertLazyFrameOpen();
        if (typeof key !== 'string') {
          throw new TypeError('Symbol membership is unsupported by tracked values');
        }
        const nextAddress = copyAddress([...node.address, memberSegment(isArray, key, 'Unsupported array membership key')]);
        const fact = checkedSelection(root.source.select(nextAddress, 'membership'), nextAddress, 'membership');
        recordLazyFact(binding, fact);
        return fact.fact === true;
      },
      ...immutableContainerTraps,
    });
    ownership.set(proxy, { kind: 'lazy', binding, root, node, address: node.address });
    return proxy;
  }

  /**
   * Load an explicitly output lazy container as detached supported data. The
   * source must answer with the same container kind it navigated; the output
   * port then validates, encodes and copies it without retaining the answer.
   */
  function loadLazySubtree(owned: ILazyProxyRecord): object {
    const loaded: unknown = owned.root.source.subtree(owned.address);
    if (loaded === null || typeof loaded !== 'object' || Array.isArray(loaded) !== (owned.node.kind === 'array')) {
      throw new TypeError('Tracked node source returned a subtree of a different kind');
    }
    return loaded;
  }

  /** Intern one identity per retained container address so repeated navigations alias in output checks. */
  function lazyIdentity(owned: ILazyProxyRecord): object {
    const key = addressKey(owned.address);
    let identity = owned.root.identities.get(key);
    if (identity === undefined) {
      identity = Object.freeze({});
      owned.root.identities.set(key, identity);
    }
    return identity;
  }

  /**
   * Keep callable behavior observable only at invocation boundaries while hiding ordinary function reflection.
   * Promise assimilation is the narrow exception: its `then` probe must see an ordinary non-thenable value.
   */
  function wrapFunction<T extends object>(binding: IBindingRecord, root: object, target: T, address: readonly IAddressSegment[]): T {
    if (typeof target !== 'function') {
      throw new TypeError('Tracked callable has an unsupported runtime value');
    }
    const proxy = new Proxy(target, {
      apply(fn, thisArgument, argumentsList): unknown {
        recordImplementation(binding, address, fn);
        return Reflect.apply(fn, thisArgument, argumentsList);
      },
      construct(): never {
        throw new TypeError('Tracked functions support ordinary calls, not construction');
      },
      get(fn, key): unknown {
        // Promise resolution needs a neutral `then` result, but a fixed own data property cannot be hidden by a Proxy.
        if (key === 'then') {
          const descriptor = Reflect.getOwnPropertyDescriptor(fn, key);
          if (descriptor !== undefined && !descriptor.configurable && 'value' in descriptor && !descriptor.writable && descriptor.value !== undefined) {
            throw new TypeError('Tracked functions with a non-configurable then property are unsupported');
          }
          // Inspect descriptors only: a custom getter or thenable must never run during assimilation.
          return undefined;
        }
        throw new TypeError('Tracked function properties and metadata are unsupported');
      },
      set(): never {
        throw new TypeError('Tracked function properties are immutable and unsupported');
      },
      defineProperty(): never {
        throw new TypeError('Tracked function properties are immutable and unsupported');
      },
      deleteProperty(): never {
        throw new TypeError('Tracked function properties are immutable and unsupported');
      },
      ownKeys(): never {
        throw new TypeError('Tracked function reflection is unsupported');
      },
      getOwnPropertyDescriptor(): never {
        throw new TypeError('Tracked function reflection is unsupported');
      },
      getPrototypeOf(): never {
        throw new TypeError('Tracked function reflection is unsupported');
      },
      setPrototypeOf(): never {
        throw new TypeError('Tracked function properties are immutable and unsupported');
      },
      isExtensible(): never {
        throw new TypeError('Tracked function reflection is unsupported');
      },
      preventExtensions(): never {
        throw new TypeError('Tracked function properties are immutable and unsupported');
      },
    });
    ownership.set(proxy, { kind: 'local', binding, root, value: target, address: copyAddress(address) });
    return proxy as T;
  }

  /** Current-value consumers use operation semantics and digest equality only. */
  function compareCurrent(capture: IObservationCapture<unknown>, provider: ICurrentFactProvider): ICurrentComparison {
    for (const observation of capture.observations) {
      const resolved = provider.resolve(observation.binding, observation.selection);
      if (resolved.kind === 'unavailable' || resolved.kind === 'ambiguous' || resolved.kind === 'incompatible') {
        return { kind: resolved.kind, observation };
      }
      let currentFingerprint: string;
      if (resolved.kind === 'compatible-fingerprint') {
        if (resolved.encodingVersion !== observation.encodingVersion || !sameRequest(resolved.selection, observation.selection)
          || !/^[0-9a-f]{64}$/.test(resolved.fingerprint)) {
          return { kind: 'incompatible', observation };
        }
        currentFingerprint = resolved.fingerprint;
      } else {
        switch (observation.selection.kind) {
          case 'selected': {
            // A provider fact is compared only as the single validated copy Value produces.
            const fact = encodeCurrentValue(() => normalizeSelectedFact(resolved.fact));
            if (fact === undefined || !matchesSelectedRequest(fact, observation.selection)) {
              return { kind: 'incompatible', observation };
            }
            const encoded = encodeCurrentValue(() => encodeSelectedFact(fact));
            if (encoded === undefined) {
              return { kind: 'incompatible', observation };
            }
            currentFingerprint = fingerprint(encoded, machine);
            break;
          }
          case 'implementation':
            if (typeof resolved.fact !== 'function') {
              return { kind: 'unavailable', observation };
            }
            const source = inspectImplementationSource(resolved.fact);
            if (source === undefined) {
              return { kind: 'unavailable', observation };
            }
            currentFingerprint = encodeImplementationSource(source, machine).digest;
            break;
          case 'materialized-output': {
            const encoded = encodeCurrentValue(() => encodeSnapshot(resolved.fact));
            if (encoded === undefined) {
              return { kind: 'incompatible', observation };
            }
            currentFingerprint = fingerprint(encoded, machine);
            break;
          }
          case 'projection': {
            const fact = resolved.fact;
            if (!isProjectionFact(fact)) {
              return { kind: 'incompatible', observation };
            }
            // Value accepts null-prototype records as the same projection meaning as ordinary records.
            // Normalize supported descriptor records before comparing with the stored selection.
            const descriptor = copyProjectionDescriptor(fact.descriptor);
            // A valid projection can still answer a different address or traversal question.
            // Canonical request equality ignores record insertion order but preserves ordered coverage keys.
            if (!sameRequest({ kind: 'projection', descriptor, encodingVersion: 'MDP1' }, observation.selection)) {
              return { kind: 'incompatible', observation };
            }
            const encoded = encodeCurrentValue(() => encodeProjectionFact(fact));
            if (encoded === undefined) {
              return { kind: 'incompatible', observation };
            }
            currentFingerprint = fingerprint(encoded, machine);
            break;
          }
          case 'collection-order': {
            const keys = copyUniqueStringSequence(resolved.fact);
            if (keys === undefined) {
              return { kind: 'incompatible', observation };
            }
            const encoded = encodeCurrentValue(() => encodeValue(keys));
            if (encoded === undefined) {
              return { kind: 'incompatible', observation };
            }
            currentFingerprint = fingerprint(encoded, machine);
            break;
          }
          default: {
            const exhaustive: never = observation.selection;
            return exhaustive;
          }
        }
      }
      if (currentFingerprint !== observation.fingerprint) {
        return { kind: 'changed', observation };
      }
    }
    return { kind: 'equal' };
  }

  /**
   * These capabilities belong to this observer's capture and fact-recording
   * state. Keep those references lexical so a capability remains valid when
   * destructured or passed as a callback; its caller is not a receiver contract.
   */
  const materialization: ITrackingMaterialization = Object.freeze({
    assertFrameOpen(): void {
      const frame = captures.getStore();
      if (frame !== undefined && !frame.open) {
        throw new Error('Cannot materialize selected content after its capture frame closed');
      }
    },
    owns(value: unknown): value is ITracked<object> {
      return value !== null && (typeof value === 'object' || typeof value === 'function') && ownership.has(value);
    },
    /**
     * Route a selected member read through the wrapper proxy so evaluation records
     * its fact; open indexes may be absent and the compile-time brand is not a
     * materialized source member.
     */
    read<V extends ITracked<object>, K extends keyof V>(value: V, key: K): V[K] {
      if (!ownership.has(value)) {
        throw new TypeError('Materialization reads require an observer-owned tracked value');
      }
      return value[key];
    },
    recordSelected(binding: ITrackingBinding, fact: ISelectedFact): void {
      if (captures.getStore() === undefined) {
        return;
      }
      materialization.assertFrameOpen();
      // Encode and record one validated copy so the evidence and its selection cannot diverge.
      const selected = normalizeSelectedFact(fact);
      const encoded = encodeSelectedFact(selected);
      const request: ICurrentFactRequest = {
        kind: 'selected',
        operation: selected.operation,
        address: selected.address,
        encodingVersion: 'MDO1',
      };
      recordExternal(copyBinding(binding), request, 'fact', selected.operation, encoded);
    },
    recordProjection(binding: ITrackingBinding, fact: IValueProjectionFact): void {
      if (captures.getStore() === undefined) {
        return;
      }
      materialization.assertFrameOpen();
      const encoded = encodeProjectionFact(fact);
      const descriptor = copyProjectionDescriptor(fact.descriptor);
      const request: ICurrentFactRequest = { kind: 'projection', descriptor, encodingVersion: 'MDP1' };
      recordExternal(copyBinding(binding), request, 'projection', 'projection', encoded);
    },
    recordCollectionOrder(binding: ITrackingBinding, keys: readonly string[]): void {
      if (captures.getStore() === undefined) {
        return;
      }
      materialization.assertFrameOpen();
      const copiedKeys = copyUniqueStringSequence(keys);
      if (copiedKeys === undefined) {
        throw new TypeError('Collection order needs a unique ordered sequence of string keys');
      }
      const encoded = encodeValue(copiedKeys);
      const request: ICurrentFactRequest = { kind: 'collection-order', keys: copiedKeys, encodingVersion: 'MDV1' };
      recordExternal(copyBinding(binding), request, 'collection-order', 'collection-order', encoded);
    },
    lazyView<T extends object>(binding: ITrackingBinding, source: ITrackedNodeSource): ITracked<T> {
      assertLazyFrameOpen();
      const copied = copyBinding(binding);
      const rootNode = checkedNode(source.node([]), []);
      if (rootNode.kind === 'scalar') {
        throw new TypeError('A lazy tracked view needs a record or array root');
      }
      const root: ILazyRoot = { source, identities: new Map() };
      // As in tracked(), the hidden owner table rather than the cast is the runtime authority.
      return wrapLazy(copied, root, rootNode) as ITracked<T>;
    },
  });

  return Object.freeze({
    local,
    tracked<T extends object>(value: T, binding: ITrackingBinding): ITracked<T> {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError('Tracked inputs must be objects or functions');
      }
      if (isClassConstructor(value)) {
        throw new TypeError('Class constructors are unsupported tracked inputs');
      }
      if (typeof value === 'function' && inspectImplementationSource(value) === undefined) {
        throw new TypeError('Tracked callables need inspectable implementation source');
      }
      const copied = copyBinding(binding);
      let snapshot: object;
      if (typeof value === 'function') {
        snapshot = value;
      } else {
        const encoded = encodeSnapshot(value);
        const decoded: unknown = decodeSnapshot(encoded);
        if (decoded === null || typeof decoded !== 'object') {
          throw new TypeError('Supported tracked data must decode as an object or array');
        }
        snapshot = decoded;
      }
      const wrapped = typeof snapshot === 'function'
        ? wrapFunction(copied, snapshot, snapshot, [])
        : wrapContainer(copied, snapshot, snapshot, []);
      // Proxy typing cannot express the hidden owner table; this cast exposes
      // field/call structure while WeakMap membership remains runtime authority.
      return wrapped as ITracked<T>;
    },
    capture<T>(callback: () => T): IObservationCapture<T> {
      const frame: ICaptureFrame = { observations: new Map(), open: true };
      return captures.run(frame, () => {
        try {
          const value = callback();
          if (isThenableResult(value, ownership)) {
            if (value instanceof Promise) {
              void value.catch(() => undefined);
            }
            throw new TypeError('Use captureAsync for asynchronous callbacks');
          }
          return Object.freeze({ value, observations: Object.freeze([...frame.observations.values()]) });
        } finally {
          frame.open = false;
        }
      });
    },
    captureAsync<T>(callback: () => Promise<T>): Promise<IObservationCapture<T>> {
      const frame: ICaptureFrame = { observations: new Map(), open: true };
      return captures.run(frame, async () => {
        try {
          const value = await callback();
          return Object.freeze({ value, observations: Object.freeze([...frame.observations.values()]) });
        } finally {
          frame.open = false;
        }
      });
    },
    compareCurrent,
    snapshotOutput: outputObservation.snapshotOutput,
    keys(value: ITracked<object>): readonly string[] {
      const owned = ownership.get(value);
      if (owned?.kind === 'lazy') {
        if (owned.node.kind !== 'record') {
          throw new TypeError('keys needs an observer-owned record');
        }
        assertLazyFrameOpen();
        const selected = checkedSelection(owned.root.source.select(owned.address, 'keys'), owned.address, 'keys');
        recordLazyFact(owned.binding, selected);
        return selected.fact as readonly string[];
      }
      if (owned === undefined || Array.isArray(owned.value)) {
        throw new TypeError('keys needs an observer-owned record');
      }
      const fact = recordFact(owned.binding, owned.root, owned.address, 'keys').fact;
      if (!Array.isArray(fact)) {
        throw new TypeError('Key observation returned an unsupported value');
      }
      const keys: string[] = [];
      for (let index = 0; index < fact.length; index += 1) {
        const key: unknown = fact[index];
        if (typeof key !== 'string') {
          throw new TypeError('Key observation contains an unsupported member');
        }
        keys.push(key);
      }
      return Object.freeze(keys);
    },
    hasOwn(value: ITracked<object>, key: string): boolean {
      const owned = ownership.get(value);
      if (owned === undefined) {
        throw new TypeError('hasOwn needs an observer-owned value');
      }
      if (owned.kind === 'lazy') {
        const isArray = owned.node.kind === 'array';
        if (isArray && key === 'length') {
          throw new TypeError('Array length ownership is not a supported own-property fact');
        }
        assertLazyFrameOpen();
        const nextAddress = copyAddress([...owned.address, memberSegment(isArray, key, 'Array own-property checks need a canonical nonnegative index')]);
        const selected = checkedSelection(owned.root.source.select(nextAddress, 'own'), nextAddress, 'own');
        recordLazyFact(owned.binding, selected);
        return selected.fact === true;
      }
      if (Array.isArray(owned.value) && key === 'length') {
        throw new TypeError('Array length ownership is not a supported own-property fact');
      }
      let segment: IAddressSegment;
      if (Array.isArray(owned.value)) {
        const index = arrayIndex(key);
        if (index === undefined) {
          throw new TypeError('Array own-property checks need a canonical nonnegative index');
        }
        segment = { kind: 'index', index };
      } else {
        segment = { kind: 'property', key };
      }
      const fact = recordFact(owned.binding, owned.root, [...owned.address, segment], 'own').fact;
      return Boolean(fact);
    },
    materialization,
    derived<T>(callback: () => T): { get(): T } {
      const cached = local.derived((): IOutcome<T> => {
        const frame: ICaptureFrame = { observations: new Map(), open: true };
        return captures.run(frame, () => {
          try {
            return { kind: 'success', value: callback(), observations: Object.freeze([...frame.observations.values()]) };
          } catch (error: unknown) {
            return { kind: 'failure', error, observations: Object.freeze([...frame.observations.values()]) };
          } finally {
            frame.open = false;
          }
        });
      });
      return Object.freeze({
        get(): T {
          const current = captures.getStore();
          if (current !== undefined && !current.open) {
            throw new Error('Cannot replay tracked derivation after its capture frame closed');
          }
          const outcome = cached.get();
          if (current !== undefined) {
            for (const observation of outcome.observations) {
              const key = observationKey({ descriptor: observation.binding, path: observation.binding.path }, observation.address, observation.operation, observation.fingerprint);
              if (!current.observations.has(key)) {
                current.observations.set(key, observation);
              }
            }
          }
          if (outcome.kind === 'failure') {
            throw outcome.error;
          }
          return outcome.value;
        },
      });
    },
  });
}
