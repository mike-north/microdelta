/**
 * The Reuse Resolution engine. For one requested step it decides, under the
 * current composition and policy, whether an exact retained result is
 * acceptable now, and otherwise executes through admission and History.
 *
 * Phase order for a source (REUSE-002 M3 selection): select candidates by
 * scoped subject and compatibility version; validate each candidate's own
 * actually called implementation and consumed inputs; only for a still
 * eligible candidate evaluate the *current* finality hook; true retains the
 * exact reference with a new acceptance record; false or absent enters the
 * source check, which receives the eligible carrier (or absence when there is
 * none) and returns either fresh data, published as a new result, or an
 * explicit retention of exactly that carrier.
 *
 * Phase order for a memo: validate its own implementation, inputs and called
 * helpers; reconnect each recorded direct-child witness through Definition;
 * resolve the current child under current source policy; compare only the
 * child output facts the memo consumed. A fully valid candidate is retained
 * with acceptance evidence naming the current children; its provenance keeps
 * the historical children. Missing or ambiguous correspondence and
 * unsupported evidence are honest misses; missing or wrong-scope historical
 * data is an integrity failure. A body is never replayed as validation.
 *
 * A nested memo (provenance version 2) is validated the same way, then call by
 * call in recorded order (CMP-7, REUSE-005/006/007): reconnect the call's
 * version-2 witness; rebuild its arguments, forwarded origins from current
 * bindings or the current output of an earlier call, derived values only when
 * recorded as justified, an unreconstructible argument never; obtain the
 * current child result (a sibling source or memo, or the implementation
 * currently supplied to a callable slot, under that slot's subject) through
 * its own validation or normal admission; and compare only the facts the
 * parent consumed from that call. The first failing call ends validation with
 * a distinct miss; later calls are not reached. A supplied step validates its
 * own implementation, bindings and the argument facts it observed.
 *
 * Work that validation could not avoid is admitted before any claim, attempt
 * or body (REUSE-009). Within one top-level request, every child invocation's
 * established current result (a source or memo step, or a supplied slot call
 * with its subject and arguments) is shared, so a child validated or executed
 * while its parent was being validated is reused when that parent then
 * executes, and no child runs twice. That sharing is request-local evidence,
 * never durable finality.
 */
import { DefinitionError, derivedArguments } from '@microdelta/definition';
import type {
  IAnyMemoDeclaration,
  IAnySourceDeclaration,
  IAnySuppliedStepDeclaration,
  IApply,
  IArgumentRecipe,
  IArgumentSupplier,
  IArgumentViews,
  IAuthorInvoker,
  IBindingDescriptor,
  IChildResult,
  IDeclaredInvocationRequest,
  IForwardOrigin,
  IInvocationArguments,
  IInvocationPort,
  IInvocationScope,
  IMemoInvocation,
  INestedInvocationWitness,
  IPreviousSupplier,
  IScopedSubject,
  ISourceDeclaration,
  ISourceInvocation,
  ISuppliedInvocation,
  ISuppliedStepDeclaration,
} from '@microdelta/definition';
import { AttemptConflictError, HistoryIntegrityError } from '@microdelta/history';
import type {
  IAcceptanceRecord,
  ICompletedEnvelope,
  ICompletedResultReference,
  IVersionedSubject,
  IWriterLease,
} from '@microdelta/history';
import { createMaterialization } from '@microdelta/materialization';
import { createTrackingObserver } from '@microdelta/tracking';
import type {
  ICurrentComparison,
  ICurrentFactProvider,
  IObservationCapture,
  ITrackingObservation,
} from '@microdelta/tracking';

import type {
  IAdmissionRequest,
  ICandidateMiss,
  ICheckOutcome,
  ICheckRequest,
  ILifecycleEvent,
  ILifecyclePhase,
  IRecoverRequest,
  IRecoveryResult,
  IResolution,
  IResolutionOptions,
  IResolutionOutcome,
  IResolveRequest,
  IReuseBasis,
  IStepKind,
} from './contracts.js';
import {
  argumentList,
  callObservationIndex,
  inputRecord,
  isChildObservation,
  isPreviousObservation,
  ownFactProvider,
  reconnectSlots,
  siblingStep,
} from './current.js';
import type { IArgumentValue, ICurrentSlots } from './current.js';
import { ResolutionError } from './errors.js';
import { acceptanceRecord, bindingPaths, endingRecord, plainDescriptor, provenanceRecord, readProvenance } from './evidence.js';
import type { ICallEvidence, IChildEvidence, IDirectProvenance, INestedProvenance } from './evidence.js';
import type { IResolutionFamily } from './family.js';
import { attemptKey, intentDigest, suppliedIntentDigest } from './intent.js';
import { mintedOutcome, sourceOutcome } from './outcome.js';
import type { IMintedOutcome } from './outcome.js';

/** Lifecycle positions before any author body runs; an observer throw there stops the call. */
const preExecution: ReadonlySet<ILifecyclePhase> = new Set(['verify', 'finality', 'admit', 'refuse', 'claim', 'execute']);

/** Evidence gathered while resolving one step. */
interface IStepEvidence {
  readonly misses: ICandidateMiss[];
  readonly trace: ILifecycleEvent[];
  readonly diagnostics: string[];
}

/** Internal result of one step, before conversion to a public outcome. */
type IStepResult =
  | { readonly kind: 'reused'; readonly basis: IReuseBasis; readonly reference: ICompletedResultReference; readonly acceptance: IAcceptanceRecord | undefined }
  | { readonly kind: 'published'; readonly reference: ICompletedResultReference; readonly attemptId: number }
  | { readonly kind: 'refused'; readonly refused: IBindingDescriptor; readonly reason: string }
  | { readonly kind: 'uncertain'; readonly boundary: IBindingDescriptor }
  | { readonly kind: 'execution-required' };

/** A resolved step with its evidence. */
interface IResolvedStep {
  readonly step: IBindingDescriptor;
  readonly result: IStepResult;
  readonly evidence: IStepEvidence;
}

/** One top-level request's context. */
interface IRequestContext {
  readonly mode: 'normal' | 'check';
  readonly requestKey: string | undefined;
  readonly lease: IWriterLease | undefined;
  readonly slots: ICurrentSlots;
  /** Request-local shared current results of direct source invocations. */
  readonly sources: Map<string, Promise<IResolvedStep>>;
  /** Request-local shared current results of memo invocations. */
  readonly memos: Map<string, Promise<IResolvedStep>>;
  /** Request-local shared current results of supplied slot calls, by slot, subject, version and arguments. */
  readonly supplied: Map<string, Promise<IResolvedStep>>;
  /**
   * Post-commit diagnostics of every step this request resolved, including
   * nested children. Each step's lifecycle runs once per request (sources are
   * shared), so each diagnostic appears once; the top-level outcome reports
   * all of them beside its own committed success.
   */
  readonly diagnostics: string[];
}

/**
 * The bookkeeping of one executing memo body. An M3-shaped body records its
 * direct children by slot; a nested body records its calls by position.
 */
interface IMemoFrame {
  readonly request: IRequestContext;
  readonly step: IBindingDescriptor;
  readonly children: Map<string, IChildEvidence>;
  readonly calls: Map<number, ICallEvidence>;
  /**
   * Declared calls the body has started whose delivery has not yet settled.
   * Before its attempt ends, the memo waits for every one of them to settle,
   * whether the body returned or threw, so no child write races the ending.
   * The wait is unbounded: a child that never settles keeps its parent
   * waiting. Bounding that wait and cancelling in-flight work belong to Run
   * Supervision's cancellation contract (A-13), not to this resolver.
   */
  readonly inflight: Set<Promise<unknown>>;
  /**
   * How many started calls were still unsettled at the moment the body's
   * returned value was taken; undefined until then. A result cannot be
   * published without the evidence of every call its body made.
   */
  unsettledAtReturn: number | undefined;
  refused: { readonly step: IBindingDescriptor; readonly reason: string } | undefined;
  /** The first failed child resolution; a body that swallows it still cannot publish. */
  failed: { readonly error: unknown } | undefined;
}

/** What a source run's capture finishes with. */
interface ISourceReturn {
  readonly minted: IMintedOutcome | undefined;
  readonly data: unknown;
  readonly detachError: unknown;
}

/** What a memo or supplied step body's capture finishes with. */
interface IMemoReturn {
  readonly data: unknown;
  readonly detachError: unknown;
}

/**
 * One supplied slot call as Resolution resolves it: the slot, the
 * implementation currently supplied to it, the call's subject from the slot's
 * subject function, the argument values rebuilt for this call and their digest.
 */
interface ISuppliedCall<TFamily extends IResolutionFamily<object, object>> {
  readonly slot: IBindingDescriptor;
  readonly declaration: IAnySuppliedStepDeclaration<TFamily>;
  readonly subject: IScopedSubject;
  readonly values: readonly IArgumentValue[];
  readonly digest: string;
}

/** A nested call's arguments rebuilt now, or the distinct reason they cannot be. */
type IRebuiltArguments =
  | { readonly status: 'rebuilt'; readonly values: readonly IArgumentValue[] }
  | {
      readonly status: 'miss';
      readonly reason: Extract<ICandidateMiss['reason'], 'unreconstructible-argument' | 'unjustified-argument' | 'changed' | 'unavailable' | 'ambiguous'>;
      readonly detail: string;
    };

/** A forwarded origin's current value, or why it has none. */
type IForwardedValue =
  | { readonly status: 'found'; readonly value: unknown }
  | { readonly status: 'unavailable' | 'ambiguous' | 'changed'; readonly detail: string };

/** How a validated candidate is recorded as current: the acceptance content and its exact dependencies. */
interface IEligible {
  readonly record: Parameters<typeof acceptanceRecord>[0];
  readonly dependencies: readonly ICompletedResultReference[];
}

/**
 * Pass a value through a trusted port contract. Definition types a child view,
 * a previous carrier and a supplied step's argument views by declared types
 * (the child's result type, or the slot's parameter types), which Resolution
 * delivers by construction: the view of that declaration's exact result, or
 * views of the arguments rebuilt for that very call. The static type cannot
 * express those relationships, so this single assertion states them.
 */
function trusted<T>(value: unknown): T {
  return value as T;
}

/** The canonical request-local key of a step descriptor. */
function stepKey(step: IBindingDescriptor): string {
  return JSON.stringify([step.scope, step.role, step.slot, step.memberKey ?? null]);
}

/** A readable diagnostic from any thrown value. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a value is a supported completed-result root (record or array). */
function isContainer(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * Run a History read or write, translating History's integrity failures into
 * Resolution's integrity failure. Missing or wrong-scope historical data is
 * never a miss to be repaired by execution (A-10).
 */
function integrity<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    if (error instanceof HistoryIntegrityError) {
      throw new ResolutionError('integrity', `Historical evidence failed integrity: ${error.message}`, error);
    }
    throw error;
  }
}

/** A candidate miss from a Tracking comparison that was not equal. */
function missFrom(candidate: ICompletedResultReference, comparison: Exclude<ICurrentComparison, { readonly kind: 'equal' }>): ICandidateMiss {
  return Object.freeze({
    candidate,
    reason: comparison.kind,
    observation: comparison.observation,
    detail: `${comparison.kind} ${comparison.observation.kind} at ${comparison.observation.binding.path.join('/')}`,
  });
}

/** A candidate miss for another reason. */
function miss(candidate: ICompletedResultReference, reason: ICandidateMiss['reason'], detail: string): ICandidateMiss {
  return Object.freeze({ candidate, reason, detail });
}

/**
 * A nested call's consumed output compared unequal. A changed fact, or a
 * current output whose shape no longer answers the consumed path, is changed
 * child output (REUSE-005); unavailable or ambiguous facts keep their kinds.
 */
function callOutputMiss(candidate: ICompletedResultReference, index: number, comparison: Exclude<ICurrentComparison, { readonly kind: 'equal' }>): ICandidateMiss {
  if (comparison.kind === 'changed' || comparison.kind === 'incompatible') {
    return Object.freeze({
      candidate,
      reason: 'changed-child-output',
      observation: comparison.observation,
      detail: `call ${String(index)} output changed at ${describeAddress(comparison.observation)}`,
    });
  }
  return missFrom(candidate, comparison);
}

/** A readable structured address of an observation, for diagnostics only. */
function describeAddress(observation: ITrackingObservation): string {
  const path = observation.address.map((segment) => segment.kind === 'property' ? segment.key : `[${String(segment.index)}]`).join('.');
  return `${observation.kind} ${path.length === 0 ? '(root)' : path}`;
}

/** A readable slot descriptor, for diagnostics only. */
function describeSlot(descriptor: IBindingDescriptor): string {
  return `${descriptor.role} slot ${descriptor.slot}${descriptor.memberKey === undefined ? '' : ` of ${descriptor.memberKey}`}`;
}

/** A readable forwarded origin, for diagnostics only. */
function describeOrigin(origin: IForwardOrigin): string {
  const path = origin.path.map((segment) => segment.kind === 'property' ? segment.key : `[${String(segment.index)}]`).join('.');
  switch (origin.binding) {
    case 'input':
      return `input ${origin.slot}${path.length === 0 ? '' : ` at ${path}`}`;
    case 'member':
      return `the member binding${path.length === 0 ? '' : ` at ${path}`}`;
    case 'child':
      return `call ${String(origin.call)} output${path.length === 0 ? '' : ` at ${path}`}`;
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

/** A recipe as plain stored data. */
function plainRecipe(recipe: IArgumentRecipe): Record<string, unknown> {
  switch (recipe.form) {
    case 'forwarded': {
      const path = recipe.origin.path.map((segment) => segment.kind === 'property' ? { kind: 'property', key: segment.key } : { kind: 'index', index: segment.index });
      const origin = recipe.origin;
      return {
        form: recipe.form,
        origin: origin.binding === 'input' ? { binding: origin.binding, slot: origin.slot, path }
          : origin.binding === 'child' ? { binding: origin.binding, call: origin.call, path }
            : { binding: origin.binding, path },
        justified: recipe.justified,
      };
    }
    case 'derived':
      return { form: recipe.form, value: recipe.value, justified: recipe.justified };
    case 'unreconstructible':
      return { form: recipe.form, reason: recipe.reason };
    default: {
      const exhaustive: never = recipe;
      return exhaustive;
    }
  }
}

/** A version-2 witness as plain stored data, retained for Definition to judge again later. */
function plainWitness(witness: INestedInvocationWitness): Record<string, unknown> {
  return {
    version: witness.version,
    parent: plainDescriptor(witness.parent),
    child: plainDescriptor(witness.child),
    index: witness.index,
    arguments: 'form' in witness.arguments ? { form: 'empty' } : witness.arguments.map(plainRecipe),
  };
}

/** Exact references in first-use order, without repeats. */
function uniqueReferences(references: readonly ICompletedResultReference[]): readonly ICompletedResultReference[] {
  const unique: ICompletedResultReference[] = [];
  for (const reference of references) {
    if (!unique.some((existing) => existing.locator === reference.locator)) {
      unique.push(reference);
    }
  }
  return unique;
}

/**
 * Create Reuse Resolution over one current composition and History scope.
 * @param options - Ports, composition and declared binding slots.
 * @returns The Resolution contract.
 * @alpha
 */
export function createResolution<TInputs extends object, THelpers extends object>(options: IResolutionOptions<TInputs, THelpers>): IResolution {
  type IFamily = IResolutionFamily<TInputs, THelpers>;
  const { composition, history, tracking, host, admission, observer } = options;
  if (typeof options.environment !== 'string' || options.environment.length === 0) {
    throw new ResolutionError('invalid-request', 'A History environment must be a nonempty string');
  }
  const bindingSlots = Object.freeze({ inputs: Object.freeze([...options.bindings.inputs]), helpers: Object.freeze([...options.bindings.helpers]) });
  for (const slot of [...bindingSlots.inputs, ...bindingSlots.helpers]) {
    if (typeof slot !== 'string' || slot.length === 0) {
      throw new ResolutionError('invalid-request', 'Declared binding slots must be nonempty strings');
    }
  }
  const analysis = composition.scope;
  const environment = options.environment;
  /** Selects current input facts and fingerprints intent; it never has an author capture. */
  const validation = createTrackingObserver(host);
  const materialization = createMaterialization({ tracking, reader: history.reader, navigationReader: history.reader });
  /**
   * Reads forwarded origins in exact retained results through the validation
   * observer, so rebuilding a nested call's arguments never records into the
   * capture of the parent body that is making the call.
   */
  const originMaterialization = createMaterialization({ tracking: validation, reader: history.reader, navigationReader: history.reader });
  /** The invocation currently executing in each asynchronous context, for Definition's handles. */
  const active = host.createAsyncContext<IInvocationScope>();
  /** Executing memo bodies, keyed by their invocation scope. */
  const frames = new WeakMap<IInvocationScope, IMemoFrame>();
  /**
   * The observed untracked read authors receive: Tracking reads the scalar
   * without consuming it and records the read in the active capture.
   */
  const untracked: IFamily['memo']['untracked'] = (value, key) => tracking.untracked(value, key);
  /** Previous carriers this Resolution supplied, with the exact result and the resolution they belong to. */
  const carriers = new WeakMap<object, { readonly reference: ICompletedResultReference; readonly token: object }>();

  const port: IInvocationPort<IFamily> = Object.freeze({
    active: (): IInvocationScope | undefined => active.getStore(),
    // The child view travels inside a plain `{ data }` carrier across every
    // asynchronous boundary. Resolving a Promise with the view itself would make
    // Promise assimilation probe its `then` member inside the parent's capture,
    // recording a read the author never made (and failing for array views).
    dispatch: <TResult>(request: IDeclaredInvocationRequest<IFamily, TResult>): Promise<IChildResult<IApply<IFamily['views'], TResult>>> =>
      dispatchChild(request).then((delivered) => ({ data: trusted<IApply<IFamily['views'], TResult>>(delivered.data) })),
    // Author views (inputs, helpers and child results) are all minted by this
    // Resolution's tracking observer, so its ownership table recognizes them.
    isTrackedView: (value: unknown): boolean => tracking.materialization.owns(value),
    // A derived argument is justified exactly when the calling body's capture
    // (the active one while its handle records the call) has made no observed
    // untracked read so far (CMP-7). Unobserved influence stays outside (CX-1).
    argumentsJustified: (): boolean => !tracking.untrackedReadObserved(),
  });

  /** The scoped subject and compatibility group of a declaration. */
  function versioned(declaration: IAnySourceDeclaration<IFamily> | IAnyMemoDeclaration<IFamily>): IVersionedSubject {
    return Object.freeze({ analysis, environment, subject: declaration.subject, version: declaration.version });
  }

  /** The scoped subject and compatibility group of one supplied slot call. */
  function suppliedSubject(call: ISuppliedCall<IFamily>): IVersionedSubject {
    if (call.subject.scope !== analysis) {
      throw new ResolutionError('invalid-request', `Slot ${call.slot.slot} computed a subject in scope ${call.subject.scope}, not ${analysis}`);
    }
    return Object.freeze({ analysis, environment, subject: call.subject.subject, version: call.declaration.version });
  }

  /**
   * Reconnect a requested step to its unique current source or memo
   * declaration. Template instance steps (descriptors carrying `template` or
   * `collection`) and strict folds are refused with `invalid-request` before
   * any evidence, candidate lookup or admission: this resolver resolves only
   * explicit member and composition-level sources and memos. Template instance
   * invocation, gates and keyed member reuse are added by #85, and strict fold
   * readiness by #86.
   */
  function stepTarget(step: IBindingDescriptor): { readonly step: IBindingDescriptor; readonly declaration: IAnySourceDeclaration<IFamily> | IAnyMemoDeclaration<IFamily> } {
    // Checked on the requested descriptor itself, through property descriptors
    // only (no accessor runs), before composition lookup can mint an instance.
    if (typeof step === 'object' && step !== null &&
        (Object.getOwnPropertyDescriptor(step, 'template') !== undefined || Object.getOwnPropertyDescriptor(step, 'collection') !== undefined)) {
      throw new ResolutionError('invalid-request', 'The requested step is a template instance step; this resolver resolves only member and composition-level sources and memos');
    }
    let resolution: ReturnType<typeof composition.resolve>;
    try {
      resolution = composition.resolve(step);
    } catch (error: unknown) {
      throw new ResolutionError('invalid-request', `Malformed step descriptor: ${describe(error)}`, error);
    }
    if (resolution.status !== 'bound' || resolution.target.role !== 'step') {
      throw new ResolutionError('unbound-step', `Step ${stepKey(resolution.descriptor)} has no unique current declaration (${resolution.status})`);
    }
    const declaration = resolution.target.declaration;
    if (declaration.kind === 'fold') {
      throw new ResolutionError('invalid-request', `Step ${stepKey(resolution.descriptor)} is a strict fold; this resolver resolves only sources and memos`);
    }
    return { step: resolution.descriptor, declaration };
  }

  /** A new request context with its declared slots reconnected once. */
  function newRequest(mode: 'normal' | 'check', requestKey: string | undefined, lease: IWriterLease | undefined): IRequestContext {
    return { mode, requestKey, lease, slots: reconnectSlots(composition, bindingSlots), sources: new Map(), memos: new Map(), supplied: new Map(), diagnostics: [] };
  }

  /** The lease of a normal request; check-only requests never write. */
  function leaseOf(request: IRequestContext): IWriterLease {
    if (request.lease === undefined) {
      throw new ResolutionError('invalid-request', 'A normal request needs History\'s writer lease');
    }
    return request.lease;
  }

  /** New step evidence; diagnostics are the request's shared list. */
  function newEvidence(request: IRequestContext): IStepEvidence {
    return { misses: [], trace: [], diagnostics: request.diagnostics };
  }

  /**
   * Record one lifecycle event and offer it to the observer. Before
   * execution an observer failure stops this call; after a commit it becomes
   * a diagnostic beside the committed success. Check-only requests have no
   * lifecycle to observe.
   */
  function emit(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, phase: ILifecyclePhase, reference?: ICompletedResultReference): void {
    if (request.mode === 'check') {
      return;
    }
    const event: ILifecycleEvent = Object.freeze({ step, phase, ...(reference === undefined ? {} : { reference }) });
    evidence.trace.push(event);
    if (observer === undefined) {
      return;
    }
    try {
      observer.observe(event);
    } catch (error: unknown) {
      if (preExecution.has(phase)) {
        throw new ResolutionError('observer-failure', `Lifecycle observer failed at ${phase}: ${describe(error)}`, error);
      }
      evidence.diagnostics.push(`Lifecycle observer failed at ${phase} for ${stepKey(step)} after commit: ${describe(error)}`);
    }
  }

  /**
   * The bindings every author callback receives: the declared input record
   * as one tracked view and each declared helper as a tracked function. Work
   * cannot proceed without every declared slot uniquely bound.
   */
  function authorBindings(request: IRequestContext): IFamily['memo'] {
    for (const [slot, state] of [...request.slots.inputs, ...request.slots.helpers]) {
      if (state.status !== 'bound') {
        throw new ResolutionError('unbound-step', `Declared binding slot ${slot} is ${state.status} in the current composition`);
      }
    }
    const inputs = tracking.tracked(inputRecord(request.slots), { path: bindingPaths.inputs });
    const helpers = Object.create(null) as Record<string, unknown>;
    for (const [slot, state] of request.slots.helpers) {
      if (state.status === 'bound') {
        // eslint-disable-next-line microdelta/tracked-captures -- Framework binding: Resolution wraps the declared helper Definition reconnected so its calls record implementation evidence; the helper is not a capture callback.
        helpers[slot] = tracking.tracked(state.value, { path: bindingPaths.callable(slot) });
      }
    }
    Object.freeze(helpers);
    return Object.freeze({ inputs: trusted<IFamily['memo']['inputs']>(inputs), helpers: trusted<IFamily['memo']['helpers']>(helpers), untracked });
  }

  /**
   * Resolution's rank-2 invoker: track the author's actual callback as the
   * step's own implementation (`self`) and run it with the context Definition
   * assembled inside a fresh capture. `finish` runs inside that capture, so
   * explicit output detachment records what the step consumed from its output.
   */
  function invoker<TFinished>(finish: (value: unknown) => TFinished, begin?: () => void): IAuthorInvoker<Promise<IObservationCapture<TFinished>>> {
    return <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): Promise<IObservationCapture<TFinished>> => {
      // eslint-disable-next-line microdelta/tracked-captures -- Framework invoker: the callback is the author's actual function from Definition's record, tracked so its implementation is the step's own evidence.
      const authored = tracking.tracked(callback, { path: bindingPaths.self });
      // eslint-disable-next-line microdelta/tracked-captures -- Framework invoker: this capture is the author call's evidence boundary; `begin` marks the author call's start inside it, then only the tracked author callback runs with Definition's assembled context.
      return tracking.captureAsync(async () => { begin?.(); return finish(await authored(context)); });
    };
  }

  /** Mint a previous carrier for an eligible result, owned by one source resolution. */
  function carrierFor(reference: ICompletedResultReference, token: object): object {
    const data = materialization.materializeView<object>(reference, { path: bindingPaths.previous });
    const carrier = Object.freeze({ data });
    carriers.set(carrier, { reference, token });
    return carrier;
  }

  /** Open the unique current invocation of a step. */
  function openSource(step: IBindingDescriptor): ISourceInvocation<IFamily> {
    const invocation = options.declarations.openInvocation(composition, step, port);
    if (invocation.kind !== 'source') {
      invocation.close();
      throw new ResolutionError('unbound-step', `Step ${stepKey(step)} is not a source`);
    }
    return invocation;
  }

  /**
   * Open the unique current invocation of a memo step. Definition refuses a
   * memo whose declared supplied slots are not each bound to exactly one
   * implementation; that is reported as `unbound-step`, keeping Definition's
   * distinct missing and ambiguous diagnostics.
   */
  function openMemo(step: IBindingDescriptor): IMemoInvocation<IFamily> {
    let invocation: ReturnType<typeof options.declarations.openInvocation>;
    try {
      invocation = options.declarations.openInvocation(composition, step, port);
    } catch (error: unknown) {
      if (error instanceof DefinitionError && (error.code === 'missing-slot' || error.code === 'ambiguous-slot')) {
        throw new ResolutionError('unbound-step', `Step ${stepKey(step)} cannot run: ${error.message}`, error);
      }
      throw error;
    }
    if (invocation.kind !== 'memo') {
      invocation.close();
      throw new ResolutionError('unbound-step', `Step ${stepKey(step)} is not a memo`);
    }
    return invocation;
  }

  /** Open the invocation of the implementation currently supplied to a callable slot. */
  function openSupplied(slot: IBindingDescriptor): ISuppliedInvocation<IFamily> {
    let invocation: ReturnType<typeof options.declarations.openInvocation>;
    try {
      invocation = options.declarations.openInvocation(composition, slot, port);
    } catch (error: unknown) {
      if (error instanceof DefinitionError) {
        throw new ResolutionError('unbound-step', `Supplied slot ${slot.slot} cannot run: ${error.message}`, error);
      }
      throw error;
    }
    if (invocation.kind !== 'supplied') {
      invocation.close();
      throw new ResolutionError('unbound-step', `Slot ${slot.slot} is not a supplied step slot`);
    }
    return invocation;
  }

  /** Invoke a source's finality hook or check under capture, with its previous carrier. */
  function callSource<TFinished>(
    request: IRequestContext,
    invocation: ISourceInvocation<IFamily>,
    which: 'run' | 'finality',
    carrier: object | undefined,
    finish: (value: unknown) => TFinished,
  ): Promise<IObservationCapture<TFinished>> {
    const shared = authorBindings(request);
    const bindings: IFamily['source'] = Object.freeze({ ...shared, outcome: sourceOutcome });
    const supplier: IPreviousSupplier<IFamily> | undefined = carrier === undefined ? undefined : Object.freeze({
      carrier: <TResult>(declaration: ISourceDeclaration<IFamily, TResult>): IApply<IFamily['previous'], TResult> => {
        void declaration;
        return trusted<IApply<IFamily['previous'], TResult>>(carrier);
      },
    });
    return active.run(invocation, () => {
      if (which === 'finality') {
        if (supplier === undefined) {
          throw new ResolutionError('invalid-request', 'Finality needs an eligible previous result');
        }
        return invocation.applyFinality(bindings, supplier, invoker(finish));
      }
      return invocation.apply(bindings, supplier, invoker(finish));
    });
  }

  /** Compare observations with current facts through Tracking. */
  function compare(observations: readonly ITrackingObservation[], provider: ICurrentFactProvider): ICurrentComparison {
    return integrity(() => tracking.compareCurrent({ value: undefined, observations }, provider));
  }

  /** Ask Run Supervision's admission port for work; denial is recorded as refusal. */
  async function admit(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, kind: IStepKind, subject: IVersionedSubject, reason: IAdmissionRequest['reason']): Promise<string | undefined> {
    emit(request, evidence, step, 'admit');
    let decision: unknown;
    try {
      decision = await admission.admit(Object.freeze({ step, kind, subject, reason }));
    } catch (error: unknown) {
      throw new ResolutionError('admission-failure', `Admission failed for ${stepKey(step)}: ${describe(error)}`, error);
    }
    const decided: unknown = typeof decision === 'object' && decision !== null ? Reflect.get(decision, 'kind') : undefined;
    if (decided === 'admitted') {
      return undefined;
    }
    const deniedReason: unknown = typeof decision === 'object' && decision !== null ? Reflect.get(decision, 'reason') : undefined;
    if (decided !== 'denied' || typeof deniedReason !== 'string') {
      throw new ResolutionError('admission-failure', `Admission returned no valid decision for ${stepKey(step)}`);
    }
    emit(request, evidence, step, 'refuse');
    return deniedReason;
  }

  /** End an attempt without a result; its failure never masks the original outcome. */
  /**
   * End an admitted attempt without a new result and report whether History
   * durably recorded the ending. An unsuccessful ending (failure, interruption,
   * refused child) is then announced as the `abandon` lifecycle event; an
   * explicit check retention is a successful ending its caller announces as
   * `release` instead. Nothing is announced when History could not record the
   * ending: the attempt stays incomplete and recoverable, and a diagnostic says
   * so. Neither an ending failure nor an observer failure at `abandon` (a
   * post-commit position) replaces the caller's original outcome.
   */
  function abandon(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, attemptId: number, outcome: 'failed' | 'interrupted', ending: Parameters<typeof endingRecord>[0]): boolean {
    try {
      history.abandonAttempt(leaseOf(request), { attemptId, outcome, evidence: endingRecord(ending) });
    } catch (error: unknown) {
      evidence.diagnostics.push(`Attempt ${String(attemptId)} of ${stepKey(step)} could not be ended: ${describe(error)}`);
      return false;
    }
    if (ending.ending !== 'retained') {
      emit(request, evidence, step, 'abandon');
    }
    return true;
  }

  /** The durable identity of one admitted execution under this request. */
  type IExecutionIdentity = ReturnType<typeof versioned> & { readonly attemptKey: string; readonly intentDigest: string };

  /** Reject a request key already bound to a different intent, as History does. */
  function conflict(requestKey: string, step: IBindingDescriptor, error: unknown): never {
    if (error instanceof AttemptConflictError) {
      throw new ResolutionError('wrong-intent', `Request key ${requestKey} already identifies a different execution of ${stepKey(step)}`, error);
    }
    throw error;
  }

  /**
   * Derive the execution identity for admitted work and require that the
   * request key has not already been used for it. This runs before admission:
   * a key whose execution already committed, or that is bound to a different
   * intent, or that names an incomplete or unsuccessful execution, is never
   * served, resumed or re-executed by a normal request; the separate recovery
   * operation reports what happened.
   */
  function freshIdentity(request: IRequestContext, step: IBindingDescriptor, declaration: IAnySourceDeclaration<IFamily> | IAnyMemoDeclaration<IFamily>): IExecutionIdentity {
    const requestKey = requestKeyOfRequest(request);
    return unusedIdentity(requestKey, step, {
      ...versioned(declaration),
      attemptKey: attemptKey(host, requestKey, step),
      intentDigest: intentDigest({ host, validation, composition, environment, step, declaration, slots: request.slots }),
    });
  }

  /** The execution identity of one supplied slot call, checked unused as {@link freshIdentity} is. */
  function freshSuppliedIdentity(request: IRequestContext, call: ISuppliedCall<IFamily>): IExecutionIdentity {
    const requestKey = requestKeyOfRequest(request);
    const subject = suppliedSubject(call);
    return unusedIdentity(requestKey, call.slot, {
      ...subject,
      attemptKey: attemptKey(host, requestKey, call.slot, { subject: subject.subject, arguments: call.digest }),
      intentDigest: suppliedIntentDigest({
        host, validation, scope: analysis, environment, slot: call.slot, subject: subject.subject, version: subject.version,
        arguments: call.digest, run: call.declaration.run, slots: request.slots,
      }),
    });
  }

  /** The saved request key of a normal request. */
  function requestKeyOfRequest(request: IRequestContext): string {
    if (request.requestKey === undefined) {
      throw new ResolutionError('invalid-request', 'A normal request needs a request key');
    }
    return request.requestKey;
  }

  /** Require that a request key has not already been used for an execution identity. */
  function unusedIdentity(requestKey: string, step: IBindingDescriptor, identity: IExecutionIdentity): IExecutionIdentity {
    let prior: ReturnType<typeof history.recoverAttempt>;
    try {
      prior = integrity(() => history.recoverAttempt(identity));
    } catch (error: unknown) {
      return conflict(requestKey, step, error);
    }
    if (prior.kind !== 'absent') {
      throw new ResolutionError('invalid-request', `Request key ${requestKey} already identifies a ${prior.kind} execution of ${stepKey(step)}; recover it or use a fresh request key`);
    }
    return identity;
  }

  /** Claim one attempt for admitted work under an identity checked by {@link freshIdentity}. */
  function claim(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, identity: IExecutionIdentity): number {
    const requestKey = request.requestKey ?? '';
    let attemptId: number;
    try {
      attemptId = integrity(() => history.allocateAttempt(leaseOf(request), identity)).attemptId;
    } catch (error: unknown) {
      return conflict(requestKey, step, error);
    }
    try {
      emit(request, evidence, step, 'claim');
    } catch (error: unknown) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'observer-failure', detail: describe(error) });
      throw error;
    }
    return attemptId;
  }

  /** Stage and publish new content in History's one publication commit. */
  function publish(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, attemptId: number, content: {
    readonly payload: unknown;
    readonly provenance: Parameters<typeof provenanceRecord>[0];
    readonly dependencies: readonly ICompletedResultReference[];
  }): IStepResult {
    const lease = leaseOf(request);
    if (!isContainer(content.payload)) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'result root is not a record or array' });
      throw new ResolutionError('unsupported-result', `Step ${stepKey(step)} produced a result without a record or array root`);
    }
    try {
      history.stageAttempt(lease, { attemptId, payload: content.payload, provenance: provenanceRecord(content.provenance), dependencies: content.dependencies });
    } catch (error: unknown) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(error) });
      if (error instanceof TypeError) {
        throw new ResolutionError('unsupported-result', `Step ${stepKey(step)} produced unsupported result data: ${error.message}`, error);
      }
      throw error;
    }
    const reference = history.publishAttempt(lease, attemptId);
    emit(request, evidence, step, 'publish', reference);
    return { kind: 'published', reference, attemptId };
  }

  /** Record a current acceptance of an existing result and report it. */
  function accept(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, basis: IReuseBasis, reference: ICompletedResultReference, record: Parameters<typeof acceptanceRecord>[0], dependencies: readonly ICompletedResultReference[]): IStepResult {
    const acceptance = integrity(() => history.recordAcceptance(leaseOf(request), { reference, evidence: acceptanceRecord(record), dependencies }));
    emit(request, evidence, step, 'accept', reference);
    return { kind: 'reused', basis, reference, acceptance };
  }

  /** Resolve a direct source invocation once per top-level request. */
  function resolveSourceShared(request: IRequestContext, step: IBindingDescriptor, declaration: IAnySourceDeclaration<IFamily>): Promise<IResolvedStep> {
    const key = stepKey(step);
    const existing = request.sources.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pending = resolveSource(request, step, declaration);
    request.sources.set(key, pending);
    return pending;
  }

  /** Resolve one source step under current policy. */
  async function resolveSource(request: IRequestContext, step: IBindingDescriptor, declaration: IAnySourceDeclaration<IFamily>): Promise<IResolvedStep> {
    const evidence = newEvidence(request);
    const done = (result: IStepResult): IResolvedStep => ({ step, result, evidence });
    emit(request, evidence, step, 'verify');
    const candidates = integrity(() => history.findCandidates(versioned(declaration)));
    let eligible: ICompletedEnvelope | undefined;
    for (const candidate of candidates) {
      const reading = integrity(() => readProvenance(candidate));
      if (reading.status === 'unsupported') {
        evidence.misses.push(miss(candidate.reference, 'unsupported-evidence', reading.detail));
        continue;
      }
      if (reading.provenance.kind !== 'source') {
        evidence.misses.push(miss(candidate.reference, 'unsupported-evidence', 'provenance was recorded for a memo'));
        continue;
      }
      // The previous result a check read is its history, not a current input.
      const own = reading.provenance.observations.filter((item) => !isPreviousObservation(item.binding));
      const comparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run }));
      if (comparison.kind === 'equal') {
        eligible = candidate;
        break;
      }
      evidence.misses.push(missFrom(candidate.reference, comparison));
    }
    const invocation = openSource(step);
    try {
      const token = {};
      const carrier = eligible === undefined ? undefined : carrierFor(eligible.reference, token);
      if (eligible !== undefined && invocation.hasFinality) {
        emit(request, evidence, step, 'finality');
        let decided: IObservationCapture<unknown>;
        try {
          decided = await callSource(request, invocation, 'finality', carrier, (value) => value);
        } catch (error: unknown) {
          throw new ResolutionError('policy-failure', `Current finality of ${stepKey(step)} failed: ${describe(error)}`, error);
        }
        if (typeof decided.value !== 'boolean') {
          throw new ResolutionError('policy-failure', `Current finality of ${stepKey(step)} returned ${typeof decided.value}, not a boolean`);
        }
        if (decided.value) {
          if (request.mode === 'check') {
            return done({ kind: 'reused', basis: 'finality', reference: eligible.reference, acceptance: undefined });
          }
          return done(accept(request, evidence, step, 'finality', eligible.reference, { basis: 'finality', step, observations: decided.observations }, []));
        }
      }
      if (request.mode === 'check') {
        return done({ kind: 'uncertain', boundary: step });
      }
      authorBindings(request);
      const identity = freshIdentity(request, step, declaration);
      const refusal = await admit(request, evidence, step, 'source', versioned(declaration), eligible !== undefined ? 'source-policy' : candidates.length > 0 ? 'invalid' : 'cold');
      if (refusal !== undefined) {
        return done({ kind: 'refused', refused: step, reason: refusal });
      }
      const attemptId = claim(request, evidence, step, identity);
      let ran: IObservationCapture<ISourceReturn>;
      try {
        emit(request, evidence, step, 'execute');
        ran = await callSource(request, invocation, 'run', carrier, (value): ISourceReturn => {
          const minted = mintedOutcome(value);
          if (minted?.kind !== 'fresh') {
            return { minted, data: undefined, detachError: undefined };
          }
          try {
            return { minted, data: tracking.snapshotOutput(minted.data), detachError: undefined };
          } catch (error: unknown) {
            return { minted, data: undefined, detachError: error };
          }
        });
      } catch (error: unknown) {
        abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(error) });
        if (error instanceof ResolutionError) {
          throw error;
        }
        throw new ResolutionError('execution-failure', `Source check of ${stepKey(step)} failed: ${describe(error)}`, error);
      }
      const { minted } = ran.value;
      if (minted === undefined) {
        abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'invalid source outcome' });
        throw new ResolutionError('invalid-outcome', `Source ${stepKey(step)} returned something other than a Resolution outcome envelope`);
      }
      if (minted.kind === 'retain') {
        const held = typeof minted.previous === 'object' && minted.previous !== null ? carriers.get(minted.previous) : undefined;
        if (eligible === undefined || held === undefined || held.token !== token || held.reference.locator !== eligible.reference.locator) {
          abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'invalid retention' });
          throw new ResolutionError('invalid-retention', `Source ${stepKey(step)} retained something other than its own eligible previous result`);
        }
        let result: IStepResult;
        try {
          result = accept(request, evidence, step, 'check', eligible.reference, { basis: 'check', step, observations: ran.observations }, []);
        } catch (error: unknown) {
          abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(error) });
          throw error;
        }
        // The admitted claim produced no new result: end it with the retention as its evidence.
        if (abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'retained', detail: 'the source check explicitly retained its eligible previous result', reference: eligible.reference })) {
          emit(request, evidence, step, 'release', eligible.reference);
        }
        return done(result);
      }
      if (ran.value.detachError !== undefined) {
        abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(ran.value.detachError) });
        throw new ResolutionError('unsupported-result', `Source ${stepKey(step)} returned unsupported fresh data: ${describe(ran.value.detachError)}`, ran.value.detachError);
      }
      return done(publish(request, evidence, step, attemptId, {
        payload: ran.value.data,
        provenance: { version: 1, kind: 'source', step, observations: ran.observations, children: [] },
        dependencies: [],
      }));
    } finally {
      invocation.close();
    }
  }

  /** The outcome of validating one memo candidate. */
  type IMemoVerdict =
    | ({ readonly verdict: 'eligible' } & IEligible)
    | { readonly verdict: 'miss'; readonly miss: ICandidateMiss }
    | { readonly verdict: 'stop'; readonly result: IStepResult };

  /**
   * Validate one memo candidate beneath current child policy: version-1
   * provenance with its M3 meaning, version 2 call by call.
   */
  async function evaluateMemoCandidate(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>, candidate: ICompletedEnvelope): Promise<IMemoVerdict> {
    const reading = integrity(() => readProvenance(candidate));
    if (reading.status === 'unsupported') {
      return { verdict: 'miss', miss: miss(candidate.reference, 'unsupported-evidence', reading.detail) };
    }
    const { provenance } = reading;
    if (provenance.kind !== 'memo') {
      return { verdict: 'miss', miss: miss(candidate.reference, 'unsupported-evidence', `provenance was recorded for a ${provenance.kind === 'source' ? 'source' : 'supplied step'}`) };
    }
    if (provenance.version === 2) {
      return evaluateNestedCandidate(request, step, declaration, candidate, provenance);
    }
    return evaluateDirectCandidate(request, step, declaration, candidate, provenance);
  }

  /** Validate a version-1 memo candidate with its M3 meaning, unchanged. */
  async function evaluateDirectCandidate(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>, candidate: ICompletedEnvelope, provenance: IDirectProvenance): Promise<IMemoVerdict> {
    const own = provenance.observations.filter((item) => !isChildObservation(item.binding));
    const ownComparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run }));
    if (ownComparison.kind !== 'equal') {
      return { verdict: 'miss', miss: missFrom(candidate.reference, ownComparison) };
    }
    const current = new Map<string, ICompletedResultReference>();
    for (const child of provenance.children) {
      const reconnected = composition.resolveWitness(child.witness);
      if (reconnected.status === 'unsupported') {
        return { verdict: 'miss', miss: miss(candidate.reference, 'unsupported-evidence', `direct-child witness for ${child.slot} is unsupported (${reconnected.reason})`) };
      }
      if (reconnected.status !== 'bound') {
        return { verdict: 'miss', miss: miss(candidate.reference, 'correspondence', `direct-child witness for ${child.slot} has no unique current correspondence (${reconnected.status})`) };
      }
      if (reconnected.witness.version !== 1) {
        // Version-1 provenance records only version-1 witnesses; any other is not this format's meaning.
        return { verdict: 'miss', miss: miss(candidate.reference, 'unsupported-evidence', `direct-child witness for ${child.slot} is version ${String(reconnected.witness.version)}, not version 1`) };
      }
      const childStep = siblingStep(step, child.slot);
      const childTarget = composition.resolve(childStep);
      const childDeclaration = reconnected.child.declaration;
      if (reconnected.parent.declaration !== declaration || childTarget.status !== 'bound' || childTarget.target.role !== 'step'
        || childTarget.target.declaration !== childDeclaration || childDeclaration.kind !== 'source') {
        return { verdict: 'miss', miss: miss(candidate.reference, 'correspondence', `direct-child witness for ${child.slot} does not name this step's current ${child.slot} source`) };
      }
      if (!candidate.dependencies.some((dependency) => dependency.locator === child.reference.locator)) {
        throw new ResolutionError('integrity', `Recorded child ${child.slot} of ${candidate.reference.locator} is not among its exact dependencies`);
      }
      const historical = integrity(() => history.readEnvelope(child.reference));
      if (historical.analysis !== analysis || historical.environment !== environment) {
        throw new ResolutionError('integrity', `Recorded child ${child.slot} of ${candidate.reference.locator} is outside this History scope`);
      }
      // The historical child is read only for exact integrity. Correspondence is
      // the uniquely reconnected structural slot (CMP-6): a different subject now
      // occupying it is simply the current child, resolved under its own
      // eligibility and admission, whose consumed output facts are then compared
      // (REUSE-005/006, RES-003/007). Original provenance keeps the old child.
      const resolved = await resolveSourceShared(request, childStep, childDeclaration);
      switch (resolved.result.kind) {
        case 'reused':
        case 'published':
          current.set(child.slot, resolved.result.reference);
          break;
        case 'refused':
        case 'uncertain':
          return { verdict: 'stop', result: resolved.result };
        case 'execution-required':
          return { verdict: 'stop', result: { kind: 'uncertain', boundary: childStep } };
        default: {
          const exhaustive: never = resolved.result;
          return exhaustive;
        }
      }
    }
    const unavailable: ICurrentFactProvider = Object.freeze({ resolve: () => ({ kind: 'unavailable' as const }) });
    const childFacts = provenance.observations.filter((item) => isChildObservation(item.binding));
    const childComparison = compare(childFacts, materialization.currentProvider(
      (binding) => binding.path.length === 2 && binding.path[1] !== undefined ? current.get(binding.path[1]) : undefined,
      unavailable,
    ));
    if (childComparison.kind !== 'equal') {
      return { verdict: 'miss', miss: missFrom(candidate.reference, childComparison) };
    }
    const children = [...current].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return {
      verdict: 'eligible',
      record: { basis: 'validated', step, children: children.map(([slot, reference]) => ({ slot, reference })) },
      dependencies: children.map(([, reference]) => reference),
    };
  }

  /**
   * Validate a version-2 memo candidate: its own evidence first, then each
   * recorded call in order. For call k: reconnect the witness through
   * Definition; rebuild the arguments (forwarded origins from current bindings
   * or the current output of an earlier call, justified derived values, never
   * an unreconstructible one); obtain the current child result under its own
   * validation or normal admission; and compare only the facts the parent
   * consumed from call k. The first failure is the candidate's miss; no later
   * call is reached and the parent body never runs here.
   */
  async function evaluateNestedCandidate(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>, candidate: ICompletedEnvelope, provenance: INestedProvenance): Promise<IMemoVerdict> {
    const missed = (reason: ICandidateMiss['reason'], detail: string): IMemoVerdict => ({ verdict: 'miss', miss: miss(candidate.reference, reason, detail) });
    const own = provenance.observations.filter((item) => callObservationIndex(item.binding) === undefined);
    const ownComparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run }));
    if (ownComparison.kind !== 'equal') {
      return { verdict: 'miss', miss: missFrom(candidate.reference, ownComparison) };
    }
    const scanned = scanCalls(candidate, declaration, provenance);
    if (scanned.status === 'miss') {
      return { verdict: 'miss', miss: scanned.miss };
    }
    const outputs = new Map<number, ICompletedResultReference>();
    const unavailable: ICurrentFactProvider = Object.freeze({ resolve: () => ({ kind: 'unavailable' as const }) });
    for (const { call, reconnected } of scanned.calls) {
      const label = `call ${String(call.index)}`;
      const witness = reconnected.witness;
      if (witness.version !== 2) {
        return missed('unsupported-evidence', `${label} carries a witness for another version`);
      }
      if (!candidate.dependencies.some((dependency) => dependency.locator === call.reference.locator)) {
        throw new ResolutionError('integrity', `Recorded ${label} of ${candidate.reference.locator} is not among its exact dependencies`);
      }
      const historical = integrity(() => history.readEnvelope(call.reference));
      if (historical.analysis !== analysis || historical.environment !== environment) {
        throw new ResolutionError('integrity', `Recorded ${label} of ${candidate.reference.locator} is outside this History scope`);
      }
      const rebuilt = rebuildArguments(request, call.index, witness.arguments, outputs, true);
      if (rebuilt.status === 'miss') {
        return missed(rebuilt.reason, rebuilt.detail);
      }
      const child = reconnected.child;
      let resolved: IResolvedStep;
      if (child.role === 'step') {
        const childStep = siblingStep(step, witness.child.slot);
        const childDeclaration = child.declaration;
        if (childDeclaration.kind === 'source') {
          resolved = await resolveSourceShared(request, childStep, childDeclaration);
        } else if (childDeclaration.kind === 'memo') {
          resolved = await resolveMemoShared(request, childStep, childDeclaration);
        } else {
          return missed('correspondence', `${label} names a ${childDeclaration.kind}, which is never a declared call`);
        }
      } else {
        let subject: IScopedSubject;
        try {
          subject = child.subjectFor(witness.arguments);
        } catch (error: unknown) {
          if (error instanceof DefinitionError) {
            return missed('correspondence', `${label} has no current subject: ${error.message}`);
          }
          throw error;
        }
        resolved = await resolveSuppliedShared(request, { slot: witness.child, declaration: child.declaration, subject, values: rebuilt.values, digest: argumentDigest(rebuilt.values) });
      }
      switch (resolved.result.kind) {
        case 'reused':
        case 'published':
          outputs.set(call.index, resolved.result.reference);
          break;
        case 'refused':
        case 'uncertain':
          return { verdict: 'stop', result: resolved.result };
        case 'execution-required':
          return { verdict: 'stop', result: { kind: 'uncertain', boundary: resolved.step } };
        default: {
          const exhaustive: never = resolved.result;
          return exhaustive;
        }
      }
      const current = resolved.result.reference;
      const consumed = provenance.observations.filter((item) => callObservationIndex(item.binding) === String(call.index));
      const comparison = compare(consumed, materialization.currentProvider(() => current, unavailable));
      if (comparison.kind !== 'equal') {
        return { verdict: 'miss', miss: callOutputMiss(candidate.reference, call.index, comparison) };
      }
    }
    const calls = [...outputs].sort(([left], [right]) => left - right);
    return {
      verdict: 'eligible',
      record: { basis: 'validated', step, calls: calls.map(([index, reference]) => ({ index, reference })) },
      dependencies: uniqueReferences(calls.map(([, reference]) => reference)),
    };
  }

  /** A recorded call reconnected to its current parent and child, before any child work. */
  interface IScannedCall {
    readonly call: ICallEvidence;
    readonly reconnected: Extract<ReturnType<typeof composition.resolveWitness>, { readonly status: 'bound' }>;
  }

  /**
   * Reconnect every recorded call's witness through Definition, side effect
   * free, before any child is resolved. A witness Definition cannot read, a
   * slot with no current binding or several, an edge the step no longer
   * declares, another parent, or a witness for another call position is a
   * miss with zero child work, even when an earlier call would need work.
   */
  function scanCalls(candidate: ICompletedEnvelope, declaration: IAnyMemoDeclaration<IFamily>, provenance: INestedProvenance):
    | { readonly status: 'miss'; readonly miss: ICandidateMiss }
    | { readonly status: 'scanned'; readonly calls: readonly IScannedCall[] } {
    const missed = (reason: ICandidateMiss['reason'], detail: string): { readonly status: 'miss'; readonly miss: ICandidateMiss } =>
      ({ status: 'miss', miss: miss(candidate.reference, reason, detail) });
    const calls: IScannedCall[] = [];
    for (const call of provenance.calls) {
      const label = `call ${String(call.index)}`;
      const reconnected = composition.resolveWitness(call.witness);
      switch (reconnected.status) {
        case 'unsupported':
          return missed('unsupported-evidence', `${label} witness is unsupported (${reconnected.reason})`);
        case 'missing':
          return missed('missing-binding', `${label}: ${describeSlot(reconnected.descriptor)} has no current binding`);
        case 'ambiguous':
          return missed('ambiguous-binding', `${label}: ${describeSlot(reconnected.descriptor)} has ${String(reconnected.occupants)} current bindings`);
        case 'undeclared-edge':
          return missed('correspondence', `${label} names an edge this step no longer declares`);
        case 'bound':
          break;
        default: {
          const exhaustive: never = reconnected;
          return exhaustive;
        }
      }
      if (reconnected.witness.version !== 2 || reconnected.witness.index !== call.index) {
        return missed('unsupported-evidence', `${label} carries a witness for another call position or version`);
      }
      if (reconnected.parent.declaration !== declaration) {
        return missed('correspondence', `${label} names a parent other than this step's current declaration`);
      }
      calls.push({ call, reconnected });
    }
    return { status: 'scanned', calls };
  }

  /**
   * Whether a memo's declared supplied slots are each bound to exactly one
   * implementation now. Opening the invocation runs no author code; Definition
   * refuses it, with its distinct missing or ambiguous diagnostic, otherwise.
   */
  function slotOccupancy(step: IBindingDescriptor): { readonly reason: 'missing-binding' | 'ambiguous-binding'; readonly error: ResolutionError } | undefined {
    try {
      openMemo(step).close();
      return undefined;
    } catch (error: unknown) {
      if (error instanceof ResolutionError && error.cause instanceof DefinitionError) {
        if (error.cause.code === 'missing-slot') {
          return { reason: 'missing-binding', error };
        }
        if (error.cause.code === 'ambiguous-slot') {
          return { reason: 'ambiguous-binding', error };
        }
      }
      throw error;
    }
  }

  /**
   * The miss of a candidate for a memo that cannot run now because a declared
   * supplied slot is unbound: whatever its own evidence and recorded witnesses
   * show without any child work, otherwise the slot occupancy itself.
   */
  function unboundMiss(request: IRequestContext, declaration: IAnyMemoDeclaration<IFamily>, candidate: ICompletedEnvelope, occupancy: { readonly reason: 'missing-binding' | 'ambiguous-binding'; readonly error: ResolutionError }): ICandidateMiss {
    const reading = integrity(() => readProvenance(candidate));
    if (reading.status === 'unsupported') {
      return miss(candidate.reference, 'unsupported-evidence', reading.detail);
    }
    const { provenance } = reading;
    if (provenance.kind !== 'memo') {
      return miss(candidate.reference, 'unsupported-evidence', `provenance was recorded for a ${provenance.kind === 'source' ? 'source' : 'supplied step'}`);
    }
    const own = provenance.version === 2
      ? provenance.observations.filter((item) => callObservationIndex(item.binding) === undefined)
      : provenance.observations.filter((item) => !isChildObservation(item.binding));
    const ownComparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run }));
    if (ownComparison.kind !== 'equal') {
      return missFrom(candidate.reference, ownComparison);
    }
    if (provenance.version === 2) {
      const scanned = scanCalls(candidate, declaration, provenance);
      if (scanned.status === 'miss') {
        return scanned.miss;
      }
    }
    return miss(candidate.reference, occupancy.reason, occupancy.error.message);
  }

  /**
   * Rebuild one nested call's arguments now, position by position. A forwarded
   * origin is resolved from current bindings (an input path, or the current
   * output of an earlier call of the same invocation); a stored value is never
   * substituted. When validating, a derived value or forwarded path is used
   * only if recorded as justified, and an unreconstructible argument is an
   * immediate miss. When
   * executing, the parent is making the call itself, so every recipe stands.
   */
  function rebuildArguments(request: IRequestContext, index: number, recipes: IInvocationArguments, outputs: ReadonlyMap<number, ICompletedResultReference>, validating: boolean): IRebuiltArguments {
    if ('form' in recipes) {
      return { status: 'rebuilt', values: [] };
    }
    const derived = derivedArguments(recipes);
    const values: IArgumentValue[] = [];
    for (const [position, recipe] of recipes.entries()) {
      const label = `call ${String(index)} argument ${String(position)}`;
      switch (recipe.form) {
        case 'unreconstructible':
          if (validating) {
            return { status: 'miss', reason: 'unreconstructible-argument', detail: `${label} kept no value (${recipe.reason}), so the call cannot be made again without running the parent` };
          }
          values.push({ kind: 'opaque', reason: recipe.reason });
          break;
        case 'derived':
          if (validating && !recipe.justified) {
            return { status: 'miss', reason: 'unjustified-argument', detail: `${label} was derived after an observed untracked read, so recorded evidence cannot justify it` };
          }
          values.push({ kind: 'data', value: derived[position] });
          break;
        case 'forwarded': {
          if (validating && !recipe.justified) {
            return { status: 'miss', reason: 'unjustified-argument', detail: `${label} forwards a path chosen after an observed untracked read, so recorded evidence cannot justify it` };
          }
          const found = forwardedValue(request, recipe.origin, outputs);
          if (found.status !== 'found') {
            return { status: 'miss', reason: found.status, detail: `${label} forwards ${describeOrigin(recipe.origin)}, which ${found.detail}` };
          }
          values.push({ kind: 'data', value: found.value });
          break;
        }
        default: {
          const exhaustive: never = recipe;
          return exhaustive;
        }
      }
    }
    return { status: 'rebuilt', values };
  }

  /**
   * The current value at a forwarded origin, read through the validation
   * observer so nothing is recorded into an author capture. A container is
   * detached as supported data for the called step's argument view.
   */
  function forwardedValue(request: IRequestContext, origin: IForwardOrigin, outputs: ReadonlyMap<number, ICompletedResultReference>): IForwardedValue {
    let root: unknown;
    switch (origin.binding) {
      case 'input': {
        const state = request.slots.inputs.get(origin.slot);
        if (state === undefined || state.status === 'missing') {
          return { status: 'unavailable', detail: 'has no current binding' };
        }
        if (state.status === 'ambiguous') {
          return { status: 'ambiguous', detail: 'has ambiguous current bindings' };
        }
        root = Reflect.get(validation.tracked(inputRecord(request.slots), { path: bindingPaths.inputs }), origin.slot);
        break;
      }
      case 'child': {
        const reference = outputs.get(origin.call);
        if (reference === undefined) {
          return { status: 'unavailable', detail: 'has no current result' };
        }
        root = originMaterialization.materializeView<object>(reference, { path: ['forwarded'] });
        break;
      }
      case 'member':
        // Definition reconnects member origins only for template instances, which this resolver does not run.
        return { status: 'unavailable', detail: 'needs a template instance member binding' };
      default: {
        const exhaustive: never = origin;
        return exhaustive;
      }
    }
    try {
      let current = root;
      for (const segment of origin.path) {
        if (!validation.materialization.owns(current) || (segment.kind === 'index') !== Array.isArray(current)) {
          return { status: 'changed', detail: 'no longer has that shape' };
        }
        current = Reflect.get(current, segment.kind === 'property' ? segment.key : String(segment.index));
      }
      return { status: 'found', value: validation.materialization.owns(current) ? validation.snapshotOutput(current) : current };
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        return { status: 'changed', detail: `no longer resolves (${error.message})` };
      }
      throw error;
    }
  }

  /**
   * A canonical digest of one call's argument values: the content fingerprint
   * of the supported values (opaque positions as holes) plus which positions
   * are opaque and why. It keys request-local sharing and attempt identity;
   * it is never compared as evidence.
   */
  function argumentDigest(values: readonly IArgumentValue[]): string {
    const view = validation.tracked(argumentList(values), { path: bindingPaths.argument });
    // Framework-owned fingerprinting: the validation observer detaches the argument list; no author callback runs here.
    const captured = validation.capture(() => validation.snapshotOutput(view));
    const opaque = values.flatMap((value, position) => value.kind === 'opaque' ? [[position, value.reason]] : []);
    return JSON.stringify([captured.observations[0]?.fingerprint ?? null, opaque]);
  }

  /**
   * The argument list a supplied step reads, as the plain array it stands for.
   *
   * The target is a frozen real array of the call's arity whose positions are
   * enumerable accessors reading through the author observer's view of the
   * whole list at the `argument` binding, so every element read (directly, by
   * an array method, iteration, spread, destructuring or JSON) is the step's
   * own evidence. An opaque (unreconstructible) position is an accessor that
   * throws, so no step can depend on it. Being a real frozen array with real
   * index keys, it satisfies Definition's frozen-array check, and `in`, key
   * reflection and every array method see its elements.
   *
   * The proxy adds only observation: reading `length`, a position past the
   * end, an `in` check or key reflection records the list's shape (its length,
   * or the absent position), each returning exactly what the target answers,
   * as the proxy invariants for a frozen target require. Shape observations
   * are armed only when the author callback starts, because Definition's
   * frozen-array check reflects on the list before that, possibly inside a
   * parent body's capture where a record would be misattributed.
   */
  function argumentViews(values: readonly IArgumentValue[]): { readonly views: readonly unknown[]; readonly arm: () => void } {
    const whole = tracking.tracked(argumentList(values), { path: bindingPaths.argument });
    let armed = false;
    const observeArity = (): void => {
      if (armed) {
        void Reflect.get(whole, 'length');
      }
    };
    const target: unknown[] = [];
    values.forEach((value, position) => {
      Object.defineProperty(target, position, {
        enumerable: true,
        get: (): unknown => {
          if (value.kind === 'opaque') {
            throw new TypeError(`Argument ${String(position)} is unreconstructible (${value.reason}); a supplied step can never observe it`);
          }
          return Reflect.get(whole, String(position));
        },
      });
    });
    Object.freeze(target);
    const views = new Proxy(target, {
      get(held, key, receiver): unknown {
        if (key === 'length') {
          observeArity();
          return held.length;
        }
        if (typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(key) && Number(key) >= held.length) {
          // A position past the end: its absence is a fact of this list's shape.
          return Reflect.get(whole, key);
        }
        return Reflect.get(held, key, receiver);
      },
      has(held, key): boolean {
        observeArity();
        return Reflect.has(held, key);
      },
      ownKeys(held): ArrayLike<string | symbol> {
        observeArity();
        return Reflect.ownKeys(held);
      },
      getOwnPropertyDescriptor(held, key): PropertyDescriptor | undefined {
        observeArity();
        return Reflect.getOwnPropertyDescriptor(held, key);
      },
    });
    return { views, arm: () => { armed = true; } };
  }

  /** Resolve one supplied slot call once per top-level request, for its slot, subject, version and arguments. */
  function resolveSuppliedShared(request: IRequestContext, call: ISuppliedCall<IFamily>): Promise<IResolvedStep> {
    const key = JSON.stringify([stepKey(call.slot), call.subject.scope, call.subject.subject, call.declaration.version, call.digest]);
    const existing = request.supplied.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pending = resolveSupplied(request, call);
    request.supplied.set(key, pending);
    return pending;
  }

  /**
   * Resolve one supplied slot call: candidates under the call's subject and
   * the supplied implementation's version, each validated on its own
   * implementation, bindings and the argument facts it observed; otherwise
   * admit and execute the implementation currently supplied, with the call's
   * argument views, and publish its version-2 provenance.
   */
  async function resolveSupplied(request: IRequestContext, call: ISuppliedCall<IFamily>): Promise<IResolvedStep> {
    const step = call.slot;
    const evidence = newEvidence(request);
    const done = (result: IStepResult): IResolvedStep => ({ step, result, evidence });
    const subject = suppliedSubject(call);
    emit(request, evidence, step, 'verify');
    const candidates = integrity(() => history.findCandidates(subject));
    let eligible: ICompletedEnvelope | undefined;
    for (const candidate of candidates) {
      const reading = integrity(() => readProvenance(candidate));
      if (reading.status === 'unsupported') {
        evidence.misses.push(miss(candidate.reference, 'unsupported-evidence', reading.detail));
        continue;
      }
      if (reading.provenance.kind !== 'supplied') {
        evidence.misses.push(miss(candidate.reference, 'unsupported-evidence', `provenance was recorded for a ${reading.provenance.kind}`));
        continue;
      }
      if (stepKey(reading.provenance.step) !== stepKey(step)) {
        evidence.misses.push(miss(candidate.reference, 'correspondence', `provenance names ${describeSlot(reading.provenance.step)}, not ${describeSlot(step)}`));
        continue;
      }
      const comparison = compare(reading.provenance.observations, ownFactProvider({ validation, slots: request.slots, self: call.declaration.run, arguments: call.values }));
      if (comparison.kind === 'equal') {
        eligible = candidate;
        break;
      }
      evidence.misses.push(missFrom(candidate.reference, comparison));
    }
    if (eligible !== undefined) {
      if (request.mode === 'check') {
        return done({ kind: 'reused', basis: 'validated', reference: eligible.reference, acceptance: undefined });
      }
      return done(accept(request, evidence, step, 'validated', eligible.reference, { basis: 'validated', step }, []));
    }
    if (request.mode === 'check') {
      return done({ kind: 'execution-required' });
    }
    const bindings = authorBindings(request);
    const identity = freshSuppliedIdentity(request, call);
    const refusal = await admit(request, evidence, step, 'supplied', subject, candidates.length > 0 ? 'invalid' : 'cold');
    if (refusal !== undefined) {
      return done({ kind: 'refused', refused: step, reason: refusal });
    }
    const invocation = openSupplied(step);
    let attemptId: number;
    try {
      attemptId = claim(request, evidence, step, identity);
    } catch (error: unknown) {
      invocation.close();
      throw error;
    }
    const { views, arm } = argumentViews(call.values);
    const supplier: IArgumentSupplier<IFamily> = Object.freeze({
      views: <TParameters extends readonly unknown[]>(declaration: ISuppliedStepDeclaration<IFamily, TParameters, unknown>): IArgumentViews<IFamily, TParameters> => {
        void declaration;
        return trusted<IArgumentViews<IFamily, TParameters>>(views);
      },
    });
    let ran: IObservationCapture<IMemoReturn>;
    try {
      emit(request, evidence, step, 'execute');
      ran = await active.run(invocation, () => invocation.apply(bindings, supplier, invoker(detachComputation, arm)));
    } catch (error: unknown) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(error) });
      if (error instanceof ResolutionError) {
        throw error;
      }
      throw new ResolutionError('execution-failure', `Supplied step ${describeSlot(step)} for ${subject.subject} failed: ${describe(error)}`, error);
    } finally {
      invocation.close();
    }
    if (ran.value.detachError !== undefined) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(ran.value.detachError) });
      throw new ResolutionError('unsupported-result', `Supplied step ${describeSlot(step)} returned unsupported data: ${describe(ran.value.detachError)}`, ran.value.detachError);
    }
    return done(publish(request, evidence, step, attemptId, {
      payload: ran.value.data,
      provenance: { version: 2, kind: 'supplied', step, observations: ran.observations, calls: [] },
      dependencies: [],
    }));
  }

  /** Explicitly detach a computation's returned value inside its capture. */
  function detachComputation(value: unknown): IMemoReturn {
    try {
      return { data: tracking.snapshotOutput(value), detachError: undefined };
    } catch (error: unknown) {
      return { data: undefined, detachError: error };
    }
  }

  /** Resolve one memo invocation once per top-level request. */
  function resolveMemoShared(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>): Promise<IResolvedStep> {
    const key = stepKey(step);
    const existing = request.memos.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pending = resolveMemo(request, step, declaration);
    request.memos.set(key, pending);
    return pending;
  }

  /** Resolve one memo step under current policy. */
  async function resolveMemo(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>): Promise<IResolvedStep> {
    const evidence = newEvidence(request);
    const done = (result: IStepResult): IResolvedStep => ({ step, result, evidence });
    emit(request, evidence, step, 'verify');
    const candidates = integrity(() => history.findCandidates(versioned(declaration)));
    // A memo whose declared supplied slot is unbound cannot run: every candidate
    // is judged without any child work, and nothing is admitted.
    const occupancy = slotOccupancy(step);
    if (occupancy !== undefined) {
      for (const candidate of candidates) {
        evidence.misses.push(unboundMiss(request, declaration, candidate, occupancy));
      }
      if (request.mode === 'check') {
        return done({ kind: 'execution-required' });
      }
      throw occupancy.error;
    }
    for (const candidate of candidates) {
      const evaluated = await evaluateMemoCandidate(request, step, declaration, candidate);
      if (evaluated.verdict === 'stop') {
        return done(evaluated.result);
      }
      if (evaluated.verdict === 'miss') {
        evidence.misses.push(evaluated.miss);
        continue;
      }
      if (request.mode === 'check') {
        return done({ kind: 'reused', basis: 'validated', reference: candidate.reference, acceptance: undefined });
      }
      return done(accept(request, evidence, step, 'validated', candidate.reference, evaluated.record, evaluated.dependencies));
    }
    if (request.mode === 'check') {
      return done({ kind: 'execution-required' });
    }
    const bindings = authorBindings(request);
    const identity = freshIdentity(request, step, declaration);
    const refusal = await admit(request, evidence, step, 'memo', versioned(declaration), candidates.length > 0 ? 'invalid' : 'cold');
    if (refusal !== undefined) {
      return done({ kind: 'refused', refused: step, reason: refusal });
    }
    // Opening the invocation runs no author code; doing it before the claim leaves no attempt behind if it fails.
    const invocation = openMemo(step);
    let attemptId: number;
    try {
      attemptId = claim(request, evidence, step, identity);
    } catch (error: unknown) {
      invocation.close();
      throw error;
    }
    const frame: IMemoFrame = { request, step, children: new Map(), calls: new Map(), inflight: new Set(), unsettledAtReturn: undefined, refused: undefined, failed: undefined };
    frames.set(invocation, frame);
    let ran: IObservationCapture<IMemoReturn>;
    try {
      emit(request, evidence, step, 'execute');
      ran = await active.run(invocation, () => invocation.apply(bindings, invoker((value): IMemoReturn => {
        // Taken inside the capture, as the body's value is: which started calls it left unsettled.
        frame.unsettledAtReturn = frame.inflight.size;
        return detachComputation(value);
      })));
    } catch (error: unknown) {
      // What the body failed with is decided now: a call that fails or is
      // refused while the in-flight calls settle below must not replace it.
      const refused = frame.refused;
      const failed = frame.failed;
      // Let calls the body started finish their own lifecycle before this attempt
      // ends (an unbounded wait; see IMemoFrame.inflight).
      await Promise.allSettled([...frame.inflight]);
      if (refused !== undefined) {
        abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'child-refused', detail: refused.reason });
        return done({ kind: 'refused', refused: refused.step, reason: refused.reason });
      }
      const cause = failed?.error ?? error;
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(cause) });
      if (cause instanceof ResolutionError && cause.code !== 'execution-failure') {
        throw cause;
      }
      throw new ResolutionError('execution-failure', `Body of ${stepKey(step)} failed: ${describe(cause)}`, cause);
    } finally {
      invocation.close();
    }
    const unsettled = frame.unsettledAtReturn ?? 0;
    // Every started call settles before the attempt ends (an unbounded wait; see IMemoFrame.inflight).
    await Promise.allSettled([...frame.inflight]);
    if (unsettled > 0) {
      // Its evidence would lack a call the body made: never publish such a result.
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: `${String(unsettled)} declared call(s) had not settled when the body returned` });
      throw new ResolutionError('execution-failure', `Body of ${stepKey(step)} returned while ${String(unsettled)} declared call(s) it made had not settled`);
    }
    if (frame.refused !== undefined) {
      // A body that swallowed a refused child cannot publish a result missing that child.
      abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'child-refused', detail: frame.refused.reason });
      return done({ kind: 'refused', refused: frame.refused.step, reason: frame.refused.reason });
    }
    if (frame.failed !== undefined) {
      // A body that swallowed a failed child cannot publish a result missing that child's current evidence.
      const cause = frame.failed.error;
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(cause) });
      throw cause instanceof ResolutionError ? cause : new ResolutionError('execution-failure', `A child of ${stepKey(step)} failed: ${describe(cause)}`, cause);
    }
    if (ran.value.detachError !== undefined) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(ran.value.detachError) });
      throw new ResolutionError('unsupported-result', `Body of ${stepKey(step)} returned unsupported data: ${describe(ran.value.detachError)}`, ran.value.detachError);
    }
    if (frame.calls.size > 0) {
      // Nested calls carry version-2 witnesses: record them in call order. Every
      // started call settled, so positions are contiguous; a gap is a defect.
      const calls = [...frame.calls.values()].sort((left, right) => left.index - right.index);
      if (calls.some((call, position) => call.index !== position)) {
        abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'a declared call did not settle before the body returned' });
        throw new ResolutionError('execution-failure', `Body of ${stepKey(step)} returned before every declared call it made had settled`);
      }
      return done(publish(request, evidence, step, attemptId, {
        payload: ran.value.data,
        provenance: { version: 2, kind: 'memo', step, observations: ran.observations, calls },
        dependencies: uniqueReferences(calls.map((call) => call.reference)),
      }));
    }
    const children = [...frame.children.values()].sort((left, right) => left.slot < right.slot ? -1 : left.slot > right.slot ? 1 : 0);
    return done(publish(request, evidence, step, attemptId, {
      payload: ran.value.data,
      provenance: { version: 1, kind: 'memo', step, observations: ran.observations, children },
      dependencies: uniqueReferences(children.map((child) => child.reference)),
    }));
  }

  /**
   * Deliver one declared child call from an executing memo body: reconnect
   * its witness, resolve the child under current policy (sharing a result
   * already established in this request), record the direct-child evidence and
   * return a lazy view of the child's exact result bound to the child slot.
   */
  function dispatchChild<TResult>(request: IDeclaredInvocationRequest<IFamily, TResult>): Promise<{ readonly data: unknown }> {
    const frame = frames.get(request.scope);
    if (frame === undefined) {
      return Promise.reject(new ResolutionError('invalid-request', 'A declared call arrived from an invocation Resolution is not executing'));
    }
    // Started now, synchronously within the body: in flight until its delivery settles.
    const delivery = deliverChild(frame, request);
    frame.inflight.add(delivery);
    const settled = (): void => {
      frame.inflight.delete(delivery);
    };
    void delivery.then(settled, settled);
    return delivery;
  }

  /** Deliver one declared call for {@link dispatchChild}. */
  async function deliverChild<TResult>(frame: IMemoFrame, request: IDeclaredInvocationRequest<IFamily, TResult>): Promise<{ readonly data: unknown }> {
    const witness = request.witness;
    if (witness.version === 2) {
      return dispatchNested(frame, request, witness);
    }
    if (request.kind !== 'source') {
      // Definition sends memo and supplied slot calls only with the version-2
      // witness; anything else is refused before any child work.
      const error = new ResolutionError('unbound-step', `A ${request.kind} call with a version-1 witness is not supported by this Resolution`);
      frame.failed ??= { error };
      throw error;
    }
    const reconnected = composition.resolveWitness(witness);
    if (reconnected.status !== 'bound' || reconnected.child.declaration !== request.child) {
      const error = new ResolutionError('unbound-step', 'A declared call does not reconnect to its current child declaration');
      frame.failed ??= { error };
      throw error;
    }
    const slot = witness.child.slot;
    const childStep = siblingStep(frame.step, slot);
    let resolved: IResolvedStep;
    try {
      resolved = await resolveSourceShared(frame.request, childStep, request.child);
    } catch (error: unknown) {
      frame.failed ??= { error };
      throw error;
    }
    if (resolved.result.kind !== 'reused' && resolved.result.kind !== 'published') {
      const reason = resolved.result.kind === 'refused' ? resolved.result.reason : `child resolution ended ${resolved.result.kind}`;
      frame.refused ??= { step: resolved.result.kind === 'refused' ? resolved.result.refused : childStep, reason };
      throw new ResolutionError('execution-failure', `Declared child ${slot} was refused: ${reason}`);
    }
    const reference = resolved.result.reference;
    if (!frame.children.has(slot)) {
      frame.children.set(slot, Object.freeze({
        slot,
        witness: {
          version: witness.version,
          parent: { ...witness.parent },
          child: { ...witness.child },
          arguments: { form: witness.arguments.form },
        },
        reference,
        binding: Object.freeze({ path: bindingPaths.child(slot) }),
      }));
    }
    // Boxed: an async function's result is assimilated, so the view must never be it.
    return Object.freeze({ data: materialization.materializeView<object>(reference, { path: bindingPaths.child(slot) }) });
  }

  /**
   * Deliver one nested call (version-2 witness) from an executing memo body:
   * reconnect its witness; resolve the sibling source or memo, or rebuild the
   * call's arguments and resolve the implementation supplied to its slot under
   * the call's subject, sharing any result already established in this request
   * (including one obtained while this parent was being validated); record the
   * call at its position; and return a lazy view of the exact child result
   * bound to that position.
   */
  async function dispatchNested<TResult>(frame: IMemoFrame, request: IDeclaredInvocationRequest<IFamily, TResult>, witness: INestedInvocationWitness): Promise<{ readonly data: unknown }> {
    const fail = (error: unknown): unknown => {
      frame.failed ??= { error };
      return error;
    };
    const reconnected = composition.resolveWitness(witness);
    if (reconnected.status !== 'bound' || reconnected.child.declaration !== request.child) {
      throw fail(new ResolutionError('unbound-step', 'A declared call does not reconnect to its current child declaration'));
    }
    let resolved: IResolvedStep;
    try {
      switch (request.kind) {
        case 'source':
          resolved = await resolveSourceShared(frame.request, siblingStep(frame.step, witness.child.slot), request.child);
          break;
        case 'memo':
          resolved = await resolveMemoShared(frame.request, siblingStep(frame.step, witness.child.slot), request.child);
          break;
        case 'supplied': {
          const outputs = new Map([...frame.calls].map(([index, call]) => [index, call.reference]));
          const rebuilt = rebuildArguments(frame.request, witness.index, witness.arguments, outputs, false);
          if (rebuilt.status !== 'rebuilt') {
            throw new ResolutionError('execution-failure', `Call ${String(witness.index)} of ${stepKey(frame.step)} cannot be made: ${rebuilt.detail}`);
          }
          resolved = await resolveSuppliedShared(frame.request, { slot: witness.child, declaration: request.child, subject: request.subject, values: rebuilt.values, digest: argumentDigest(rebuilt.values) });
          break;
        }
        default: {
          const exhaustive: never = request;
          return exhaustive;
        }
      }
    } catch (error: unknown) {
      throw fail(error);
    }
    if (resolved.result.kind !== 'reused' && resolved.result.kind !== 'published') {
      const reason = resolved.result.kind === 'refused' ? resolved.result.reason : `child resolution ended ${resolved.result.kind}`;
      frame.refused ??= { step: resolved.result.kind === 'refused' ? resolved.result.refused : resolved.step, reason };
      throw new ResolutionError('execution-failure', `Call ${String(witness.index)} of ${stepKey(frame.step)} was refused: ${reason}`);
    }
    const reference = resolved.result.reference;
    const binding = Object.freeze({ path: bindingPaths.call(witness.index) });
    frame.calls.set(witness.index, Object.freeze({ index: witness.index, witness: plainWitness(witness), reference, binding }));
    // Boxed: an async function's result is assimilated, so the view must never be it.
    return Object.freeze({ data: materialization.materializeView<object>(reference, binding) });
  }

  /** Resolve a requested step in a request context. */
  async function resolveStep(request: IRequestContext, step: IBindingDescriptor): Promise<IResolvedStep> {
    const target = stepTarget(step);
    return target.declaration.kind === 'source'
      ? resolveSourceShared(request, target.step, target.declaration)
      : resolveMemoShared(request, target.step, target.declaration);
  }

  /** Validate a caller's request key. */
  function requestKeyOf(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ResolutionError('invalid-request', 'A request key must be a nonempty string saved by the caller');
    }
    return value;
  }

  return Object.freeze({
    async resolve(request: IResolveRequest): Promise<IResolutionOutcome> {
      const requestKey = requestKeyOf(request.requestKey);
      const context = newRequest('normal', requestKey, request.lease);
      leaseOf(context);
      const resolved = await resolveStep(context, request.step);
      const evidence = { step: resolved.step, misses: Object.freeze([...resolved.evidence.misses]), trace: Object.freeze([...resolved.evidence.trace]), diagnostics: Object.freeze([...resolved.evidence.diagnostics]) };
      const result = resolved.result;
      switch (result.kind) {
        case 'reused':
          if (result.acceptance === undefined) {
            throw new ResolutionError('integrity', 'A normal reuse must record current acceptance');
          }
          return Object.freeze({ ...evidence, kind: 'reused', basis: result.basis, reference: result.reference, acceptance: result.acceptance });
        case 'published':
          return Object.freeze({ ...evidence, kind: 'published', reference: result.reference, attemptId: result.attemptId });
        case 'refused':
          return Object.freeze({ ...evidence, kind: 'refused', refused: result.refused, reason: result.reason });
        case 'uncertain':
        case 'execution-required':
          throw new ResolutionError('invalid-request', `A normal request cannot end ${result.kind}`);
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    },

    async check(request: ICheckRequest): Promise<ICheckOutcome> {
      const context = newRequest('check', undefined, undefined);
      const resolved = await resolveStep(context, request.step);
      const misses = Object.freeze([...resolved.evidence.misses]);
      const result = resolved.result;
      switch (result.kind) {
        case 'reused':
          return Object.freeze({ kind: 'reusable', step: resolved.step, basis: result.basis, reference: result.reference, misses });
        case 'execution-required':
          return Object.freeze({ kind: 'execution-required', step: resolved.step, misses });
        case 'uncertain':
          return Object.freeze({ kind: 'uncertain', step: resolved.step, boundary: result.boundary, misses });
        case 'published':
        case 'refused':
          throw new ResolutionError('invalid-request', `A check-only request cannot end ${result.kind}`);
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    },

    recover(request: IRecoverRequest): IRecoveryResult {
      const requestKey = requestKeyOf(request.requestKey);
      const { step, declaration } = stepTarget(request.step);
      const slots = reconnectSlots(composition, bindingSlots);
      const identity = {
        ...versioned(declaration),
        attemptKey: attemptKey(host, requestKey, step),
        intentDigest: intentDigest({ host, validation, composition, environment, step, declaration, slots }),
      };
      let recovered: ReturnType<typeof history.recoverAttempt>;
      try {
        recovered = integrity(() => history.recoverAttempt(identity));
      } catch (error: unknown) {
        if (error instanceof AttemptConflictError) {
          throw new ResolutionError('wrong-intent', `Request key ${requestKey} identifies a different execution of ${stepKey(step)}`, error);
        }
        throw error;
      }
      switch (recovered.kind) {
        case 'completed':
          return Object.freeze({ kind: 'recovered', reference: recovered.reference, attemptId: recovered.attempt.attemptId });
        case 'absent':
          return Object.freeze({ kind: 'absent' });
        case 'incomplete':
          return Object.freeze({ kind: 'incomplete', attemptId: recovered.attempt.attemptId });
        case 'unsuccessful':
          return Object.freeze({ kind: 'unsuccessful', attemptId: recovered.attempt.attemptId });
        default: {
          const exhaustive: never = recovered;
          return exhaustive;
        }
      }
    },
  });
}
