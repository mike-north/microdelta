/**
 * The frozen composition and its current structural correspondence.
 *
 * A composition owns framework copies of its declared inputs, helpers,
 * composition-level steps, explicitly keyed members and supplied step
 * bindings before any run. Its supported topology is fixed. Steps live at one
 * of two levels: the composition level (descriptors with no member key) or an
 * explicitly keyed member. A memo may name a sibling source or memo slot of its
 * own level, whose pinned declaration must be exactly the one occupying that
 * slot in this composition, or a composition-wide supplied step slot. That
 * identity is current-composition consistency only; restart correspondence is
 * structural. A supplied step slot is bound to whatever implementation this
 * composition supplies; zero or several supplies are distinct misses reported
 * when a parent is opened, never a remap. Resolution of a historical
 * descriptor or invocation witness yields exactly one current target or a
 * distinct missing/ambiguous/undeclared/unsupported outcome, never a fallback
 * by name, subject, hash, function identity or ordinal (CMP-1/3/6/7,
 * REUSE-006/007). Composition and lookup never invoke author callbacks; a slot
 * subject function runs only when a caller asks for a call's subject.
 *
 * Keyed fanout templates bind to the one composition-level slot holding their
 * collection source. A template instance is addressed by its template step
 * descriptor plus the member key and is minted on demand, per composition,
 * from the frozen template; a strict or outcome fold is a composition-level
 * step that consumes one composed template step.
 *
 * Each step registration keeps the declaration's own record, so the typed
 * invocation closures reached by `openInvocation` are exactly those retained
 * when the author declared the step.
 */
import { decodeSnapshot, encodeSnapshot } from '@microdelta/value';

import type { IKeyedSnapshot } from './collection.js';
import type { IBindingDescriptor } from './descriptor.js';
import type { IDeclarationRecords, IStepDeclaration, IStepRecord } from './declaration.js';
import { reject } from './declaration.js';
import type { DefinitionError } from './errors.js';
import type { IBindingFamily } from './family.js';
import type { IFoldTopology } from './fold.js';
import type { IAnySuppliedStepDeclaration, ISuppliedStepRegistration } from './slot.js';
import { slotSubject, supplyState } from './slot.js';
import { bindTemplates, instancePrefixOf, isMemberStep, type IAnyTemplateDeclaration, type IBoundTemplates, type ITemplateRecords, type ITemplateTopology } from './template.js';
import { copyDescriptor, isTemplateDescriptor, parseWitness } from './witness.js';
import type { IInvocationArguments, IInvocationWitness, IUnsupportedWitnessReason } from './witness.js';

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
 * A step slot, at the composition level or within a member, holding one Definition-minted declaration.
 * @alpha
 */
export interface IStepRegistration<TFamily extends IBindingFamily> {
  /** Step slot name within its level (the composition level or one member). */
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
  /** Composition-level step slots, outside any member; their descriptors carry no member key. */
  readonly steps?: readonly IStepRegistration<TFamily>[];
  /** Explicitly keyed members. */
  readonly members?: readonly IMemberRegistration<TFamily>[];
  /** Supplied step implementations bound to callable step slots, made by `supply`. */
  readonly supplied?: readonly ISuppliedStepRegistration<TFamily>[];
  /** Fanout templates, each bound to a keyed collection source among the composition-level steps. */
  readonly templates?: readonly IAnyTemplateDeclaration<TFamily>[];
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
  /** Distinguishes a helper function from a supplied step in the same callable slot namespace. */
  readonly kind: 'helper';
  /** The author's actual helper function. */
  readonly callable: (...arguments_: never[]) => unknown;
}

/**
 * The current supplied step bound to a callable step slot. The slot, not the
 * implementation, is the structural correspondence; the implementation is
 * whatever this composition binds now.
 * @alpha
 */
export interface ISuppliedStepTarget<TFamily extends IBindingFamily> {
  /** Supplied step slots share the callable slot namespace with helpers. */
  readonly role: 'callable';
  /** Distinguishes a supplied step from a helper function. */
  readonly kind: 'supplied-step';
  /** The supplied implementation, with its callback context erased. */
  readonly declaration: IAnySuppliedStepDeclaration<TFamily>;
  /**
   * The scoped history subject of one call through this slot, computed by the
   * bound subject function from the recipes' derived values only. It runs the
   * author's subject function and rejects with `invalid-subject` unless that
   * returns a complete nonempty string.
   */
  subjectFor(arguments_: IInvocationArguments): IScopedSubject;
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
export type IBindingTarget<TFamily extends IBindingFamily> = IInputTarget | ICallableTarget | ISuppliedStepTarget<TFamily> | IStepTarget<TFamily>;

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
 * The frozen abstract step graph, ordered structurally rather than by
 * registration, together with the names of the composition-wide input and
 * callable slots every callback's bindings are assembled from. Slot names are
 * declared structure, not current values: values are read only through
 * `resolve`.
 * @alpha
 */
export interface ITopology {
  /** Every step slot, in structural order. */
  readonly steps: readonly IBindingDescriptor[];
  /** Every permitted parent-to-child call relationship, in structural order. */
  readonly edges: readonly IDeclaredEdge[];
  /** Declared input slot names, sorted; a repeated slot appears once (resolution reports it ambiguous). */
  readonly inputs: readonly string[];
  /** Declared callable (helper) slot names, sorted; a repeated slot appears once. */
  readonly helpers: readonly string[];
  /** Supplied step slot names that some parent declares, sorted, whether or not they are currently supplied. */
  readonly slots: readonly string[];
  /** Fanout templates, sorted by template slot. */
  readonly templates: readonly ITemplateTopology[];
  /** Strict folds and the template steps they consume, in structural order. */
  readonly folds: readonly IFoldTopology[];
  /** Outcome (tolerant) folds and the template steps they consume, in structural order. */
  readonly outcomeFolds: readonly IFoldTopology[];
}

/**
 * Outcome of reconnecting a historical invocation witness (version 1 or 2).
 * A bound outcome carries the parsed witness so the caller reads its call
 * position and recipes from Definition's validated copy. Unknown witness
 * versions, argument or recipe forms and malformed data are unsupported
 * rather than guessed (REUSE-007).
 * @alpha
 */
export type IWitnessResolution<TFamily extends IBindingFamily> =
  | {
    readonly status: 'bound';
    readonly parent: IStepTarget<TFamily>;
    readonly child: IStepTarget<TFamily> | ISuppliedStepTarget<TFamily>;
    readonly witness: IInvocationWitness;
  }
  | { readonly status: 'missing'; readonly descriptor: IBindingDescriptor }
  | { readonly status: 'ambiguous'; readonly descriptor: IBindingDescriptor; readonly occupants: number }
  | { readonly status: 'undeclared-edge' }
  | { readonly status: 'unsupported'; readonly reason: IUnsupportedWitnessReason };

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
  /** Reconnect a historical invocation witness, supplied as untrusted durable data. */
  resolveWitness(witness: unknown): IWitnessResolution<TFamily>;
  /** Key one collection snapshot under a template's key strategy, before any gate or member body. */
  keyMembers(template: string, snapshot: unknown): IKeyedSnapshot;
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
  /** The composed templates: their instances, keying and gates. */
  readonly templates: IBoundTemplates<TFamily>;
  /** The template step descriptor each strict or outcome fold consumes, by the fold's descriptor key. */
  readonly folds: ReadonlyMap<string, IBindingDescriptor>;
}

/** Nonzero while a composition is being constructed; framework resolution must reject then. */
let composing = 0;

/**
 * Whether a composition is currently being constructed. Author code can run
 * then only through traps on the author's own builder objects; framework
 * resolution, declared calls and runtime context lookup must reject rather
 * than act during composition (CMP-9, RUN-001). This is a read-only query; it
 * grants nothing.
 * @returns True while any composition is being constructed.
 * @alpha
 */
export function isComposing(): boolean {
  return composing > 0;
}

/**
 * Run graph-construction work, such as a template factory, inside the
 * composition phase, so framework resolution attempted from it rejects.
 * @param build - The construction work.
 * @returns Its result.
 */
export function withinComposition<T>(build: () => T): T {
  composing++;
  try {
    return build();
  } finally {
    composing--;
  }
}

/** Exact-field descriptor key over every field, absent fields included; there is no partial or normalized match. */
export function descriptorKey(descriptor: IBindingDescriptor): string {
  return JSON.stringify([
    descriptor.scope,
    descriptor.role,
    descriptor.slot,
    descriptor.memberKey ?? null,
    descriptor.template ?? null,
    descriptor.collection ?? null,
  ]);
}

/** Whether two descriptors denote the same slot. */
function sameDescriptor(left: IBindingDescriptor, right: IBindingDescriptor): boolean {
  return descriptorKey(left) === descriptorKey(right);
}

/**
 * Freeze an author's declared graph before any run, without invoking callbacks.
 * @param records - The builder instance's declaration records.
 * @param compositions - The builder instance's composition states.
 * @param options - The author's scope, inputs, helpers, steps, members, supplied steps and templates.
 * @param templates - The builder instance's template records.
 * @returns The frozen composition.
 */
export function composeIn<TFamily extends IBindingFamily>(
  records: IDeclarationRecords<TFamily>,
  compositions: WeakMap<object, ICompositionState<TFamily>>,
  options: ICompositionOptions<TFamily>,
  templates: ITemplateRecords<TFamily>,
): IComposition<TFamily> {
  composing++;
  try {
    // Every registration record is captured exactly once through its own data
    // property descriptors. Validation, lookup and invocation all use this one
    // framework-owned capture, so no later read can observe a different value.
    const optionFields = captureFields(options, {
      scope: 'invalid-descriptor',
      inputs: 'invalid-descriptor',
      helpers: 'invalid-descriptor',
      steps: 'invalid-descriptor',
      members: 'invalid-descriptor',
      supplied: 'invalid-descriptor',
      templates: 'invalid-descriptor',
    });
    const scope = nonempty(optionFields.get('scope'), 'scope');
    const registrations = new Map<string, IRegistration<TFamily>[]>();
    const register = (descriptor: IBindingDescriptor, registration: IRegistration<TFamily>): void => {
      const key = descriptorKey(descriptor);
      registrations.set(key, [...(registrations.get(key) ?? []), registration]);
    };
    // Framework-owned copies: arrays are copied once, and input values become
    // frozen Value snapshots, so later author mutation cannot change the graph.
    const inputSlots = new Set<string>();
    const helperSlots = new Set<string>();
    for (const input of listOf(optionFields.get('inputs'), 'inputs', true)) {
      const fields = captureFields(input, { slot: 'invalid-descriptor', value: 'invalid-input' });
      const slot = nonempty(fields.get('slot'), 'input slot');
      inputSlots.add(slot);
      register({ scope, role: 'input', slot }, { target: Object.freeze({ role: 'input', value: snapshotInput(fields.get('value'), slot) }), record: undefined });
    }
    for (const helper of listOf(optionFields.get('helpers'), 'helpers', true)) {
      const fields = captureFields(helper, { slot: 'invalid-descriptor', helper: 'invalid-callback' });
      const slot = nonempty(fields.get('slot'), 'helper slot');
      const callable = fields.get('helper');
      if (!isCallable(callable)) {
        reject('invalid-callback', `Helper ${slot} must be a function.`);
      }
      helperSlots.add(slot);
      register({ scope, role: 'callable', slot }, { target: Object.freeze({ role: 'callable', kind: 'helper', callable }), record: undefined });
    }
    const steps: IBindingDescriptor[] = [];
    const edges: IDeclaredEdge[] = [];
    /** Edge keys already recorded: several calls naming one slot declare one edge. */
    const edgeKeys = new Set<string>();
    const addEdge = (parent: IBindingDescriptor, child: IBindingDescriptor): void => {
      const key = `${descriptorKey(parent)}->${descriptorKey(child)}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push(Object.freeze({ parent, child }));
      }
    };
    /** Supplied step slot names some parent declares. */
    const declaredSlots = new Set<string>();
    /** RES-001: each scoped subject is claimed by exactly one declaration object in this composition. */
    const subjects = new Map<string, IStepDeclaration<TFamily>>();
    /** Composition-level step occupants, which templates bind to and folds live among. */
    const compositionSteps: { readonly slot: string; readonly record: IStepRecord<TFamily> }[] = [];
    /**
     * Register one level's step slots: a member's (with its key) or the
     * composition level (no key). Sibling edges stay within one level.
     */
    const registerLevel = (memberKey: string | undefined, rawSteps: readonly unknown[]): void => {
      // Capture every step of this level once, before any edge refers to a sibling.
      const levelSteps = rawSteps.map(step => {
        const fields = captureFields(step, { slot: 'invalid-descriptor', declaration: 'forged-declaration' });
        const slot = nonempty(fields.get('slot'), 'step slot');
        const candidate = fields.get('declaration');
        const record = typeof candidate === 'object' && candidate !== null ? records.get(candidate) : undefined;
        if (record === undefined) {
          return reject('forged-declaration', `Step ${slot} holds a declaration this family did not mint.`);
        }
        if (record.kind === 'supplied-step') {
          return reject('illegal-edge', `Step ${slot} holds a supplied step; supplied steps occupy step slots only through supply.`);
        }
        if (isMemberStep(record.declaration)) {
          return reject('invalid-template', `Step ${slot} holds a member step declaration, which is addressable only through its template.`);
        }
        if ((record.kind === 'fold' || record.kind === 'outcome-fold') && memberKey !== undefined) {
          return reject('illegal-edge', `Fold ${slot} must be a composition-level step, not a member step.`);
        }
        return { slot, record };
      });
      if (memberKey === undefined) {
        compositionSteps.push(...levelSteps);
      }
      for (const { slot, record } of levelSteps) {
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
        if (record.kind !== 'memo') {
          continue;
        }
        for (const [call, edge] of record.children) {
          if (edge.kind === 'slot') {
            declaredSlots.add(edge.slot);
            addEdge(descriptor, slotDescriptor(scope, edge.slot));
            continue;
          }
          // Current-composition consistency: the pinned child must be the one
          // declaration occupying that sibling slot of this level. Declarations
          // are immutable and pinned before their parents exist, so memo edges
          // cannot form a cycle; a parent occupying its own child slot fails here.
          const siblings = levelSteps.filter(sibling => sibling.slot === call);
          const [sibling] = siblings;
          if (siblings.length !== 1 || sibling?.record.declaration !== edge.declaration || call === slot) {
            reject('illegal-edge', `Memo ${slot} child ${call} must be the declaration occupying that sibling slot.`);
          }
          addEdge(descriptor, stepDescriptor(scope, call, memberKey));
        }
      }
    };
    registerLevel(undefined, listOf(optionFields.get('steps'), 'steps', true));
    for (const member of listOf(optionFields.get('members'), 'members', true)) {
      const memberFields = captureFields(member, { key: 'invalid-descriptor', steps: 'invalid-descriptor' });
      const memberKey = nonempty(memberFields.get('key'), 'member key');
      registerLevel(memberKey, listOf(memberFields.get('steps'), 'member steps', false));
    }
    const suppliedSlots = new Set<string>();
    for (const supplied of listOf(optionFields.get('supplied'), 'supplied', true)) {
      const state = supplyState(supplied);
      const record = state === undefined ? undefined : records.get(state.declaration);
      if (state === undefined || record?.kind !== 'supplied-step') {
        return reject('forged-declaration', 'A supplied registration must be made by supply from this family instance.');
      }
      suppliedSlots.add(state.slot);
      const subject = state.subject;
      const target: ISuppliedStepTarget<TFamily> = {
        role: 'callable',
        kind: 'supplied-step',
        declaration: record.declaration,
        subjectFor(arguments_: IInvocationArguments): IScopedSubject {
          if (isComposing()) {
            reject('composition-phase', 'Slot subjects cannot be computed while composing.');
          }
          const scoped = slotSubject(scope, subject, arguments_);
          if (subjects.has(scoped.subject)) {
            reject('conflicting-subject', `Slot ${state.slot} computed the subject ${scoped.subject}, which a declared step already claims (RES-001).`);
          }
          // Read when a subject is computed, after composition bound the templates.
          const prefix = instancePrefixOf(boundTemplates.prefixes, scoped.subject);
          if (prefix !== undefined) {
            reject('conflicting-subject', `Slot ${state.slot} computed the subject ${scoped.subject}, which a template instance of member prefix ${JSON.stringify(prefix)} can claim (RES-001).`);
          }
          return scoped;
        },
      };
      register(slotDescriptor(scope, state.slot), { target: Object.freeze(target), record });
    }
    const boundTemplates = bindTemplates(
      scope,
      listOf(optionFields.get('templates'), 'templates', true),
      templates,
      (declaration) => compositionSteps.filter(entry => entry.record.declaration === declaration).map(entry => entry.slot),
      subjects.keys(),
    );
    for (const slot of boundTemplates.slots) {
      declaredSlots.add(slot);
    }
    // A fold consumes a step of a template composed here; anything else is an undeclared edge.
    const folds = new Map<string, IBindingDescriptor>();
    const foldTopology: IFoldTopology[] = [];
    const outcomeFoldTopology: IFoldTopology[] = [];
    for (const { slot, record } of compositionSteps) {
      if (record.kind === 'fold' || record.kind === 'outcome-fold') {
        const over = boundTemplates.foldTarget(record.declaration.over.template, record.declaration.over.step)
          ?? reject('illegal-edge', `Fold ${slot} consumes template ${record.declaration.over.template.slot}, which this composition does not declare.`);
        const fold = stepDescriptor(scope, slot, undefined);
        folds.set(descriptorKey(fold), over);
        (record.kind === 'fold' ? foldTopology : outcomeFoldTopology).push(Object.freeze({ fold, over }));
      }
    }
    for (const slot of [...declaredSlots, ...suppliedSlots]) {
      if (helperSlots.has(slot)) {
        reject('illegal-edge', `Callable slot ${slot} is declared as a supplied step slot and also registered as a helper.`);
      }
    }
    const topology: ITopology = Object.freeze({
      steps: Object.freeze([...steps].sort(compareDescriptors)),
      edges: Object.freeze([...edges].sort((left, right) => compareDescriptors(left.parent, right.parent) || compareDescriptors(left.child, right.child))),
      inputs: Object.freeze([...inputSlots].sort()),
      helpers: Object.freeze([...helperSlots].sort()),
      slots: Object.freeze([...declaredSlots].sort()),
      templates: boundTemplates.topology,
      folds: Object.freeze(foldTopology.sort((left, right) => compareDescriptors(left.fold, right.fold))),
      outcomeFolds: Object.freeze(outcomeFoldTopology.sort((left, right) => compareDescriptors(left.fold, right.fold))),
    });
    const frozenRegistrations: ReadonlyMap<string, readonly IRegistration<TFamily>[]> = new Map(
      [...registrations].map(([key, occupants]) => [key, Object.freeze(occupants)]),
    );
    const resolve = (supplied: IBindingDescriptor): IBindingResolution<TFamily> => {
      const descriptor = ownedDescriptor(supplied);
      if (isTemplateDescriptor(descriptor)) {
        // A template instance: its template step descriptor plus the member key, never remapped.
        const instance = boundTemplates.instance(descriptor);
        return instance === undefined ? { status: 'missing', descriptor } : {
          status: 'bound',
          descriptor,
          target: Object.freeze({ role: 'step', declaration: instance.declaration, scopedSubject: Object.freeze({ scope, subject: instance.declaration.subject }) }),
        };
      }
      const occupants = frozenRegistrations.get(descriptorKey(descriptor)) ?? [];
      const [only] = occupants;
      if (only === undefined) {
        return { status: 'missing', descriptor };
      }
      return occupants.length > 1 ? { status: 'ambiguous', descriptor, occupants: occupants.length } : { status: 'bound', descriptor, target: only.target };
    };
    const declaredEdge = (parent: IBindingDescriptor, child: IBindingDescriptor): boolean =>
      topology.edges.some(edge => sameDescriptor(edge.parent, parent) && sameDescriptor(edge.child, child)) || boundTemplates.declaresEdge(parent, child);
    const composition: Omit<IComposition<TFamily>, keyof ICompositionBrand<TFamily>> = {
      scope,
      topology,
      resolve,
      resolveWitness(witness: unknown): IWitnessResolution<TFamily> {
        const parsed = parseWitness(witness);
        if (parsed.status === 'unsupported') {
          return parsed;
        }
        const { parent, child } = parsed.witness;
        const parentResolution = resolve(parent);
        if (parentResolution.status !== 'bound') {
          return parentResolution;
        }
        const childResolution = resolve(child);
        if (childResolution.status !== 'bound') {
          return childResolution;
        }
        const parentTarget = parentResolution.target;
        const childTarget = childResolution.target;
        if (parentTarget.role !== 'step' || !declaredEdge(parent, child)) {
          return { status: 'undeclared-edge' };
        }
        if (parsed.witness.version === 1) {
          // M3 meaning, unchanged: an argument-free call of a sibling source.
          // A memo or supplied slot child was never recorded with version 1.
          return childTarget.role === 'step' && childTarget.declaration.kind === 'source'
            ? { status: 'bound', parent: parentTarget, child: childTarget, witness: parsed.witness }
            : { status: 'unsupported', reason: 'argument-form' };
        }
        const recipes = parsed.witness.arguments;
        if (childTarget.role === 'step') {
          // Sibling edges are argument-free.
          return 'form' in recipes
            ? { status: 'bound', parent: parentTarget, child: childTarget, witness: parsed.witness }
            : { status: 'unsupported', reason: 'argument-form' };
        }
        if (childTarget.role !== 'callable' || childTarget.kind !== 'supplied-step') {
          return { status: 'undeclared-edge' };
        }
        if (!isTemplateDescriptor(parent) && !('form' in recipes) && recipes.some(recipe => recipe.form === 'forwarded' && recipe.origin.binding === 'member')) {
          // Member origins require a template instance's member binding;
          // explicit members and composition-level steps have none.
          return { status: 'unsupported', reason: 'argument-form' };
        }
        return { status: 'bound', parent: parentTarget, child: childTarget, witness: parsed.witness };
      },
      keyMembers(template: string, snapshot: unknown): IKeyedSnapshot {
        if (isComposing()) {
          reject('composition-phase', 'Collections cannot be keyed while composing.');
        }
        return boundTemplates.keyMembers(template, snapshot);
      },
    };
    Object.freeze(composition);
    compositions.set(composition, { scope, registrations: frozenRegistrations, templates: boundTemplates, folds });
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

/** A frozen step descriptor; a composition-level step has no member key field at all. */
function stepDescriptor(scope: string, slot: string, memberKey: string | undefined): IBindingDescriptor {
  return memberKey === undefined ? Object.freeze({ scope, role: 'step', slot }) : Object.freeze({ scope, role: 'step', slot, memberKey });
}

/** A frozen, composition-wide supplied step slot descriptor. */
function slotDescriptor(scope: string, slot: string): IBindingDescriptor {
  return Object.freeze({ scope, role: 'callable', slot });
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

/** Structural descriptor order: member key, role, slot, then template fields; registration order never matters. */
function compareDescriptors(left: IBindingDescriptor, right: IBindingDescriptor): number {
  const leftKey = [left.memberKey ?? '', left.role, left.slot, left.template ?? '', left.collection ?? ''];
  const rightKey = [right.memberKey ?? '', right.role, right.slot, right.template ?? '', right.collection ?? ''];
  for (let index = 0; index < leftKey.length; index++) {
    const a = leftKey[index] ?? '';
    const b = rightKey[index] ?? '';
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Copy a caller-supplied descriptor used for lookup or invocation into a frozen
 * framework-owned descriptor, reading only own data properties, so lookups never
 * run author code. A malformed or accessor-bearing descriptor is rejected.
 */
export function ownedDescriptor(value: unknown): IBindingDescriptor {
  return copyDescriptor(value) ?? reject('invalid-descriptor', 'A binding descriptor must hold scope, role, slot and optional memberKey, template and collection as own data properties.');
}
