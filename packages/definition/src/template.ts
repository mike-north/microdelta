/**
 * Fanout templates and tracked gates (CMP-1, CMP-4, CMP-8, CMP-9).
 *
 * A fanout template is a member computation declared once over a keyed
 * collection source. Its factory runs exactly once, while composing, against a
 * symbolic member: a builder that can mint member-scoped subjects and member
 * step declarations but never sees a member key or any member data. The
 * declarations it returns, and the author record holding them, are copied and
 * frozen; afterwards every builder call rejects with `frozen`. Runtime data can
 * then only instantiate the fixed template for discovered member keys.
 *
 * A member instance is addressed structurally by its template step descriptor
 * (template slot, step slot and collection binding) plus the member key. Its
 * complete subject is the step's member-subject prefix applied to the key
 * only. Renaming a template or moving it to another collection changes that
 * address, so prior instances are misses, never remapped.
 *
 * A template may declare a gate: a tracked author predicate over its declared
 * bindings (inputs, helpers and the member binding). Definition only exposes the
 * gate with its assembled context to Resolution's invoker and classifies the
 * settled result; only an explicit `false` skips an instance. Definition never
 * evaluates gates, runs member bodies, decides readiness or chooses candidates.
 */
import { keySnapshot, type IKeyedSnapshot, type IMemberOf } from './collection.js';
import { isComposing, ownedDescriptor, withinComposition, type IComposition, type ICompositionState, type IDeclaredEdge } from './composition.js';
import {
  checkBindings,
  declareMemo,
  declareSource,
  isPlainRecord,
  readOptions,
  reject,
  type IAnyMemoDeclaration,
  type IAnySourceDeclaration,
  type IAuthorInvoker,
  type IChildDeclarations,
  type IDeclarationRecords,
  type IFinalityContext,
  type IMemoDeclaration,
  type IMemoRecord,
  type IMemoRunContext,
  type ISourceDeclaration,
  type ISourceRecord,
  type ISourceRunContext,
} from './declaration.js';
import type { IBindingDescriptor } from './descriptor.js';
import type { IApply, IBindingFamily } from './family.js';

/**
 * Nominal brand for member subjects; runtime ownership is proven only by the
 * member builder that minted the subject.
 * @alpha
 */
export interface IMemberSubjectBrand {
  readonly __microdeltaMemberSubject: unique symbol;
}

/**
 * A symbolic member subject: the author's subject prefix, to which each member
 * instance applies its key (`prefix:key`). It carries no member data.
 * @alpha
 */
export interface IMemberSubject extends IMemberSubjectBrand {
  /** The author's complete subject prefix, retained exactly. */
  readonly prefix: string;
}

/**
 * Options for a member-scoped source: an ordinary source whose subject is a
 * symbolic member subject.
 * @alpha
 */
export interface ITemplateSourceOptions<TFamily extends IBindingFamily, TResult> {
  /** The member subject minted by this template's member builder. */
  readonly subject: IMemberSubject;
  /** Compatibility group; a positive safe integer, default 1. */
  readonly version?: number;
  /** Display metadata only; never identity or correspondence. */
  readonly label?: string;
  /** The author's check/retrieval callback. */
  readonly run: (context: ISourceRunContext<TFamily, TResult>) => IApply<TFamily['outcomes'], TResult>;
  /** The author's optional current finality hook. */
  readonly finality?: (context: IFinalityContext<TFamily, TResult>) => unknown;
}

/**
 * Options for a member-scoped memoized computation. Its children are sibling
 * member steps (sources or memos) of the same template, or composition-wide
 * supplied step slots.
 * @alpha
 */
export interface ITemplateMemoOptions<TFamily extends IBindingFamily, TChildren extends IChildDeclarations<TFamily>, TResult> {
  /** The member subject minted by this template's member builder. */
  readonly subject: IMemberSubject;
  /** Compatibility group; a positive safe integer, default 1. */
  readonly version?: number;
  /** Display metadata only; never identity or correspondence. */
  readonly label?: string;
  /** Each call name mapped to the sibling member step occupying that slot, or to a supplied step slot. */
  readonly children?: TChildren;
  /** The author's computation callback. */
  readonly run: (context: IMemoRunContext<TFamily, TChildren>) => TResult;
}

/**
 * The symbolic member a template factory receives. It mints member subjects
 * and member step declarations while the factory runs and rejects every call
 * with `frozen` once the factory has returned. It exposes no key and no data.
 * @alpha
 */
export interface IMemberBuilder<TFamily extends IBindingFamily> {
  /** A member subject whose instances are `prefix:key`, computed from the key only. */
  subject(prefix: string): IMemberSubject;
  /** Declare a member-scoped retained source. */
  source<TResult>(options: ITemplateSourceOptions<TFamily, TResult>): ISourceDeclaration<TFamily, TResult>;
  /** Declare a member-scoped memoized computation over sibling member sources. */
  memo<TChildren extends IChildDeclarations<TFamily> = Record<never, never>, TResult = unknown>(
    options: ITemplateMemoOptions<TFamily, TChildren, TResult>,
  ): IMemoDeclaration<TFamily, TChildren, TResult>;
}

/**
 * A declaration a template factory may return: a member-scoped source or memo.
 * @alpha
 */
export type ITemplateStepDeclaration<TFamily extends IBindingFamily> = IAnySourceDeclaration<TFamily> | IAnyMemoDeclaration<TFamily>;

/**
 * A template factory's result: each key is a template step slot and each value
 * the member-scoped declaration occupying it.
 * @alpha
 */
export type ITemplateSteps<TFamily extends IBindingFamily> = { readonly [slot: string]: ITemplateStepDeclaration<TFamily> };

/**
 * Author context for a gate: the facade's memo bindings (declared inputs and
 * helpers) plus the member binding, a view of this instance's member record.
 * @alpha
 */
export type IGateContext<TFamily extends IBindingFamily, TMember> = TFamily['memo'] & {
  readonly member: IApply<TFamily['views'], TMember>;
};

/**
 * Rejects, at the type level, a template over a source whose declared result
 * is not a keyed collection.
 * @alpha
 */
export type IKeyedCollectionCheck<TFamily extends IBindingFamily, TCollection> =
  [IMemberOf<TFamily, TCollection>] extends [never] ? never : unknown;

/**
 * Author options for a fanout template.
 * @alpha
 */
export interface ITemplateOptions<
  TFamily extends IBindingFamily,
  TCollection extends IAnySourceDeclaration<TFamily>,
  TSteps extends ITemplateSteps<TFamily>,
> {
  /** The template slot, unique within a composition and part of every instance descriptor. */
  readonly slot: string;
  /** The keyed collection source whose members instantiate the template. */
  readonly collection: TCollection & IKeyedCollectionCheck<TFamily, TCollection>;
  /** An explicit custom-key function overriding the collection's designated identity. */
  readonly key?: (member: IMemberOf<TFamily, TCollection>) => string;
  /** A tracked gate: an explicit `false` skips an instance without changing topology. */
  readonly gate?: (context: IGateContext<TFamily, IMemberOf<TFamily, TCollection>>) => boolean;
  /** The factory, run exactly once against a symbolic member. */
  readonly steps: (member: IMemberBuilder<TFamily>) => TSteps;
}

/**
 * Nominal brand for Definition-minted templates, with an invariant family marker.
 * @alpha
 */
export interface ITemplateBrand<TFamily extends IBindingFamily> {
  readonly __microdeltaTemplate: unique symbol;
  readonly __microdeltaFamily?: (family: TFamily) => TFamily;
}

/**
 * A frozen template with its member and step types erased.
 * @alpha
 */
export interface IAnyTemplateDeclaration<TFamily extends IBindingFamily> extends ITemplateBrand<TFamily> {
  readonly kind: 'template';
  /** The template slot. */
  readonly slot: string;
  /** The keyed collection source the template fans out over. */
  readonly collection: IAnySourceDeclaration<TFamily>;
  /** The author's custom-key function, when declared. */
  readonly key: ((member: never) => unknown) | undefined;
  /** The author's gate, when declared. */
  readonly gate: ((context: never) => unknown) | undefined;
  /** Frozen copy of the factory's step record. */
  readonly steps: ITemplateSteps<TFamily>;
}

/**
 * A frozen template carrying its collection, member and step types.
 * @alpha
 */
export interface ITemplateDeclaration<
  TFamily extends IBindingFamily,
  TCollection extends IAnySourceDeclaration<TFamily>,
  TSteps extends ITemplateSteps<TFamily>,
> extends IAnyTemplateDeclaration<TFamily> {
  readonly collection: TCollection;
  readonly key: ((member: IMemberOf<TFamily, TCollection>) => string) | undefined;
  readonly gate: ((context: IGateContext<TFamily, IMemberOf<TFamily, TCollection>>) => boolean) | undefined;
  readonly steps: TSteps;
}

/**
 * Resolution's supplier of the member binding for one gate evaluation: the
 * view of one instance's member record from the given collection's result.
 * @alpha
 */
export interface IMemberSupplier<TFamily extends IBindingFamily> {
  /** The member view of the addressed instance (its descriptor carries the member key) of a template over `collection`. */
  view<TCollection extends IAnySourceDeclaration<TFamily>>(
    collection: TCollection,
    instance: IBindingDescriptor,
  ): IApply<TFamily['views'], IMemberOf<TFamily, TCollection>>;
}

/**
 * One template instance's declared gate, exposed for Resolution to evaluate
 * under tracking. It is addressed like an invocation: by an instance
 * descriptor, whose member key names the member the gate decides for.
 * @alpha
 */
export interface IGateInvocation<TFamily extends IBindingFamily> {
  /** The instance descriptor the gate was opened for. */
  readonly parent: IBindingDescriptor;
  /** The member key the gate decides for. */
  readonly memberKey: string;
  /** Hand the actual author gate and its context (bindings plus member) to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], member: IMemberSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/**
 * How one gate evaluation settled: it returned a value, or it threw.
 * @alpha
 */
export type IGateSettlement =
  | { readonly kind: 'returned'; readonly value: unknown }
  | { readonly kind: 'threw'; readonly error: unknown };

/**
 * The meaning of a settled gate (CMP-8). Only an explicit `true` requires the
 * instance and only an explicit `false` skips it; any other value, including a
 * promise, and any throw fail the instance, distinctly.
 * @alpha
 */
export type IGateOutcome =
  | { readonly status: 'required' }
  | { readonly status: 'skipped' }
  | { readonly status: 'failed'; readonly reason: 'non-boolean'; readonly received: string }
  | { readonly status: 'failed'; readonly reason: 'threw'; readonly error: unknown };

/**
 * One template in a frozen composition's topology.
 * @alpha
 */
export interface ITemplateTopology {
  /** The template slot. */
  readonly slot: string;
  /** The composition-level collection step the template fans out over. */
  readonly collection: IBindingDescriptor;
  /** Template step descriptors (no member key), in structural order. */
  readonly steps: readonly IBindingDescriptor[];
  /** Permitted template-level parent-to-child relationships (sibling steps and supplied step slots), in structural order. */
  readonly edges: readonly IDeclaredEdge[];
  /** Whether the template declares a gate. */
  readonly gated: boolean;
  /** Whether the template declares a custom-key function. */
  readonly customKey: boolean;
}

/**
 * Classify a settled gate evaluation. The settlement is Resolution-supplied
 * data; a malformed one is rejected rather than read as a skip.
 * @param settlement - What the gate returned, or what it threw.
 * @returns Required, skipped, or failed with a distinct reason.
 * @alpha
 */
export function gateOutcome(settlement: IGateSettlement): IGateOutcome {
  return Object.freeze(classifyGate(settlement));
}

/** Classify one settlement read through own data properties only. */
function classifyGate(settlement: unknown): IGateOutcome {
  const kind = ownValue(settlement, 'kind');
  if (kind === 'threw' && hasOwnData(settlement, 'error')) {
    return { status: 'failed', reason: 'threw', error: ownValue(settlement, 'error') };
  }
  if (kind !== 'returned' || !hasOwnData(settlement, 'value')) {
    return reject('invalid-result', 'A gate settlement must be { kind: "returned", value } or { kind: "threw", error }.');
  }
  const value = ownValue(settlement, 'value');
  if (value === true) {
    return { status: 'required' };
  }
  if (value === false) {
    return { status: 'skipped' };
  }
  return { status: 'failed', reason: 'non-boolean', received: value === null ? 'null' : typeof value };
}

/** A template's gate with its typed closure over the author's gate and collection. */
interface IGateRecord<TFamily extends IBindingFamily> {
  apply<TOutcome>(bindings: TFamily['memo'], member: IMemberSupplier<TFamily>, instance: IBindingDescriptor, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/** One frozen template step: its slot, member subject prefix and template-level record. */
interface ITemplateStep<TFamily extends IBindingFamily> {
  readonly slot: string;
  readonly prefix: string;
  readonly record: ISourceRecord<TFamily> | IMemoRecord<TFamily>;
}

/** A template's private record, reachable only through the builder instance that minted it. */
export interface ITemplateRecord<TFamily extends IBindingFamily> {
  readonly declaration: IAnyTemplateDeclaration<TFamily>;
  /** The keyed collection source declaration. */
  readonly collection: IAnySourceDeclaration<TFamily>;
  /** The collection's designated identity field. */
  readonly identity: string;
  readonly customKey: ((member: never) => unknown) | undefined;
  readonly gate: IGateRecord<TFamily> | undefined;
  /** Template steps by slot, in structural (sorted) order. */
  readonly steps: ReadonlyMap<string, ITemplateStep<TFamily>>;
  /** The step slot each template-level member step declaration occupies. */
  readonly slotOf: ReadonlyMap<object, string>;
}

/** One builder instance's template records, keyed by the templates it minted. */
export type ITemplateRecords<TFamily extends IBindingFamily> = WeakMap<object, ITemplateRecord<TFamily>>;

/** Every member step declaration a member builder minted, and every instance of one; valid only through their template. */
const memberSteps = new WeakSet<object>();

/** Nonzero while a template factory runs; templates do not nest. */
let factoryDepth = 0;

/**
 * Whether a declaration was minted by a template's member builder or
 * instantiated from one for a member key. Such a declaration is addressable
 * only through its template, never as an ordinary member or composition step.
 * @param declaration - Any declaration.
 * @returns True for member step and instance declarations.
 */
export function isMemberStep(declaration: object): boolean {
  return memberSteps.has(declaration);
}

/** The options a template declaration recognizes. */
const templateFields = ['slot', 'collection', 'key', 'gate', 'steps'] as const;

/**
 * Declare a fanout template, running its factory exactly once inside the
 * composition phase against a symbolic member.
 * @param records - The builder instance's declaration records.
 * @param templates - The builder instance's template records.
 * @param options - The author's slot, collection, key, gate and factory.
 * @returns The frozen template.
 */
export function declareTemplate<TFamily extends IBindingFamily, TCollection extends IAnySourceDeclaration<TFamily>, TSteps extends ITemplateSteps<TFamily>>(
  records: IDeclarationRecords<TFamily>,
  templates: ITemplateRecords<TFamily>,
  options: ITemplateOptions<TFamily, TCollection, TSteps>,
): ITemplateDeclaration<TFamily, TCollection, TSteps> {
  if (factoryDepth > 0) {
    reject('invalid-template', 'Templates do not nest: declare every template outside any template factory.');
  }
  const read = templateOptions(options);
  const slot = read.get('slot');
  if (typeof slot !== 'string' || slot.length === 0) {
    reject('invalid-descriptor', 'A template slot must be a nonempty string.');
  }
  for (const [key, required] of [['steps', true], ['key', false], ['gate', false]] as const) {
    const value = read.get(key);
    if ((value !== undefined || required) && typeof value !== 'function') {
      reject('invalid-callback', `Template option ${key} must be a function.`);
    }
  }
  const candidate = read.get('collection');
  const collectionRecord = typeof candidate === 'object' && candidate !== null ? records.get(candidate) : undefined;
  if (collectionRecord === undefined) {
    return reject('forged-declaration', `Template ${slot} collection is not a declaration this family minted.`);
  }
  if (collectionRecord.kind !== 'source' || collectionRecord.declaration.collection === undefined) {
    return reject('invalid-collection', `Template ${slot} must fan out over a keyed collection source declaring its designated identity.`);
  }
  const identity = collectionRecord.declaration.collection.identity;
  // Every recognized option was just proven to be an own data property of the
  // expected type (or absent without an inherited property), so these typed
  // reads run no author code and adopt nothing unvalidated.
  const { collection, key, gate, steps: factory } = options;

  const minted = new Map<object, ISourceRecord<TFamily> | IMemoRecord<TFamily>>();
  const prefixes = new Map<object, string>();
  let open = true;
  const assertOpen = (): void => {
    if (!open) {
      reject('frozen', `Template ${slot} is frozen: its member builder rejects every call after the factory returns.`);
    }
  };
  const memberPrefix = (subject: unknown): string => {
    // Only subjects minted by this template's own member builder carry a prefix here.
    const prefix = typeof subject === 'object' && subject !== null ? prefixes.get(subject) : undefined;
    return prefix ?? reject('invalid-subject', `Template ${slot} member steps require a subject minted by this template's member.subject(prefix).`);
  };
  /** Options that never apply to a member step. */
  const checkMemberOptions = (fields: ReadonlyMap<string, unknown>): void => {
    if (fields.has('collection')) {
      reject('invalid-template', 'A member step cannot be a keyed collection; templates do not nest.');
    }
    if (fields.has('over')) {
      reject('illegal-edge', 'Only a strict fold names the template step it consumes.');
    }
  };
  const adopt = (declaration: object): void => {
    const record = records.get(declaration);
    if (record?.kind !== 'source' && record?.kind !== 'memo') {
      return reject('invalid-template', `Template ${slot} member steps must be sources or memos.`);
    }
    minted.set(declaration, record);
    memberSteps.add(declaration);
  };
  const member: IMemberBuilder<TFamily> = {
    subject(prefix: string): IMemberSubject {
      assertOpen();
      if (typeof prefix !== 'string' || prefix.length === 0) {
        reject('invalid-subject', 'A member subject prefix must be a complete nonempty string.');
      }
      const subject = mintSubject(prefix);
      prefixes.set(subject, prefix);
      return subject;
    },
    source<TResult>(sourceOptions: ITemplateSourceOptions<TFamily, TResult>): ISourceDeclaration<TFamily, TResult> {
      assertOpen();
      const fields = readOptions(sourceOptions);
      checkMemberOptions(fields);
      if (fields.has('children')) {
        reject('illegal-edge', 'Sources declare no child edges.');
      }
      const prefix = memberPrefix(fields.get('subject'));
      const { run, finality, version, label } = sourceOptions;
      const declaration = declareSource<TFamily, TResult>(records, {
        subject: prefix,
        run,
        ...(finality === undefined ? {} : { finality }),
        ...(version === undefined ? {} : { version }),
        ...(label === undefined ? {} : { label }),
      });
      adopt(declaration);
      return declaration;
    },
    memo<TChildren extends IChildDeclarations<TFamily> = Record<never, never>, TResult = unknown>(
      memoOptions: ITemplateMemoOptions<TFamily, TChildren, TResult>,
    ): IMemoDeclaration<TFamily, TChildren, TResult> {
      assertOpen();
      const fields = readOptions(memoOptions);
      checkMemberOptions(fields);
      const prefix = memberPrefix(fields.get('subject'));
      const { run, children, version, label } = memoOptions;
      const declaration = declareMemo<TFamily, TChildren, TResult>(records, {
        subject: prefix,
        run,
        ...(children === undefined ? {} : { children }),
        ...(version === undefined ? {} : { version }),
        ...(label === undefined ? {} : { label }),
      });
      const record = records.get(declaration);
      for (const edge of record?.kind === 'memo' ? record.children.values() : []) {
        // Supplied step slots are composition-wide; sibling edges stay inside this template.
        if (edge.kind === 'sibling' && !minted.has(edge.declaration)) {
          reject('illegal-edge', `Template ${slot} member memo children must be member steps of the same template or supplied step slots.`);
        }
      }
      adopt(declaration);
      return declaration;
    },
  };
  Object.freeze(member);

  let returned: TSteps;
  factoryDepth++;
  try {
    // CMP-4: the factory runs exactly once, while composing, against the symbolic member.
    returned = withinComposition(() => factory(member));
  } finally {
    open = false;
    factoryDepth--;
  }
  if (!isPlainRecord(returned) || Object.keys(returned).length === 0) {
    return reject('invalid-template', `Template ${slot} factory must return a nonempty plain record of member step declarations.`);
  }
  // Framework-owned copy: the author's record may change later without effect.
  const copy = { ...returned };
  Object.freeze(copy);
  const steps = new Map<string, ITemplateStep<TFamily>>();
  const slotOf = new Map<object, string>();
  for (const stepSlot of Object.keys(copy).sort(compareText)) {
    const declaration: unknown = Object.getOwnPropertyDescriptor(copy, stepSlot)?.value;
    const record = typeof declaration === 'object' && declaration !== null ? minted.get(declaration) : undefined;
    if (record === undefined || typeof declaration !== 'object' || declaration === null || slotOf.has(declaration)) {
      return reject('invalid-template', `Template ${slot} step ${stepSlot} must be a distinct member step declared by this template's member builder.`);
    }
    slotOf.set(declaration, stepSlot);
    steps.set(stepSlot, { slot: stepSlot, prefix: record.declaration.subject, record });
  }
  for (const step of steps.values()) {
    for (const [call, edge] of step.record.kind === 'memo' ? step.record.children : []) {
      // Current-template consistency: a sibling edge names the member step occupying that slot.
      if (edge.kind === 'sibling' && (call === step.slot || steps.get(call)?.record.declaration !== edge.declaration)) {
        reject('illegal-edge', `Template ${slot} memo ${step.slot} child ${call} must be the member step occupying that sibling slot.`);
      }
    }
  }
  assertDisjointPrefixes([...steps.values()].map(step => step.prefix));

  const declaration = mintTemplate<ITemplateDeclaration<TFamily, TCollection, TSteps>>({ kind: 'template', slot, collection, key, gate, steps: copy });
  templates.set(declaration, {
    declaration,
    collection: collectionRecord.declaration,
    identity,
    customKey: key,
    gate: gate === undefined ? undefined : {
      apply<TOutcome>(bindings: TFamily['memo'], supplier: IMemberSupplier<TFamily>, instance: IBindingDescriptor, invoke: IAuthorInvoker<TOutcome>): TOutcome {
        checkBindings(bindings, 'member');
        const context: IGateContext<TFamily, IMemberOf<TFamily, TCollection>> = { ...bindings, member: supplier.view<TCollection>(collection, instance) };
        Object.freeze(context);
        return invoke(gate, context);
      },
    },
    steps,
    slotOf,
  });
  return declaration;
}

/** Freeze a constructed template and attach its type-level brand. */
function mintTemplate<TTemplate extends object>(value: Omit<TTemplate, keyof ITemplateBrand<IBindingFamily>>): TTemplate {
  Object.freeze(value);
  // The brand is type-level only; this module is its sole minting authority.
  return value as TTemplate;
}

/** Freeze a member subject and attach its type-level brand. */
function mintSubject(prefix: string): IMemberSubject {
  const subject = Object.freeze({ prefix });
  // The brand is type-level only; member builders are its sole minting authority.
  return subject as IMemberSubject;
}

/**
 * RES-001 across instances: no prefix may equal another or extend it with the
 * `:` separator, since `prefix:key` would then collide for some member key.
 */
function assertDisjointPrefixes(prefixes: readonly string[]): void {
  prefixes.forEach((prefix, index) => {
    for (const other of prefixes.slice(index + 1)) {
      if (prefix === other || prefix.startsWith(`${other}:`) || other.startsWith(`${prefix}:`)) {
        reject('conflicting-subject', `Member subject prefixes ${JSON.stringify(prefix)} and ${JSON.stringify(other)} can produce the same instance subject.`);
      }
    }
  });
}

/** UTF-16 code-unit order for structural slot ordering. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Capture a template options record through its own property descriptors. An
 * accessor or inherited recognized option rejects without running any getter.
 */
function templateOptions(options: unknown): ReadonlyMap<string, unknown> {
  if (typeof options !== 'object' || options === null) {
    return reject('invalid-template', 'Template options must be a record.');
  }
  const read = new Map<string, unknown>();
  for (const key of templateFields) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined) {
      if (key in options) {
        reject('invalid-template', `Template option ${key} must be an own property, not inherited.`);
      }
      continue;
    }
    if (!('value' in descriptor)) {
      reject('invalid-template', `Template option ${key} must be a data property, not an accessor.`);
    }
    read.set(key, descriptor.value);
  }
  return read;
}

/** Whether a value has an own data property; accessors and inherited properties do not count. */
function hasOwnData(value: unknown, key: string): boolean {
  const descriptor = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, key) : undefined;
  return descriptor !== undefined && 'value' in descriptor;
}

/** An own data property's value, or undefined; accessors are never invoked. */
function ownValue(value: unknown, key: string): unknown {
  const descriptor = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, key) : undefined;
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/** A composed template: its record, collection binding and topology in one composition. */
interface IBoundTemplate<TFamily extends IBindingFamily> {
  readonly record: ITemplateRecord<TFamily>;
  readonly collection: string;
  readonly topology: ITemplateTopology;
}

/**
 * The member subject prefix whose instances can claim `subject`: an instance
 * subject is `prefix:key` with a nonempty key, so only a longer subject that
 * starts with `prefix:` can collide (RES-001).
 * @param prefixes - Every member subject prefix of the composed templates.
 * @param subject - A complete subject claimed elsewhere in the composition.
 * @returns The colliding prefix, or undefined when no instance can claim the subject.
 */
export function instancePrefixOf(prefixes: readonly string[], subject: string): string | undefined {
  return prefixes.find(prefix => subject.length > prefix.length + 1 && subject.startsWith(`${prefix}:`));
}

/** The templates of one frozen composition and the lookups Definition performs over them. */
export interface IBoundTemplates<TFamily extends IBindingFamily> {
  /** Template topology, sorted by template slot. */
  readonly topology: readonly ITemplateTopology[];
  /** Every member subject prefix of the composed templates. */
  readonly prefixes: readonly string[];
  /** Supplied step slot names some template memo declares. */
  readonly slots: readonly string[];
  /** The template step descriptor a fold names, or undefined when that template or step is not composed. */
  foldTarget(template: object, step: string): IBindingDescriptor | undefined;
  /** The instance record a template descriptor addresses, or undefined for a miss. */
  instance(descriptor: IBindingDescriptor): ISourceRecord<TFamily> | IMemoRecord<TFamily> | undefined;
  /** Whether a relationship is a declared template edge of one member (sibling) or to a supplied step slot. */
  declaresEdge(parent: IBindingDescriptor, child: IBindingDescriptor): boolean;
  /** Key a collection snapshot under a composed template's strategy. */
  keyMembers(template: string, snapshot: unknown): IKeyedSnapshot;
  /** The declared gate of the instance a descriptor addresses, or undefined when its template declares none. */
  gate(instance: IBindingDescriptor): IGateInvocation<TFamily> | undefined;
}

/**
 * Bind a composition's templates to their collection slots and freeze their
 * topology. Every template must be minted by this builder instance, occupy a
 * unique slot and fan out over a collection held by exactly one
 * composition-level step slot. Instance subjects must not collide across
 * templates or with any ordinary subject (RES-001). Instance declarations are
 * minted on demand; only those of members this composition's keying returned
 * are retained, per composition, so resolving an untrusted historical
 * descriptor never grows retained state.
 * @param scope - The composition scope.
 * @param entries - The author's template list, already copied.
 * @param templates - The builder instance's template records.
 * @param collectionSlots - The composition-level step slots holding a declaration.
 * @param subjects - Every ordinary step subject in the composition.
 * @returns The bound templates.
 */
export function bindTemplates<TFamily extends IBindingFamily>(
  scope: string,
  entries: readonly unknown[],
  templates: ITemplateRecords<TFamily>,
  collectionSlots: (declaration: object) => readonly string[],
  subjects: Iterable<string>,
): IBoundTemplates<TFamily> {
  const bound = new Map<string, IBoundTemplate<TFamily>>();
  const slots = new Set<string>();
  for (const entry of entries) {
    const record = typeof entry === 'object' && entry !== null ? templates.get(entry) : undefined;
    if (record === undefined) {
      return reject('forged-declaration', 'A composed template must be one this family minted.');
    }
    const slot = record.declaration.slot;
    if (bound.has(slot)) {
      reject('invalid-template', `Template slot ${slot} occurs more than once in this composition.`);
    }
    const [collection, ...others] = collectionSlots(record.collection);
    if (collection === undefined || others.length > 0) {
      return reject('invalid-collection', `Template ${slot} collection must occupy exactly one composition-level step slot.`);
    }
    const stepDescriptor = (step: string): IBindingDescriptor => Object.freeze({ scope, role: 'step', slot: step, template: slot, collection });
    const edges: IDeclaredEdge[] = [];
    for (const step of record.steps.values()) {
      for (const [call, edge] of step.record.kind === 'memo' ? step.record.children : []) {
        if (edge.kind === 'slot') {
          slots.add(edge.slot);
        }
        const child = edge.kind === 'slot' ? Object.freeze({ scope, role: 'callable' as const, slot: edge.slot }) : stepDescriptor(call);
        if (!edges.some(existing => existing.parent.slot === step.slot && existing.child.role === child.role && existing.child.slot === child.slot)) {
          edges.push(Object.freeze({ parent: stepDescriptor(step.slot), child }));
        }
      }
    }
    edges.sort((left, right) => compareText(left.parent.slot, right.parent.slot) || compareText(left.child.role, right.child.role) || compareText(left.child.slot, right.child.slot));
    const topology: ITemplateTopology = Object.freeze({
      slot,
      collection: Object.freeze({ scope, role: 'step', slot: collection }),
      steps: Object.freeze([...record.steps.keys()].map(stepDescriptor)),
      edges: Object.freeze(edges),
      gated: record.gate !== undefined,
      customKey: record.customKey !== undefined,
    });
    bound.set(slot, { record, collection, topology });
  }
  const prefixes = [...bound.values()].flatMap(entry => [...entry.record.steps.values()].map(step => step.prefix));
  assertDisjointPrefixes(prefixes);
  for (const subject of subjects) {
    const prefix = instancePrefixOf(prefixes, subject);
    if (prefix !== undefined) {
      reject('conflicting-subject', `Subject ${JSON.stringify(subject)} can equal an instance subject of member prefix ${JSON.stringify(prefix)}.`);
    }
  }
  /**
   * The member keys each template's keying has returned in this composition.
   * Only their instances are retained, so the cache is bounded by the members
   * discovery actually produced (times the template's steps); an untrusted
   * historical descriptor naming any other key resolves structurally to a
   * fresh instance that is never retained.
   */
  const keyedMembers = new Map<string, Set<string>>();
  /** This composition's retained instances: template slot, then member key, then step slot. */
  const instances = new Map<string, Map<string, Map<string, ISourceRecord<TFamily> | IMemoRecord<TFamily>>>>();
  const instanceOf = (entry: IBoundTemplate<TFamily>, stepSlot: string, memberKey: string): ISourceRecord<TFamily> | IMemoRecord<TFamily> | undefined => {
    const step = entry.record.steps.get(stepSlot);
    if (step === undefined) {
      return undefined;
    }
    const templateSlot = entry.record.declaration.slot;
    const retained = keyedMembers.get(templateSlot)?.has(memberKey) === true;
    let bySlot: Map<string, ISourceRecord<TFamily> | IMemoRecord<TFamily>> | undefined;
    if (retained) {
      const byKey = instances.get(templateSlot) ?? new Map<string, Map<string, ISourceRecord<TFamily> | IMemoRecord<TFamily>>>();
      instances.set(templateSlot, byKey);
      bySlot = byKey.get(memberKey) ?? new Map<string, ISourceRecord<TFamily> | IMemoRecord<TFamily>>();
      byKey.set(memberKey, bySlot);
      const existing = bySlot.get(stepSlot);
      if (existing !== undefined) {
        return existing;
      }
    }
    // RES-001: the instance subject is computed from the member subject prefix and the key only.
    const subject = `${step.prefix}:${memberKey}`;
    const created = step.record.kind === 'source'
      ? step.record.instantiate(subject)
      : step.record.instantiate(subject, (sibling) => {
        const siblingSlot = entry.record.slotOf.get(sibling);
        const siblingInstance = siblingSlot === undefined ? undefined : instanceOf(entry, siblingSlot, memberKey);
        return siblingInstance?.declaration ?? reject('illegal-edge', `Template ${entry.record.declaration.slot} memo ${stepSlot} has an unpinned child.`);
      });
    // An instance, like its template step, is addressable only through its template.
    memberSteps.add(created.declaration);
    bySlot?.set(stepSlot, created);
    return created;
  };
  const boundOf = (template: string): IBoundTemplate<TFamily> =>
    bound.get(template) ?? reject('invalid-template', `Template ${template} is not declared in this composition.`);
  /** The composed template a descriptor addresses, when its scope, role and collection binding match exactly. */
  const addressed = (descriptor: IBindingDescriptor): IBoundTemplate<TFamily> | undefined => {
    const entry = descriptor.template === undefined ? undefined : bound.get(descriptor.template);
    return entry !== undefined && descriptor.scope === scope && descriptor.role === 'step' && descriptor.collection === entry.collection ? entry : undefined;
  };
  /** The instance record a descriptor addresses: a declared step of a composed template with a member key. */
  const instance = (descriptor: IBindingDescriptor): ISourceRecord<TFamily> | IMemoRecord<TFamily> | undefined => {
    const entry = addressed(descriptor);
    // A template step without a member key addresses no instance.
    return entry === undefined || descriptor.memberKey === undefined ? undefined : instanceOf(entry, descriptor.slot, descriptor.memberKey);
  };
  return Object.freeze({
    topology: Object.freeze([...bound.keys()].sort(compareText).map(slot => boundOf(slot).topology)),
    prefixes: Object.freeze(prefixes),
    slots: Object.freeze([...slots].sort(compareText)),
    foldTarget(template: object, step: string): IBindingDescriptor | undefined {
      const entry = [...bound.values()].find(candidate => candidate.record.declaration === template);
      return entry?.topology.steps.find(descriptor => descriptor.slot === step);
    },
    instance,
    declaresEdge(parent: IBindingDescriptor, child: IBindingDescriptor): boolean {
      const entry = addressed(parent);
      if (entry === undefined || parent.memberKey === undefined || entry.record.steps.get(parent.slot) === undefined) {
        return false;
      }
      if (child.role === 'callable') {
        return child.scope === scope && child.memberKey === undefined && child.template === undefined &&
          entry.topology.edges.some(edge => edge.parent.slot === parent.slot && edge.child.role === 'callable' && edge.child.slot === child.slot);
      }
      return addressed(child) === entry && parent.memberKey === child.memberKey &&
        entry.topology.edges.some(edge => edge.parent.slot === parent.slot && edge.child.role === 'step' && edge.child.slot === child.slot);
    },
    keyMembers(template: string, snapshot: unknown): IKeyedSnapshot {
      const { record, collection } = boundOf(template);
      const keyed = keySnapshot({ template, collection, identity: record.identity, customKey: record.customKey }, snapshot);
      if (keyed.status === 'keyed') {
        const members = keyedMembers.get(template) ?? new Set<string>();
        keyedMembers.set(template, members);
        for (const { key } of keyed.members) {
          members.add(key);
        }
      }
      return keyed;
    },
    gate(descriptor: IBindingDescriptor): IGateInvocation<TFamily> | undefined {
      const entry = addressed(descriptor);
      const memberKey = descriptor.memberKey;
      if (entry === undefined || memberKey === undefined || entry.record.steps.get(descriptor.slot) === undefined) {
        return reject('unresolved-parent', 'A gate is opened for an instance descriptor of a declared step of a composed template.');
      }
      const gate = entry.record.gate;
      if (gate === undefined) {
        return undefined;
      }
      return Object.freeze({
        parent: descriptor,
        memberKey,
        apply<TOutcome>(bindings: TFamily['memo'], member: IMemberSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome {
          if (isComposing()) {
            reject('composition-phase', 'Gates cannot be applied while composing.');
          }
          return gate.apply(bindings, member, descriptor, invoke);
        },
      });
    },
  });
}

/**
 * Expose the declared gate of the template instance a descriptor addresses,
 * mirroring `openInvocation`.
 * @param compositions - The builder instance's composition states.
 * @param composition - A composition this builder instance minted.
 * @param instance - An instance descriptor: a composed template step plus a member key.
 * @returns The gate invocation, or undefined when the template declares no gate.
 */
export function gateOfIn<TFamily extends IBindingFamily>(
  compositions: WeakMap<object, ICompositionState<TFamily>>,
  composition: IComposition<TFamily>,
  instance: IBindingDescriptor,
): IGateInvocation<TFamily> | undefined {
  if (isComposing()) {
    reject('composition-phase', 'Gates cannot be opened while composing.');
  }
  const state = compositions.get(composition) ?? reject('forged-composition', 'This family did not mint the composition.');
  return state.templates.gate(ownedDescriptor(instance));
}
