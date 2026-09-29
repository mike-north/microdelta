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
 * Work that validation could not avoid is admitted before any claim, attempt
 * or body (REUSE-009). Within one top-level request, a direct invocation's
 * established current result is shared; that memo is request-local evidence,
 * never durable finality.
 */
import type {
  IAnyMemoDeclaration,
  IAnySourceDeclaration,
  IApply,
  IAuthorInvoker,
  IBindingDescriptor,
  IChildResult,
  IDeclaredInvocationRequest,
  IInvocationPort,
  IInvocationScope,
  IMemoInvocation,
  IPreviousSupplier,
  ISourceDeclaration,
  ISourceInvocation,
  IStepDeclaration,
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
import { inputRecord, isChildObservation, isPreviousObservation, ownFactProvider, reconnectSlots, siblingStep } from './current.js';
import type { ICurrentSlots } from './current.js';
import { ResolutionError } from './errors.js';
import { acceptanceRecord, bindingPaths, endingRecord, provenanceRecord, readProvenance } from './evidence.js';
import type { IChildEvidence } from './evidence.js';
import type { IResolutionFamily } from './family.js';
import { attemptKey, intentDigest } from './intent.js';
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
  /**
   * Post-commit diagnostics of every step this request resolved, including
   * nested children. Each step's lifecycle runs once per request (sources are
   * shared), so each diagnostic appears once; the top-level outcome reports
   * all of them beside its own committed success.
   */
  readonly diagnostics: string[];
}

/** The bookkeeping of one executing memo body. */
interface IMemoFrame {
  readonly request: IRequestContext;
  readonly step: IBindingDescriptor;
  readonly children: Map<string, IChildEvidence>;
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

/** What a memo body's capture finishes with. */
interface IMemoReturn {
  readonly data: unknown;
  readonly detachError: unknown;
}

/**
 * Pass a value through a trusted port contract. Definition types a child view
 * and a previous carrier by the declared result type, which Resolution
 * delivers by construction from that declaration's exact result; the static
 * type cannot express that relationship, so this single assertion states it.
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
  /** The invocation currently executing in each asynchronous context, for Definition's handles. */
  const active = host.createAsyncContext<IInvocationScope>();
  /** Executing memo bodies, keyed by their invocation scope. */
  const frames = new WeakMap<IInvocationScope, IMemoFrame>();
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
    // This port treats every derived argument as justified: it keeps no
    // observed untracked-read state for a frame that could contradict it.
    argumentsJustified: (): boolean => true,
  });

  /** The scoped subject and compatibility group of a declaration. */
  function versioned(declaration: IStepDeclaration<IFamily>): IVersionedSubject {
    return Object.freeze({ analysis, environment, subject: declaration.subject, version: declaration.version });
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
    return { mode, requestKey, lease, slots: reconnectSlots(composition, bindingSlots), sources: new Map(), diagnostics: [] };
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
  function authorBindings(request: IRequestContext): { readonly inputs: IFamily['memo']['inputs']; readonly helpers: IFamily['memo']['helpers'] } {
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
    return { inputs: trusted<IFamily['memo']['inputs']>(inputs), helpers: trusted<IFamily['memo']['helpers']>(helpers) };
  }

  /**
   * Resolution's rank-2 invoker: track the author's actual callback as the
   * step's own implementation (`self`) and run it with the context Definition
   * assembled inside a fresh capture. `finish` runs inside that capture, so
   * explicit output detachment records what the step consumed from its output.
   */
  function invoker<TFinished>(finish: (value: unknown) => TFinished): IAuthorInvoker<Promise<IObservationCapture<TFinished>>> {
    return <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): Promise<IObservationCapture<TFinished>> => {
      // eslint-disable-next-line microdelta/tracked-captures -- Framework invoker: the callback is the author's actual function from Definition's record, tracked so its implementation is the step's own evidence.
      const authored = tracking.tracked(callback, { path: bindingPaths.self });
      // eslint-disable-next-line microdelta/tracked-captures -- Framework invoker: this capture is the author call's evidence boundary; it invokes only the tracked author callback with Definition's assembled context.
      return tracking.captureAsync(async () => finish(await authored(context)));
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

  /** Open the unique current invocation of a memo step. */
  function openMemo(step: IBindingDescriptor): IMemoInvocation<IFamily> {
    const invocation = options.declarations.openInvocation(composition, step, port);
    if (invocation.kind !== 'memo') {
      invocation.close();
      throw new ResolutionError('unbound-step', `Step ${stepKey(step)} is not a memo`);
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
    const bindings: IFamily['source'] = Object.freeze({ inputs: shared.inputs, helpers: shared.helpers, outcome: sourceOutcome });
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
  async function admit(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, kind: IStepKind, declaration: IStepDeclaration<IFamily>, reason: IAdmissionRequest['reason']): Promise<string | undefined> {
    emit(request, evidence, step, 'admit');
    let decision: unknown;
    try {
      decision = await admission.admit(Object.freeze({ step, kind, subject: versioned(declaration), reason }));
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
  function freshIdentity(request: IRequestContext, step: IBindingDescriptor, declaration: IStepDeclaration<IFamily>): IExecutionIdentity {
    const requestKey = request.requestKey;
    if (requestKey === undefined) {
      throw new ResolutionError('invalid-request', 'A normal request needs a request key');
    }
    const identity: IExecutionIdentity = {
      ...versioned(declaration),
      attemptKey: attemptKey(host, requestKey, step),
      intentDigest: intentDigest({ host, validation, composition, environment, step, declaration, slots: request.slots }),
    };
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
      const refusal = await admit(request, evidence, step, 'source', declaration, eligible !== undefined ? 'source-policy' : candidates.length > 0 ? 'invalid' : 'cold');
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
        provenance: { kind: 'source', step, observations: ran.observations, children: [] },
        dependencies: [],
      }));
    } finally {
      invocation.close();
    }
  }

  /** Validate one memo candidate beneath current child policy. */
  async function evaluateMemoCandidate(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>, candidate: ICompletedEnvelope):
    Promise<
      | { readonly verdict: 'eligible'; readonly children: ReadonlyMap<string, ICompletedResultReference> }
      | { readonly verdict: 'miss'; readonly miss: ICandidateMiss }
      | { readonly verdict: 'stop'; readonly result: IStepResult }
    > {
    const reading = integrity(() => readProvenance(candidate));
    if (reading.status === 'unsupported') {
      return { verdict: 'miss', miss: miss(candidate.reference, 'unsupported-evidence', reading.detail) };
    }
    const { provenance } = reading;
    if (provenance.kind !== 'memo') {
      return { verdict: 'miss', miss: miss(candidate.reference, 'unsupported-evidence', 'provenance was recorded for a source') };
    }
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
    return { verdict: 'eligible', children: current };
  }

  /** Resolve one memo step under current policy. */
  async function resolveMemo(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>): Promise<IResolvedStep> {
    const evidence = newEvidence(request);
    const done = (result: IStepResult): IResolvedStep => ({ step, result, evidence });
    emit(request, evidence, step, 'verify');
    const candidates = integrity(() => history.findCandidates(versioned(declaration)));
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
      const children = [...evaluated.children].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
      return done(accept(request, evidence, step, 'validated', candidate.reference,
        { basis: 'validated', step, children: children.map(([slot, reference]) => ({ slot, reference })) },
        children.map(([, reference]) => reference)));
    }
    if (request.mode === 'check') {
      return done({ kind: 'execution-required' });
    }
    const bindings = authorBindings(request);
    const identity = freshIdentity(request, step, declaration);
    const refusal = await admit(request, evidence, step, 'memo', declaration, candidates.length > 0 ? 'invalid' : 'cold');
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
    const frame: IMemoFrame = { request, step, children: new Map(), refused: undefined, failed: undefined };
    frames.set(invocation, frame);
    let ran: IObservationCapture<IMemoReturn>;
    try {
      emit(request, evidence, step, 'execute');
      ran = await active.run(invocation, () => invocation.apply(Object.freeze({ inputs: bindings.inputs, helpers: bindings.helpers }), invoker((value): IMemoReturn => {
        try {
          return { data: tracking.snapshotOutput(value), detachError: undefined };
        } catch (error: unknown) {
          return { data: undefined, detachError: error };
        }
      })));
    } catch (error: unknown) {
      if (frame.refused !== undefined) {
        abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'child-refused', detail: frame.refused.reason });
        return done({ kind: 'refused', refused: frame.refused.step, reason: frame.refused.reason });
      }
      const cause = frame.failed?.error ?? error;
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: describe(cause) });
      if (cause instanceof ResolutionError && cause.code !== 'execution-failure') {
        throw cause;
      }
      throw new ResolutionError('execution-failure', `Body of ${stepKey(step)} failed: ${describe(cause)}`, cause);
    } finally {
      invocation.close();
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
    const children = [...frame.children.values()].sort((left, right) => left.slot < right.slot ? -1 : left.slot > right.slot ? 1 : 0);
    const dependencies: ICompletedResultReference[] = [];
    for (const child of children) {
      if (!dependencies.some((dependency) => dependency.locator === child.reference.locator)) {
        dependencies.push(child.reference);
      }
    }
    return done(publish(request, evidence, step, attemptId, {
      payload: ran.value.data,
      provenance: { kind: 'memo', step, observations: ran.observations, children },
      dependencies,
    }));
  }

  /**
   * Deliver one declared child call from an executing memo body: reconnect
   * its witness, resolve the child under current policy (sharing a result
   * already established in this request), record the direct-child evidence and
   * return a lazy view of the child's exact result bound to the child slot.
   */
  async function dispatchChild<TResult>(request: IDeclaredInvocationRequest<IFamily, TResult>): Promise<{ readonly data: unknown }> {
    const frame = frames.get(request.scope);
    if (frame === undefined) {
      throw new ResolutionError('invalid-request', 'A declared call arrived from an invocation Resolution is not executing');
    }
    if (request.kind !== 'source' || request.witness.version !== 1) {
      // This Resolution delivers only argument-free sibling source calls with
      // the version-1 witness; nested memo and supplied step slot calls are
      // refused before any child work rather than validated by guesswork.
      const error = new ResolutionError('unbound-step', `A ${request.kind} call with a version-${String(request.witness.version)} witness is not supported by this Resolution`);
      frame.failed ??= { error };
      throw error;
    }
    const reconnected = composition.resolveWitness(request.witness);
    if (reconnected.status !== 'bound' || reconnected.child.declaration !== request.child) {
      const error = new ResolutionError('unbound-step', 'A declared call does not reconnect to its current child declaration');
      frame.failed ??= { error };
      throw error;
    }
    const slot = request.witness.child.slot;
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
          version: request.witness.version,
          parent: { ...request.witness.parent },
          child: { ...request.witness.child },
          arguments: { form: request.witness.arguments.form },
        },
        reference,
        binding: Object.freeze({ path: bindingPaths.child(slot) }),
      }));
    }
    // Boxed: an async function's result is assimilated, so the view must never be it.
    return Object.freeze({ data: materialization.materializeView<object>(reference, { path: bindingPaths.child(slot) }) });
  }

  /** Resolve a requested step in a request context. */
  async function resolveStep(request: IRequestContext, step: IBindingDescriptor): Promise<IResolvedStep> {
    const target = stepTarget(step);
    return target.declaration.kind === 'source'
      ? resolveSourceShared(request, target.step, target.declaration)
      : resolveMemo(request, target.step, target.declaration);
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
