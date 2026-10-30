/**
 * Restricted root acquisition correspondence. A traversal fixes one declared
 * query, supplied page source, collection, template and strict fold before
 * composition freezes. Its witness identifies that relationship without
 * inventing a memo parent or permitting an arbitrary root call. Definition
 * validates topology and ownership only: Resolution supplies current arguments
 * and evidence; Supervision supplies the live run and dispatch authority.
 */
import { encodeSnapshot } from '@microdelta/value';

import type { IBindingTarget, IComposition, ICompositionState } from './composition.js';
import { readOptions, reject } from './declaration.js';
import type { IAnySourceDeclaration, IDeclarationRecords, IStepRecord } from './declaration.js';
import type { IBindingDescriptor } from './descriptor.js';
import type { IBindingFamily } from './family.js';
import type { IAnyFoldDeclaration } from './fold.js';
import { sourceSlotName } from './source-slot.js';
import type { IAnySourceSlot } from './source-slot.js';
import type { IAnyTemplateDeclaration, IBoundTemplates, ITemplateRecords } from './template.js';
import type { IArgumentRecipe, IInvocationArguments } from './witness.js';

/**
 * A Definition-minted fixed traversal relationship, independent of run lifetime.
 * Its nominal identity is recognized by its owning builder, never by shape.
 * @alpha
 */
export interface ITraversalDeclaration<TFamily extends IBindingFamily> {
  /** Nominal relationship authority; absent at runtime. */
  readonly __microdeltaTraversal: unique symbol;
  /** Prevent a relationship of another binding family from being substituted. */
  readonly __microdeltaFamily?: (family: TFamily) => TFamily;
  readonly kind: 'traversal';
  /** Structural relationship slot; not a history subject or display label. */
  readonly slot: string;
}

/**
 * The fixed participants of one root acquisition relationship. Every declaration
 * must be genuinely owned and every participant uniquely composed. The query
 * names a declared immutable input; source arguments remain Resolution-owned.
 * @alpha
 */
export interface ITraversalOptions<TFamily extends IBindingFamily> {
  readonly slot: string;
  readonly query: string;
  readonly page: IAnySourceSlot<TFamily>;
  readonly collection: IAnySourceDeclaration<TFamily>;
  readonly template: IAnyTemplateDeclaration<TFamily>;
  readonly fold: IAnyFoldDeclaration<TFamily>;
}

/**
 * Structural correspondence for the participants actually bound in a frozen
 * composition. It grants neither run authority nor permission to execute.
 * @alpha
 */
export interface ITraversalBinding {
  readonly slot: string;
  readonly query: IBindingDescriptor;
  readonly page: IBindingDescriptor;
  readonly collection: IBindingDescriptor;
  readonly template: string;
  readonly fold: IBindingDescriptor;
}

/**
 * A root witness belongs to exactly one frozen composition and relationship.
 * Resolution recognizes it through the owning builder before obtaining current
 * arguments; a copied or foreign witness cannot justify a source call.
 * @alpha
 */
export interface IRootAcquisitionWitness<TFamily extends IBindingFamily> {
  /** Nominal witness authority; absent at runtime. */
  readonly __microdeltaRootAcquisition: unique symbol;
  readonly __microdeltaFamily?: (family: TFamily) => TFamily;
  readonly kind: 'root-acquisition';
  readonly relationship: string;
}

/** Captured declaration participants, inaccessible through author token fields. */
export interface ITraversalRecord<TFamily extends IBindingFamily> {
  readonly slot: string;
  readonly query: string;
  readonly page: string;
  readonly collection: IAnySourceDeclaration<TFamily>;
  readonly template: IAnyTemplateDeclaration<TFamily>;
  readonly fold: IAnyFoldDeclaration<TFamily>;
}

/** The builder owns declarations and witnesses separately from composition state. */
export interface ITraversalRecords<TFamily extends IBindingFamily> {
  readonly declarations: WeakMap<object, ITraversalRecord<TFamily>>;
  readonly witnesses: WeakMap<object, { readonly composition: IComposition<TFamily>; readonly binding: ITraversalBinding }>;
}

/** Read one semantic name without permitting empty structural correspondence. */
function name(value: unknown, role: string): string {
  return typeof value === 'string' && value.length > 0
    ? value
    : reject('invalid-descriptor', `A traversal's ${role} must be a nonempty string.`);
}

/** Capture genuine participants without applying their callbacks or subject functions. */
export function declareTraversal<TFamily extends IBindingFamily>(
  records: IDeclarationRecords<TFamily>,
  templates: ITemplateRecords<TFamily>,
  traversals: ITraversalRecords<TFamily>,
  options: ITraversalOptions<TFamily>,
): ITraversalDeclaration<TFamily> {
  const read = readOptions(options);
  const slot = name(read.get('slot'), 'slot');
  const query = name(read.get('query'), 'query input');
  const page = sourceSlotName(read.get('page')) ?? reject('illegal-edge', 'A traversal page must be a Definition-minted source slot.');
  const collection = read.get('collection');
  const collectionRecord = typeof collection === 'object' && collection !== null ? records.get(collection) : undefined;
  const template = read.get('template');
  const templateRecord = typeof template === 'object' && template !== null ? templates.get(template) : undefined;
  const fold = read.get('fold');
  const foldRecord = typeof fold === 'object' && fold !== null ? records.get(fold) : undefined;
  if (collectionRecord?.kind !== 'source' || templateRecord === undefined || foldRecord?.kind !== 'fold') {
    return reject('forged-declaration', 'A traversal requires this builder\'s ordinary source, template and strict fold.');
  }
  const token = Object.freeze({ kind: 'traversal' as const, slot });
  traversals.declarations.set(token, Object.freeze({
    slot, query, page, collection: collectionRecord.declaration,
    template: templateRecord.declaration, fold: foldRecord.declaration,
  }));
  // Nominal fields exist only in types; the owning registry is their sole mint.
  return token as ITraversalDeclaration<TFamily>;
}

/** The composition supplies already captured participants; no author reads occur here. */
export interface ITraversalComposition<TFamily extends IBindingFamily> {
  readonly scope: string;
  readonly steps: readonly { readonly slot: string; readonly record: IStepRecord<TFamily> }[];
  readonly templates: IBoundTemplates<TFamily>;
  target(descriptor: IBindingDescriptor): IBindingTarget<TFamily> | undefined;
}

/** Bind the one selected relationship completely, or reject the composition atomically. */
export function bindTraversals<TFamily extends IBindingFamily>(
  traversals: ITraversalRecords<TFamily>,
  declared: readonly unknown[],
  composition: ITraversalComposition<TFamily>,
): ReadonlyMap<object, ITraversalBinding> {
  if (declared.length > 1) {
    return reject('illegal-edge', 'A bounded traversal composition declares at most one root relationship.');
  }
  const bindings = new Map<object, ITraversalBinding>();
  for (const token of declared) {
    const record = typeof token === 'object' && token !== null ? traversals.declarations.get(token) : undefined;
    if (record === undefined || typeof token !== 'object' || token === null) {
      return reject('forged-declaration', 'A composed traversal must be minted by this builder.');
    }
    const query: IBindingDescriptor = Object.freeze({ scope: composition.scope, role: 'input', slot: record.query });
    const page: IBindingDescriptor = Object.freeze({ scope: composition.scope, role: 'callable', slot: record.page });
    const queryTarget = composition.target(query);
    const pageTarget = composition.target(page);
    if (queryTarget?.role !== 'input' || pageTarget?.role !== 'callable' || pageTarget.kind !== 'supplied-source') {
      return reject('illegal-edge', 'A traversal requires one current query input and one supplied source page binding.');
    }
    const collections = composition.steps.filter(entry => entry.record.declaration === record.collection);
    const folds = composition.steps.filter(entry => entry.record.declaration === record.fold);
    const [collection] = collections;
    const [fold] = folds;
    const over = composition.templates.foldTarget(record.template, record.fold.over.step);
    if (collections.length !== 1 || collection === undefined || folds.length !== 1 || fold === undefined
      || record.template.collection !== record.collection || record.fold.over.template !== record.template
      || over?.template !== record.template.slot || over.collection !== collection.slot) {
      return reject('illegal-edge', 'A traversal collection, template and strict fold must be the same unique composed relationship.');
    }
    const collectionStep: IBindingDescriptor = Object.freeze({ scope: composition.scope, role: 'step', slot: collection.slot });
    const foldStep: IBindingDescriptor = Object.freeze({ scope: composition.scope, role: 'step', slot: fold.slot });
    const collectionTarget = composition.target(collectionStep);
    const foldTarget = composition.target(foldStep);
    // Unique declaration registration does not prove unique descriptor
    // occupancy: a different genuine declaration can occupy the same slot.
    if (collectionTarget?.role !== 'step' || collectionTarget.declaration !== record.collection
      || foldTarget?.role !== 'step' || foldTarget.declaration !== record.fold) {
      return reject('illegal-edge', 'Traversal collection and fold descriptors must each have exactly their selected declaration.');
    }
    bindings.set(token, Object.freeze({
      slot: record.slot, query, page,
      collection: collectionStep,
      template: record.template.slot,
      fold: foldStep,
    }));
  }
  return bindings;
}

/** Mint correspondence only after both the composition and relationship are owned. */
export function rootAcquisitionIn<TFamily extends IBindingFamily>(
  compositions: WeakMap<object, ICompositionState<TFamily>>,
  traversals: ITraversalRecords<TFamily>,
  composition: IComposition<TFamily>,
  relationship: ITraversalDeclaration<TFamily>,
): IRootAcquisitionWitness<TFamily> {
  const state = compositions.get(composition) ?? reject('forged-composition', 'This builder did not mint the acquisition composition.');
  const binding = state.traversals.get(relationship) ?? reject('illegal-edge', 'The traversal relationship is not declared in this composition.');
  const witness = Object.freeze({ kind: 'root-acquisition' as const, relationship: binding.slot });
  traversals.witnesses.set(witness, { composition, binding });
  // Nominal witness construction is confined to the registry that recognizes it.
  return witness as IRootAcquisitionWitness<TFamily>;
}

/** Recognize a genuine composition-local witness without reading supplied properties. */
export function resolveRootAcquisitionIn<TFamily extends IBindingFamily>(
  compositions: WeakMap<object, ICompositionState<TFamily>>,
  traversals: ITraversalRecords<TFamily>,
  composition: IComposition<TFamily>,
  witness: unknown,
): ITraversalBinding {
  if (!compositions.has(composition)) {
    return reject('forged-composition', 'This builder did not mint the acquisition composition.');
  }
  const record = typeof witness === 'object' && witness !== null ? traversals.witnesses.get(witness) : undefined;
  if (record === undefined || record.composition !== composition) {
    return reject('illegal-edge', 'A root acquisition witness must belong to this exact composition.');
  }
  return record.binding;
}

/**
 * Encode the run owner's current query/cursor using ordinary derived recipes.
 * Witness recognition precedes data traversal. Resolution supplies the already
 * decided justification; this encoding neither computes currentness nor grants
 * a call, and it never invents a parent invocation or a new witness wire form.
 */
export function rootArgumentRecipesIn<TFamily extends IBindingFamily>(
  compositions: WeakMap<object, ICompositionState<TFamily>>,
  traversals: ITraversalRecords<TFamily>,
  composition: IComposition<TFamily>,
  witness: unknown,
  values: readonly [unknown, string | undefined],
  justified: boolean,
): IInvocationArguments {
  resolveRootAcquisitionIn(compositions, traversals, composition, witness);
  if (!Array.isArray(values) || values.length !== 2 || (values[1] !== undefined && typeof values[1] !== 'string')
    || typeof justified !== 'boolean') {
    return reject('invalid-argument', 'Root recipes require one current query, one optional cursor and an owner justification decision.');
  }
  /** Copy one already justified current value; unsupported data grants no opaque root argument. */
  const encode = (value: unknown): IArgumentRecipe => {
    try {
      return Object.freeze({ form: 'derived', value: encodeSnapshot(value), justified });
    } catch {
      return reject('invalid-argument', 'A current root query or cursor is outside supported Value data.');
    }
  };
  const recipes: readonly [IArgumentRecipe, IArgumentRecipe] = [encode(values[0]), encode(values[1])];
  return Object.freeze(recipes);
}
