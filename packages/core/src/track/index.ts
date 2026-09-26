import { AsyncLocalStorage } from 'node:async_hooks';

import { computed, signal, untracked } from '@preact/signals-core';
import type { Signal } from '@preact/signals-core';

/**
 * Opaque identity for one process-local reactive dependency.
 * Tags cannot be serialized; revision signals remain private to this module.
 * @public
 */
export interface Tag { readonly __tag: unique symbol }

/**
 * A process-local position on the shared monotonically increasing revision clock.
 * Revisions have no meaning after a restart and must not be stored durably.
 * @public
 */
export type Revision = number;

/** A frame stays open only until its own callback completes. */
interface IFrame {
  readonly consumed: Set<Tag>;
  open: boolean;
}

/** Capture failures as values so cached failures retain their read dependencies. */
type IOutcome<T> = { readonly kind: 'value'; readonly value: T } | { readonly kind: 'error'; readonly error: unknown };

const frames = new AsyncLocalStorage<IFrame>();
const revisions = new WeakMap<Tag, Signal<Revision>>();
let currentRevision: Revision = 0;

// This assertion creates the interface's nominal brand in its sole factory.
// WeakMap membership, rather than the publicly readable brand, validates tokens.
const tagBrand: Tag['__tag'] = Symbol('microdelta.track') as Tag['__tag'];

/** Find the private signal without accepting structurally forged tag objects. */
function revisionOf(tag: Tag): Signal<Revision> {
  const revision = revisions.get(tag);
  if (revision === undefined) {
    throw new TypeError('Expected a process-local tag created by this track module');
  }
  return revision;
}

/**
 * Create a frozen dependency token at the current revision without consuming it.
 * Its enumerable symbol and function values reject structured/V8 cloning, and
 * the JSON hook rejects accidental serialization instead of silently losing state.
 * @public
 */
export function createTag(): Tag {
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
 * @public
 */
export function consume(tag: Tag): void {
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
 * @public
 */
export function dirty(tag: Tag): void {
  const revision = revisionOf(tag);
  currentRevision++;
  revision.value = currentRevision;
}

/**
 * Read the greatest revision across the supplied tags, or zero for an empty set.
 * Peeking never consumes dependencies; iteration supports single-pass iterables.
 * @public
 */
export function snapshot(tags: Iterable<Tag>): Revision {
  let maximum: Revision = 0;
  for (const tag of tags) {
    maximum = Math.max(maximum, revisionOf(tag).peek());
  }
  return maximum;
}

/**
 * Test whether none of the supplied dependencies advanced past a prior snapshot.
 * Validation does not consume tags or cause derivations to subscribe to them.
 * @public
 */
export function isValid(tags: Iterable<Tag>, at: Revision): boolean {
  return snapshot(tags) <= at;
}

/**
 * Execute a synchronous callback in a fresh, isolated dependency collector.
 * Nested collectors do not implicitly merge or create hidden adopted-library
 * dependencies. The returned set is a completion snapshot; throws preserve their
 * original value and restore the caller's frame.
 * Use {@link withFrameAsync} for callbacks whose reads continue after await.
 * @public
 */
export function withFrame<T>(fn: () => T): { value: T; consumed: ReadonlySet<Tag> } {
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
 * @public
 */
export async function withFrameAsync<T>(fn: () => Promise<T>): Promise<{ value: T; consumed: ReadonlySet<Tag> }> {
  const frame: IFrame = { consumed: new Set(), open: true };
  return frames.run(frame, async (): Promise<{ value: T; consumed: ReadonlySet<Tag> }> => {
    try {
      // Only the callback's synchronous launch could inherit a surrounding
      // computed context; ALS independently carries collection across its awaits.
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
 * @public
 */
export function cell<T>(initial: T): { get(): T; set(v: T): void } {
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
 * @public
 */
export function derived<T>(fn: () => T): { get(): T } {
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
