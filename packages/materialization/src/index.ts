/**
 * Selected Materialization loads only explicitly requested result facts, either
 * as top-level scalars or through lazy nested views, emits detached explicit
 * outputs, and builds keyed projections. It provides no freshness policy,
 * storage implementation, publication transition, or reuse grant.
 * @packageDocumentation
 */
import type {
  ICompletedNavigationReader,
  ICompletedProjectionReader,
  ICompletedResultReader,
  ICompletedResultReference,
  ISelectedFingerprintRequest,
  ISelectedFingerprintResolution,
  ISelectedReadRequest,
} from '@microdelta/history';
import { encodeValue, normalizeProjectionDescriptor, normalizeProjectionFact, normalizeSelectedNode } from '@microdelta/value';
import type {
  IAddressSegment,
  ISelectedFact,
  ISelectedNode,
  IValueProjectionDescriptor,
  IValueProjectionFact,
} from '@microdelta/value';
import type {
  ICurrentFactProvider,
  ICurrentFactRequest,
  ICurrentFactResolution,
  IDetachedOutput,
  ITracked,
  ITrackedBrand,
  ITrackedNodeSource,
  ITrackingBinding,
  ITrackingObserver,
} from '@microdelta/tracking';

/** Scalars are the only values exposed through the unexpected top-level result view. @alpha */
export type IMaterializedScalar = undefined | null | boolean | number | string;

/** Preserve declared scalar fields without making nested payloads navigable. @alpha */
export type IMaterializedScalarView<T extends object> = {
  readonly [K in keyof T as T[K] extends IMaterializedScalar ? K : never]: T[K];
} & ITrackedBrand;

/**
 * An immutable lazy view over one exact retained record or array. Nested
 * records and arrays stay lazy views carrying Tracking's canonical brand;
 * scalar leaves are ordinary values. Arrays expose numeric positions and
 * `length` only. The view is owned by the composed Tracking observer, so its
 * explicit key, presence and output operations behave as for tracked inputs.
 * @alpha
 */
export type IMaterializedView<T extends object> = ITracked<T>;

/** Frozen selected member content returned by one aggregate projection operation. @alpha */
export type IMaterializedProjection = IValueProjectionFact;

/** Construction ports supplied by composition; projection reading remains optional. @alpha */
export interface IMaterializationOptions {
  /** Tracking records the semantic facts selected by this component. */
  readonly tracking: ITrackingObserver;
  /** Exact scalar and fingerprint-only reader for completed immutable snapshots. */
  readonly reader: ICompletedResultReader;
  /** Separate capability so scalar-only History readers need not implement projection reads. */
  readonly projectionReader?: ICompletedProjectionReader;
  /** Separate capability for nested navigation; scalar-only readers keep their existing behavior. */
  readonly navigationReader?: ICompletedNavigationReader;
}

/** A resolved binding identifies the exact completed result used for current metadata. @alpha */
export type ICompletedReferenceResolver = (binding: ITrackingBinding) => ICompletedResultReference | undefined;

/**
 * Selected read and output operations composed from History, Value, and Tracking
 * ports. Each unexpected field read is independent; no cache or eviction policy
 * is implied by this view.
 * @alpha
 */
export interface IMaterialization {
  /** Make only requested top-level scalar properties available from the exact reference. */
  materialize<T extends object>(
    reference: ICompletedResultReference,
    binding: ITrackingBinding,
  ): IMaterializedScalarView<T>;
  /**
   * Make one exact reference's record or array root navigable as a lazy nested
   * view. Each member read asks the navigation reader for exactly that node and
   * records only consumed leaves, lengths, presence and key order; passing
   * through a container records nothing. Requires the navigation capability.
   */
  materializeView<T extends object>(
    reference: ICompletedResultReference,
    binding: ITrackingBinding,
  ): IMaterializedView<T>;
  /** Explicitly detach supplied output and observe each selected tracked subtree. */
  materializeOutput<T>(output: T): IDetachedOutput<T>;
  /** Build and record one canonical keyed projection from already selected content. */
  project(binding: ITrackingBinding, fact: IValueProjectionFact): IMaterializedProjection;
  /** Read and record a keyed projection through the separately supplied reader capability. */
  projectFrom(
    reference: ICompletedResultReference,
    binding: ITrackingBinding,
    descriptor: IValueProjectionDescriptor,
  ): IMaterializedProjection;
  /** Record sequence only when a consumer actually depends on member order. */
  observeMemberOrder(binding: ITrackingBinding, keys: readonly string[]): readonly string[];
  /** Adapt exact History metadata lookups into Tracking's operation-specific request port. */
  currentProvider(resolveReference: ICompletedReferenceResolver, fallback: ICurrentFactProvider): ICurrentFactProvider;
}

/** Validate a reference before passing it across the reader boundary. */
function copyReference(reference: ICompletedResultReference): ICompletedResultReference {
  if (reference === null || typeof reference !== 'object') {
    throw new TypeError('Completed-result reference must be an object');
  }
  const kind = Object.getOwnPropertyDescriptor(reference, 'kind');
  const locator = Object.getOwnPropertyDescriptor(reference, 'locator');
  if (kind === undefined || !('value' in kind) || kind.value !== 'completed-result'
    || locator === undefined || !('value' in locator) || typeof locator.value !== 'string' || locator.value.length === 0) {
    throw new TypeError('Completed-result reference needs a supported kind and opaque locator');
  }
  return Object.freeze({ kind: 'completed-result', locator: locator.value });
}

/** Copy and validate a caller's structural binding before it enters an observation envelope. */
function copyBinding(binding: ITrackingBinding): ITrackingBinding {
  if (binding === null || typeof binding !== 'object') {
    throw new TypeError('Materialization binding must contain a structural path');
  }
  const pathDescriptor = Object.getOwnPropertyDescriptor(binding, 'path');
  if (pathDescriptor === undefined || !('value' in pathDescriptor) || !Array.isArray(pathDescriptor.value)) {
    throw new TypeError('Materialization binding path must be an own data array');
  }
  const path: string[] = [];
  for (let index = 0; index < pathDescriptor.value.length; index += 1) {
    const segment = Object.getOwnPropertyDescriptor(pathDescriptor.value, String(index));
    if (segment === undefined || !('value' in segment) || typeof segment.value !== 'string') {
      throw new TypeError('Materialization binding path must contain only dense string segments');
    }
    path.push(segment.value);
  }
  return Object.freeze({ path: Object.freeze(path) });
}

/** Copy a Value address after validating every segment as a data descriptor. */
function copyAddress(address: unknown): readonly IAddressSegment[] {
  if (!Array.isArray(address)) {
    throw new TypeError('Selected fact address must be an array');
  }
  const copied: IAddressSegment[] = [];
  for (let index = 0; index < address.length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(address, String(index));
    if (slot === undefined || !('value' in slot)) {
      throw new TypeError('Selected fact address must contain dense structured segments');
    }
    const slotValue = propertyValue(slot);
    if (slotValue === null || typeof slotValue !== 'object') {
      throw new TypeError('Selected fact address must contain dense structured segments');
    }
    const segment = slotValue;
    const keys = Reflect.ownKeys(segment);
    const kind = Object.getOwnPropertyDescriptor(segment, 'kind');
    if (keys.length === 2 && keys.every((key) => typeof key === 'string')
      && kind !== undefined && 'value' in kind) {
      const key = Object.getOwnPropertyDescriptor(segment, 'key');
      const keyValue = key === undefined || !('value' in key) ? undefined : propertyValue(key);
      if (propertyValue(kind) === 'property' && typeof keyValue === 'string') {
        copied.push(Object.freeze({ kind: 'property', key: keyValue }));
        continue;
      }
      const index = Object.getOwnPropertyDescriptor(segment, 'index');
      const indexValue = index === undefined || !('value' in index) ? undefined : propertyValue(index);
      if (propertyValue(kind) === 'index' && typeof indexValue === 'number'
        && Number.isSafeInteger(indexValue) && indexValue >= 0) {
        copied.push(Object.freeze({ kind: 'index', index: indexValue }));
        continue;
      }
    }
    throw new TypeError('Selected fact address contains an unsupported data segment');
  }
  return Object.freeze(copied);
}

/** PropertyDescriptor.value is typed as any by the DOM library; this boundary deliberately demotes it. */
function propertyValue(descriptor: PropertyDescriptor): unknown {
  return descriptor.value as unknown;
}

/** Reject malformed reader envelopes and ensure they answer the exact dispatched request. */
function validateSelectedFact(value: unknown, request: ISelectedReadRequest): ISelectedFact {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Selected reader returned a malformed fact');
  }
  const operation = Object.getOwnPropertyDescriptor(value, 'operation');
  const address = Object.getOwnPropertyDescriptor(value, 'address');
  const fact = Object.getOwnPropertyDescriptor(value, 'fact');
  if (operation === undefined || !('value' in operation) || address === undefined || !('value' in address)
    || fact === undefined || !('value' in fact)) {
    throw new TypeError('Selected reader facts require own data fields');
  }
  const copiedAddress = copyAddress(propertyValue(address));
  const operationValue = propertyValue(operation);
  if (operationValue !== request.operation || encodeValue(copiedAddress) !== encodeValue(request.address)) {
    throw new TypeError('Selected reader returned a fact for a mismatched operation or address');
  }
  if (Object.keys(value).length !== 3) {
    throw new TypeError('Selected reader fact has unsupported fields');
  }
  return Object.freeze({ operation: request.operation, address: copiedAddress, fact: propertyValue(fact) });
}

/** Verify that a projection reader answered the requested relative selection. */
function validateProjectionFact(value: unknown, descriptor: IValueProjectionDescriptor): IValueProjectionFact {
  const candidate = requireProjectionFact(value);
  const normalized = normalizeProjectionFact(candidate);
  if (encodeValue(normalized.descriptor) !== encodeValue(descriptor)) {
    throw new TypeError('Projection reader returned a mismatched descriptor');
  }
  return normalized;
}

/** Validate outer projection ownership without reading through a caller accessor. */
function requireProjectionFact(value: unknown): IValueProjectionFact {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Projection reader returned a malformed projection fact');
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'descriptor');
  const members = Object.getOwnPropertyDescriptor(value, 'members');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || keys.some((key) => key !== 'descriptor' && key !== 'members')
    || descriptor === undefined || !('value' in descriptor)
    || members === undefined || !('value' in members)) {
    throw new TypeError('Projection reader must return own descriptor and member data');
  }
  // The Value encoder performs the complete structural and graph validation.
  // These assertions bridge unknown descriptor values only after its own-data envelope is fixed.
  return {
    descriptor: propertyValue(descriptor) as IValueProjectionDescriptor,
    members: propertyValue(members) as IValueProjectionFact['members'],
  };
}

/** Validate selected content and detach it as Value-owned canonical immutable data. */
function detachProjection(fact: IValueProjectionFact): IMaterializedProjection {
  return normalizeProjectionFact(fact);
}

/**
 * Validate a navigation reader's answer as a Value node for exactly the
 * dispatched address. Malformed, asynchronous or mismatched answers fail here,
 * at the History boundary, before Tracking records or returns anything.
 */
function validateNode(value: unknown, address: readonly IAddressSegment[]): ISelectedNode {
  const node = normalizeSelectedNode(value);
  const answered = node.kind === 'scalar' ? node.selected.address : node.address;
  if (encodeValue(answered) !== encodeValue(address)) {
    throw new TypeError('Navigation reader returned a node for a mismatched address');
  }
  return node;
}

/**
 * Adapt one exact reference to Tracking's node-source port. Each request is
 * detached before dispatch so a reader cannot mutate the address it answers,
 * and every answer is validated against the dispatched request. Presence and
 * key-order facts use the reader's ordinary selected-read contract.
 */
function createNodeSource(
  reference: ICompletedResultReference,
  reader: ICompletedResultReader,
  navigationReader: ICompletedNavigationReader,
): ITrackedNodeSource {
  return Object.freeze({
    node(address: readonly IAddressSegment[]): ISelectedNode {
      const requested = copyAddress(address);
      return validateNode(navigationReader.readNode(reference, requested), requested);
    },
    select(address: readonly IAddressSegment[], operation: 'own' | 'membership' | 'keys'): ISelectedFact {
      const request: ISelectedReadRequest = Object.freeze({ operation, address: copyAddress(address) });
      return validateSelectedFact(reader.readSelected(reference, request), request);
    },
    subtree(address: readonly IAddressSegment[]): unknown {
      return navigationReader.readSubtree(reference, copyAddress(address));
    },
  });
}

/** A selected view maps one property get to one exact History read and one Tracking fact. */
function createScalarView<T extends object>(
  reference: ICompletedResultReference,
  binding: ITrackingBinding,
  reader: ICompletedResultReader,
  tracking: ITrackingObserver,
): IMaterializedScalarView<T> {
  const target = Object.create(null) as object;
  const fail = (operation: string): never => { throw new TypeError(`Materialized result ${operation} is unsupported`); };
  const view = new Proxy(target, {
    get(_target, key): unknown {
      tracking.materialization.assertFrameOpen();
      if (typeof key !== 'string') {
        return fail('symbol access');
      }
      const request: ISelectedReadRequest = { operation: 'value', address: [{ kind: 'property', key }] };
      const fact = validateSelectedFact(reader.readSelected(reference, request), request);
      if (fact.fact !== null && (typeof fact.fact === 'object' || typeof fact.fact === 'function')) {
        return fail('nested value access');
      }
      // Tracking skips recordSelected outside captures, so enforce the scalar domain before that boundary.
      if (typeof fact.fact === 'bigint' || typeof fact.fact === 'symbol') {
        return fail('unsupported scalar access');
      }
      tracking.materialization.recordSelected(binding, fact);
      return fact.fact;
    },
    has(): boolean { return fail('presence checks'); },
    ownKeys(): ArrayLike<string | symbol> { return fail('enumeration'); },
    getOwnPropertyDescriptor(): PropertyDescriptor | undefined { return fail('property descriptors'); },
    getPrototypeOf(): object | null { return fail('prototype reflection'); },
    setPrototypeOf(): boolean { return fail('prototype mutation'); },
    isExtensible(): boolean { return fail('extensibility reflection'); },
    preventExtensions(): boolean { return fail('extensibility mutation'); },
    set(): boolean { return fail('mutation'); },
    defineProperty(): boolean { return fail('property definition'); },
    deleteProperty(): boolean { return fail('property deletion'); },
  });
  return view as IMaterializedScalarView<T>;
}

/**
 * Compose selected reads with exact History and Tracking ports. The current
 * provider asks History for compatible metadata only; selected payload fallback
 * remains an explicit operation on the returned scalar view.
 * @alpha
 */
export function createMaterialization(options: IMaterializationOptions): IMaterialization {
  return Object.freeze({
    materialize<T extends object>(reference: ICompletedResultReference, binding: ITrackingBinding): IMaterializedScalarView<T> {
      const exactReference = copyReference(reference);
      return createScalarView<T>(exactReference, copyBinding(binding), options.reader, options.tracking);
    },
    materializeView<T extends object>(reference: ICompletedResultReference, binding: ITrackingBinding): IMaterializedView<T> {
      options.tracking.materialization.assertFrameOpen();
      const exactReference = copyReference(reference);
      const copiedBinding = copyBinding(binding);
      if (options.navigationReader === undefined) {
        throw new TypeError('This completed-result reader does not support nested navigation');
      }
      const source = createNodeSource(exactReference, options.reader, options.navigationReader);
      return options.tracking.materialization.lazyView<T>(copiedBinding, source);
    },
    materializeOutput<T>(output: T): IDetachedOutput<T> {
      return options.tracking.snapshotOutput(output);
    },
    project(binding: ITrackingBinding, fact: IValueProjectionFact): IMaterializedProjection {
      options.tracking.materialization.assertFrameOpen();
      const copiedBinding = copyBinding(binding);
      let detached: IMaterializedProjection;
      try {
        detached = detachProjection(fact);
      } catch (error: unknown) {
        const context = copiedBinding.path.length === 0 ? '<root>' : copiedBinding.path.join('.');
        const detail = error instanceof Error ? error.message : 'invalid projection fact';
        throw new TypeError(`Invalid projection for collection ${context}: ${detail}`);
      }
      options.tracking.materialization.recordProjection(copiedBinding, fact);
      return detached;
    },
    projectFrom(
      reference: ICompletedResultReference,
      binding: ITrackingBinding,
      descriptor: IValueProjectionDescriptor,
    ): IMaterializedProjection {
      options.tracking.materialization.assertFrameOpen();
      const exactReference = copyReference(reference);
      if (options.projectionReader === undefined) {
        throw new TypeError('This completed-result reader does not support keyed projections');
      }
      const copiedBinding = copyBinding(binding);
      // Value detaches the selection before reader code can mutate its request or the caller's descriptor.
      const selection = normalizeProjectionDescriptor(descriptor);
      const source = options.projectionReader.readProjection(exactReference, selection);
      const detached = validateProjectionFact(source, selection);
      options.tracking.materialization.recordProjection(copiedBinding, detached);
      return detached;
    },
    observeMemberOrder(binding: ITrackingBinding, keys: readonly string[]): readonly string[] {
      options.tracking.materialization.assertFrameOpen();
      const copiedBinding = copyBinding(binding);
      options.tracking.materialization.recordCollectionOrder(copiedBinding, keys);
      return Object.freeze([...keys]);
    },
    currentProvider(resolveReference: ICompletedReferenceResolver, fallback: ICurrentFactProvider): ICurrentFactProvider {
      return Object.freeze({
        resolve(binding: ITrackingBinding, request: ICurrentFactRequest): ICurrentFactResolution {
          if (request.kind === 'implementation' || request.kind === 'collection-order') {
            return fallback.resolve(binding, request);
          }
          const reference = resolveReference(binding);
          if (reference === undefined) {
            return { kind: 'unavailable' };
          }
          const exactReference = copyReference(reference);
          const fingerprintRequest: ISelectedFingerprintRequest = request.kind === 'selected'
            ? { kind: 'selected', operation: request.operation, address: request.address, encoding: request.encodingVersion }
            : request.kind === 'projection'
              ? { kind: 'projection', descriptor: request.descriptor, encoding: request.encodingVersion }
              : { kind: 'materialized-output', address: request.address, encoding: request.encodingVersion };
          const resolution: ISelectedFingerprintResolution = options.reader.resolveFingerprint(exactReference, fingerprintRequest);
          switch (resolution.kind) {
            case 'compatible':
              return {
                kind: 'compatible-fingerprint',
                selection: request,
                encodingVersion: request.encodingVersion,
                fingerprint: resolution.fingerprint,
              };
            case 'unavailable':
            case 'incompatible':
            case 'ambiguous':
              return resolution;
            default: {
              const exhaustive: never = resolution;
              return exhaustive;
            }
          }
        },
      });
    },
  });
}
