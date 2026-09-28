/**
 * The frozen M3 composition and its current structural correspondence.
 *
 * A composition owns framework copies of its declared inputs, helpers and
 * explicitly keyed members before any run. Its supported topology is fixed:
 * members hold source and memo step slots, and the only permitted edge is a memo
 * naming a sibling source slot of the same member, whose pinned declaration must
 * be exactly the one occupying that slot in this composition. That identity is
 * current-composition consistency only; restart correspondence is structural.
 * Resolution of a historical descriptor or direct-child witness yields exactly
 * one current target or a distinct missing/ambiguous/unsupported outcome, never
 * a fallback by name, subject, hash, function identity or ordinal (CMP-1/6/7,
 * REUSE-006/007). Composition and lookup never invoke author callbacks.
 *
 * Each step registration keeps the declaration's own record, so the typed
 * invocation closures reached by `openInvocation` are exactly those retained
 * when the author declared the step.
 */
import { decodeSnapshot, encodeSnapshot } from '@microdelta/value';

import type { IBindingDescriptor } from './descriptor.js';
import type { IDeclarationRecords, IStepDeclaration, IStepRecord } from './declaration.js';
import { reject } from './declaration.js';
import type { IBindingFamily } from './family.js';

/**
 * A declared current input value. Definition retains a frozen copy, so later
 * mutation of the author's object cannot change what the slot denotes.
 * @alpha
 */
export interface IInputRegistration {
  /** Composition-wide input slot name. */
  readonly slot: string;
  /** Supported plain data; accessors and functions are rejected. */
  readonly value: unknown;
}

/**
 * A supplied helper function. Definition retains the author's function itself.
 * @alpha
 */
export interface IHelperRegistration {
  /** Composition-wide callable slot name. */
  readonly slot: string;
  /** The author's helper; never invoked by Definition. */
  readonly helper: (...arguments_: never[]) => unknown;
}

/**
 * A step slot within a member holding one Definition-minted declaration.
 * @alpha
 */
export interface IStepRegistration<TFamily extends IBindingFamily> {
  /** Step slot name within its member. */
  readonly slot: string;
  /** The declaration occupying the slot. */
  readonly declaration: IStepDeclaration<TFamily>;
}

/**
 * An explicitly keyed member and its step slots. The key is structural
 * correspondence, never a display name or invocation ordinal.
 * @alpha
 */
export interface IMemberRegistration<TFamily extends IBindingFamily> {
  /** Explicit stable member key. */
  readonly key: string;
  /** The member's step slots. */
  readonly steps: readonly IStepRegistration<TFamily>[];
}

/**
 * The author's composition builder input. Arrays are copied at composition, so
 * later mutation cannot reconnect or add operations.
 * @alpha
 */
export interface ICompositionOptions<TFamily extends IBindingFamily> {
  /** The analysis scope owning every slot and scoped subject. */
  readonly scope: string;
  /** Declared current inputs. */
  readonly inputs?: readonly IInputRegistration[];
  /** Declared supplied helpers. */
  readonly helpers?: readonly IHelperRegistration[];
  /** Explicitly keyed members. */
  readonly members: readonly IMemberRegistration<TFamily>[];
}

/**
 * A subject qualified by its analysis scope; equal subject text in two scopes
 * denotes two different histories (RES-001).
 * @alpha
 */
export interface IScopedSubject {
  readonly scope: string;
  readonly subject: string;
}

/** The current value bound to an input slot. @alpha */
export interface IInputTarget {
  readonly role: 'input';
  /** Frozen framework-owned copy of the declared value. */
  readonly value: unknown;
}

/** The current helper bound to a callable slot. @alpha */
export interface ICallableTarget {
  readonly role: 'callable';
  /** The author's actual helper function. */
  readonly callable: (...arguments_: never[]) => unknown;
}

/** The current declaration bound to a step slot; invoke it through `openInvocation`. @alpha */
export interface IStepTarget<TFamily extends IBindingFamily> {
  readonly role: 'step';
  /** The Definition-minted declaration, with callback contexts erased. */
  readonly declaration: IStepDeclaration<TFamily>;
  /** The declaration's subject within this composition's scope. */
  readonly scopedSubject: IScopedSubject;
}

/** Whatever a uniquely occupied slot currently denotes. @alpha */
export type IBindingTarget<TFamily extends IBindingFamily> = IInputTarget | ICallableTarget | IStepTarget<TFamily>;

/**
 * Outcome of resolving one descriptor against the current composition.
 * Missing and ambiguous are distinct misses; neither falls back to another slot.
 * @alpha
 */
export type IBindingResolution<TFamily extends IBindingFamily = IBindingFamily> =
  | { readonly status: 'bound'; readonly descriptor: IBindingDescriptor; readonly target: IBindingTarget<TFamily> }
  | { readonly status: 'missing'; readonly descriptor: IBindingDescriptor }
  | { readonly status: 'ambiguous'; readonly descriptor: IBindingDescriptor; readonly occupants: number };

/** One permitted parent-to-child call relationship. @alpha */
export interface IDeclaredEdge {
  readonly parent: IBindingDescriptor;
  readonly child: IBindingDescriptor;
}

/**
 * The frozen abstract step graph, ordered structurally rather than by registration.
 * @alpha
 */
export interface ITopology {
  readonly steps: readonly IBindingDescriptor[];
  readonly edges: readonly IDeclaredEdge[];
}

/**
 * Outcome of reconnecting a historical direct-child witness. Unknown witness
 * versions and argument forms are unsupported rather than guessed (REUSE-007).
 * @alpha
 */
export type IWitnessResolution<TFamily extends IBindingFamily> =
  | { readonly status: 'bound'; readonly parent: IStepTarget<TFamily>; readonly child: IStepTarget<TFamily> }
  | { readonly status: 'missing'; readonly descriptor: IBindingDescriptor }
  | { readonly status: 'ambiguous'; readonly descriptor: IBindingDescriptor; readonly occupants: number }
  | { readonly status: 'undeclared-edge' }
  | { readonly status: 'unsupported'; readonly reason: 'malformed' | 'witness-version' | 'argument-form' };

/**
 * Nominal brand for Definition-minted compositions, with an invariant family marker.
 * @alpha
 */
export interface ICompositionBrand<TFamily extends IBindingFamily> {
  readonly __microdeltaComposition: unique symbol;
  readonly __microdeltaFamily?: (family: TFamily) => TFamily;
}

/**
 * A frozen composition: its scope, fixed topology and current correspondence.
 * @alpha
 */
export interface IComposition<TFamily extends IBindingFamily> extends ICompositionBrand<TFamily> {
  /** The analysis scope. */
  readonly scope: string;
  /** The fixed abstract step graph. */
  readonly topology: ITopology;
  /** Resolve one structural descriptor to its unique current target. */
  resolve(descriptor: IBindingDescriptor): IBindingResolution<TFamily>;
  /** Reconnect a historical direct-child witness, supplied as untrusted durable data. */
  resolveWitness(witness: unknown): IWitnessResolution<TFamily>;
}

/** One occupant of a declared slot. The step record is the declaration's own record. */
export interface IRegistration<TFamily extends IBindingFamily> {
  readonly target: IBindingTarget<TFamily>;
  readonly record: IStepRecord<TFamily> | undefined;
}

/** A composition's private state, reachable only through its builder instance. */
export interface ICompositionState<TFamily extends IBindingFamily> {
  readonly scope: string;
  /** Every occupant of each descriptor key, so ambiguity stays observable. */
  readonly registrations: ReadonlyMap<string, readonly IRegistration<TFamily>[]>;
}

/** Nonzero while a composition is being constructed; framework resolution must reject then. */
let composing = 0;

/** Whether a composition is currently being constructed. */
export function isComposing(): boolean {
  return composing > 0;
}

/** Exact-field descriptor key; there is no partial or normalized match. */
export function descriptorKey(descriptor: IBindingDescriptor): string {
  return JSON.stringify([descriptor.scope, descriptor.role, descriptor.slot, descriptor.memberKey ?? null]);
}

/** Whether two descriptors denote the same slot. */
function sameDescriptor(left: IBindingDescriptor, right: IBindingDescriptor): boolean {
  return descriptorKey(left) === descriptorKey(right);
}

/**
 * Freeze an author's declared graph before any run, without invoking callbacks.
 * @param records - The builder instance's declaration records.
 * @param compositions - The builder instance's composition states.
 * @param options - The author's scope, inputs, helpers and members.
 * @returns The frozen composition.
 */
export function composeIn<TFamily extends IBindingFamily>(
  records: IDeclarationRecords<TFamily>,
  compositions: WeakMap<object, ICompositionState<TFamily>>,
  options: ICompositionOptions<TFamily>,
): IComposition<TFamily> {
  composing++;
  try {
    const scope = nonempty(options.scope, 'scope');
    const registrations = new Map<string, IRegistration<TFamily>[]>();
    const register = (descriptor: IBindingDescriptor, registration: IRegistration<TFamily>): void => {
      const key = descriptorKey(descriptor);
      registrations.set(key, [...(registrations.get(key) ?? []), registration]);
    };
    // Framework-owned copies: arrays are copied once, and input values become
    // frozen Value snapshots, so later author mutation cannot change the graph.
    for (const input of Array.from(options.inputs ?? [])) {
      const slot = nonempty(input.slot, 'input slot');
      register({ scope, role: 'input', slot }, { target: Object.freeze({ role: 'input', value: snapshotInput(input.value, slot) }), record: undefined });
    }
    for (const helper of Array.from(options.helpers ?? [])) {
      const slot = nonempty(helper.slot, 'helper slot');
      if (typeof helper.helper !== 'function') {
        reject('invalid-callback', `Helper ${slot} must be a function.`);
      }
      register({ scope, role: 'callable', slot }, { target: Object.freeze({ role: 'callable', callable: helper.helper }), record: undefined });
    }
    const steps: IBindingDescriptor[] = [];
    const edges: IDeclaredEdge[] = [];
    /** RES-001: each scoped subject is claimed by exactly one declaration object in this composition. */
    const subjects = new Map<string, IStepDeclaration<TFamily>>();
    for (const member of Array.from(options.members)) {
      const memberKey = nonempty(member.key, 'member key');
      const memberSteps = Array.from(member.steps);
      for (const step of memberSteps) {
        const slot = nonempty(step.slot, 'step slot');
        const record = records.get(step.declaration);
        if (record === undefined) {
          reject('forged-declaration', `Step ${slot} holds a declaration this family did not mint.`);
        }
        const claimant = subjects.get(step.declaration.subject);
        if (claimant !== undefined && claimant !== step.declaration) {
          reject('conflicting-subject', `Distinct declarations claim the scoped subject ${step.declaration.subject}.`);
        }
        subjects.set(step.declaration.subject, step.declaration);
        const descriptor = stepDescriptor(scope, slot, memberKey);
        steps.push(descriptor);
        register(descriptor, {
          target: Object.freeze({ role: 'step', declaration: step.declaration, scopedSubject: Object.freeze({ scope, subject: step.declaration.subject }) }),
          record,
        });
        if (record.kind === 'memo') {
          for (const [child, pinned] of record.children) {
            // Current-composition consistency: the pinned child must be the one
            // declaration occupying that sibling slot of this member entry.
            const siblings = memberSteps.filter(sibling => sibling.slot === child);
            const [sibling] = siblings;
            if (siblings.length !== 1 || sibling?.declaration !== pinned || child === slot) {
              reject('illegal-edge', `Memo ${slot} child ${child} must be the declaration occupying that sibling slot.`);
            }
            edges.push(Object.freeze({ parent: descriptor, child: stepDescriptor(scope, child, memberKey) }));
          }
        }
      }
    }
    const topology: ITopology = Object.freeze({
      steps: Object.freeze([...steps].sort(compareDescriptors)),
      edges: Object.freeze([...edges].sort((left, right) => compareDescriptors(left.parent, right.parent) || compareDescriptors(left.child, right.child))),
    });
    const frozenRegistrations: ReadonlyMap<string, readonly IRegistration<TFamily>[]> = new Map(
      [...registrations].map(([key, occupants]) => [key, Object.freeze(occupants)]),
    );
    const resolve = (descriptor: IBindingDescriptor): IBindingResolution<TFamily> => {
      const occupants = frozenRegistrations.get(descriptorKey(descriptor)) ?? [];
      const [only] = occupants;
      if (only === undefined) {
        return { status: 'missing', descriptor };
      }
      return occupants.length > 1 ? { status: 'ambiguous', descriptor, occupants: occupants.length } : { status: 'bound', descriptor, target: only.target };
    };
    const composition: Omit<IComposition<TFamily>, keyof ICompositionBrand<TFamily>> = {
      scope,
      topology,
      resolve,
      resolveWitness(witness: unknown): IWitnessResolution<TFamily> {
        const parsed = parseWitness(witness);
        if (parsed.status === 'unsupported') {
          return parsed;
        }
        const { parent, child } = parsed;
        const parentResolution = resolve(parent);
        if (parentResolution.status !== 'bound') {
          return parentResolution;
        }
        const childResolution = resolve(child);
        if (childResolution.status !== 'bound') {
          return childResolution;
        }
        if (parentResolution.target.role !== 'step' || childResolution.target.role !== 'step' ||
            !topology.edges.some(edge => sameDescriptor(edge.parent, parent) && sameDescriptor(edge.child, child))) {
          return { status: 'undeclared-edge' };
        }
        return { status: 'bound', parent: parentResolution.target, child: childResolution.target };
      },
    };
    Object.freeze(composition);
    compositions.set(composition, { scope, registrations: frozenRegistrations });
    // The brand is type-level only; this module is its sole minting authority.
    return composition as IComposition<TFamily>;
  } finally {
    composing--;
  }
}

/** A frozen step descriptor. */
function stepDescriptor(scope: string, slot: string, memberKey: string): IBindingDescriptor {
  return Object.freeze({ scope, role: 'step', slot, memberKey });
}

/** Scope, member keys and slots are nonempty author strings. */
function nonempty(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    reject('invalid-descriptor', `A ${what} must be a nonempty string.`);
  }
  return value;
}

/**
 * Copy an input into a frozen Value snapshot. Value's walk rejects accessors,
 * cycles and unsupported shapes without invoking getters.
 */
function snapshotInput(value: unknown, slot: string): unknown {
  try {
    return decodeSnapshot(encodeSnapshot(value));
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return reject('invalid-input', `Input ${slot} is not supported plain data: ${detail}`);
  }
}

/** Structural descriptor order: member key, then role, then slot; registration order never matters. */
function compareDescriptors(left: IBindingDescriptor, right: IBindingDescriptor): number {
  const leftKey = [left.memberKey ?? '', left.role, left.slot];
  const rightKey = [right.memberKey ?? '', right.role, right.slot];
  for (let index = 0; index < leftKey.length; index++) {
    const a = leftKey[index] ?? '';
    const b = rightKey[index] ?? '';
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

/** The only supported witness version. */
const WITNESS_VERSION = 1;

/**
 * Parse untrusted durable witness data. Structure is checked first, then the
 * witness version, then the argument form, which must be exactly `{ form: 'empty' }`.
 */
function parseWitness(witness: unknown):
  | { readonly status: 'parsed'; readonly parent: IBindingDescriptor; readonly child: IBindingDescriptor }
  | { readonly status: 'unsupported'; readonly reason: 'malformed' | 'witness-version' | 'argument-form' } {
  if (typeof witness !== 'object' || witness === null || !('parent' in witness) || !('child' in witness)) {
    return { status: 'unsupported', reason: 'malformed' };
  }
  const parent = copyDescriptor(witness.parent);
  const child = copyDescriptor(witness.child);
  if (parent === undefined || child === undefined) {
    return { status: 'unsupported', reason: 'malformed' };
  }
  if (!('version' in witness) || witness.version !== WITNESS_VERSION) {
    return { status: 'unsupported', reason: 'witness-version' };
  }
  const argumentsForm = 'arguments' in witness ? witness.arguments : undefined;
  if (typeof argumentsForm !== 'object' || argumentsForm === null ||
      Object.keys(argumentsForm).length !== 1 || !('form' in argumentsForm) || argumentsForm.form !== 'empty') {
    return { status: 'unsupported', reason: 'argument-form' };
  }
  return { status: 'parsed', parent, child };
}

/** Copy untrusted durable data into a frozen descriptor, or report it malformed. */
function copyDescriptor(value: unknown): IBindingDescriptor | undefined {
  if (typeof value !== 'object' || value === null ||
      !('scope' in value) || typeof value.scope !== 'string' ||
      !('role' in value) || (value.role !== 'input' && value.role !== 'callable' && value.role !== 'step') ||
      !('slot' in value) || typeof value.slot !== 'string') {
    return undefined;
  }
  if ('memberKey' in value && value.memberKey !== undefined) {
    return typeof value.memberKey === 'string'
      ? Object.freeze({ scope: value.scope, role: value.role, slot: value.slot, memberKey: value.memberKey })
      : undefined;
  }
  return Object.freeze({ scope: value.scope, role: value.role, slot: value.slot });
}
