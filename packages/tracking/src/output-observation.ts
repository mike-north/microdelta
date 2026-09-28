/**
 * Explicit output observation owns the one operation that may traverse a
 * supplied graph: materializing its exact supported shape as detached data.
 * Ordinary callback results stay opaque and are never expanded here.
 * @packageDocumentation
 */
import { decodeSnapshot, encodeSnapshot, fingerprint } from '@microdelta/value';
import type { ISha256Capability } from '@microdelta/machine';

import type { IAddressSegment } from '@microdelta/value';
import type { ITrackedBrand, ITrackingBinding } from './observer.js';

/** Recursively remove observer ownership while retaining the immutable data shape accepted at runtime. @alpha */
export type IDetachedOutput<T> = T extends (...arguments_: never[]) => unknown
  ? never
  : T extends readonly unknown[]
    ? number extends T['length']
      ? readonly IDetachedOutput<T[number]>[]
      : T extends readonly [...infer Elements]
        ? { readonly [K in keyof Elements]: IDetachedOutput<Elements[K]> }
        : never
    : T extends object
      ? { readonly [K in keyof T as K extends keyof ITrackedBrand ? never : K]: IDetachedOutput<T[K]> }
      : T;

/** Private source and provenance used only while the explicit output is copied. @internal */
export interface IOutputOwnership {
  readonly binding: ITrackingBinding;
  readonly address: readonly IAddressSegment[];
  /** The supported data to detach; for a lazy view it is loaded only for this explicit output. */
  readonly value: object;
  /** One identity per underlying retained node, so repeated wrappers of it are detected as aliases. */
  readonly identity: object;
}

/** One successfully snapshotted tracked subtree to add to the active frame. @internal */
export interface IOutputFact {
  readonly ownership: IOutputOwnership;
  readonly encoded: string;
  readonly fingerprint: string;
}

/** Narrow closure ports keep this traversal independent of Tracking frame internals. @internal */
export interface IOutputObservationCallbacks {
  /** Reject inherited work before this operation traverses or hashes any supplied data. */
  readonly assertFrameOpen: () => void;
  /** Resolve only proxies registered in this observer's private table. */
  readonly ownershipOf: (value: object) => IOutputOwnership | undefined;
  /** Append one already validated subtree fact to the current open frame. */
  readonly record: (fact: IOutputFact) => void;
}

/**
 * Build the explicit output port around private wrapper lookup and evidence
 * recording. One identity set spans the complete output graph and prototype
 * chains, so copying independent branches cannot conceal aliases.
 * @internal
 */
export function createOutputObservationPort(
  callbacks: IOutputObservationCallbacks,
  machine: ISha256Capability,
): { snapshotOutput<T>(output: T): IDetachedOutput<T> } {
  /** Clone supported enumerable data without invoking accessors or changing key order. */
  function copyNode(source: object, identities: WeakSet<object>, pending: IOutputFact[], alreadySeen: boolean): object {
    if (!alreadySeen) {
      if (identities.has(source)) {
        throw new TypeError('Output cannot contain cycles or repeated references');
      }
      identities.add(source);
    }
    if (Array.isArray(source)) {
      if (Object.getPrototypeOf(source) !== Array.prototype || Object.getOwnPropertySymbols(source).length !== 0) {
        throw new TypeError('Output array has an unsupported prototype or symbol key');
      }
      const target = new Array<unknown>(source.length);
      for (const key of Object.getOwnPropertyNames(source)) {
        if (key === 'length') {
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
          throw new TypeError(`Output array slot ${key} is hidden or an accessor`);
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key || index >= source.length) {
          throw new TypeError(`Output array property ${key} is unsupported`);
        }
        target[index] = copyValue(descriptor.value, identities, pending);
      }
      return target;
    }

    if (Object.getOwnPropertySymbols(source).length !== 0) {
      throw new TypeError('Output records cannot contain user symbol keys');
    }
    const sourcePrototype = Object.getPrototypeOf(source) as object | null;
    let targetPrototype: object | null = sourcePrototype;
    if (sourcePrototype !== null && sourcePrototype !== Object.prototype) {
      if (identities.has(sourcePrototype)) {
        throw new TypeError('Output cannot contain cycles or repeated references through prototypes');
      }
      targetPrototype = copyValue(sourcePrototype, identities, pending) as object;
    }
    const target = Object.create(targetPrototype) as object;
    for (const key of Object.getOwnPropertyNames(source)) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError(`Output property ${key} is hidden or an accessor`);
      }
      Object.defineProperty(target, key, {
        value: copyValue(descriptor.value, identities, pending),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return target;
  }

  /** Expand owned wrappers only for this explicit output request; local values remain ordinary data. */
  function copyValue(value: unknown, identities: WeakSet<object>, pending: IOutputFact[]): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return value;
    }
    const ownership = callbacks.ownershipOf(value);
    if (ownership !== undefined) {
      if (identities.has(value) || identities.has(ownership.identity) || identities.has(ownership.value)) {
        throw new TypeError('Output cannot contain cycles or repeated tracked subtrees');
      }
      identities.add(value);
      identities.add(ownership.identity);
      identities.add(ownership.value);
      const encoded = encodeSnapshot(ownership.value);
      pending.push({ ownership, encoded, fingerprint: fingerprint(encoded, machine) });
      return copyNode(ownership.value, identities, pending, true);
    }
    if (typeof value === 'function') {
      throw new TypeError('Output functions are outside the supported Value domain');
    }
    return copyNode(value, identities, pending, false);
  }

  return Object.freeze({
    snapshotOutput<T>(output: T): IDetachedOutput<T> {
      callbacks.assertFrameOpen();
      const pending: IOutputFact[] = [];
      const identities = new WeakSet<object>();
      const prepared = copyValue(output, identities, pending);
      const encoded = encodeSnapshot(prepared);
      const detached: unknown = decodeSnapshot(encoded);
      for (const fact of pending) {
        callbacks.record(fact);
      }
      return detached as IDetachedOutput<T>;
    },
  });
}
