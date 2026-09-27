/**
 * EXP-1's synchronous, portable probe separates current structural binding from
 * the facts observed during one execution. It decides neither publication nor
 * source freshness, and its scalar value domain is deliberately narrower than
 * the later Tracking and Value Semantics contracts.
 */

/** A declared role has a structural address independent of labels and call order. @internal */
export interface IBindingDescriptor {
  readonly scope: string;
  readonly role: 'input' | 'callable' | 'step';
  readonly slot: string;
  readonly memberKey?: string;
}

/** Only finite scalar data is observed in this fixture; EXP-2 owns the full value grammar. */
type IScalar = string | number | boolean | null;

/** Durable evidence remembers a consumed fact at a structural slot, never a live binding. @internal */
export type IObservation =
  | { readonly kind: 'field'; readonly descriptor: IBindingDescriptor; readonly field: string; readonly value: IScalar }
  | { readonly kind: 'implementation'; readonly descriptor: IBindingDescriptor; readonly source: string };

/** This fixture's exact reference and immutable observation set form one retained candidate. @internal */
export interface ICandidate {
  readonly subject: string;
  readonly version: number;
  readonly reference: string;
  readonly observations: readonly IObservation[];
}

/** Resolution distinguishes a proven current declaration from absent or conflicting declarations. */
type IResolution =
  | { readonly status: 'found'; readonly descriptor: IBindingDescriptor; readonly value: object }
  | { readonly status: 'missing' }
  | { readonly status: 'ambiguous' };

/** A fresh process registers current objects under declared slots before validation. @internal */
export interface IRegistry {
  register(descriptor: IBindingDescriptor, value: object): void;
  resolve(descriptor: IBindingDescriptor): IResolution;
  describe(value: object): IResolution;
}

/** Validation reports why a retained candidate cannot be accepted without executing it. @internal */
export type IValidation =
  | { readonly status: 'hit'; readonly reference: string }
  | {
      readonly status: 'miss';
      readonly reason: 'version' | 'missing-binding' | 'ambiguous-binding' | 'changed-evidence' | 'missing-evidence';
      readonly descriptor?: IBindingDescriptor;
    };

/** The active synchronous capture frame is process-local and never serialized. */
interface IFrame {
  readonly registry: IRegistry;
  readonly observations: IObservation[];
}

/** Wrappers keep their current target only in memory; persisted facts use descriptors. */
const currentTargets = new WeakMap<object, object>();
let activeFrame: IFrame | undefined;

/** Descriptor encoding is local registry bookkeeping; durable records retain fields separately. */
function descriptorKey(descriptor: IBindingDescriptor): string {
  return JSON.stringify([descriptor.scope, descriptor.role, descriptor.slot, descriptor.memberKey ?? null]);
}

/** Copy an author's slot declaration so later mutation cannot redirect this frame's correspondence. */
function frozenDescriptor(descriptor: IBindingDescriptor): IBindingDescriptor {
  if (!descriptor.scope || !descriptor.slot || (descriptor.memberKey !== undefined && !descriptor.memberKey)) {
    throw new TypeError('A binding descriptor needs nonempty scope, slot, and optional member key');
  }
  return Object.freeze({ ...descriptor });
}

/** A scalar check prevents JSON omissions/coercions from fabricating equality in this bounded probe. */
function scalar(value: unknown): value is IScalar {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0));
}

/** Unwrapped source text is evidence only after the declared slot resolves. */
function implementationSource(value: object): string | undefined {
  const original = currentTargets.get(value);
  return typeof original === 'function' ? Function.prototype.toString.call(original) : undefined;
}

/** Fail capture when an observed imported declaration has not been bound structurally. */
function observedDescriptor(frame: IFrame, value: object): IBindingDescriptor {
  const resolution = frame.registry.describe(value);
  if (resolution.status !== 'found') {
    throw new TypeError(`Observed binding has ${resolution.status} structural correspondence`);
  }
  return resolution.descriptor;
}

/**
 * Wrap one imported plain object or function once at declaration. Ordinary reads
 * and calls then collect only the facts actually consumed by an active frame.
 * The wrapper has no durable identity, no async behavior, and no broad native
 * value support; unsupported fields fail visibly during capture.
 * @internal
 */
export function tracked<T extends object>(value: T): T {
  if (typeof value !== 'function' && (Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some(key => typeof key !== 'string')
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(property => !('value' in property)))) {
    throw new TypeError('EXP-1 tracks plain string-keyed objects or functions');
  }
  const wrapper: T = new Proxy(value, {
    get(target, property, receiver): unknown {
      const fact: unknown = Reflect.get(target, property, receiver);
      const frame = activeFrame;
      if (frame && typeof target !== 'function' && typeof property === 'string') {
        if (!Object.hasOwn(target, property) || !scalar(fact)) {
          throw new TypeError(`EXP-1 cannot observe unsupported field ${property}`);
        }
        frame.observations.push({ kind: 'field', descriptor: observedDescriptor(frame, wrapper), field: property, value: fact });
      }
      return fact;
    },
    apply(target, thisArg, args): unknown {
      const frame = activeFrame;
      if (frame) {
        const source = implementationSource(wrapper);
        if (source === undefined) {
          throw new TypeError('A called binding needs an imported tracked function');
        }
        frame.observations.push({ kind: 'implementation', descriptor: observedDescriptor(frame, wrapper), source });
      }
      if (typeof target !== 'function') {
        throw new TypeError('Only functions can be invoked');
      }
      return Reflect.apply(target, thisArg, args);
    },
  });
  currentTargets.set(wrapper, value);
  return wrapper;
}

/** Keep all declarations for a slot so a duplicate cannot silently win by registration order. */
class BindingRegistry implements IRegistry {
  /** Current slot candidates are ephemeral and may differ across processes. */
  readonly #byDescriptor = new Map<string, { readonly descriptor: IBindingDescriptor; readonly value: object }[]>();
  /** A wrapper may be referred to by only one current slot during capture. */
  readonly #byValue = new WeakMap<object, IBindingDescriptor[]>();

  /** Register only wrappers, because source and field evidence must come from their actual target. */
  register(descriptor: IBindingDescriptor, value: object): void {
    if (!currentTargets.has(value)) {
      throw new TypeError('Register a tracked imported object or function');
    }
    const copied = frozenDescriptor(descriptor);
    const key = descriptorKey(copied);
    const entries = this.#byDescriptor.get(key) ?? [];
    entries.push({ descriptor: copied, value });
    this.#byDescriptor.set(key, entries);
    const addresses = this.#byValue.get(value) ?? [];
    addresses.push(copied);
    this.#byValue.set(value, addresses);
  }

  /** A historical address may match exactly one current declaration. */
  resolve(descriptor: IBindingDescriptor): IResolution {
    const entries = this.#byDescriptor.get(descriptorKey(descriptor)) ?? [];
    if (entries.length === 0) {
      return { status: 'missing' };
    }
    if (entries.length !== 1) {
      return { status: 'ambiguous' };
    }
    const entry = entries[0];
    if (entry === undefined) {
      return { status: 'missing' };
    }
    return { status: 'found', descriptor: entry.descriptor, value: entry.value };
  }

  /** Process-local reverse lookup records which declared role was actually consumed. */
  describe(value: object): IResolution {
    const descriptors = this.#byValue.get(value) ?? [];
    if (descriptors.length === 0) {
      return { status: 'missing' };
    }
    if (descriptors.length !== 1) {
      return { status: 'ambiguous' };
    }
    const descriptor = descriptors[0];
    if (descriptor === undefined) {
      return { status: 'missing' };
    }
    return this.resolve(descriptor);
  }
}

/** Build a fresh registry for each process's declared graph. @internal */
export function createRegistry(): IRegistry {
  return new BindingRegistry();
}

/**
 * Capture one synchronous body exactly once. This frame does not retain tags,
 * revisions or closures; nested frames restore their parent even on failure.
 * @internal
 */
export function capture<T>(registry: IRegistry, invoke: () => T): { readonly value: T; readonly observations: readonly IObservation[] } {
  const prior = activeFrame;
  const frame: IFrame = { registry, observations: [] };
  activeFrame = frame;
  try {
    const value = invoke();
    if (value instanceof Promise) {
      throw new TypeError('EXP-1 capture is synchronous');
    }
    return { value, observations: Object.freeze([...frame.observations]) };
  } finally {
    activeFrame = prior;
  }
}

/** Positive safe integers are the unambiguous representable JS subset of the settled version contract. @internal */
export function compatibilityVersion(version?: number): number {
  const selected = version === undefined ? 1 : version;
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new TypeError('Compatibility version must be a positive safe integer');
  }
  return selected;
}

/**
 * Compare current facts after structural lookup; implementation text cannot
 * locate a callable. A valid hit reports the prior exact reference and leaves
 * current-pointer publication entirely outside this probe.
 * @internal
 */
export function validate(registry: IRegistry, candidate: ICandidate, version?: number): IValidation {
  if (candidate.version !== compatibilityVersion(version)) {
    return { status: 'miss', reason: 'version' };
  }
  if (!candidate.observations.some(observation => observation.kind === 'implementation' && observation.descriptor.role === 'step')) {
    return { status: 'miss', reason: 'missing-evidence' };
  }
  for (const observation of candidate.observations) {
    const current = registry.resolve(observation.descriptor);
    if (current.status === 'missing') {
      return { status: 'miss', reason: 'missing-binding', descriptor: observation.descriptor };
    }
    if (current.status === 'ambiguous') {
      return { status: 'miss', reason: 'ambiguous-binding', descriptor: observation.descriptor };
    }
    if (observation.kind === 'implementation') {
      if (implementationSource(current.value) !== observation.source) {
        return { status: 'miss', reason: 'changed-evidence', descriptor: observation.descriptor };
      }
      continue;
    }
    const target = currentTargets.get(current.value);
    if (!target || typeof target === 'function') {
      return { status: 'miss', reason: 'changed-evidence', descriptor: observation.descriptor };
    }
    const property = Object.getOwnPropertyDescriptor(target, observation.field);
    if (!property || !('value' in property) || !scalar(property.value) || !Object.is(property.value, observation.value)) {
      return { status: 'miss', reason: 'changed-evidence', descriptor: observation.descriptor };
    }
  }
  return { status: 'hit', reference: candidate.reference };
}
