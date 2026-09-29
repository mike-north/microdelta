/**
 * Invocation scopes, declared child-call handles and the injected port.
 *
 * `openInvocation` reconnects one uniquely bound step (or the implementation
 * uniquely bound to a supplied step slot) of a composition its builder
 * instance minted and returns a live scope whose `apply` pairs the actual
 * author callback with the context Definition assembles: the facade's bindings
 * plus Definition-minted calls (memo), the previous carrier Resolution
 * selected (source), or the argument views Resolution reconstructed (supplied
 * step). The pair goes to Resolution's rank-2 invoker, which tracks and
 * captures it. Definition never selects previous results, materializes data,
 * decides freshness or admission, or runs a body.
 *
 * Calling a handle routes an immutable witness, the pinned child declaration
 * (or the slot's current implementation and the call's subject) through the
 * injected port. A parent whose children are all sibling sources sends the M3
 * version-1 witness; a parent declaring a memo child or a supplied slot sends
 * the version-2 nested witness with its call position and argument recipes.
 * Only supplied slot calls take runtime arguments. The result is an immutable
 * `{ data }` carrier so awaiting it never probes a `then` property on child
 * data. Forged, substituted, out-of-scope, closed and composition-phase calls,
 * arguments on argument-free edges, and raw tracked views reject before
 * dispatch (CMP-9).
 */
import { recordArguments, registerCarrier, type IArgumentContext, type IHandleArguments } from './arguments.js';
import type { IComposition, ICompositionState, IScopedSubject, ISuppliedStepTarget } from './composition.js';
import { descriptorKey, isComposing, ownedDescriptor } from './composition.js';
import type {
  IAnyMemoDeclaration,
  IAuthorInvoker,
  IChildEdge,
  IDeclarationRecords,
  IPreviousSupplier,
  ISourceDeclaration,
} from './declaration.js';
import { reject } from './declaration.js';
import type { IBindingDescriptor } from './descriptor.js';
import { DefinitionError } from './errors.js';
import type { IApply, IBindingFamily } from './family.js';
import type { IAnySuppliedStepDeclaration, IArgumentSupplier } from './slot.js';
import type {
  IDirectChildWitness,
  IEmptyArguments,
  IInvocationArguments,
  IInvocationWitness,
  INestedInvocationWitness,
} from './witness.js';

/**
 * The immutable carrier for a child result. `data` holds whatever view the
 * port supplies; the carrier itself is never a thenable.
 * @alpha
 */
export interface IChildResult<T> {
  readonly data: T;
}

/**
 * Nominal brand for Definition-minted handles. It has no runtime property;
 * runtime ownership is proven only by Definition's private registry.
 * @alpha
 */
export interface IDeclaredCallBrand {
  readonly __microdeltaDeclaredCall: unique symbol;
}

/**
 * A declared child call. `T` is the child view the facade's family selects for
 * the child's declared result. `TParameters` are the runtime arguments a
 * supplied step slot declares; sibling edges take none.
 * @alpha
 */
export type IDeclaredCallHandle<T, TParameters extends readonly unknown[] = readonly []> =
  ((...values: IHandleArguments<TParameters>) => Promise<IChildResult<T>>) & IDeclaredCallBrand;

/**
 * What Definition can say about a genuine version-2 handle before it is
 * called: its structural parent and child. The call position and argument
 * recipe exist only once a call is made.
 * @alpha
 */
export interface IDeclaredCallDescription {
  /** The witness version the handle's calls record. */
  readonly version: 2;
  /** The calling step slot. */
  readonly parent: IBindingDescriptor;
  /** The called sibling step slot or supplied step slot. */
  readonly child: IBindingDescriptor;
}

/**
 * A dispatch of a sibling source. A parent whose children are all sources
 * sends the M3 version-1 witness; a nested parent sends version 2.
 * @alpha
 */
export interface ISourceCallRequest<TFamily extends IBindingFamily, TResult> {
  /** Discriminates the request by child kind. */
  readonly kind: 'source';
  /** The parent invocation scope the call belongs to. */
  readonly scope: IInvocationScope;
  /** The witness for this call. */
  readonly witness: IInvocationWitness;
  /** The declared child source, carrying its result type to the port. */
  readonly child: ISourceDeclaration<TFamily, TResult>;
}

/**
 * A dispatch of a sibling memo; always argument-free with a version-2 witness.
 * @alpha
 */
export interface IMemoCallRequest<TFamily extends IBindingFamily> {
  /** Discriminates the request by child kind. */
  readonly kind: 'memo';
  /** The parent invocation scope the call belongs to. */
  readonly scope: IInvocationScope;
  /** The nested witness for this call. */
  readonly witness: INestedInvocationWitness;
  /** The declared child memo pinned at composition. */
  readonly child: IAnyMemoDeclaration<TFamily>;
}

/**
 * A dispatch through a supplied step slot. The witness names the slot; the
 * current implementation travels beside it for the port, never inside it.
 * @alpha
 */
export interface ISuppliedCallRequest<TFamily extends IBindingFamily> {
  /** Discriminates the request by child kind. */
  readonly kind: 'supplied';
  /** The parent invocation scope the call belongs to. */
  readonly scope: IInvocationScope;
  /** The nested witness for this call, naming the slot descriptor. */
  readonly witness: INestedInvocationWitness;
  /** The implementation currently bound to the slot. */
  readonly child: IAnySuppliedStepDeclaration<TFamily>;
  /** The call's history subject, computed from the slot's subject function and derived values only. */
  readonly subject: IScopedSubject;
}

/**
 * One dispatch from a genuine handle to the invocation port.
 * @alpha
 */
export type IDeclaredInvocationRequest<TFamily extends IBindingFamily, TResult> =
  | ISourceCallRequest<TFamily, TResult>
  | IMemoCallRequest<TFamily>
  | ISuppliedCallRequest<TFamily>;

/**
 * The injected port implemented by Resolution and the run context. It is
 * trusted to return the family's view of exactly the witness child's result.
 * @alpha
 */
export interface IInvocationPort<TFamily extends IBindingFamily> {
  /** The invocation scope currently executing in this asynchronous context, if any. */
  active(): IInvocationScope | undefined;
  /** Resolve and deliver one declared child call. */
  dispatch<TResult>(request: IDeclaredInvocationRequest<TFamily, TResult>): Promise<IChildResult<IApply<TFamily['views'], TResult>>>;
  /**
   * Whether a value is a tracked view the run context minted. Definition asks
   * before reading an argument, so a raw view is rejected without being read.
   */
  isTrackedView(value: unknown): boolean;
  /**
   * Whether derived arguments made now by the scope's body are justified by its
   * recorded evidence: false once the body has made an observed untracked read.
   * Definition records the answer and never computes it.
   */
  argumentsJustified(scope: IInvocationScope): boolean;
}

/**
 * The live invocation of one bound step.
 * @alpha
 */
export interface IInvocationScope {
  /** The step slot being invoked. */
  readonly parent: IBindingDescriptor;
  /** Whether the scope may still apply or dispatch. */
  readonly open: boolean;
  /** End the scope; later handle calls and applies reject. */
  close(): void;
}

/**
 * A live memo invocation.
 * @alpha
 */
export interface IMemoInvocation<TFamily extends IBindingFamily> extends IInvocationScope {
  readonly kind: 'memo';
  /** Hand the actual author `run` and its context (bindings plus declared calls) to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/**
 * A live source invocation. Its bindings differ from a memo's; `run` may
 * receive no previous carrier, while `finality` always receives one.
 * @alpha
 */
export interface ISourceInvocation<TFamily extends IBindingFamily> extends IInvocationScope {
  readonly kind: 'source';
  /** Whether the author declared a finality hook. */
  readonly hasFinality: boolean;
  /** Hand the actual author `run` and its context to the invoker. */
  apply<TOutcome>(bindings: TFamily['source'], previous: IPreviousSupplier<TFamily> | undefined, invoke: IAuthorInvoker<TOutcome>): TOutcome;
  /** Hand the actual author `finality` and its context to the invoker. */
  applyFinality<TOutcome>(bindings: TFamily['source'], previous: IPreviousSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/**
 * A live invocation of the implementation currently bound to a supplied step slot.
 * @alpha
 */
export interface ISuppliedInvocation<TFamily extends IBindingFamily> extends IInvocationScope {
  /** Discriminates the invocation kind. */
  readonly kind: 'supplied';
  /** Hand the actual author `run` and its context (bindings plus argument views) to the invoker. */
  apply<TOutcome>(bindings: TFamily['memo'], args: IArgumentSupplier<TFamily>, invoke: IAuthorInvoker<TOutcome>): TOutcome;
}

/**
 * A live invocation of any step kind.
 * @alpha
 */
export type IInvocation<TFamily extends IBindingFamily> = IMemoInvocation<TFamily> | ISourceInvocation<TFamily> | ISuppliedInvocation<TFamily>;

/** What Definition can describe about each genuine handle; forged look-alikes are absent. */
const handles = new WeakMap<object, IDirectChildWitness | IDeclaredCallDescription>();

/** The one explicit empty argument form every argument-free call records. */
const emptyArguments: IEmptyArguments = Object.freeze({ form: 'empty' });

/**
 * Open an invocation of one uniquely bound step, or of the implementation
 * uniquely bound to a supplied step slot, in a composition this builder
 * instance minted. A memo parent's declared supplied slots must each resolve to
 * exactly one current implementation before its body can run: an unsupplied
 * slot rejects with `missing-slot` and a doubly supplied one with
 * `ambiguous-slot` (the EXP-4 supplied-callable selection).
 * @param records - The builder instance's declaration records.
 * @param compositions - The builder instance's composition states.
 * @param composition - The frozen composition.
 * @param parent - The step slot or supplied step slot being invoked.
 * @param port - The injected invocation port.
 * @returns The live invocation.
 */
export function openInvocationIn<TFamily extends IBindingFamily>(
  records: IDeclarationRecords<TFamily>,
  compositions: WeakMap<object, ICompositionState<TFamily>>,
  composition: IComposition<TFamily>,
  parent: IBindingDescriptor,
  port: IInvocationPort<TFamily>,
): IInvocation<TFamily> {
  if (isComposing()) {
    reject('composition-phase', 'Invocations cannot be opened while composing.');
  }
  const state = compositions.get(composition) ?? reject('forged-composition', 'This family did not mint the composition.');
  // Read the caller's descriptor only as own data, so opening never runs author code.
  const frozenParent = ownedDescriptor(parent);
  const occupants = state.registrations.get(descriptorKey(frozenParent)) ?? [];
  if (frozenParent.role === 'callable' && isStepSlot(composition.topology.slots, frozenParent.slot, occupants)) {
    checkSlotOccupancy(frozenParent.slot, occupants);
  }
  const [only] = occupants;
  const record = occupants.length === 1 ? only?.record : undefined;
  if (record === undefined) {
    reject('unresolved-parent', 'An invocation requires exactly one bound step.');
  }
  let open = true;
  /** Apply is permitted only inside a live scope and never while composing. */
  const assertApplicable = (): void => {
    if (isComposing()) {
      reject('composition-phase', 'Author callbacks cannot be applied while composing.');
    }
    if (!open) {
      reject('scope-closed', 'This invocation scope has closed.');
    }
  };
  if (record.kind === 'source') {
    const invocation: ISourceInvocation<TFamily> = {
      kind: 'source',
      parent: frozenParent,
      get open(): boolean {
        return open;
      },
      close(): void {
        open = false;
      },
      hasFinality: record.declaration.finality !== undefined,
      apply: (bindings, previous, invoke) => {
        assertApplicable();
        return record.apply(bindings, previous, invoke);
      },
      applyFinality: (bindings, previous, invoke) => {
        assertApplicable();
        return record.applyFinality(bindings, previous, invoke);
      },
    };
    return Object.freeze(invocation);
  }
  if (record.kind === 'supplied-step') {
    const suppliedRecord = record;
    const invocation: ISuppliedInvocation<TFamily> = {
      kind: 'supplied',
      parent: frozenParent,
      get open(): boolean {
        return open;
      },
      close(): void {
        open = false;
      },
      apply: (bindings, args, invoke) => {
        assertApplicable();
        return suppliedRecord.apply(bindings, args, invoke);
      },
    };
    return Object.freeze(invocation);
  }
  const memoRecord = record;
  /** Each declared supplied slot's current implementation, resolved once before any body runs. */
  const slotTargets = new Map<string, ISuppliedStepTarget<TFamily>>();
  for (const edge of memoRecord.children.values()) {
    if (edge.kind === 'slot' && !slotTargets.has(edge.slot)) {
      const slotOccupants = state.registrations.get(descriptorKey(slotDescriptor(frozenParent.scope, edge.slot))) ?? [];
      checkSlotOccupancy(edge.slot, slotOccupants);
      const [occupant] = slotOccupants;
      if (occupant?.target.role !== 'callable' || occupant.target.kind !== 'supplied-step') {
        return reject('missing-slot', `Supplied step slot ${edge.slot} is not occupied by a supplied step.`);
      }
      slotTargets.set(edge.slot, occupant.target);
    }
  }
  /** The parent invocation's call order: the next dispatched call's position. */
  let nextIndex = 0;
  const invocation: IMemoInvocation<TFamily> = {
    kind: 'memo',
    parent: frozenParent,
    get open(): boolean {
      return open;
    },
    close(): void {
      open = false;
    },
    apply: (bindings, invoke) => {
      assertApplicable();
      return memoRecord.apply(bindings, mintHandle, invoke);
    },
  };
  Object.freeze(invocation);
  const argumentContext: IArgumentContext = Object.freeze({
    scope: invocation,
    // Only template instances carry a member binding; no parent opened here is one.
    memberBinding: false,
    inputDeclared: (slot: string): boolean => state.registrations.has(descriptorKey({ scope: frozenParent.scope, role: 'input', slot })),
    isTrackedView: (value: unknown): boolean => port.isTrackedView(value),
    justified: (): boolean => port.argumentsJustified(invocation),
  });

  /**
   * How one edge's call reaches the port once its arguments are recorded:
   * a prepared dispatch that takes the call's witness. Preparation may reject
   * (for example an invalid slot subject) before a call position is consumed.
   */
  function preparer(call: string, edge: IChildEdge<TFamily>): (args: IInvocationArguments) => (witness: IInvocationWitness) => Promise<unknown> {
    if (edge.kind === 'slot') {
      const target = slotTargets.get(edge.slot) ?? reject('missing-slot', `Supplied step slot ${edge.slot} is not supplied.`);
      return args => {
        const subject = target.subjectFor(args);
        return witness => port.dispatch(Object.freeze({ kind: 'supplied', scope: invocation, witness: nestedWitness(witness), child: target.declaration, subject }));
      };
    }
    const childRecord = records.get(edge.declaration);
    if (childRecord?.kind === 'source') {
      return () => witness => childRecord.dispatch(port, invocation, witness);
    }
    if (childRecord?.kind === 'memo') {
      const child = childRecord.declaration;
      return () => witness => port.dispatch(Object.freeze({ kind: 'memo', scope: invocation, witness: nestedWitness(witness), child }));
    }
    return reject('illegal-edge', `Call ${call} is not a declared child of this memo.`);
  }

  /** Mint the guarded handle for one declared call of this invocation. */
  function mintHandle(call: string): IDeclaredCallHandle<unknown, readonly unknown[]> {
    const edge = memoRecord.children.get(call) ?? reject('illegal-edge', `Call ${call} is not a declared child of this memo.`);
    const prepare = preparer(call, edge);
    const argumentBearing = edge.kind === 'slot';
    const child = edge.kind === 'slot' ? slotDescriptor(frozenParent.scope, edge.slot) : siblingDescriptor(frozenParent, call);
    const directWitness: IDirectChildWitness = Object.freeze({ version: 1, parent: frozenParent, child, arguments: emptyArguments });
    const handle = (...values: unknown[]): Promise<IChildResult<unknown>> => {
      if (!argumentBearing && values.length > 0) {
        return Promise.reject(new DefinitionError('unsupported-arguments', 'Calls of sibling steps take no runtime arguments.'));
      }
      if (isComposing()) {
        return Promise.reject(new DefinitionError('composition-phase', 'Declared calls cannot resolve while composing.'));
      }
      if (!open) {
        return Promise.reject(new DefinitionError('scope-closed', 'This invocation scope has closed.'));
      }
      if (port.active() !== invocation) {
        return Promise.reject(new DefinitionError('scope-inactive', 'This handle belongs to an invocation that is not currently executing.'));
      }
      let dispatch: (witness: IInvocationWitness) => Promise<unknown>;
      let args: IInvocationArguments;
      try {
        args = argumentBearing ? recordArguments(values, argumentContext) : emptyArguments;
        dispatch = prepare(args);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      const index = nextIndex++;
      const witness: IInvocationWitness = memoRecord.nested
        ? Object.freeze({ version: 2, parent: frozenParent, child, index, arguments: args })
        : directWitness;
      return dispatch(witness).then(result => childCarrier(result, invocation, index));
    };
    handles.set(handle, memoRecord.nested ? Object.freeze({ version: 2, parent: frozenParent, child }) : directWitness);
    Object.freeze(handle);
    // The brand is type-level only; this module is its sole minting authority.
    return handle as IDeclaredCallHandle<unknown, readonly unknown[]>;
  }
  return invocation;
}

/**
 * Whether a callable slot is a supplied step slot: one some parent declares, or
 * one occupied by a supplied step. Any other callable (an absent name or a
 * helper) keeps the M3 `unresolved-parent` outcome when opened.
 */
function isStepSlot(declaredSlots: readonly string[], slot: string, occupants: readonly { readonly target: { readonly role: string; readonly kind?: string } }[]): boolean {
  return declaredSlots.includes(slot) || occupants.some(occupant => occupant.target.kind === 'supplied-step');
}

/** A supplied slot's occupancy must be exactly one; missing and ambiguous stay distinct. */
function checkSlotOccupancy(slot: string, occupants: readonly unknown[]): void {
  if (occupants.length === 0) {
    reject('missing-slot', `Supplied step slot ${slot} has no current implementation.`);
  }
  if (occupants.length > 1) {
    reject('ambiguous-slot', `Supplied step slot ${slot} has ${String(occupants.length)} current implementations.`);
  }
}

/** A composition-wide supplied step slot descriptor. */
function slotDescriptor(scope: string, slot: string): IBindingDescriptor {
  return Object.freeze({ scope, role: 'callable', slot });
}

/** The descriptor of a sibling step slot at the parent's level (same member key, or none). */
function siblingDescriptor(parent: IBindingDescriptor, slot: string): IBindingDescriptor {
  return Object.freeze({ scope: parent.scope, role: 'step', slot, ...(parent.memberKey === undefined ? {} : { memberKey: parent.memberKey }) });
}

/** Memo and supplied calls are only ever made by nested parents, whose witnesses are version 2. */
function nestedWitness(witness: IInvocationWitness): INestedInvocationWitness {
  return witness.version === 2 ? witness : reject('illegal-edge', 'Memo and supplied slot calls require the nested invocation witness.');
}

/**
 * Re-wrap a port result as a frozen null-prototype `{ data }` without reading
 * anything from the data itself; anything else is rejected. The carrier is
 * remembered as the result of its call position, so `forward.child` can name it.
 */
function childCarrier(result: unknown, scope: IInvocationScope, index: number): IChildResult<unknown> {
  if (typeof result !== 'object' || result === null) {
    reject('invalid-result', 'The invocation port must supply a { data } carrier.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(result, 'data');
  if (descriptor === undefined || !('value' in descriptor)) {
    reject('invalid-result', 'The invocation port must supply data as an own data property.');
  }
  const data: unknown = descriptor.value;
  const carrier = { data };
  Object.setPrototypeOf(carrier, null);
  Object.freeze(carrier);
  registerCarrier(carrier, scope, index);
  return carrier;
}

/**
 * Describe a Definition-minted handle; look-alikes are not handles. An
 * argument-free handle of an M3-shaped parent is described by its fixed
 * version-1 witness; a nested parent's handle by its parent and child only,
 * since its call position and recipe exist only once a call is made.
 * @param value - Any value.
 * @returns The description, or undefined when the value is not a genuine handle.
 * @alpha
 */
export function describeHandle(value: unknown): IDirectChildWitness | IDeclaredCallDescription | undefined {
  return typeof value === 'function' ? handles.get(value) : undefined;
}
