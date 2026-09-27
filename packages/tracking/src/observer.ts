/**
 * Semantic observation composes process-local reactivity with detached supported
 * values. Tracking owns the facts consumed during evaluation; callers own the
 * structural binding correspondence used to compare those facts later.
 * @packageDocumentation
 */
import type { IAsyncContextCapability, ISha256Capability } from '@microdelta/machine';
import { decodeSnapshot, encodeProjectionFact, encodeSelectedFact, encodeSnapshot, encodeValue, fingerprint, observe } from '@microdelta/value';
import type {
  IAddressSegment,
  IOperation,
  ISelectedFact,
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
}

interface IBindingRecord {
  /** Immutable public descriptor retained with each observation. */
  readonly descriptor: ITrackingBinding;
  /** Copied path used only to distinguish evidence observed at separate bindings. */
  readonly path: readonly string[];
}

/** One wrapper's frozen source, correspondence and current structured path. */
interface IProxyRecord {
  readonly binding: IBindingRecord;
  /** The snapshot root follows the wrapper closure; it is not indexed by binding identity. */
  readonly root: object;
  /** The container represented by this proxy, used to select supported operations. */
  readonly value: object;
  /** Full path from the wrapper root, re-evaluated by current-fact providers. */
  readonly address: readonly IAddressSegment[];
}

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

/** Validate provider-selected data before treating it as a Value-owned fact. */
function isSelectedFact(value: unknown): value is ISelectedFact {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || keys.some((key) => key !== 'operation' && key !== 'address' && key !== 'fact')) {
    return false;
  }
  const operationField = ownDataField(value, 'operation');
  const addressField = ownDataField(value, 'address');
  const factField = ownDataField(value, 'fact');
  if (!operationField.present || !addressField.present || !factField.present) {
    return false;
  }
  const operation = operationField.value;
  if (operation !== 'value' && operation !== 'own' && operation !== 'membership' && operation !== 'length' && operation !== 'keys') {
    return false;
  }
  const address = addressField.value;
  if (!Array.isArray(address)) {
    return false;
  }
  for (let index = 0; index < address.length; index += 1) {
    const slot = ownDataField(address, String(index));
    if (!slot.present || slot.value === null || typeof slot.value !== 'object') {
      return false;
    }
    const segment = slot.value;
    const segmentKeys = Reflect.ownKeys(segment);
    if (segmentKeys.length !== 2 || segmentKeys.some((key) => key !== 'kind' && key !== 'key' && key !== 'index')) {
      return false;
    }
    const kind = ownDataField(segment, 'kind');
    if (!kind.present) {
      return false;
    }
    const memberKey = ownDataField(segment, 'key');
    const memberIndex = ownDataField(segment, 'index');
    if (kind.value === 'property' && memberKey.present && typeof memberKey.value === 'string') {
      continue;
    }
    if (kind.value === 'index' && memberIndex.present && typeof memberIndex.value === 'number'
      && Number.isSafeInteger(memberIndex.value) && memberIndex.value >= 0) {
      continue;
    }
    return false;
  }
  return true;
}

/** Read data-property contents as unknown; PropertyDescriptor.value is typed as any. */
function ownDataField(value: object, key: string): { readonly present: boolean; readonly value: unknown } {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    return { present: false, value: undefined };
  }
  return { present: true, value: descriptor.value as unknown };
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
function encodeCurrentValue(encode: () => string): string | undefined {
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

/** Keep provider key sequences finite, unique, dense, and free of coercion. */
function isUniqueStringSequence(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  const keys = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(value, String(index));
    if (slot === undefined || !('value' in slot) || typeof slot.value !== 'string' || keys.has(slot.value)) {
      return false;
    }
    keys.add(slot.value);
  }
  return true;
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
      return owned === undefined ? undefined : {
        binding: owned.binding.descriptor,
        address: owned.address,
        value: owned.value,
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
    });
    ownership.set(proxy, { binding, root, value, address: copyAddress(address) });
    return proxy;
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
    ownership.set(proxy, { binding, root, value: target, address: copyAddress(address) });
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
            const fact = resolved.fact;
            if (!isSelectedFact(fact) || !matchesSelectedRequest(fact, observation.selection)) {
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
            if (!isUniqueStringSequence(resolved.fact)) {
              return { kind: 'incompatible', observation };
            }
            const encoded = encodeCurrentValue(() => encodeValue(resolved.fact));
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
      const encoded = encodeSelectedFact(fact);
      const request: ICurrentFactRequest = {
        kind: 'selected',
        operation: fact.operation,
        address: fact.address,
        encodingVersion: 'MDO1',
      };
      recordExternal(copyBinding(binding), request, 'fact', fact.operation, encoded);
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
      if (!isUniqueStringSequence(keys)) {
        throw new TypeError('Collection order needs a unique ordered sequence of string keys');
      }
      const copiedKeys = Object.freeze([...keys]);
      const encoded = encodeValue(copiedKeys);
      const request: ICurrentFactRequest = { kind: 'collection-order', keys: copiedKeys, encodingVersion: 'MDV1' };
      recordExternal(copyBinding(binding), request, 'collection-order', 'collection-order', encoded);
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
