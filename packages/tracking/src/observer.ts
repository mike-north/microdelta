/**
 * Semantic observation composes process-local reactivity with detached supported
 * values. Tracking owns the facts consumed during evaluation; callers own the
 * structural binding correspondence used to compare those facts later.
 * @packageDocumentation
 */
import type { IAsyncContextCapability, ISha256Capability } from '@microdelta/machine';
import { decodeSnapshot, encodeSelectedFact, encodeSnapshot, fingerprint, observe } from '@microdelta/value';
import type { IAddressSegment, IOperation, ISelectedFact } from '@microdelta/value';

import { createTracking } from './index.js';
import type { ITracking } from './index.js';

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

/** Portable evidence for one consumed value fact or one actually invoked implementation. @alpha */
export interface ITrackingObservation {
  /** The structural binding registered with the tracked root. */
  readonly binding: ITrackingBinding;
  /** Address within the currently bound value; function code uses the same path. */
  readonly address: readonly IAddressSegment[];
  /** Keep code evidence separate from Value's supported selected-fact operations. */
  readonly kind: 'fact' | 'implementation';
  /** Value operation, or `implementation` for called function code. */
  readonly operation: IOperation | 'implementation';
  /** Versioned canonical observation text, suitable for transfer but not a locator. */
  readonly encoded: string;
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
  /** Resolve a captured binding and then its current operation at the full address. */
  resolve(
    binding: ITrackingBinding,
    address: readonly IAddressSegment[],
    operation: IOperation | 'implementation',
  ): ICurrentFactResolution;
}

/** Provider outcomes distinguish lost correspondence from an actual changed fact. @alpha */
export type ICurrentFactResolution =
  | { readonly kind: 'available'; readonly fact: unknown }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'ambiguous' };

/** Content comparison is evidence only; it does not authorize cache reuse. @alpha */
export type ICurrentComparison =
  | { readonly kind: 'equal' }
  | { readonly kind: 'changed'; readonly observation: ITrackingObservation }
  | { readonly kind: 'unavailable'; readonly observation: ITrackingObservation }
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
  /** Identify wrappers by this observer's private ownership, not by the type brand. */
  owns(value: unknown): value is ITracked<object>;
  /** Read one selected field through the ordinary observer operation. */
  read<T extends object, K extends keyof ITracked<T>>(value: ITracked<T>, key: K): ITracked<T>[K];
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

/** JSON string escaping preserves UTF-16 code units before the host's UTF-8 hash. */
function encodeImplementation(target: object, machine: ISha256Capability): { readonly encoded: string; readonly digest: string } {
  const source = Function.prototype.toString.call(target);
  if (isNativeFunctionSource(source)) {
    throw new TypeError('Tracked callables need inspectable implementation source');
  }
  const sourceDigest = fingerprint(JSON.stringify(source), machine);
  const encoded = `${IMPLEMENTATION_VERSION}${sourceDigest}`;
  return { encoded, digest: fingerprint(encoded, machine) };
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

/** Validate provider-selected data before treating it as a Value-owned fact. */
function isSelectedFact(value: unknown): value is ISelectedFact {
  if (value === null || typeof value !== 'object' || !('operation' in value) || !('address' in value) || !('fact' in value)) {
    return false;
  }
  const operation = value.operation;
  if (operation !== 'value' && operation !== 'own' && operation !== 'membership' && operation !== 'length' && operation !== 'keys') {
    return false;
  }
  if (!Array.isArray(value.address)) {
    return false;
  }
  return value.address.every((segment: unknown) => {
    if (segment === null || typeof segment !== 'object' || !('kind' in segment)) {
      return false;
    }
    return segment.kind === 'property'
      ? 'key' in segment && typeof segment.key === 'string'
      : segment.kind === 'index' && 'index' in segment && typeof segment.index === 'number' && Number.isSafeInteger(segment.index);
  });
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
      frame.observations.set(key, freezeObservation({ binding, address, kind: 'fact', operation, encoded, digest }));
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
      frame.observations.set(key, freezeObservation({ binding, address, kind: 'implementation', operation: 'implementation', encoded, digest }));
    }
  }

  /** Detach all exposed semantic descriptors before the frame can be mutated or closed. */
  function freezeObservation(input: {
    readonly binding: IBindingRecord;
    readonly address: readonly IAddressSegment[];
    readonly kind: 'fact' | 'implementation';
    readonly operation: IOperation | 'implementation';
    readonly encoded: string;
    readonly digest: string;
  }): ITrackingObservation {
    return Object.freeze({
      binding: input.binding.descriptor,
      address: copyAddress(input.address),
      kind: input.kind,
      operation: input.operation,
      encoded: input.encoded,
      fingerprint: input.digest,
    });
  }

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

  /** Wrap a callable while preserving ordinary invocation and return values. */
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
      get(): never {
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
      const resolved = provider.resolve(observation.binding, observation.address, observation.operation);
      if (resolved.kind !== 'available') {
        return { kind: resolved.kind, observation };
      }
      let encoded: string;
      let currentFingerprint: string;
      if (observation.kind === 'implementation') {
        if (typeof resolved.fact !== 'function') {
          return { kind: 'unavailable', observation };
        }
        const implementation = encodeImplementation(resolved.fact, machine);
        encoded = implementation.encoded;
        currentFingerprint = implementation.digest;
      } else {
        if (!isSelectedFact(resolved.fact)) {
          return { kind: 'unavailable', observation };
        }
        encoded = encodeSelectedFact(resolved.fact);
        currentFingerprint = fingerprint(encoded, machine);
      }
      if (currentFingerprint !== observation.fingerprint) {
        return { kind: 'changed', observation };
      }
    }
    return { kind: 'equal' };
  }

  const materialization: ITrackingMaterialization = Object.freeze({
    owns(value: unknown): value is ITracked<object> {
      return value !== null && (typeof value === 'object' || typeof value === 'function') && ownership.has(value);
    },
    read<T extends object, K extends keyof ITracked<T>>(value: ITracked<T>, key: K): ITracked<T>[K] {
      if (!ownership.has(value)) {
        throw new TypeError('Materialization reads require an observer-owned tracked value');
      }
      return value[key];
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
      if (typeof value === 'function' && isNativeFunctionSource(Function.prototype.toString.call(value))) {
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
