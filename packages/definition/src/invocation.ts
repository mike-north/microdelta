/**
 * Invocation scopes, declared child-call handles and the injected port.
 *
 * `openInvocation` reconnects one uniquely bound step of a composition its
 * builder instance minted and returns a live scope whose `apply` pairs the
 * step's actual author callback with the context Definition assembles: the
 * facade's bindings plus either Definition-minted calls (memo) or the previous
 * carrier Resolution selected (source). The pair goes to Resolution's rank-2
 * invoker, which tracks and captures it. Definition never selects previous
 * results, materializes data, decides freshness or admission, or runs a body.
 *
 * A handle takes no runtime arguments; calling it routes an immutable
 * empty-argument direct-child witness and the pinned sibling declaration
 * through the injected port. The result is an immutable `{ data }` carrier so
 * awaiting it never probes a `then` property on child data. Forged, substituted,
 * out-of-scope, closed, composition-phase and argument-bearing calls reject
 * before dispatch (CMP-9).
 */
import type { IBindingDescriptor } from './descriptor.js';
import type { IAuthorInvoker, IDeclarationRecords, IPreviousSupplier, ISourceDeclaration } from './declaration.js';
import { reject } from './declaration.js';
import type { IComposition, ICompositionState } from './composition.js';
import { descriptorKey, isComposing, ownedDescriptor } from './composition.js';
import { DefinitionError } from './errors.js';
import type { IApply, IBindingFamily } from './family.js';

/**
 * The explicit M3 argument form: a positive, checked statement that the child
 * receives no runtime arguments, not an absence of argument evidence.
 * @alpha
 */
export interface IEmptyArguments {
  readonly form: 'empty';
}

/**
 * The versioned durable description of one direct child call: its structural
 * parent and child slots and its argument form. Exact result references and
 * consumed outputs are added by Resolution, not Definition.
 * @alpha
 */
export interface IDirectChildWitness {
  readonly version: 1;
  readonly parent: IBindingDescriptor;
  readonly child: IBindingDescriptor;
  readonly arguments: IEmptyArguments;
}

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
 * A declared, argument-free child call. `T` is the child view the facade's
 * family selects for the child's declared result.
 * @alpha
 */
export type IDeclaredCallHandle<T> = (() => Promise<IChildResult<T>>) & IDeclaredCallBrand;

/**
 * One dispatch from a genuine handle to the invocation port. `child` is the
 * pinned sibling declaration, carrying its result type to the port.
 * @alpha
 */
export interface IDeclaredInvocationRequest<TFamily extends IBindingFamily, TResult> {
  /** The parent invocation scope the call belongs to. */
  readonly scope: IInvocationScope;
  /** The direct-child witness for this call. */
  readonly witness: IDirectChildWitness;
  /** The declared child source. */
  readonly child: ISourceDeclaration<TFamily, TResult>;
}

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
 * A live invocation of either step kind.
 * @alpha
 */
export type IInvocation<TFamily extends IBindingFamily> = IMemoInvocation<TFamily> | ISourceInvocation<TFamily>;

/** Witnesses of Definition-minted handles; forged look-alikes are absent. */
const handles = new WeakMap<object, IDirectChildWitness>();

/**
 * Open an invocation of one uniquely bound step in a composition this builder instance minted.
 * @param records - The builder instance's declaration records.
 * @param compositions - The builder instance's composition states.
 * @param composition - The frozen composition.
 * @param parent - The step slot being invoked.
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
  const memoRecord = record;
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

  /** Mint the guarded handle for one declared child slot of this invocation. */
  function mintHandle(slot: string): IDeclaredCallHandle<unknown> {
    const child = memoRecord.children.get(slot);
    const childRecord = child === undefined ? undefined : records.get(child);
    if (childRecord?.kind !== 'source') {
      reject('illegal-edge', `Slot ${slot} is not a declared source child.`);
    }
    const childDescriptor: IBindingDescriptor = Object.freeze({
      scope: frozenParent.scope,
      role: 'step',
      slot,
      ...(frozenParent.memberKey === undefined ? {} : { memberKey: frozenParent.memberKey }),
    });
    const witness: IDirectChildWitness = Object.freeze({
      version: 1,
      parent: frozenParent,
      child: childDescriptor,
      arguments: Object.freeze({ form: 'empty' }),
    });
    const handle = (...values: unknown[]): Promise<IChildResult<unknown>> => {
      if (values.length > 0) {
        return Promise.reject(new DefinitionError('unsupported-arguments', 'M3 declared calls take no runtime arguments.'));
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
      return childRecord.dispatch(port, invocation, witness).then(childCarrier);
    };
    handles.set(handle, witness);
    Object.freeze(handle);
    // The brand is type-level only; this module is its sole minting authority.
    return handle as IDeclaredCallHandle<unknown>;
  }
  return invocation;
}

/**
 * Re-wrap a port result as a frozen null-prototype `{ data }` without reading
 * anything from the data itself; anything else is rejected.
 */
function childCarrier(result: unknown): IChildResult<unknown> {
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
  return Object.freeze(carrier);
}

/**
 * Describe the witness a Definition-minted handle dispatches; look-alikes are not handles.
 * @param value - Any value.
 * @returns The handle's witness, or undefined when the value is not a genuine handle.
 * @alpha
 */
export function describeHandle(value: unknown): IDirectChildWitness | undefined {
  return typeof value === 'function' ? handles.get(value) : undefined;
}
