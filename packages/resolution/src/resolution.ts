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
 * or body (REUSE-009). Every admitted body and current-policy hook runs
 * through Run Supervision's cancellation port, and every publication commit
 * first asks it whether run cancellation forbids committing now (RUN-014/015):
 * an interrupted execution, or output a hard stop discards before its commit,
 * ends the attempt interrupted (ending `stopped`) and reports a cancellation,
 * never a failure or a partial result. Within one top-level request, every child invocation's
 * established current result (a source or memo step, or a supplied slot call
 * with its subject and arguments) is shared, so a child validated or executed
 * while its parent was being validated is reused when that parent then
 * executes, and no child runs twice. That sharing is request-local evidence,
 * never durable finality.
 *
 * A template instance (CMP-4, CMP-8, COL-1) is resolved within its current
 * population: the template's collection source is resolved under its current
 * policy once per request and its exact result keyed by Definition before any
 * gate or member body; a rejected snapshot admits no member work. Each
 * member's gate runs once per request in its own tracking frame over the
 * member's current record, whose facts are that instance's gate evidence and
 * enter no step's provenance; only an explicit `false` skips the instance. A
 * required instance resolves like any source or memo. Its callbacks receive
 * the member binding, a view of the member's current record whose reads are
 * the step's own evidence and are validated against the current record on
 * reuse; its forwarded member origins are rebuilt from that record. A members
 * request resolves every current member independently, so one member's
 * failure, refusal or skip never prevents a sibling whose evidence is ready
 * from completing (RUN-005).
 *
 * A strict fold (CMP-8, RUN-010) first settles its consumed template step for
 * every current member exactly as a members request does. Its readiness is
 * then decided in order: a failed or cancelled required member fails it at
 * once, naming failed, cancelled and pending keys and open discovery;
 * otherwise open discovery or a pending member leaves it waiting. Neither runs
 * its body, admits its work or publishes. A ready fold is validated or
 * executed over its membership-and-status fact (each current member, in
 * canonical key order, included with its accepted result or skipped by its
 * gate): a candidate is reused only when it consumed the same template step
 * (a renamed step or template, or a moved collection, is a correspondence
 * miss, never a remap), its recorded fact equals the current one and every
 * member fact it consumed is unchanged. The gate's raw
 * observations are the instance's evidence, never the fold's, so a threshold
 * edit that flips no outcome reruns nothing. A successful fold carries
 * framework coverage derived from that fact, never from its body. Nothing is
 * retracted when a member is skipped or deleted.
 *
 * An outcome (tolerant) fold (RUN-010) settles its consumed template step the
 * same way, but no member status fails it: each member settles as succeeded
 * (its accepted result), skipped, failed (a member-attributable typed
 * failure) or cancelled (work withdrawn from this run through admission),
 * while denied work leaves the member pending. While discovery is open (or
 * its work was denied) or any member is pending, the outcome fold waits with
 * the partial coverage settled so far: it never claims a complete set, runs
 * no body, admits no fold work and publishes nothing. A rejected or cancelled
 * discovery fails it, since no population can be established in this pass.
 * Once every member of a closed population has settled, it is validated or
 * executed exactly as a strict fold is, over a membership-and-status fact
 * that also records failed and cancelled members: repairing a failed member
 * changes that fact, so the fold reconsiders, while unaffected members are
 * reused. Its provenance is a version of its own, so neither fold contract
 * ever accepts the other's result. Neither kind of fold is ever a child, and
 * every fold or members request presents its members to Run Supervision's
 * window; Supervision refuses a run operation called from inside member work
 * as an undeclared call (CMP-9), so no fan-out nests under that window
 * (RUN-002's nested rule).
 */
import { DefinitionError, derivedArguments, gateOutcome } from '@microdelta/definition';
import type {
  IAnyFoldDeclaration,
  IAnyMemoDeclaration,
  IAnyOutcomeFoldDeclaration,
  IAnySourceDeclaration,
  IAnySuppliedStepDeclaration,
  IApply,
  IArgumentRecipe,
  IArgumentSupplier,
  IArgumentViews,
  IAuthorInvoker,
  IBindingDescriptor,
  IChildResult,
  ICollectionStatus,
  IDeclaredInvocationRequest,
  IFoldDeclaration,
  IFoldEntry,
  IFoldInvocation,
  IFoldMemberSupplier,
  IFoldTopology,
  IForwardOrigin,
  IGateSettlement,
  IInvocationArguments,
  IInvocationPort,
  IInvocationScope,
  IKeyingDiagnostic,
  IMemberOf,
  IMemberSupplier,
  IMemoInvocation,
  INestedInvocationWitness,
  IOutcomeEntry,
  IOutcomeFoldDeclaration,
  IOutcomeFoldInvocation,
  IOutcomeFoldMemberSupplier,
  IPreviousSupplier,
  IScopedSubject,
  ISourceDeclaration,
  ISourceInvocation,
  IStepDeclaration,
  ISuppliedInvocation,
  ISuppliedStepDeclaration,
  ITemplateTopology,
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
  ICompleteOutcomeFoldCoverage,
  IDiscoveryOutcome,
  IExecutionSupervision,
  IFoldCoverage,
  IFoldOutcome,
  IFoldRequest,
  IFoldResolution,
  IGateEvidence,
  IIncompleteOutcomeFoldCoverage,
  ILifecycleEvent,
  ILifecyclePhase,
  IMemberResolution,
  IMembersRequest,
  IMembersResolution,
  IOutcomeFoldOutcome,
  IOutcomeFoldResolution,
  IRecoverRequest,
  IRecoveryResult,
  IRefusalDisposition,
  IResolution,
  IResolutionOptions,
  IResolutionOutcome,
  IResolveRequest,
  IReuseBasis,
  IStepKind,
  ISupervisedExecution,
} from './contracts.js';
import {
  argumentList,
  callObservationIndex,
  entryObservationKey,
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
import type {
  ICallEvidence,
  IChildEvidence,
  IDirectProvenance,
  IFoldProvenance,
  IMembershipEntry,
  INestedProvenance,
  IOutcomeFoldProvenance,
  IOutcomeMembershipEntry,
  IProvenance,
} from './evidence.js';
import type { IResolutionFamily } from './family.js';
import { attemptKey, intentDigest, suppliedIntentDigest } from './intent.js';
import { mintedOutcome, sourceOutcome } from './outcome.js';
import type { IMintedOutcome } from './outcome.js';

/**
 * Resolution failures that belong to the run rather than to one template
 * member: the admission port or an observer failed, historical evidence is
 * damaged, or the request itself is wrong. A members request, like a strict
 * fold's member phase, rethrows them instead of reporting any member failed.
 */
const runLevelFailures: ReadonlySet<ResolutionError['code']> = new Set<ResolutionError['code']>(['admission-failure', 'observer-failure', 'integrity', 'wrong-intent', 'invalid-request']);

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
  | { readonly kind: 'refused'; readonly refused: IBindingDescriptor; readonly reason: string; readonly disposition: IRefusalDisposition }
  | { readonly kind: 'uncertain'; readonly boundary: IBindingDescriptor }
  | { readonly kind: 'execution-required' };

/** A resolved step with its evidence. */
interface IResolvedStep {
  readonly step: IBindingDescriptor;
  readonly result: IStepResult;
  readonly evidence: IStepEvidence;
}

/**
 * A requested step's resolution. A template instance its gate excludes is an
 * explicit skip rather than a work result; `gate` is the instance's gate
 * evidence, absent for steps outside templates and templates without a gate.
 */
interface IResolvedTarget {
  readonly step: IBindingDescriptor;
  readonly result: IStepResult | { readonly kind: 'skipped'; readonly gate: IGateEvidence };
  readonly evidence: IStepEvidence;
  readonly gate: IGateEvidence | undefined;
}

/**
 * One template's current population in one request: the collection result
 * keyed by Definition, Definition's rejection of it, or the collection step's
 * own result when discovery could not produce a current result (refused
 * work, or check-only uncertainty).
 */
type IPopulation =
  | {
      readonly status: 'keyed';
      readonly collection: IBindingDescriptor;
      readonly reference: ICompletedResultReference;
      readonly completion: ICollectionStatus;
      /** Member keys in canonical order. */
      readonly keys: readonly string[];
    }
  | { readonly status: 'rejected'; readonly collection: IBindingDescriptor; readonly reference: ICompletedResultReference; readonly diagnostic: IKeyingDiagnostic }
  | { readonly status: 'stopped'; readonly collection: IBindingDescriptor; readonly result: Extract<IStepResult, { readonly kind: 'refused' | 'uncertain' }> };

/**
 * One gate run in its own capture: what it returned with the facts it read,
 * that it returned a promise or other thenable (an asynchronous gate), or
 * what it threw.
 */
type IGateRun =
  | { readonly kind: 'returned'; readonly value: unknown; readonly observations: readonly ITrackingObservation[] }
  | { readonly kind: 'promise' }
  | { readonly kind: 'threw'; readonly error: unknown };

/** How one member's gate settled in one request. */
type IGateSettled =
  | { readonly status: 'settled'; readonly evidence: IGateEvidence | undefined }
  | { readonly status: 'failed'; readonly error: ResolutionError };

/** One current member's instance of a template step, settled in one request: its resolution, or its confined typed failure. */
interface ISettledMember {
  readonly key: string;
  readonly step: IBindingDescriptor;
  readonly resolved: IResolvedTarget | ResolutionError;
}

/**
 * A strict fold's readiness in one request (CMP-8 EXP-4 strict-fold
 * selection, supervisor resolution: fail fast). `failed` and `waiting` name
 * members in canonical key order; `ready` carries the current membership-and-
 * status fact, which is both what the body's entries are built from and what
 * the fold's evidence records and validates.
 */
type IFoldReadiness =
  | {
      readonly status: 'failed';
      readonly failed: readonly string[];
      readonly cancelled: readonly string[];
      readonly pending: readonly string[];
      readonly openDiscovery: boolean;
      readonly diagnostic: string;
    }
  | { readonly status: 'waiting'; readonly pending: readonly string[]; readonly openDiscovery: boolean }
  | { readonly status: 'ready'; readonly membership: readonly IMembershipEntry[] };

/**
 * Whether an outcome fold's set has settled in one request (RUN-010):
 * `failed` when no population can be established in this pass, `waiting`
 * with the partial coverage settled so far, or `ready` with the current
 * membership-and-status fact over every settled status (in canonical key
 * order), from which the body's entries are built and which the fold's
 * evidence records and validates, and its complete coverage.
 */
type IOutcomeReadiness =
  | { readonly status: 'failed'; readonly diagnostic: string }
  | { readonly status: 'waiting'; readonly coverage: IIncompleteOutcomeFoldCoverage }
  | { readonly status: 'ready'; readonly membership: readonly IOutcomeMembershipEntry[]; readonly coverage: ICompleteOutcomeFoldCoverage };

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
  /** Request-local current populations, by template slot: discovery is resolved and keyed once per request. */
  readonly populations: Map<string, Promise<IPopulation>>;
  /**
   * The member binding of every keyed member, by template slot and member
   * key: the member record exactly as the current collection result holds it.
   * Forwarded member origins and gates resolve against it.
   */
  readonly members: Map<string, ReadonlyMap<string, object>>;
  /** Request-local settled gates, by template slot and member key: each gate runs once per request. */
  readonly gates: Map<string, IGateSettled>;
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
   * whether the body returned, threw or was interrupted, so no child write
   * races the ending.
   *
   * The wait has no default deadline, but run cancellation bounds it (#106):
   * each child's own admission, body and nested waits run through Run
   * Supervision's ports, so once a hard stop or an operator deadline takes
   * effect every in-flight child ends promptly as interrupted, even one whose
   * author code never settles. The parent then ends honestly: cancelled when
   * it was itself interrupted, or with its own error when its body had
   * already thrown. It never publishes partial work. A soft stop does not
   * shorten the wait: admitted children drain.
   */
  readonly inflight: Set<Promise<unknown>>;
  /**
   * How many started calls were still unsettled at the moment the body's
   * returned value was taken; undefined until then. A result cannot be
   * published without the evidence of every call its body made.
   */
  unsettledAtReturn: number | undefined;
  refused: { readonly step: IBindingDescriptor; readonly reason: string; readonly disposition: IRefusalDisposition } | undefined;
  /** The first failed child resolution; a body that swallows it still cannot publish. */
  failed: { readonly error: unknown } | undefined;
}

/** One refused child, as a memo frame records it. */
type IFrameRefusal = NonNullable<IMemoFrame['refused']>;

/**
 * Record a refused child in its parent's frame. The first refusal is kept,
 * except that a cancellation dominates a denial: a cancelled child makes the
 * parent's own refusal a cancellation, whichever child was refused first, and
 * the cancelled child is then the recorded refused step.
 */
function recordRefusal(frame: IMemoFrame, refusal: IFrameRefusal): void {
  frame.refused = dominantRefusal(frame.refused, refusal);
}

/** The refusal that stands between a recorded one and a later one: the first, unless only the later is a cancellation. */
function dominantRefusal(recorded: IFrameRefusal | undefined, later: IFrameRefusal | undefined): IFrameRefusal | undefined {
  if (recorded === undefined) {
    return later;
  }
  return recorded.disposition === 'denied' && later?.disposition === 'cancelled' ? later : recorded;
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
 * a previous carrier, a supplied step's argument views and a strict fold's
 * entry views by declared types (the child's or consumed member step's result
 * type, or the slot's parameter types), which Resolution delivers by
 * construction: the view of that declaration's exact result, or views of the
 * arguments rebuilt for that very call. The static type cannot express those
 * relationships, so this single assertion states them.
 */
function trusted<T>(value: unknown): T {
  return value as T;
}

/**
 * The canonical request-local key of a step descriptor. A template instance
 * adds its template slot and collection binding, so it never shares a key
 * with an explicit member step of the same slot and key.
 */
function stepKey(step: IBindingDescriptor): string {
  const base = [step.scope, step.role, step.slot, step.memberKey ?? null];
  return JSON.stringify(step.template === undefined && step.collection === undefined ? base : [...base, step.template ?? null, step.collection ?? null]);
}

/** A template-bearing descriptor: a template step, or with a member key, one of its instances. */
function isTemplateStep(step: IBindingDescriptor): boolean {
  return step.template !== undefined || step.collection !== undefined;
}

/**
 * Whether a candidate's recorded step no longer corresponds to the current
 * step (CMP-4, COL-1). Candidates are found by subject, which a template
 * instance keeps when its template slot is renamed or its collection moves to
 * another slot; that is changed correspondence, never a remap. So whenever
 * either descriptor is template-bearing, every structural field must match.
 * Other steps keep their M3 meaning, where the subject is the correspondence.
 */
function changedCorrespondence(recorded: IBindingDescriptor, current: IBindingDescriptor): boolean {
  return (isTemplateStep(recorded) || isTemplateStep(current)) && stepKey(recorded) !== stepKey(current);
}

/** The miss of a candidate whose recorded step no longer corresponds to the current one. */
function correspondenceMiss(candidate: ICompletedResultReference, recorded: IBindingDescriptor, current: IBindingDescriptor): ICandidateMiss {
  return miss(candidate, 'correspondence', `provenance names ${stepKey(recorded)}, not the current ${stepKey(current)}`);
}

/**
 * The text of a failure the framework itself raised (History, or Definition
 * validating a caller's descriptor), for a message, a diagnostic or a stored
 * ending. Never applied to a value that author or caller code threw or
 * produced (bodies, source checks, finality hooks, gates, admission,
 * lifecycle observers) or to a failure detaching an author's returned data:
 * those failures name the step and the failure kind only, and keep the
 * thrown value as the failure's `cause` (RUN-013: diagnostics name fields
 * and keys, not their contents).
 */
function frameworkDetail(error: unknown): string {
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

/**
 * A strict fold's consumed member facts compared unequal. A changed fact, or
 * a current member result whose shape no longer answers the consumed path, is
 * changed member output; unavailable or ambiguous facts keep their kinds.
 */
function memberOutputMiss(candidate: ICompletedResultReference, comparison: Exclude<ICurrentComparison, { readonly kind: 'equal' }>): ICandidateMiss {
  if (comparison.kind === 'changed' || comparison.kind === 'incompatible') {
    return Object.freeze({
      candidate,
      reason: 'changed-member-output',
      observation: comparison.observation,
      detail: `member ${comparison.observation.binding.path[1] ?? ''} output changed at ${describeAddress(comparison.observation)}`,
    });
  }
  return missFrom(candidate, comparison);
}

/**
 * How a fold's recorded membership-and-status fact differs from the current
 * one, or undefined when they are equal. Both are in canonical key order, so
 * equal keys and statuses mean an equal fact. A strict fold's fact holds only
 * included and skipped members; an outcome fold's also failed and cancelled.
 */
function membershipChange(recorded: readonly IOutcomeMembershipEntry[], current: readonly IOutcomeMembershipEntry[]): string | undefined {
  const before = new Map(recorded.map((entry) => [entry.key, entry.status]));
  const now = new Map(current.map((entry) => [entry.key, entry.status]));
  const changes: string[] = [];
  for (const [key, status] of now) {
    const was = before.get(key);
    if (was === undefined) {
      changes.push(`${key} is a new ${status} member`);
    } else if (was !== status) {
      changes.push(`${key} was ${was}, now ${status}`);
    }
  }
  for (const key of before.keys()) {
    if (!now.has(key)) {
      changes.push(`${key} is no longer a member`);
    }
  }
  return changes.length === 0 ? undefined : `membership changed: ${changes.join('; ')}`;
}

/** The framework's coverage of a ready fold's membership-and-status fact (always over closed discovery). */
function coverageOf(membership: readonly IMembershipEntry[]): IFoldCoverage {
  return Object.freeze({
    required: Object.freeze(membership.flatMap((entry) => entry.status === 'included' ? [entry.key] : [])),
    skipped: Object.freeze(membership.flatMap((entry) => entry.status === 'skipped' ? [entry.key] : [])),
    closed: true,
  });
}

/** The member keys of each status, in the canonical key order of the settled members. */
function statusLists(membership: readonly IOutcomeMembershipEntry[]): Pick<ICompleteOutcomeFoldCoverage, 'succeeded' | 'skipped' | 'failed' | 'cancelled'> {
  const keysOf = (status: IOutcomeMembershipEntry['status']): readonly string[] => Object.freeze(membership.flatMap((entry) => entry.status === status ? [entry.key] : []));
  return { succeeded: keysOf('included'), skipped: keysOf('skipped'), failed: keysOf('failed'), cancelled: keysOf('cancelled') };
}

/** The framework's coverage of an outcome fold whose closed population has completely settled. */
function completeCoverage(membership: readonly IOutcomeMembershipEntry[]): ICompleteOutcomeFoldCoverage {
  return Object.freeze({ ...statusLists(membership), pending: Object.freeze([] as const), openDiscovery: false, complete: true });
}

/** The framework's partial coverage of an outcome fold whose set has not settled. */
function incompleteCoverage(membership: readonly IOutcomeMembershipEntry[], pending: readonly string[], openDiscovery: boolean): IIncompleteOutcomeFoldCoverage {
  return Object.freeze({ ...statusLists(membership), pending: Object.freeze([...pending]), openDiscovery, complete: false });
}

/** A readable structured address of an observation, for diagnostics only. */
function describeAddress(observation: ITrackingObservation): string {
  const path = observation.address.map((segment) => segment.kind === 'property' ? segment.key : `[${String(segment.index)}]`).join('.');
  return `${observation.kind} ${path.length === 0 ? '(root)' : path}`;
}

/** A readable kind of recorded provenance, for diagnostics only. */
function describeKind(kind: IProvenance['kind']): string {
  switch (kind) {
    case 'source':
    case 'memo':
      return kind;
    case 'supplied':
      return 'supplied step';
    case 'fold':
      return 'strict fold';
    case 'outcome-fold':
      return 'outcome fold';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
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

/** Run author work to its own end, reporting how it settled; nothing interrupts it. */
async function executeUnsupervised<T>(step: IBindingDescriptor, work: () => Promise<T>): Promise<ISupervisedExecution<T>> {
  void step;
  try {
    return { kind: 'returned', value: await work() };
  } catch (error: unknown) {
    return { kind: 'threw', error };
  }
}

/**
 * Execution without Run Supervision, for one Resolution: author work runs to
 * its own end, nothing interrupts it, every commit may proceed, and fan-out
 * members resolve one at a time, in the order they are presented.
 */
function unsupervised(): IExecutionSupervision {
  /** The previous member's settlement; the next member starts after it. */
  let tail: Promise<unknown> = Promise.resolve();
  return Object.freeze({
    execute: executeUnsupervised,
    member<T>(work: () => Promise<T>): Promise<T> {
      const next = tail.then(work);
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
    publicationRefusal: (): string | undefined => undefined,
  });
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
  /** Run Supervision's cancellation port and window, or unsupervised execution where nothing can interrupt work. */
  const supervision: IExecutionSupervision = options.execution ?? unsupervised();
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

  /**
   * Whether a candidate's recorded dependency is historical evidence of this
   * analysis. It is read only for exact integrity, never accepted or reused:
   * validation resolves the current dependency afresh in this run's
   * environment under its own eligibility and admission, and compares only
   * the facts the candidate consumed. A candidate admitted here by a recorded
   * promotion keeps its original provenance, so its dependencies may name its
   * publishing environment (a trial), and a candidate published here may
   * depend on a result a promotion admitted here. History verified at staging
   * that every recorded dependency was admissible in the candidate's
   * environment, so the environment is not rechecked; another analysis is
   * integrity damage (RUN-017, RES-007).
   */
  function historicalInScope(historical: ICompletedEnvelope): boolean {
    return historical.analysis === analysis;
  }

  /** The scoped subject and compatibility group of a declaration. */
  function versioned(declaration: IStepDeclaration<IFamily>): IVersionedSubject {
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
   * Reconnect a requested step to its unique current declaration of any
   * kind: an explicit member or composition-level step, a template instance
   * (its template step descriptor plus a member key), or a strict or outcome
   * fold.
   * Definition reads the caller's descriptor through own data properties
   * only, so a malformed or accessor-bearing descriptor is an invalid request
   * and no accessor runs.
   */
  function anyStepTarget(step: IBindingDescriptor): { readonly step: IBindingDescriptor; readonly declaration: IStepDeclaration<IFamily> } {
    let resolution: ReturnType<typeof composition.resolve>;
    try {
      resolution = composition.resolve(step);
    } catch (error: unknown) {
      throw new ResolutionError('invalid-request', `Malformed step descriptor: ${frameworkDetail(error)}`, error);
    }
    if (resolution.status !== 'bound' || resolution.target.role !== 'step') {
      throw new ResolutionError('unbound-step', `Step ${stepKey(resolution.descriptor)} has no unique current declaration (${resolution.status})`);
    }
    return { step: resolution.descriptor, declaration: resolution.target.declaration };
  }

  /**
   * Reconnect a requested step to its unique current source or memo
   * declaration, as {@link anyStepTarget} does. A strict or outcome fold is
   * refused with `invalid-request` before any evidence, candidate lookup or
   * admission: its readiness, waiting and coverage are resolved only by
   * `resolveFold` or `resolveOutcomeFold`, whose outcomes can express them.
   */
  function stepTarget(step: IBindingDescriptor): { readonly step: IBindingDescriptor; readonly declaration: IAnySourceDeclaration<IFamily> | IAnyMemoDeclaration<IFamily> } {
    const target = anyStepTarget(step);
    const declaration = target.declaration;
    if (declaration.kind === 'fold') {
      throw new ResolutionError('invalid-request', `Step ${stepKey(target.step)} is a strict fold; resolve it with resolveFold, whose waiting, failed and coverage outcomes a step outcome cannot express`);
    }
    if (declaration.kind === 'outcome-fold') {
      throw new ResolutionError('invalid-request', `Step ${stepKey(target.step)} is an outcome fold; resolve it with resolveOutcomeFold, whose waiting and coverage outcomes a step outcome cannot express`);
    }
    return { step: target.step, declaration };
  }

  /** A new request context with its declared slots reconnected once. */
  function newRequest(mode: 'normal' | 'check', requestKey: string | undefined, lease: IWriterLease | undefined): IRequestContext {
    return {
      mode,
      requestKey,
      lease,
      slots: reconnectSlots(composition, bindingSlots),
      sources: new Map(),
      memos: new Map(),
      supplied: new Map(),
      populations: new Map(),
      members: new Map(),
      gates: new Map(),
      diagnostics: [],
    };
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
        throw new ResolutionError('observer-failure', `Lifecycle observer failed at ${phase} for ${stepKey(step)}`, error);
      }
      evidence.diagnostics.push(`Lifecycle observer failed at ${phase} for ${stepKey(step)} after commit`);
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
      carrier: <TResult>(declaration: ISourceDeclaration<IFamily, TResult, never>): IApply<IFamily['previous'], TResult> => {
        void declaration;
        return trusted<IApply<IFamily['previous'], TResult>>(carrier);
      },
    });
    const member = memberBindingOf(request, invocation.parent);
    return active.run(invocation, () => {
      if (which === 'finality') {
        if (supplier === undefined) {
          throw new ResolutionError('invalid-request', 'Finality needs an eligible previous result');
        }
        return invocation.applyFinality(bindings, supplier, invoker(finish), member);
      }
      return invocation.apply(bindings, supplier, invoker(finish), member);
    });
  }

  /** Compare observations with current facts through Tracking. */
  function compare(observations: readonly ITrackingObservation[], provider: ICurrentFactProvider): ICurrentComparison {
    return integrity(() => tracking.compareCurrent({ value: undefined, observations }, provider));
  }

  /**
   * Ask Run Supervision's admission port for work. Returns undefined when the
   * work is admitted; a denial or a cancellation is recorded as a refusal and
   * returned with the decision's reason and kind unchanged.
   */
  async function admit(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, kind: IStepKind, subject: IVersionedSubject, reason: IAdmissionRequest['reason']): Promise<{ readonly reason: string; readonly disposition: IRefusalDisposition } | undefined> {
    emit(request, evidence, step, 'admit');
    let decision: unknown;
    try {
      decision = await admission.admit(Object.freeze({ step, kind, subject, reason }));
    } catch (error: unknown) {
      throw new ResolutionError('admission-failure', `Admission failed for ${stepKey(step)}`, error);
    }
    const decided: unknown = typeof decision === 'object' && decision !== null ? Reflect.get(decision, 'kind') : undefined;
    if (decided === 'admitted') {
      return undefined;
    }
    const deniedReason: unknown = typeof decision === 'object' && decision !== null ? Reflect.get(decision, 'reason') : undefined;
    if ((decided !== 'denied' && decided !== 'cancelled') || typeof deniedReason !== 'string') {
      throw new ResolutionError('admission-failure', `Admission returned no valid decision for ${stepKey(step)}`);
    }
    emit(request, evidence, step, 'refuse');
    return { reason: deniedReason, disposition: decided };
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
      evidence.diagnostics.push(`Attempt ${String(attemptId)} of ${stepKey(step)} could not be ended: ${frameworkDetail(error)}`);
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
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'observer-failure', detail: 'a lifecycle observer threw at claim' });
      throw error;
    }
    return attemptId;
  }

  /**
   * End an admitted attempt that run cancellation interrupted, or whose output
   * it discarded before the commit: the attempt ends interrupted with a
   * `stopped` ending, and the step reports a cancellation refusal of its own
   * work, never a failure and never a partial result (RUN-014/015).
   */
  function interrupt(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, attemptId: number, reason: string): IStepResult {
    abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'stopped', detail: reason });
    return { kind: 'refused', refused: step, reason, disposition: 'cancelled' };
  }

  /**
   * End an admitted attempt whose body met an unsettled external operation
   * (deferred until a later time, or with an unknown outcome): the attempt
   * ends interrupted with an `unsettled` ending, and the step reports a
   * denial of its own work, so it stays pending and a strict consumer waits.
   * It is never a failure, a cancellation or a partial result (RUN-011/012/015).
   */
  function withhold(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, attemptId: number, reason: string): IStepResult {
    abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'unsettled', detail: reason });
    return { kind: 'refused', refused: step, reason, disposition: 'denied' };
  }

  /**
   * Stage and publish new content in History's one publication commit. Run
   * cancellation is consulted first, in the same synchronous turn as the
   * commit, so the commit is the linearization point: a hard stop effective
   * before it discards the output; one after it cannot undo it. History's
   * commit itself re-reads the lease durably, so a drain that outlived its
   * lease cannot publish either (EXP-8 ruling R).
   */
  function publish(request: IRequestContext, evidence: IStepEvidence, step: IBindingDescriptor, attemptId: number, content: {
    readonly payload: unknown;
    readonly provenance: Parameters<typeof provenanceRecord>[0];
    readonly dependencies: readonly ICompletedResultReference[];
  }): IStepResult {
    const lease = leaseOf(request);
    const refusal = supervision.publicationRefusal();
    if (refusal !== undefined) {
      return interrupt(request, evidence, step, attemptId, refusal);
    }
    if (!isContainer(content.payload)) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'result root is not a record or array' });
      throw new ResolutionError('unsupported-result', `Step ${stepKey(step)} produced a result without a record or array root`);
    }
    try {
      history.stageAttempt(lease, { attemptId, payload: content.payload, provenance: provenanceRecord(content.provenance), dependencies: content.dependencies });
    } catch (error: unknown) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: frameworkDetail(error) });
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
    const acceptance = integrity(() => history.recordAcceptance(leaseOf(request), { reference, evidence: acceptanceRecord(record), dependencies, environment }));
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
        evidence.misses.push(miss(candidate.reference, 'unsupported-evidence', `provenance was recorded for a ${describeKind(reading.provenance.kind)}`));
        continue;
      }
      if (changedCorrespondence(reading.provenance.step, step)) {
        evidence.misses.push(correspondenceMiss(candidate.reference, reading.provenance.step, step));
        continue;
      }
      // The previous result a check read is its history, not a current input.
      const own = reading.provenance.observations.filter((item) => !isPreviousObservation(item.binding));
      const comparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run, member: memberRecord(request, step) }));
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
        // A check-only request starts no work, so its policy evaluation is not supervised.
        const run = (): ReturnType<typeof callSource<unknown>> => callSource(request, invocation, 'finality', carrier, (value) => value);
        const evaluated = await (request.mode === 'check' ? executeUnsupervised(step, run) : supervision.execute(step, run));
        if (evaluated.kind === 'interrupted' || evaluated.kind === 'unsettled') {
          // A policy hook claims no attempt; an unsettled operation there leaves the step pending.
          return done({ kind: 'refused', refused: step, reason: evaluated.reason, disposition: evaluated.kind === 'interrupted' ? 'cancelled' : 'denied' });
        }
        if (evaluated.kind === 'threw') {
          throw new ResolutionError('policy-failure', `Current finality of ${stepKey(step)} threw`, evaluated.error);
        }
        const decided = evaluated.value;
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
        return done({ kind: 'refused', refused: step, reason: refusal.reason, disposition: refusal.disposition });
      }
      const attemptId = claim(request, evidence, step, identity);
      let executed: ISupervisedExecution<IObservationCapture<ISourceReturn>>;
      try {
        emit(request, evidence, step, 'execute');
        executed = await supervision.execute(step, () => callSource(request, invocation, 'run', carrier, (value): ISourceReturn => {
          const minted = mintedOutcome(value);
          if (minted?.kind !== 'fresh') {
            return { minted, data: undefined, detachError: undefined };
          }
          try {
            return { minted, data: tracking.snapshotOutput(minted.data), detachError: undefined };
          } catch (error: unknown) {
            return { minted, data: undefined, detachError: error };
          }
        }), { subject: versioned(declaration), attemptId });
      } catch (error: unknown) {
        executed = { kind: 'threw', error };
      }
      if (executed.kind === 'interrupted') {
        return done(interrupt(request, evidence, step, attemptId, executed.reason));
      }
      if (executed.kind === 'unsettled') {
        return done(withhold(request, evidence, step, attemptId, executed.reason));
      }
      if (executed.kind === 'threw') {
        const error = executed.error;
        abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'the source check threw' });
        if (error instanceof ResolutionError) {
          throw error;
        }
        throw new ResolutionError('execution-failure', `Source check of ${stepKey(step)} threw`, error);
      }
      const ran = executed.value;
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
        // An explicit retention is this check's output: a hard stop effective before its commit discards it too.
        const stopped = supervision.publicationRefusal();
        if (stopped !== undefined) {
          return done(interrupt(request, evidence, step, attemptId, stopped));
        }
        let result: IStepResult;
        try {
          result = accept(request, evidence, step, 'check', eligible.reference, { basis: 'check', step, observations: ran.observations }, []);
        } catch (error: unknown) {
          abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: frameworkDetail(error) });
          throw error;
        }
        // The admitted claim produced no new result: end it with the retention as its evidence.
        if (abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'retained', detail: 'the source check explicitly retained its eligible previous result', reference: eligible.reference })) {
          emit(request, evidence, step, 'release', eligible.reference);
        }
        return done(result);
      }
      if (ran.value.detachError !== undefined) {
        abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'the source check returned unsupported fresh data' });
        throw new ResolutionError('unsupported-result', `Source ${stepKey(step)} returned unsupported fresh data`, ran.value.detachError);
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
      return { verdict: 'miss', miss: miss(candidate.reference, 'unsupported-evidence', `provenance was recorded for a ${describeKind(provenance.kind)}`) };
    }
    if (changedCorrespondence(provenance.step, step)) {
      return { verdict: 'miss', miss: correspondenceMiss(candidate.reference, provenance.step, step) };
    }
    if (provenance.version === 2) {
      return evaluateNestedCandidate(request, step, declaration, candidate, provenance);
    }
    return evaluateDirectCandidate(request, step, declaration, candidate, provenance);
  }

  /** Validate a version-1 memo candidate with its M3 meaning, unchanged. */
  async function evaluateDirectCandidate(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>, candidate: ICompletedEnvelope, provenance: IDirectProvenance): Promise<IMemoVerdict> {
    const own = provenance.observations.filter((item) => !isChildObservation(item.binding));
    const ownComparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run, member: memberRecord(request, step) }));
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
      if (!historicalInScope(historical)) {
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
    const ownComparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run, member: memberRecord(request, step) }));
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
      if (!historicalInScope(historical)) {
        throw new ResolutionError('integrity', `Recorded ${label} of ${candidate.reference.locator} is outside this History scope`);
      }
      const rebuilt = rebuildArguments(request, step, call.index, witness.arguments, outputs, true);
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
  function unboundMiss(request: IRequestContext, step: IBindingDescriptor, declaration: IAnyMemoDeclaration<IFamily>, candidate: ICompletedEnvelope, occupancy: { readonly reason: 'missing-binding' | 'ambiguous-binding'; readonly error: ResolutionError }): ICandidateMiss {
    const reading = integrity(() => readProvenance(candidate));
    if (reading.status === 'unsupported') {
      return miss(candidate.reference, 'unsupported-evidence', reading.detail);
    }
    const { provenance } = reading;
    if (provenance.kind !== 'memo') {
      return miss(candidate.reference, 'unsupported-evidence', `provenance was recorded for a ${describeKind(provenance.kind)}`);
    }
    if (changedCorrespondence(provenance.step, step)) {
      return correspondenceMiss(candidate.reference, provenance.step, step);
    }
    const own = provenance.version === 2
      ? provenance.observations.filter((item) => callObservationIndex(item.binding) === undefined)
      : provenance.observations.filter((item) => !isChildObservation(item.binding));
    const ownComparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run, member: memberRecord(request, step) }));
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
   * origin is resolved from current bindings (an input path, the calling
   * template instance's current member binding, or the current output of an
   * earlier call of the same invocation); a stored value is never
   * substituted. When validating, a derived value or forwarded path is used
   * only if recorded as justified, and an unreconstructible argument is an
   * immediate miss. When executing, the parent is making the call itself, so
   * every recipe stands.
   */
  function rebuildArguments(request: IRequestContext, step: IBindingDescriptor, index: number, recipes: IInvocationArguments, outputs: ReadonlyMap<number, ICompletedResultReference>, validating: boolean): IRebuiltArguments {
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
          const found = forwardedValue(request, step, recipe.origin, outputs);
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
   * The current value at a forwarded origin of a call made by `step`, read
   * through the validation observer so nothing is recorded into an author
   * capture. A container is detached as supported data for the called step's
   * argument view. A member origin resolves against the member record the
   * current keyed collection holds for `step`'s member key.
   */
  function forwardedValue(request: IRequestContext, step: IBindingDescriptor, origin: IForwardOrigin, outputs: ReadonlyMap<number, ICompletedResultReference>): IForwardedValue {
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
      case 'member': {
        const record = memberRecord(request, step);
        if (record === undefined) {
          return { status: 'unavailable', detail: 'has no current member binding' };
        }
        root = validation.tracked(record, { path: bindingPaths.member });
        break;
      }
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
        evidence.misses.push(miss(candidate.reference, 'unsupported-evidence', `provenance was recorded for a ${describeKind(reading.provenance.kind)}`));
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
      return done({ kind: 'refused', refused: step, reason: refusal.reason, disposition: refusal.disposition });
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
    let executed: ISupervisedExecution<IObservationCapture<IMemoReturn>>;
    try {
      emit(request, evidence, step, 'execute');
      executed = await supervision.execute(step, () => active.run(invocation, () => invocation.apply(bindings, supplier, invoker(detachComputation, arm))), { subject, attemptId });
    } catch (error: unknown) {
      executed = { kind: 'threw', error };
    } finally {
      invocation.close();
    }
    if (executed.kind === 'interrupted') {
      return done(interrupt(request, evidence, step, attemptId, executed.reason));
    }
    if (executed.kind === 'unsettled') {
      return done(withhold(request, evidence, step, attemptId, executed.reason));
    }
    if (executed.kind === 'threw') {
      const error = executed.error;
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'the supplied step threw' });
      if (error instanceof ResolutionError) {
        throw error;
      }
      throw new ResolutionError('execution-failure', `Supplied step ${describeSlot(step)} for ${subject.subject} threw`, error);
    }
    const ran = executed.value;
    if (ran.value.detachError !== undefined) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'the supplied step returned unsupported data' });
      throw new ResolutionError('unsupported-result', `Supplied step ${describeSlot(step)} returned unsupported data`, ran.value.detachError);
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
        evidence.misses.push(unboundMiss(request, step, declaration, candidate, occupancy));
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
      return done({ kind: 'refused', refused: step, reason: refusal.reason, disposition: refusal.disposition });
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
    let executed: ISupervisedExecution<IObservationCapture<IMemoReturn>>;
    try {
      emit(request, evidence, step, 'execute');
      executed = await supervision.execute(step, () => active.run(invocation, () => invocation.apply(bindings, invoker((value): IMemoReturn => {
        // Taken inside the capture, as the body's value is: which started calls it left unsettled.
        frame.unsettledAtReturn = frame.inflight.size;
        return detachComputation(value);
      }), memberBindingOf(request, step))), { subject: versioned(declaration), attemptId });
    } catch (error: unknown) {
      executed = { kind: 'threw', error };
    } finally {
      // The body's execution has ended (or was interrupted): it starts no new call; calls it started continue.
      invocation.close();
    }
    if (executed.kind === 'interrupted') {
      // Calls the body started end under the same run cancellation before this attempt does (see IMemoFrame.inflight).
      await Promise.allSettled([...frame.inflight]);
      return done(interrupt(request, evidence, step, attemptId, executed.reason));
    }
    if (executed.kind === 'unsettled') {
      // Calls the body started still settle under their own lifecycle before this attempt ends.
      await Promise.allSettled([...frame.inflight]);
      return done(withhold(request, evidence, step, attemptId, executed.reason));
    }
    if (executed.kind === 'threw') {
      const error = executed.error;
      // What the body failed with is decided now: a call that fails or is
      // refused while the in-flight calls settle below must not replace it.
      const refused = frame.refused;
      const failed = frame.failed;
      // Let calls the body started finish their own lifecycle before this attempt
      // ends (bounded by run cancellation; see IMemoFrame.inflight).
      await Promise.allSettled([...frame.inflight]);
      // A refusal the body failed with stands; only a cancellation settling meanwhile upgrades a denial.
      const refusal = refused === undefined ? undefined : dominantRefusal(refused, frame.refused);
      if (refusal !== undefined) {
        abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'child-refused', detail: refusal.reason });
        return done({ kind: 'refused', refused: refusal.step, reason: refusal.reason, disposition: refusal.disposition });
      }
      const cause = failed?.error ?? error;
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'the body failed' });
      if (cause instanceof ResolutionError && cause.code !== 'execution-failure') {
        throw cause;
      }
      throw new ResolutionError('execution-failure', `Body of ${stepKey(step)} failed`, cause);
    }
    const ran = executed.value;
    const unsettled = frame.unsettledAtReturn ?? 0;
    // Every started call settles before the attempt ends (bounded by run cancellation; see IMemoFrame.inflight).
    await Promise.allSettled([...frame.inflight]);
    if (unsettled > 0) {
      // Its evidence would lack a call the body made: never publish such a result.
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: `${String(unsettled)} declared call(s) had not settled when the body returned` });
      throw new ResolutionError('execution-failure', `Body of ${stepKey(step)} returned while ${String(unsettled)} declared call(s) it made had not settled`);
    }
    if (frame.refused !== undefined) {
      // A body that swallowed a refused child cannot publish a result missing that child.
      abandon(request, evidence, step, attemptId, 'interrupted', { ending: 'child-refused', detail: frame.refused.reason });
      return done({ kind: 'refused', refused: frame.refused.step, reason: frame.refused.reason, disposition: frame.refused.disposition });
    }
    if (frame.failed !== undefined) {
      // A body that swallowed a failed child cannot publish a result missing that child's current evidence.
      const cause = frame.failed.error;
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'a declared call failed' });
      throw cause instanceof ResolutionError ? cause : new ResolutionError('execution-failure', `A child of ${stepKey(step)} failed`, cause);
    }
    if (ran.value.detachError !== undefined) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'the body returned unsupported data' });
      throw new ResolutionError('unsupported-result', `Body of ${stepKey(step)} returned unsupported data`, ran.value.detachError);
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
      recordRefusal(frame, resolved.result.kind === 'refused'
        ? { step: resolved.result.refused, reason, disposition: resolved.result.disposition }
        : { step: childStep, reason, disposition: 'denied' });
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
          const rebuilt = rebuildArguments(frame.request, frame.step, witness.index, witness.arguments, outputs, false);
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
      recordRefusal(frame, resolved.result.kind === 'refused'
        ? { step: resolved.result.refused, reason, disposition: resolved.result.disposition }
        : { step: resolved.step, reason, disposition: 'denied' });
      throw new ResolutionError('execution-failure', `Call ${String(witness.index)} of ${stepKey(frame.step)} was refused: ${reason}`);
    }
    const reference = resolved.result.reference;
    const binding = Object.freeze({ path: bindingPaths.call(witness.index) });
    frame.calls.set(witness.index, Object.freeze({ index: witness.index, witness: plainWitness(witness), reference, binding }));
    // Boxed: an async function's result is assimilated, so the view must never be it.
    return Object.freeze({ data: materialization.materializeView<object>(reference, binding) });
  }

  /**
   * The member supplier over one member record: each view it gives is a fresh
   * tracked view of the record at the `member` binding, in whichever capture
   * is active, so a gate's or a step's reads of it are that callback's own
   * observations. Definition asks it for the instance's template collection,
   * whose member type the record is by keying; the family view type cannot
   * express that relationship, so `trusted` states it.
   */
  function memberSupplier(record: object): IMemberSupplier<IFamily> {
    return Object.freeze({
      view: <TCollection extends IAnySourceDeclaration<IFamily>>(collection: TCollection, addressed: IBindingDescriptor): IApply<IFamily['views'], IMemberOf<IFamily, TCollection>> => {
        void collection;
        void addressed;
        return trusted<IApply<IFamily['views'], IMemberOf<IFamily, TCollection>>>(tracking.tracked(record, { path: bindingPaths.member }));
      },
    });
  }

  /**
   * The member binding a step invocation is applied with: for a template
   * instance, a supplier over its member's current record; for any other step,
   * none. An instance whose member this request has not keyed gets none, and
   * Definition then refuses to apply it.
   */
  function memberBindingOf(request: IRequestContext, step: IBindingDescriptor): IMemberSupplier<IFamily> | undefined {
    const record = memberRecord(request, step);
    return record === undefined ? undefined : memberSupplier(record);
  }

  /**
   * The member record the current keyed collection holds for a template
   * instance's member key, or undefined for a step outside a template or a
   * member this request has not keyed.
   */
  function memberRecord(request: IRequestContext, step: IBindingDescriptor): object | undefined {
    return step.template === undefined || step.memberKey === undefined ? undefined : request.members.get(step.template)?.get(step.memberKey);
  }

  /** A template's current population, established once per request. */
  function populationOf(request: IRequestContext, template: string): Promise<IPopulation> {
    const existing = request.populations.get(template);
    if (existing !== undefined) {
      return existing;
    }
    const pending = discover(request, template);
    request.populations.set(template, pending);
    return pending;
  }

  /**
   * Discovery (CMP-4, COL-1, RUN-005): resolve the template's collection step
   * under its current source policy, then key its exact current result through
   * Definition before any gate or member body. Keying is all-or-nothing: a
   * rejected snapshot keys no member. A keyed snapshot's member records become
   * this request's member bindings. Open discovery still keys its members, and
   * their work proceeds.
   */
  async function discover(request: IRequestContext, template: string): Promise<IPopulation> {
    const topology = composition.topology.templates.find((entry) => entry.slot === template);
    if (topology === undefined) {
      throw new ResolutionError('unbound-step', `Template ${template} is not declared in the current composition`);
    }
    const collection = topology.collection;
    const target = stepTarget(collection);
    if (target.declaration.kind !== 'source') {
      throw new ResolutionError('unbound-step', `The collection of template ${template} is not a source`);
    }
    const resolved = await resolveSourceShared(request, target.step, target.declaration);
    const result = resolved.result;
    switch (result.kind) {
      case 'reused':
      case 'published':
        break;
      case 'refused':
      case 'uncertain':
        return { status: 'stopped', collection, result };
      case 'execution-required':
        return { status: 'stopped', collection, result: { kind: 'uncertain', boundary: collection } };
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
    const snapshot: unknown = integrity(() => history.reader.readSubtree(result.reference, []));
    const keyed = composition.keyMembers(template, snapshot);
    if (keyed.status === 'rejected') {
      return { status: 'rejected', collection, reference: result.reference, diagnostic: keyed.diagnostic };
    }
    const records = new Map<string, object>();
    for (const member of keyed.members) {
      // Keying admits only record members, so every keyed member is an object.
      if (typeof member.member === 'object' && member.member !== null) {
        records.set(member.key, member.member);
      }
    }
    request.members.set(template, records);
    return { status: 'keyed', collection, reference: result.reference, completion: keyed.completion, keys: Object.freeze(keyed.members.map((member) => member.key)) };
  }

  /**
   * Evaluate one member's gate once per request (CMP-8, EXP-4 gate selection).
   * The gate runs in its own tracking frame over the declared inputs and
   * helpers and a view of the member's current record at the `member`
   * binding; its observations are that instance's gate evidence and enter no
   * step's provenance. Only an explicit `true` requires the instance and only
   * an explicit `false` skips it; a non-boolean result (a promise included)
   * or a throw is a gate failure, never a skip.
   */
  function settleGate(request: IRequestContext, instance: IBindingDescriptor, template: string, key: string, record: object): IGateSettled {
    const cacheKey = JSON.stringify([template, key]);
    const existing = request.gates.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }
    const settled = evaluateGate(request, instance, template, key, record);
    request.gates.set(cacheKey, settled);
    return settled;
  }

  /** Run one gate and classify how it settled. */
  function evaluateGate(request: IRequestContext, instance: IBindingDescriptor, template: string, key: string, record: object): IGateSettled {
    const gate = options.declarations.gateOf(composition, instance);
    if (gate === undefined) {
      return { status: 'settled', evidence: undefined };
    }
    const ran = gate.apply(authorBindings(request), memberSupplier(record), gateInvoker);
    if (ran.kind === 'promise') {
      return {
        status: 'failed',
        error: new ResolutionError('gate-failure', `The gate of template ${template} for member ${key} returned a promise, not a boolean; a gate is a synchronous predicate and only an explicit false skips an instance`),
      };
    }
    const settlement: IGateSettlement = ran.kind === 'returned' ? { kind: 'returned', value: ran.value } : { kind: 'threw', error: ran.error };
    const outcome = gateOutcome(settlement);
    switch (outcome.status) {
      case 'required':
      case 'skipped':
        return {
          status: 'settled',
          evidence: Object.freeze({ selected: outcome.status, observations: Object.freeze([...(ran.kind === 'returned' ? ran.observations : [])]) }),
        };
      case 'failed':
        return {
          status: 'failed',
          error: outcome.reason === 'threw'
            ? new ResolutionError('gate-failure', `The gate of template ${template} for member ${key} threw`, outcome.error)
            : new ResolutionError('gate-failure', `The gate of template ${template} for member ${key} returned ${outcome.received}, not a boolean; only an explicit false skips an instance`),
        };
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }

  /**
   * The gate's invoker: track the author's gate as its own implementation and
   * run it synchronously in a fresh capture, so its reads form a frame of
   * their own. The gate's value is boxed inside the capture, so the capture
   * never mistakes an asynchronous gate for an asynchronous capture; a
   * promise or other thenable is then reported as such. A throw is settled
   * here, as the gate's own outcome.
   */
  const gateInvoker: IAuthorInvoker<IGateRun> = <TContext, TResult>(callback: (context: TContext) => TResult, context: TContext): IGateRun => {
    // eslint-disable-next-line microdelta/tracked-captures -- Framework invoker: the callback is the author's actual gate from Definition's record, tracked so its implementation is the gate's own evidence.
    const authored = tracking.tracked(callback, { path: bindingPaths.self });
    let captured: IObservationCapture<{ readonly value: unknown }>;
    try {
      // eslint-disable-next-line microdelta/tracked-captures -- Framework invoker: this capture is the gate's own evidence frame; it invokes only the tracked gate with Definition's assembled context.
      captured = tracking.capture(() => ({ value: authored(context) }));
    } catch (error: unknown) {
      return { kind: 'threw', error };
    }
    const value = captured.value.value;
    if (value instanceof Promise) {
      // Its eventual rejection must not escape unhandled; the gate has already failed.
      value.catch(() => undefined);
      return { kind: 'promise' };
    }
    return isThenable(value) ? { kind: 'promise' } : { kind: 'returned', value, observations: captured.observations };
  };

  /**
   * Whether a gate's value is a thenable: a non-promise object or function
   * whose own `then` data property is a function. Only own data properties
   * are read, so no author getter runs, and a Tracking view is never probed.
   */
  function isThenable(value: unknown): boolean {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
      return false;
    }
    if (tracking.materialization.owns(value)) {
      return false;
    }
    const then = Object.getOwnPropertyDescriptor(value, 'then');
    return then !== undefined && 'value' in then && typeof then.value === 'function';
  }

  /**
   * Resolve one template instance (CMP-4, CMP-8): establish the template's
   * current population (discovery under current policy, keyed before any gate
   * or body), require the member in it, settle its gate, then resolve the
   * instance step with its member binding. A population that could not be
   * established stops here with the collection's own refusal or uncertainty;
   * a rejected snapshot or a failed gate is a typed failure; a skipped member
   * admits nothing.
   */
  async function resolveInstance(request: IRequestContext, requested: IBindingDescriptor): Promise<IResolvedTarget> {
    const template = requested.template;
    const key = requested.memberKey;
    if (template === undefined || key === undefined) {
      throw new ResolutionError('unbound-step', `Step ${stepKey(requested)} is a template step without a member key, which addresses no instance`);
    }
    const population = await populationOf(request, template);
    switch (population.status) {
      case 'stopped':
        return { step: requested, result: population.result, evidence: newEvidence(request), gate: undefined };
      case 'rejected':
        throw new ResolutionError('collection-rejected', population.diagnostic.message);
      case 'keyed':
        break;
      default: {
        const exhaustive: never = population;
        return exhaustive;
      }
    }
    const record = memberRecord(request, requested);
    if (record === undefined) {
      throw new ResolutionError('unbound-step', `Member ${key} is not in the current ${population.collection.slot} collection of template ${template}`);
    }
    // Reconnected after keying: the composition now retains this member's
    // instances, so every later reconnection yields these same declarations.
    const target = stepTarget(requested);
    const gate = settleGate(request, target.step, template, key, record);
    if (gate.status === 'failed') {
      throw gate.error;
    }
    if (gate.evidence?.selected === 'skipped') {
      return { step: target.step, result: { kind: 'skipped', gate: gate.evidence }, evidence: newEvidence(request), gate: gate.evidence };
    }
    const resolved = target.declaration.kind === 'source'
      ? await resolveSourceShared(request, target.step, target.declaration)
      : await resolveMemoShared(request, target.step, target.declaration);
    return { ...resolved, gate: gate.evidence };
  }

  /** Resolve a requested step in a request context. */
  async function resolveStep(request: IRequestContext, step: IBindingDescriptor): Promise<IResolvedTarget> {
    const target = stepTarget(step);
    if (isTemplateStep(target.step)) {
      return resolveInstance(request, target.step);
    }
    const resolved = target.declaration.kind === 'source'
      ? await resolveSourceShared(request, target.step, target.declaration)
      : await resolveMemoShared(request, target.step, target.declaration);
    return { ...resolved, gate: undefined };
  }

  /** The public outcome of a normal request's resolved step, with the request's diagnostics so far. */
  function normalOutcome(resolved: IResolvedTarget): IResolutionOutcome {
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
        return Object.freeze({ ...evidence, kind: 'refused', refused: result.refused, reason: result.reason, disposition: result.disposition });
      case 'skipped':
        return Object.freeze({ ...evidence, kind: 'skipped', gate: result.gate });
      case 'uncertain':
      case 'execution-required':
        throw new ResolutionError('invalid-request', `A normal request cannot end ${result.kind}`);
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
  }

  /** How discovery settled, for a members request. */
  function discoveryOutcome(population: IPopulation): IDiscoveryOutcome {
    switch (population.status) {
      case 'keyed':
        return Object.freeze({ kind: 'keyed', collection: population.collection, reference: population.reference, completion: population.completion, keys: population.keys });
      case 'rejected':
        return Object.freeze({ kind: 'rejected', collection: population.collection, reference: population.reference, diagnostic: population.diagnostic });
      case 'stopped':
        if (population.result.kind === 'uncertain') {
          throw new ResolutionError('invalid-request', 'A normal request cannot end uncertain');
        }
        return Object.freeze({ kind: 'refused', collection: population.collection, refused: population.result.refused, reason: population.result.reason, disposition: population.result.disposition });
      default: {
        const exhaustive: never = population;
        return exhaustive;
      }
    }
  }

  /**
   * Settle one template step for every current member of its template's
   * population (RUN-005): discovery and keying once, then the members
   * independently, started in canonical key order within Run Supervision's
   * bounded active window (RUN-002; one at a time without Supervision), and
   * reported in canonical key order. A
   * member-attributable typed failure (a gate failure included) is confined
   * to that member; its siblings still resolve, share this request's current
   * results and publish. A run-level failure (`runLevelFailures`, or any
   * failure that is not a ResolutionError) fails the whole request and is
   * never attributed to a member, so a strict fold never mistakes an outage
   * for a terminal member failure: no further member starts, members already
   * started finish, and the earliest such failure in key order is thrown. A
   * members request and a strict fold's member phase are this same settlement.
   */
  async function settleMembers(request: IRequestContext, template: ITemplateTopology, templateStep: IBindingDescriptor): Promise<{ readonly population: IPopulation; readonly settled: readonly ISettledMember[] }> {
    const population = await populationOf(request, template.slot);
    const keys = population.status === 'keyed' ? population.keys : [];
    const settled = new Map<number, ISettledMember>();
    /** The earliest (in canonical order) run-level failure seen; once set, no further member starts. */
    const runFailure: { first: { readonly position: number; readonly error: unknown } | undefined } = { first: undefined };
    /** Keep the earliest run-level failure in canonical key order. */
    const recordRunFailure = (position: number, error: unknown): void => {
      const earlier = runFailure.first;
      if (earlier === undefined || position < earlier.position) {
        runFailure.first = { position, error };
      }
    };
    /**
     * Resolve one member inside the run's bounded active window (RUN-002).
     * Every member is presented at once, in canonical key order, and the
     * window starts them in that order. A member not yet started holds
     * nothing, so after a stop it is presented to admission, and refused,
     * only when a lane reaches it; after a run-level failure it does not start.
     *
     * Invariant: the window's lane pool is run-wide, so a member's work must
     * never reach another `settleMembers` (a nested fan-out) under the same
     * pool; a member holding a lane while its own fan-out waits for lanes can
     * deadlock the window (RUN-002's nested rule). Resolution never nests one:
     * neither a strict nor an outcome fold can be a declared child. Author
     * code that kept the run cannot nest one either: Supervision refuses a
     * run operation called from inside member work or a step attempt as an
     * undeclared call (CMP-9).
     */
    const member = async (key: string, position: number): Promise<void> => {
      if (runFailure.first !== undefined) {
        return;
      }
      const instance: IBindingDescriptor = Object.freeze({ ...templateStep, memberKey: key });
      try {
        settled.set(position, { key, step: instance, resolved: await resolveInstance(request, instance) });
      } catch (error: unknown) {
        if (!(error instanceof ResolutionError) || runLevelFailures.has(error.code)) {
          recordRunFailure(position, error);
          return;
        }
        settled.set(position, { key, step: instance, resolved: error });
      }
    };
    // Members already started finish before a run-level failure is reported, so no member work outlives the request.
    await Promise.all(keys.map((key, position) => supervision.member(() => member(key, position))));
    if (runFailure.first !== undefined) {
      throw runFailure.first.error;
    }
    return { population, settled: keys.flatMap((_key, position) => {
      const member = settled.get(position);
      return member === undefined ? [] : [member];
    }) };
  }

  /** The public member outcomes of settled members, with the request's diagnostics so far. */
  function memberResolutions(request: IRequestContext, template: ITemplateTopology, settled: readonly ISettledMember[]): readonly IMemberResolution[] {
    return Object.freeze(settled.map(({ key, step, resolved }): IMemberResolution => {
      if (resolved instanceof ResolutionError) {
        const gate = request.gates.get(JSON.stringify([template.slot, key]));
        return Object.freeze({ key, step, gate: gate?.status === 'settled' ? gate.evidence : undefined, outcome: Object.freeze({ kind: 'failed', error: resolved }) });
      }
      return Object.freeze({ key, step: resolved.step, gate: resolved.gate, outcome: normalOutcome(resolved) });
    }));
  }

  /** The current composition's strict fold at a fold step descriptor, with the template step it consumes. */
  function foldTopology(step: IBindingDescriptor): IFoldTopology {
    const fold = composition.topology.folds.find((entry) => stepKey(entry.fold) === stepKey(step));
    if (fold === undefined) {
      throw new ResolutionError('unbound-step', `Strict fold ${step.slot} consumes no template step of the current composition`);
    }
    return fold;
  }

  /**
   * Decide a strict fold's readiness from how discovery and every current
   * member settled (CMP-8 EXP-4 strict-fold selection; supervisor resolution:
   * fail fast). In order:
   *
   * 1. Strict completion is impossible in this pass, so the fold fails: a
   *    required member failed or was cancelled, discovery was rejected by
   *    keying, or discovery work was cancelled. It still names every pending
   *    member and whether discovery is open.
   * 2. Otherwise the fold waits: discovery is open or its work was denied
   *    (closure is not established, RUN-004), or a required member is pending.
   * 3. Otherwise it is ready over the current membership-and-status fact:
   *    every member in canonical key order, included with its accepted
   *    result or skipped by its gate.
   */
  function foldReadiness(fold: IFoldTopology, population: IPopulation, settled: readonly ISettledMember[]): IFoldReadiness {
    const name = `Strict fold ${fold.fold.slot}`;
    switch (population.status) {
      case 'rejected':
        return { status: 'failed', failed: [], cancelled: [], pending: [], openDiscovery: false, diagnostic: `${name} cannot complete: discovery of ${population.collection.slot} was rejected: ${population.diagnostic.message}` };
      case 'stopped': {
        const result = population.result;
        if (result.kind === 'uncertain') {
          throw new ResolutionError('invalid-request', 'A normal request cannot end uncertain');
        }
        return result.disposition === 'cancelled'
          ? { status: 'failed', failed: [], cancelled: [], pending: [], openDiscovery: true, diagnostic: `${name} cannot complete: discovery work of ${population.collection.slot} was cancelled: ${result.reason}` }
          : { status: 'waiting', pending: [], openDiscovery: true };
      }
      case 'keyed':
        break;
      default: {
        const exhaustive: never = population;
        return exhaustive;
      }
    }
    const failed: string[] = [];
    const cancelled: string[] = [];
    const pending: string[] = [];
    const membership: IMembershipEntry[] = [];
    for (const { key, resolved } of settled) {
      if (resolved instanceof ResolutionError) {
        failed.push(key);
        continue;
      }
      const result = resolved.result;
      switch (result.kind) {
        case 'reused':
        case 'published':
          membership.push(Object.freeze({ key, status: 'included', reference: result.reference }));
          break;
        case 'skipped':
          membership.push(Object.freeze({ key, status: 'skipped' }));
          break;
        case 'refused':
          // A denial leaves the member pending; a cancellation is terminal for the pass.
          (result.disposition === 'cancelled' ? cancelled : pending).push(key);
          break;
        case 'uncertain':
        case 'execution-required':
          throw new ResolutionError('invalid-request', `A normal request cannot end ${result.kind}`);
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    }
    const openDiscovery = population.completion === 'open';
    if (failed.length > 0 || cancelled.length > 0) {
      const detail = `failed [${failed.join(', ')}], cancelled [${cancelled.join(', ')}], pending [${pending.join(', ')}], discovery ${openDiscovery ? 'open' : 'closed'}`;
      return { status: 'failed', failed, cancelled, pending, openDiscovery, diagnostic: `${name} requires every required member of ${String(fold.over.template)} step ${fold.over.slot}: ${detail}` };
    }
    if (openDiscovery || pending.length > 0) {
      return { status: 'waiting', pending, openDiscovery };
    }
    return { status: 'ready', membership };
  }

  /** The current composition's outcome fold at a fold step descriptor, with the template step it consumes. */
  function outcomeFoldTopology(step: IBindingDescriptor): IFoldTopology {
    const fold = composition.topology.outcomeFolds.find((entry) => stepKey(entry.fold) === stepKey(step));
    if (fold === undefined) {
      throw new ResolutionError('unbound-step', `Outcome fold ${step.slot} consumes no template step of the current composition`);
    }
    return fold;
  }

  /**
   * Decide whether an outcome fold's set has settled, from how discovery and
   * every current member settled in this pass (RUN-010). Unlike a strict
   * fold's readiness, no member status fails it. In order:
   *
   * 1. No population can be established in this pass, so it fails:
   *    discovery was rejected by keying, or its work was cancelled.
   * 2. Otherwise it waits, with the partial coverage settled so far, while
   *    discovery is open (or its work was denied) or any member is pending:
   *    denied work, like a pending retry, is not a settled status.
   * 3. Otherwise it is ready over the current membership-and-status fact:
   *    every member in canonical key order, included with its accepted
   *    result, or skipped, failed or cancelled with none.
   */
  function outcomeReadiness(fold: IFoldTopology, population: IPopulation, settled: readonly ISettledMember[]): IOutcomeReadiness {
    const name = `Outcome fold ${fold.fold.slot}`;
    switch (population.status) {
      case 'rejected':
        return { status: 'failed', diagnostic: `${name} cannot establish its population: discovery of ${population.collection.slot} was rejected: ${population.diagnostic.message}` };
      case 'stopped': {
        const result = population.result;
        if (result.kind === 'uncertain') {
          throw new ResolutionError('invalid-request', 'A normal request cannot end uncertain');
        }
        return result.disposition === 'cancelled'
          ? { status: 'failed', diagnostic: `${name} cannot establish its population: discovery work of ${population.collection.slot} was cancelled: ${result.reason}` }
          : { status: 'waiting', coverage: incompleteCoverage([], [], true) };
      }
      case 'keyed':
        break;
      default: {
        const exhaustive: never = population;
        return exhaustive;
      }
    }
    const membership: IOutcomeMembershipEntry[] = [];
    const pending: string[] = [];
    for (const { key, resolved } of settled) {
      if (resolved instanceof ResolutionError) {
        membership.push(Object.freeze({ key, status: 'failed' }));
        continue;
      }
      const result = resolved.result;
      switch (result.kind) {
        case 'reused':
        case 'published':
          membership.push(Object.freeze({ key, status: 'included', reference: result.reference }));
          break;
        case 'skipped':
          membership.push(Object.freeze({ key, status: 'skipped' }));
          break;
        case 'refused':
          // A cancellation settles the member for this run; a denial leaves it pending.
          if (result.disposition === 'cancelled') {
            membership.push(Object.freeze({ key, status: 'cancelled' }));
          } else {
            pending.push(key);
          }
          break;
        case 'uncertain':
        case 'execution-required':
          throw new ResolutionError('invalid-request', `A normal request cannot end ${result.kind}`);
        default: {
          const exhaustive: never = result;
          return exhaustive;
        }
      }
    }
    const openDiscovery = population.completion === 'open';
    if (openDiscovery || pending.length > 0) {
      return { status: 'waiting', coverage: incompleteCoverage(membership, pending, openDiscovery) };
    }
    return { status: 'ready', membership, coverage: completeCoverage(membership) };
  }

  /** Open the unique current invocation of an outcome fold step. */
  function openOutcomeFold(step: IBindingDescriptor): IOutcomeFoldInvocation<IFamily> {
    const invocation = options.declarations.openInvocation(composition, step, port);
    if (invocation.kind !== 'outcome-fold') {
      invocation.close();
      throw new ResolutionError('unbound-step', `Step ${stepKey(step)} is not an outcome fold`);
    }
    return invocation;
  }

  /**
   * The explicit keyed entries a ready outcome fold's body receives, built
   * from its membership-and-status fact in canonical key order: an included
   * member as `succeeded` with a lazy view of its exact accepted result at
   * its `entry` binding, so every fact the body reads is the fold's own
   * evidence for that member; every other member with its settled status and
   * no data at all. Definition validates, orders and freezes them.
   */
  function outcomeMembers(membership: readonly IOutcomeMembershipEntry[]): IOutcomeFoldMemberSupplier<IFamily> {
    return Object.freeze({
      outcomes: <TMemberResult>(fold: IOutcomeFoldDeclaration<IFamily, TMemberResult, unknown>): readonly IOutcomeEntry<IApply<IFamily['views'], TMemberResult>>[] => {
        void fold;
        return trusted<readonly IOutcomeEntry<IApply<IFamily['views'], TMemberResult>>[]>(membership.map((entry) => entry.status === 'included'
          ? Object.freeze({ key: entry.key, status: 'succeeded' as const, data: materialization.materializeView<object>(entry.reference, { path: bindingPaths.entry(entry.key) }) })
          : Object.freeze({ key: entry.key, status: entry.status })));
      },
    });
  }

  /** Open the unique current invocation of a strict fold step. */
  function openFold(step: IBindingDescriptor): IFoldInvocation<IFamily> {
    const invocation = options.declarations.openInvocation(composition, step, port);
    if (invocation.kind !== 'fold') {
      invocation.close();
      throw new ResolutionError('unbound-step', `Step ${stepKey(step)} is not a strict fold`);
    }
    return invocation;
  }

  /**
   * The explicit keyed entries a ready fold's body receives, built from its
   * membership-and-status fact in canonical key order: an included member as
   * `succeeded` with a lazy view of its exact accepted result at its `entry`
   * binding, so every fact the body reads is the fold's own evidence for that
   * member; a skipped member as `skipped` with no data at all. Definition
   * validates, orders and freezes them.
   */
  function foldMembers(membership: readonly IMembershipEntry[]): IFoldMemberSupplier<IFamily> {
    return Object.freeze({
      outcomes: <TMemberResult>(fold: IFoldDeclaration<IFamily, TMemberResult, unknown>): readonly IFoldEntry<IApply<IFamily['views'], TMemberResult>>[] => {
        void fold;
        return trusted<readonly IFoldEntry<IApply<IFamily['views'], TMemberResult>>[]>(membership.map((entry) => entry.status === 'included'
          ? Object.freeze({ key: entry.key, status: 'succeeded' as const, data: materialization.materializeView<object>(entry.reference, { path: bindingPaths.entry(entry.key) }) })
          : Object.freeze({ key: entry.key, status: 'skipped' as const })));
      },
    });
  }

  /** The outcome of validating one strict fold candidate. */
  type IFoldVerdict = ({ readonly verdict: 'eligible' } & IEligible) | { readonly verdict: 'miss'; readonly miss: ICandidateMiss };

  /**
   * Validate one fold candidate against the current membership-and-status
   * fact (CMP-8, RUN-010; a strict fold consumes each member's
   * included-or-skipped outcome, an outcome fold every settled status, never
   * the gate's raw facts). Its provenance must have been recorded by the same
   * fold contract: a strict fold never accepts an outcome fold's result, nor
   * the reverse. Then, the template step it recorded
   * consuming must be the one it consumes now: candidates are found by
   * subject, which the fold keeps when the consumed step or template is
   * renamed or the collection moves, and that is changed correspondence,
   * never a remap (CMP-4, COL-1). Then its own evidence (its implementation,
   * inputs and helpers); then the recorded membership fact, which must equal
   * the current one exactly, so a gate flip, an insertion or a deletion is a
   * miss while a reorder or a threshold edit that flips no outcome is not;
   * then, for each included member, only the facts the fold consumed from that
   * member's entry, compared against the member's current accepted result.
   * The fold body never runs here.
   */
  function evaluateFoldCandidate(
    request: IRequestContext,
    step: IBindingDescriptor,
    over: IBindingDescriptor,
    declaration: IAnyFoldDeclaration<IFamily> | IAnyOutcomeFoldDeclaration<IFamily>,
    candidate: ICompletedEnvelope,
    membership: readonly IOutcomeMembershipEntry[],
  ): IFoldVerdict {
    const missed = (reason: ICandidateMiss['reason'], detail: string): IFoldVerdict => ({ verdict: 'miss', miss: miss(candidate.reference, reason, detail) });
    const reading = integrity(() => readProvenance(candidate));
    if (reading.status === 'unsupported') {
      return missed('unsupported-evidence', reading.detail);
    }
    const provenance: IProvenance = reading.provenance;
    if (provenance.kind !== declaration.kind || (provenance.kind !== 'fold' && provenance.kind !== 'outcome-fold')) {
      return missed('unsupported-evidence', `provenance was recorded for a ${describeKind(provenance.kind)}`);
    }
    const recorded: IFoldProvenance | IOutcomeFoldProvenance = provenance;
    if (stepKey(recorded.over) !== stepKey(over)) {
      return missed('correspondence', `the fold consumed ${stepKey(recorded.over)}, not the current ${stepKey(over)}`);
    }
    const own = recorded.observations.filter((item) => entryObservationKey(item.binding) === undefined);
    const ownComparison = compare(own, ownFactProvider({ validation, slots: request.slots, self: declaration.run }));
    if (ownComparison.kind !== 'equal') {
      return { verdict: 'miss', miss: missFrom(candidate.reference, ownComparison) };
    }
    const change = membershipChange(recorded.membership, membership);
    if (change !== undefined) {
      return missed('changed-membership', change);
    }
    const recordedMembership: readonly IOutcomeMembershipEntry[] = recorded.membership;
    for (const entry of recordedMembership) {
      if (entry.status !== 'included') {
        continue;
      }
      if (!candidate.dependencies.some((dependency) => dependency.locator === entry.reference.locator)) {
        throw new ResolutionError('integrity', `Recorded member ${entry.key} of ${candidate.reference.locator} is not among its exact dependencies`);
      }
      const historical = integrity(() => history.readEnvelope(entry.reference));
      if (!historicalInScope(historical)) {
        throw new ResolutionError('integrity', `Recorded member ${entry.key} of ${candidate.reference.locator} is outside this History scope`);
      }
    }
    const current = new Map(membership.flatMap((entry) => entry.status === 'included' ? [[entry.key, entry.reference] as const] : []));
    const unavailable: ICurrentFactProvider = Object.freeze({ resolve: () => ({ kind: 'unavailable' as const }) });
    const consumed = recorded.observations.filter((item) => entryObservationKey(item.binding) !== undefined);
    const comparison = compare(consumed, materialization.currentProvider((binding) => {
      const key = entryObservationKey(binding);
      return key === undefined ? undefined : current.get(key);
    }, unavailable));
    if (comparison.kind !== 'equal') {
      return { verdict: 'miss', miss: memberOutputMiss(candidate.reference, comparison) };
    }
    const members = [...current].map(([key, reference]) => ({ key, reference }));
    return {
      verdict: 'eligible',
      record: { basis: 'validated', step, members },
      dependencies: members.map((member) => member.reference),
    };
  }

  /**
   * One ready fold's work under its own contract: a strict fold over its
   * included-or-skipped membership fact, or an outcome fold over every
   * settled status.
   */
  type IFoldWork =
    | { readonly kind: 'fold'; readonly declaration: IAnyFoldDeclaration<IFamily>; readonly membership: readonly IMembershipEntry[] }
    | { readonly kind: 'outcome-fold'; readonly declaration: IAnyOutcomeFoldDeclaration<IFamily>; readonly membership: readonly IOutcomeMembershipEntry[] };

  /**
   * Open a ready fold's invocation and pair its body with the explicit keyed
   * entries its contract delivers, without running anything. Opening runs no
   * author code.
   */
  function openFoldBody(step: IBindingDescriptor, work: IFoldWork, bindings: IFamily['memo']): { readonly invocation: IInvocationScope; readonly run: () => Promise<IObservationCapture<IMemoReturn>> } {
    if (work.kind === 'fold') {
      const invocation = openFold(step);
      return { invocation, run: () => active.run(invocation, () => invocation.apply(bindings, foldMembers(work.membership), invoker(detachComputation))) };
    }
    const invocation = openOutcomeFold(step);
    return { invocation, run: () => active.run(invocation, () => invocation.apply(bindings, outcomeMembers(work.membership), invoker(detachComputation))) };
  }

  /**
   * Validate or execute a ready fold over its current membership-and-status
   * fact: reuse the newest candidate that validates, recording an acceptance
   * that names each included member's current result; otherwise present the
   * fold's own work to admission and, when admitted, run its body with the
   * explicit keyed entries and publish provenance (version 3 for a strict
   * fold, version 4 for an outcome fold) whose exact dependencies are the
   * included members' results.
   */
  async function resolveFoldStep(request: IRequestContext, step: IBindingDescriptor, over: IBindingDescriptor, work: IFoldWork): Promise<IResolvedStep> {
    const { declaration } = work;
    const membership: readonly IOutcomeMembershipEntry[] = work.membership;
    const name = work.kind === 'fold' ? 'strict fold' : 'outcome fold';
    const evidence = newEvidence(request);
    const done = (result: IStepResult): IResolvedStep => ({ step, result, evidence });
    emit(request, evidence, step, 'verify');
    const candidates = integrity(() => history.findCandidates(versioned(declaration)));
    for (const candidate of candidates) {
      const evaluated = evaluateFoldCandidate(request, step, over, declaration, candidate, membership);
      if (evaluated.verdict === 'miss') {
        evidence.misses.push(evaluated.miss);
        continue;
      }
      return done(accept(request, evidence, step, 'validated', candidate.reference, evaluated.record, evaluated.dependencies));
    }
    const bindings = authorBindings(request);
    const identity = freshIdentity(request, step, declaration);
    const refusal = await admit(request, evidence, step, work.kind, versioned(declaration), candidates.length > 0 ? 'invalid' : 'cold');
    if (refusal !== undefined) {
      return done({ kind: 'refused', refused: step, reason: refusal.reason, disposition: refusal.disposition });
    }
    // Opening the invocation runs no author code; doing it before the claim leaves no attempt behind if it fails.
    const body = openFoldBody(step, work, bindings);
    let attemptId: number;
    try {
      attemptId = claim(request, evidence, step, identity);
    } catch (error: unknown) {
      body.invocation.close();
      throw error;
    }
    let executed: ISupervisedExecution<IObservationCapture<IMemoReturn>>;
    try {
      emit(request, evidence, step, 'execute');
      executed = await supervision.execute(step, body.run, { subject: versioned(declaration), attemptId });
    } catch (error: unknown) {
      executed = { kind: 'threw', error };
    } finally {
      body.invocation.close();
    }
    if (executed.kind === 'interrupted') {
      return done(interrupt(request, evidence, step, attemptId, executed.reason));
    }
    if (executed.kind === 'unsettled') {
      return done(withhold(request, evidence, step, attemptId, executed.reason));
    }
    if (executed.kind === 'threw') {
      const error = executed.error;
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'the body threw' });
      if (error instanceof ResolutionError) {
        throw error;
      }
      throw new ResolutionError('execution-failure', `Body of ${name} ${stepKey(step)} threw`, error);
    }
    const ran = executed.value;
    if (ran.value.detachError !== undefined) {
      abandon(request, evidence, step, attemptId, 'failed', { ending: 'failed', detail: 'the body returned unsupported data' });
      throw new ResolutionError('unsupported-result', `Body of ${name} ${stepKey(step)} returned unsupported data`, ran.value.detachError);
    }
    return done(publish(request, evidence, step, attemptId, {
      payload: ran.value.data,
      provenance: work.kind === 'fold'
        ? { version: 3, kind: 'fold', step, over, observations: ran.observations, membership: work.membership }
        : { version: 4, kind: 'outcome-fold', step, over, observations: ran.observations, membership: work.membership },
      dependencies: uniqueReferences(membership.flatMap((entry) => entry.status === 'included' ? [entry.reference] : [])),
    }));
  }

  /**
   * The public outcome of a strict fold: a ready fold's resolved step with the
   * framework's coverage of its membership fact, or an unready fold's typed
   * failure or wait, which ran no fold work and so has no misses or trace.
   * Diagnostics are the whole request's so far.
   */
  function foldOutcome(request: IRequestContext, step: IBindingDescriptor, readiness: IFoldReadiness, resolved: IResolvedStep | undefined): IFoldOutcome {
    if (readiness.status !== 'ready') {
      const evidence = { step, misses: Object.freeze([]), trace: Object.freeze([]), diagnostics: Object.freeze([...request.diagnostics]) };
      return readiness.status === 'failed'
        ? Object.freeze({
            ...evidence,
            kind: 'failed',
            failed: Object.freeze([...readiness.failed]),
            cancelled: Object.freeze([...readiness.cancelled]),
            pending: Object.freeze([...readiness.pending]),
            openDiscovery: readiness.openDiscovery,
            diagnostic: readiness.diagnostic,
          })
        : Object.freeze({ ...evidence, kind: 'waiting', pending: Object.freeze([...readiness.pending]), openDiscovery: readiness.openDiscovery });
    }
    if (resolved === undefined) {
      throw new ResolutionError('invalid-request', `A ready strict fold ${stepKey(step)} must be resolved`);
    }
    const evidence = { step, misses: Object.freeze([...resolved.evidence.misses]), trace: Object.freeze([...resolved.evidence.trace]), diagnostics: Object.freeze([...request.diagnostics]) };
    const coverage = coverageOf(readiness.membership);
    const result = resolved.result;
    switch (result.kind) {
      case 'reused':
        if (result.acceptance === undefined || result.basis !== 'validated') {
          throw new ResolutionError('integrity', 'A strict fold reuse must record a validated current acceptance');
        }
        return Object.freeze({ ...evidence, kind: 'reused', basis: result.basis, reference: result.reference, acceptance: result.acceptance, coverage });
      case 'published':
        return Object.freeze({ ...evidence, kind: 'published', reference: result.reference, attemptId: result.attemptId, coverage });
      case 'refused':
        return Object.freeze({ ...evidence, kind: 'refused', refused: result.refused, reason: result.reason, disposition: result.disposition });
      case 'uncertain':
      case 'execution-required':
        throw new ResolutionError('invalid-request', `A normal request cannot end ${result.kind}`);
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
  }

  /**
   * The public outcome of an outcome fold: a settled set's resolved step with
   * the framework's complete coverage, or an unsettled set's wait (with the
   * partial coverage so far) or a population that cannot be established,
   * neither of which ran fold work and so has no misses or trace.
   * Diagnostics are the whole request's so far.
   */
  function outcomeFoldOutcome(request: IRequestContext, step: IBindingDescriptor, readiness: IOutcomeReadiness, resolved: IResolvedStep | undefined): IOutcomeFoldOutcome {
    if (readiness.status !== 'ready') {
      const evidence = { step, misses: Object.freeze([]), trace: Object.freeze([]), diagnostics: Object.freeze([...request.diagnostics]) };
      return readiness.status === 'failed'
        ? Object.freeze({ ...evidence, kind: 'failed', diagnostic: readiness.diagnostic })
        : Object.freeze({ ...evidence, kind: 'waiting', coverage: readiness.coverage });
    }
    if (resolved === undefined) {
      throw new ResolutionError('invalid-request', `A settled outcome fold ${stepKey(step)} must be resolved`);
    }
    const evidence = { step, misses: Object.freeze([...resolved.evidence.misses]), trace: Object.freeze([...resolved.evidence.trace]), diagnostics: Object.freeze([...request.diagnostics]) };
    const { coverage } = readiness;
    const result = resolved.result;
    switch (result.kind) {
      case 'reused':
        if (result.acceptance === undefined || result.basis !== 'validated') {
          throw new ResolutionError('integrity', 'An outcome fold reuse must record a validated current acceptance');
        }
        return Object.freeze({ ...evidence, kind: 'reused', basis: result.basis, reference: result.reference, acceptance: result.acceptance, coverage });
      case 'published':
        return Object.freeze({ ...evidence, kind: 'published', reference: result.reference, attemptId: result.attemptId, coverage });
      case 'refused':
        return Object.freeze({ ...evidence, kind: 'refused', refused: result.refused, reason: result.reason, disposition: result.disposition, coverage });
      case 'uncertain':
      case 'execution-required':
        throw new ResolutionError('invalid-request', `A normal request cannot end ${result.kind}`);
      default: {
        const exhaustive: never = result;
        return exhaustive;
      }
    }
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
      return normalOutcome(await resolveStep(context, request.step));
    },

    /**
     * One normal request for a template step across every current member
     * (RUN-005): discovery and keying once, then each member in canonical key
     * order, independently. Failures are classified by whose they are:
     *
     * - Member-attributable failures stay with that member as its typed
     *   failure, and its siblings still resolve, share this request's current
     *   results and publish: an execution failure of its step or a child,
     *   `gate-failure`, `unbound-step`, `policy-failure`, `invalid-outcome`,
     *   `invalid-retention` and `unsupported-result`. A rejected snapshot is
     *   reported on discovery, never as member failures.
     * - Run-level failures fail the whole request and are never attributed to
     *   one member, so a strict consumer never mistakes an outage for member
     *   failures: `admission-failure` (the admission port itself failed),
     *   `observer-failure`, `integrity`, `wrong-intent`, `invalid-request`,
     *   and any failure that is not a ResolutionError (History, host, lease).
     */
    async resolveMembers(request: IMembersRequest): Promise<IMembersResolution> {
      const requestKey = requestKeyOf(request.requestKey);
      const context = newRequest('normal', requestKey, request.lease);
      leaseOf(context);
      const template = composition.topology.templates.find((entry) => entry.slot === request.template);
      if (template === undefined) {
        throw new ResolutionError('unbound-step', `Template ${String(request.template)} is not declared in the current composition`);
      }
      const templateStep = template.steps.find((step) => step.slot === request.step);
      if (templateStep === undefined) {
        throw new ResolutionError('unbound-step', `Template ${template.slot} declares no step ${String(request.step)}`);
      }
      const { population, settled } = await settleMembers(context, template, templateStep);
      return Object.freeze({
        template: template.slot,
        discovery: discoveryOutcome(population),
        // Converted after every member settled, so each outcome reports the whole request's diagnostics.
        members: memberResolutions(context, template, settled),
        diagnostics: Object.freeze([...context.diagnostics]),
      });
    },

    /**
     * One normal request for a strict fold (CMP-8, RUN-005, RUN-010). The
     * consumed template step is settled for every current member exactly as a
     * members request settles it, each member independently, so a member whose
     * evidence is ready completes whatever the fold then decides. Readiness is
     * then decided in order: a failed or cancelled required member (or a
     * rejected or cancelled discovery) fails the fold at once; otherwise open
     * discovery (or denied discovery work) or a pending member leaves it
     * waiting. Neither runs the body, admits fold work or publishes. Only a
     * ready fold is validated or executed.
     */
    async resolveFold(request: IFoldRequest): Promise<IFoldResolution> {
      const requestKey = requestKeyOf(request.requestKey);
      const context = newRequest('normal', requestKey, request.lease);
      leaseOf(context);
      const target = anyStepTarget(request.step);
      const declaration = target.declaration;
      if (declaration.kind !== 'fold') {
        throw new ResolutionError('invalid-request', `Step ${stepKey(target.step)} is a ${declaration.kind}, not a strict fold`);
      }
      const fold = foldTopology(target.step);
      const template = composition.topology.templates.find((entry) => entry.slot === fold.over.template);
      if (template === undefined) {
        throw new ResolutionError('unbound-step', `Strict fold ${target.step.slot} consumes template ${String(fold.over.template)}, which the current composition does not declare`);
      }
      const { population, settled } = await settleMembers(context, template, fold.over);
      const readiness = foldReadiness(fold, population, settled);
      const resolved = readiness.status === 'ready' ? await resolveFoldStep(context, target.step, fold.over, { kind: 'fold', declaration, membership: readiness.membership }) : undefined;
      // Converted after the fold settled, so every outcome reports the whole request's diagnostics.
      const outcome = foldOutcome(context, target.step, readiness, resolved);
      return Object.freeze({
        over: fold.over,
        discovery: discoveryOutcome(population),
        members: memberResolutions(context, template, settled),
        outcome,
        diagnostics: Object.freeze([...context.diagnostics]),
      });
    },

    /**
     * One normal request for an outcome (tolerant) fold (RUN-010). The
     * consumed template step is settled for every current member exactly as a
     * members request settles it, each member independently. A rejected or
     * cancelled discovery fails it; otherwise open discovery (or denied
     * discovery work) or a pending member leaves it waiting with the partial
     * coverage settled so far, running no body, admitting no fold work and
     * publishing nothing. Only once every member of a closed population has
     * settled (succeeded, skipped, failed or cancelled) is it validated or
     * executed, with complete coverage.
     */
    async resolveOutcomeFold(request: IFoldRequest): Promise<IOutcomeFoldResolution> {
      const requestKey = requestKeyOf(request.requestKey);
      const context = newRequest('normal', requestKey, request.lease);
      leaseOf(context);
      const target = anyStepTarget(request.step);
      const declaration = target.declaration;
      if (declaration.kind !== 'outcome-fold') {
        throw new ResolutionError('invalid-request', `Step ${stepKey(target.step)} is a ${describeKind(declaration.kind)}, not an outcome fold`);
      }
      const fold = outcomeFoldTopology(target.step);
      const template = composition.topology.templates.find((entry) => entry.slot === fold.over.template);
      if (template === undefined) {
        throw new ResolutionError('unbound-step', `Outcome fold ${target.step.slot} consumes template ${String(fold.over.template)}, which the current composition does not declare`);
      }
      const { population, settled } = await settleMembers(context, template, fold.over);
      const readiness = outcomeReadiness(fold, population, settled);
      const resolved = readiness.status === 'ready'
        ? await resolveFoldStep(context, target.step, fold.over, { kind: 'outcome-fold', declaration, membership: readiness.membership })
        : undefined;
      // Converted after the fold settled, so every outcome reports the whole request's diagnostics.
      const outcome = outcomeFoldOutcome(context, target.step, readiness, resolved);
      return Object.freeze({
        over: fold.over,
        discovery: discoveryOutcome(population),
        members: memberResolutions(context, template, settled),
        outcome,
        diagnostics: Object.freeze([...context.diagnostics]),
      });
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
        case 'skipped':
          return Object.freeze({ kind: 'skipped', step: resolved.step, gate: result.gate, misses });
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
      // Any admitted execution is recoverable, a strict fold's included.
      const { step, declaration } = anyStepTarget(request.step);
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
