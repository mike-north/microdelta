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
import type { DefinitionError } from './errors.js';
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
    // Every registration record is captured exactly once through its own data
    // property descriptors. Validation, lookup and invocation all use this one
    // framework-owned capture, so no later read can observe a different value.
    const optionFields = captureFields(options, { scope: 'invalid-descriptor', inputs: 'invalid-descriptor', helpers: 'invalid-descriptor', members: 'invalid-descriptor' });
    const scope = nonempty(optionFields.get('scope'), 'scope');
    const registrations = new Map<string, IRegistration<TFamily>[]>();
    const register = (descriptor: IBindingDescriptor, registration: IRegistration<TFamily>): void => {
      const key = descriptorKey(descriptor);
      registrations.set(key, [...(registrations.get(key) ?? []), registration]);
    };
    // Framework-owned copies: arrays are copied once, and input values become
    // frozen Value snapshots, so later author mutation cannot change the graph.
    for (const input of listOf(optionFields.get('inputs'), 'inputs', true)) {
      const fields = captureFields(input, { slot: 'invalid-descriptor', value: 'invalid-input' });
      const slot = nonempty(fields.get('slot'), 'input slot');
      register({ scope, role: 'input', slot }, { target: Object.freeze({ role: 'input', value: snapshotInput(fields.get('value'), slot) }), record: undefined });
    }
    for (const helper of listOf(optionFields.get('helpers'), 'helpers', true)) {
      const fields = captureFields(helper, { slot: 'invalid-descriptor', helper: 'invalid-callback' });
      const slot = nonempty(fields.get('slot'), 'helper slot');
      const callable = fields.get('helper');
      if (!isCallable(callable)) {
        reject('invalid-callback', `Helper ${slot} must be a function.`);
      }
      register({ scope, role: 'callable', slot }, { target: Object.freeze({ role: 'callable', callable }), record: undefined });
    }
    const steps: IBindingDescriptor[] = [];
    const edges: IDeclaredEdge[] = [];
    /** RES-001: each scoped subject is claimed by exactly one declaration object in this composition. */
    const subjects = new Map<string, IStepDeclaration<TFamily>>();
    for (const member of listOf(optionFields.get('members'), 'members', false)) {
      const memberFields = captureFields(member, { key: 'invalid-descriptor', steps: 'invalid-descriptor' });
      const memberKey = nonempty(memberFields.get('key'), 'member key');
      // Capture every step of this member once, before any edge refers to a sibling.
      const memberSteps = listOf(memberFields.get('steps'), 'member steps', false).map(step => {
        const fields = captureFields(step, { slot: 'invalid-descriptor', declaration: 'forged-declaration' });
        const slot = nonempty(fields.get('slot'), 'step slot');
        const candidate = fields.get('declaration');
        const record = typeof candidate === 'object' && candidate !== null ? records.get(candidate) : undefined;
        if (record === undefined) {
          return reject('forged-declaration', `Step ${slot} holds a declaration this family did not mint.`);
        }
        return { slot, record };
      });
      for (const { slot, record } of memberSteps) {
        const declaration = record.declaration;
        const claimant = subjects.get(declaration.subject);
        if (claimant !== undefined && claimant !== declaration) {
          reject('conflicting-subject', `Distinct declarations claim the scoped subject ${declaration.subject}.`);
        }
        subjects.set(declaration.subject, declaration);
        const descriptor = stepDescriptor(scope, slot, memberKey);
        steps.push(descriptor);
        register(descriptor, {
          target: Object.freeze({ role: 'step', declaration, scopedSubject: Object.freeze({ scope, subject: declaration.subject }) }),
          record,
        });
        if (record.kind === 'memo') {
          for (const [child, pinned] of record.children) {
            // Current-composition consistency: the pinned child must be the one
            // declaration occupying that sibling slot of this member entry.
            const siblings = memberSteps.filter(sibling => sibling.slot === child);
            const [sibling] = siblings;
            if (siblings.length !== 1 || sibling?.record.declaration !== pinned || child === slot) {
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
    const resolve = (supplied: IBindingDescriptor): IBindingResolution<TFamily> => {
      const descriptor = ownedDescriptor(supplied);
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

/**
 * Capture a registration record's recognized fields exactly once through their
 * own property descriptors. An accessor or an inherited recognized field is an
 * unsupported builder shape and rejects with that field's code; no getter runs.
 * CMP-9 guards framework resolution during construction; this is not a claim to
 * sandbox arbitrary JavaScript, only that validated and used values are the same.
 */
function captureFields(value: unknown, fields: Readonly<Record<string, DefinitionError['code']>>): ReadonlyMap<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    reject('invalid-descriptor', 'A composition registration must be a record.');
  }
  const captured = new Map<string, unknown>();
  for (const [key, code] of Object.entries(fields)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      if (key in value) {
        reject(code, `Registration field ${key} must be an own property, not inherited.`);
      }
      captured.set(key, undefined);
      continue;
    }
    if (!('value' in descriptor)) {
      reject(code, `Registration field ${key} must be a data property, not an accessor.`);
    }
    captured.set(key, descriptor.value);
  }
  return captured;
}

/** Copy a captured registration list once; optional lists may be absent. */
function listOf(value: unknown, what: string, optional: boolean): readonly unknown[] {
  if (value === undefined && optional) {
    return [];
  }
  if (!Array.isArray(value)) {
    reject('invalid-descriptor', `Composition ${what} must be an array.`);
  }
  return Array.from(value as readonly unknown[]);
}

/** A supplied helper is any function; Definition never invokes it. */
function isCallable(value: unknown): value is (...arguments_: never[]) => unknown {
  return typeof value === 'function';
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
  const parent = copyDescriptor(ownData(witness, 'parent'));
  const child = copyDescriptor(ownData(witness, 'child'));
  if (parent === undefined || child === undefined) {
    return { status: 'unsupported', reason: 'malformed' };
  }
  if (ownData(witness, 'version') !== WITNESS_VERSION) {
    return { status: 'unsupported', reason: 'witness-version' };
  }
  const argumentsForm = ownData(witness, 'arguments');
  if (typeof argumentsForm !== 'object' || argumentsForm === null ||
      Reflect.ownKeys(argumentsForm).length !== 1 || ownData(argumentsForm, 'form') !== 'empty') {
    return { status: 'unsupported', reason: 'argument-form' };
  }
  return { status: 'parsed', parent, child };
}

/**
 * Read one own data property of untrusted input through its descriptor, so an
 * accessor or an inherited property never runs author code. Returns undefined
 * for a non-object, an absent own property or an accessor.
 */
function ownData(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/**
 * Copy untrusted descriptor data into a frozen descriptor, or report it
 * malformed. Fields are read only as own data properties.
 */
function copyDescriptor(value: unknown): IBindingDescriptor | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  for (const key of ['scope', 'role', 'slot', 'memberKey']) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && !('value' in descriptor)) {
      return undefined;
    }
  }
  const scope = ownData(value, 'scope');
  const role = ownData(value, 'role');
  const slot = ownData(value, 'slot');
  const memberKey = ownData(value, 'memberKey');
  if (typeof scope !== 'string' || (role !== 'input' && role !== 'callable' && role !== 'step') || typeof slot !== 'string') {
    return undefined;
  }
  if (memberKey === undefined) {
    return Object.freeze({ scope, role, slot });
  }
  return typeof memberKey === 'string' ? Object.freeze({ scope, role, slot, memberKey }) : undefined;
}

/**
 * Copy a caller-supplied descriptor used for lookup or invocation into a frozen
 * framework-owned descriptor, reading only own data properties, so lookups never
 * run author code. A malformed or accessor-bearing descriptor is rejected.
 */
export function ownedDescriptor(value: unknown): IBindingDescriptor {
  return copyDescriptor(value) ?? reject('invalid-descriptor', 'A binding descriptor must hold scope, role, slot and optional memberKey as own data properties.');
}
