/**
 * Process-local tags and capture frames implement current observation utilities.
 * Each tracker receives its host context capability; Tracking owns frame policy,
 * while the adapter owns only async propagation. Durable encoding and run-level
 * validity remain outside this module.
 * @packageDocumentation
 */
import { computed, signal, untracked } from '@preact/signals-core';
import type { Signal } from '@preact/signals-core';
import type { IAsyncContextCapability } from '@microdelta/machine';

export type { IAsyncContext, IAsyncContextCapability, ISha256Capability } from '@microdelta/machine';
export type { IAddressSegment, IOperation } from '@microdelta/value';

export { createTrackingObserver } from './observer.js';
export type {
  ICurrentComparison,
  ICurrentFactRequest,
  ICurrentFactProvider,
  ICurrentFactResolution,
  IObservationCapture,
  ITracked,
  ITrackedBrand,
  ITrackedView,
  ITrackingBinding,
  ITrackingMaterialization,
  ITrackingObservation,
  ITrackingObserver,
  ITrackingObserverHost,
} from './observer.js';
export type { IDetachedOutput } from './output-observation.js';

/**
 * Opaque identity for one process-local reactive dependency.
 * Tags cannot be serialized; revision signals remain private to this module.
 * @alpha
 */
export interface Tag { readonly __tag: unique symbol }

/**
 * A process-local position on the shared monotonically increasing revision clock.
 * Revisions have no meaning after a restart and must not be stored durably.
 * @alpha
 */
export type Revision = number;

/** A frame stays open only until its own callback completes. */
interface IFrame {
  readonly consumed: Set<Tag>;
  open: boolean;
}

/** Capture failures as values so cached failures retain their read dependencies. */
type IOutcome<T> = { readonly kind: 'value'; readonly value: T } | { readonly kind: 'error'; readonly error: unknown };

/**
 * One process-local Tracking instance and its isolated capture/revision state.
 * Tags from another instance are rejected even though both instances share the
 * same portable TypeScript brand.
 * @alpha
 */
export interface ITracking {
  /** Create a tag belonging only to this tracker. */
  createTag(): Tag;
  /** Read a tag and add it to this tracker's open capture frame, if any. */
  consume(tag: Tag): void;
  /** Advance this tracker's revision clock for one tag. */
  dirty(tag: Tag): void;
  /** Read the greatest revision represented by the supplied tags. */
  snapshot(tags: Iterable<Tag>): Revision;
  /** Check whether supplied tags remain at or before a revision. */
  isValid(tags: Iterable<Tag>, at: Revision): boolean;
  /** Capture dependencies from a synchronous callback. */
  withFrame<T>(fn: () => T): { value: T; consumed: ReadonlySet<Tag> };
  /** Capture dependencies across asynchronous work and awaits. */
  withFrameAsync<T>(fn: () => Promise<T>): Promise<{ value: T; consumed: ReadonlySet<Tag> }>;
  /** Create a mutable value cell whose reads consume one local tag. */
  cell<T>(initial: T): { get(): T; set(v: T): void };
  /** Create a lazy synchronous derivation over this tracker's cells. */
  derived<T>(fn: () => T): { get(): T };
}

/**
 * Bind Tracking's frame policy to host-provided async propagation. Every call
 * creates independent tags, revisions, and frames; no host capability is held
 * in mutable module-global configuration.
 * @alpha
 */
export function createTracking(capability: IAsyncContextCapability): ITracking {
const frames = capability.createAsyncContext<IFrame>();
const revisions = new WeakMap<Tag, Signal<Revision>>();
let currentRevision: Revision = 0;

// This assertion creates the interface's nominal brand in its sole factory.
// WeakMap membership, rather than the publicly readable brand, validates tokens.
const tagBrand: Tag['__tag'] = Symbol('microdelta.track') as Tag['__tag'];

/** Find the private signal without accepting structurally forged tag objects. */
function revisionOf(tag: Tag): Signal<Revision> {
  const revision = revisions.get(tag);
  if (revision === undefined) {
    throw new TypeError('Expected a process-local tag created by this tracker');
  }
  return revision;
}

/**
 * Create a frozen dependency token at the current revision without consuming it.
 * Its enumerable symbol and function values reject structured/V8 cloning, and
 * the JSON hook rejects accidental serialization instead of silently losing state.
 * @alpha
 */
function createTag(): Tag {
  const tag = Object.freeze<Tag & { toJSON(): never }>({
    __tag: tagBrand,
    toJSON(): never {
      throw new TypeError('Tracking tags are process-local and cannot be serialized');
    },
  });
  revisions.set(tag, signal(currentRevision));
  return tag;
}

/**
 * Entangle a read with both the synchronous derivation and the current ALS frame.
 * Reads outside a frame are allowed; completed frames do not acquire late reads.
 * @alpha
 */
function consume(tag: Tag): void {
  void revisionOf(tag).value;
  const frame = frames.getStore();
  if (frame?.open === true) {
    frame.consumed.add(tag);
  }
}

/**
 * Invalidate a dependency by advancing the shared clock; this is not a read.
 * A global clock ensures that even a tag's first change exceeds every earlier
 * snapshot, including snapshots containing frequently changed sibling tags.
 * @alpha
 */
function dirty(tag: Tag): void {
  const revision = revisionOf(tag);
  currentRevision++;
  revision.value = currentRevision;
}

/**
 * Read the greatest revision across the supplied tags, or zero for an empty set.
 * Peeking never consumes dependencies; iteration supports single-pass iterables.
 * @alpha
 */
function snapshot(tags: Iterable<Tag>): Revision {
  let maximum: Revision = 0;
  for (const tag of tags) {
    maximum = Math.max(maximum, revisionOf(tag).peek());
  }
  return maximum;
}

/**
 * Test whether none of the supplied dependencies advanced past a prior snapshot.
 * Validation does not consume tags or cause derivations to subscribe to them.
 * @alpha
 */
function isValid(tags: Iterable<Tag>, at: Revision): boolean {
  return snapshot(tags) <= at;
}

/**
 * Execute a synchronous callback in a fresh, isolated dependency collector.
 * Nested collectors do not implicitly merge or create hidden adopted-library
 * dependencies. The returned set is a completion snapshot; throws preserve their
 * original value and restore the caller's frame.
 * Use {@link withFrameAsync} for callbacks whose reads continue after await.
 * @alpha
 */
function withFrame<T>(fn: () => T): { value: T; consumed: ReadonlySet<Tag> } {
  const frame: IFrame = { consumed: new Set(), open: true };
  return frames.run(frame, (): { value: T; consumed: ReadonlySet<Tag> } => {
    try {
      // ALS collects the contract's concrete dependencies. Isolating the adopted
      // library prevents a nested collector from subscribing its caller secretly.
      const value = untracked(fn);
      return { value, consumed: new Set(frame.consumed) };
    } finally {
      frame.open = false;
    }
  });
}

/**
 * Execute an asynchronous callback in its own dependency collector across awaits.
 * Concurrent executions stay isolated. Completion returns a snapshot of reads;
 * detached work cannot subsequently change it or entangle with a parent frame.
 * @alpha
 */
async function withFrameAsync<T>(fn: () => Promise<T>): Promise<{ value: T; consumed: ReadonlySet<Tag> }> {
  const frame: IFrame = { consumed: new Set(), open: true };
  return frames.run(frame, async (): Promise<{ value: T; consumed: ReadonlySet<Tag> }> => {
    try {
      // Only the callback's synchronous launch could inherit a surrounding
      // computed context; Machine independently carries frame data across awaits.
      const value = await untracked(fn);
      return { value, consumed: new Set(frame.consumed) };
    } finally {
      frame.open = false;
    }
  });
}

/**
 * Create mutable process-local state whose getter records a dependency.
 * Every explicit set advances the tag, including equal-value sets (TK-3).
 * @alpha
 */
function cell<T>(initial: T): { get(): T; set(v: T): void } {
  let value = initial;
  const tag = createTag();
  return {
    get(): T {
      consume(tag);
      return value;
    },
    set(v: T): void {
      value = v;
      dirty(tag);
    },
  };
}

/**
 * Lazily memoize a synchronous derivation until a dependency read by it changes.
 * Both successful and failed evaluations cache their concrete dependency sets.
 * Every get replays those tags into the caller before returning or rethrowing,
 * preserving composition through cached values, nested derivations, and catches.
 * @alpha
 */
function derived<T>(fn: () => T): { get(): T } {
  const cached = computed(() => {
    const result = withFrame((): IOutcome<T> => {
      try {
        return { kind: 'value', value: fn() };
      } catch (error: unknown) {
        return { kind: 'error', error };
      }
    });
    // Subscribe only to the concrete dependencies returned by this collector.
    // Private signal reads avoid recording cache validation in a caller's ALS
    // frame; the selected result is replayed by get(), including cached failures.
    for (const tag of result.consumed) {
      void revisionOf(tag).value;
    }
    return result;
  });
  return {
    get(): T {
      const result = cached.value;
      for (const tag of result.consumed) {
        consume(tag);
      }
      if (result.value.kind === 'error') {
        throw result.value.error;
      }
      return result.value.value;
    },
  };
}

return Object.freeze({ createTag, consume, dirty, snapshot, isValid, withFrame, withFrameAsync, cell, derived });
}
