/**
 * Current bindings and current facts. Each request reconnects the declared
 * input and helper slots through Definition's structural correspondence; the
 * same reconnection supplies both what author callbacks receive and the
 * current facts a candidate's recorded observations are compared against.
 *
 * Current input facts are selected by navigating a Tracking view of the
 * current input record with a *separate validation observer* that never opens
 * a capture frame. Tracking's own operation semantics therefore produce each
 * current fact, and selecting it can never record evidence into an author
 * capture that happens to be active in the same asynchronous context (for
 * example a parent body whose child is being validated). A recorded read whose
 * current path no longer navigates the same container shape is incompatible,
 * never equal.
 */
import type { IBindingDescriptor, IComposition } from '@microdelta/definition';
import type {
  ICurrentFactProvider,
  ICurrentFactRequest,
  ICurrentFactResolution,
  ITracked,
  ITrackingBinding,
  ITrackingObserver,
} from '@microdelta/tracking';

import { bindingPaths } from './evidence.js';
import type { IResolutionFamily } from './family.js';

/** The current state of one declared slot. */
export type ISlotState<T> =
  | { readonly status: 'bound'; readonly value: T }
  | { readonly status: 'missing' }
  | { readonly status: 'ambiguous' };

/** Every declared input and helper slot, reconnected once per request. */
export interface ICurrentSlots {
  /** Declared input slots in declaration order. */
  readonly inputs: ReadonlyMap<string, ISlotState<unknown>>;
  /** Declared helper slots in declaration order. */
  readonly helpers: ReadonlyMap<string, ISlotState<(...arguments_: never[]) => unknown>>;
}

/** Reconnect the declared input and helper slots of a composition. */
export function reconnectSlots<TInputs extends object, THelpers extends object>(
  composition: IComposition<IResolutionFamily<TInputs, THelpers>>,
  slots: { readonly inputs: readonly string[]; readonly helpers: readonly string[] },
): ICurrentSlots {
  const inputs = new Map<string, ISlotState<unknown>>();
  for (const slot of slots.inputs) {
    const resolution = composition.resolve({ scope: composition.scope, role: 'input', slot });
    inputs.set(slot, resolution.status === 'bound' && resolution.target.role === 'input'
      ? { status: 'bound', value: resolution.target.value }
      : { status: resolution.status === 'ambiguous' ? 'ambiguous' : 'missing' });
  }
  const helpers = new Map<string, ISlotState<(...arguments_: never[]) => unknown>>();
  for (const slot of slots.helpers) {
    const resolution = composition.resolve({ scope: composition.scope, role: 'callable', slot });
    helpers.set(slot, resolution.status === 'bound' && resolution.target.role === 'callable' && resolution.target.kind === 'helper'
      ? { status: 'bound', value: resolution.target.callable }
      : { status: resolution.status === 'ambiguous' ? 'ambiguous' : 'missing' });
  }
  return { inputs, helpers };
}

/**
 * The current input record: every bound declared input slot, in declaration
 * order. Unbound slots are absent here and reported by their slot state.
 */
export function inputRecord(slots: ICurrentSlots): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [slot, state] of slots.inputs) {
    if (state.status === 'bound') {
      record[slot] = state.value;
    }
  }
  return record;
}

/** Marks a current path that no longer has the recorded container shape. */
const incompatible = Symbol('incompatible');

/** Whether a value is an array, seen through a Tracking view's Proxy. */
function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

/**
 * Select one current input fact with Tracking's operation semantics by
 * navigating the validation observer's view of the current input record.
 */
function selectInput(observer: ITrackingObserver, view: ITracked<object>, request: Extract<ICurrentFactRequest, { kind: 'selected' }>): ICurrentFactResolution {
  const target = request.operation === 'own' || request.operation === 'membership' ? request.address.slice(0, -1) : request.address;
  let current: unknown = view;
  for (const segment of target) {
    if (!observer.materialization.owns(current) || (segment.kind === 'index') !== isArray(current)) {
      return { kind: 'incompatible' };
    }
    current = Reflect.get(current, segment.kind === 'property' ? segment.key : String(segment.index));
  }
  const node = current;
  const fact = (): unknown => {
    const current = node;
    switch (request.operation) {
      case 'value':
        return observer.materialization.owns(current) ? incompatible : current;
      case 'length':
        return observer.materialization.owns(current) && isArray(current) ? Reflect.get(current, 'length') : incompatible;
      case 'keys':
        return observer.materialization.owns(current) && !isArray(current) ? observer.keys(current) : incompatible;
      case 'own':
      case 'membership': {
        const last = request.address.at(-1);
        if (last === undefined || !observer.materialization.owns(current) || (last.kind === 'index') !== isArray(current)) {
          return incompatible;
        }
        const key = last.kind === 'property' ? last.key : String(last.index);
        return request.operation === 'own' ? observer.hasOwn(current, key) : Reflect.has(current, key);
      }
      default: {
        const exhaustive: never = request.operation;
        return exhaustive;
      }
    }
  };
  const selected = fact();
  return selected === incompatible
    ? { kind: 'incompatible' }
    : { kind: 'available', fact: { operation: request.operation, address: request.address, fact: selected } };
}

/**
 * The provider of a step's own current facts: its own actually called
 * implementation (`self`), the declared input record and declared helpers.
 * Other bindings, including child outputs, are unavailable here; child output
 * facts are compared separately after the current child is established.
 */
export function ownFactProvider(options: {
  readonly validation: ITrackingObserver;
  readonly slots: ICurrentSlots;
  readonly self: (context: never) => unknown;
}): ICurrentFactProvider {
  let view: ITracked<object> | undefined;
  const inputs = (): ITracked<object> => {
    view ??= options.validation.tracked(inputRecord(options.slots), { path: bindingPaths.inputs });
    return view;
  };
  return Object.freeze({
    resolve(binding: ITrackingBinding, request: ICurrentFactRequest): ICurrentFactResolution {
      const [root, slot, ...rest] = binding.path;
      if (root === 'self' && slot === undefined && request.kind === 'implementation' && request.address.length === 0) {
        return { kind: 'available', fact: options.self };
      }
      if (root === 'callable' && slot !== undefined && rest.length === 0 && request.kind === 'implementation' && request.address.length === 0) {
        const state = options.slots.helpers.get(slot);
        return state === undefined || state.status === 'missing' ? { kind: 'unavailable' }
          : state.status === 'ambiguous' ? { kind: 'ambiguous' }
            : { kind: 'available', fact: state.value };
      }
      if (root === 'inputs' && slot === undefined && request.kind === 'selected') {
        const [first] = request.address;
        if (first !== undefined && first.kind === 'property') {
          const state = options.slots.inputs.get(first.key);
          if (state?.status === 'ambiguous') {
            return { kind: 'ambiguous' };
          }
          if (state?.status === 'missing') {
            return { kind: 'unavailable' };
          }
        }
        return selectInput(options.validation, inputs(), request);
      }
      return { kind: 'unavailable' };
    },
  });
}

/** Whether an observation is bound to a memo's direct child output. */
export function isChildObservation(binding: ITrackingBinding): boolean {
  return binding.path[0] === 'child';
}

/** Whether an observation is bound to a source's previous result (history, not a current input). */
export function isPreviousObservation(binding: ITrackingBinding): boolean {
  return binding.path.length === 1 && binding.path[0] === 'previous';
}

/** The member-scoped descriptor of a sibling step slot. */
export function siblingStep(parent: IBindingDescriptor, slot: string): IBindingDescriptor {
  return Object.freeze({ scope: parent.scope, role: 'step', slot, ...(parent.memberKey === undefined ? {} : { memberKey: parent.memberKey }) });
}
