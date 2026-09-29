/**
 * Contracts of Reuse Resolution: the ports it consumes, the requests it
 * accepts and the outcomes it reports. Resolution decides current
 * eligibility, applies current source policy, validates direct children and
 * either reuses an exact retained result or executes through injected
 * admission and History ports (ARC-001/006, REUSE-001–009). It owns no
 * storage rows, no run lifetime and no admission policy.
 */
import type { IBindingDescriptor, IComposition, IDeclarations } from '@microdelta/definition';
import type {
  IAcceptanceRecord,
  ICompletedResultReference,
  IDurableHistory,
  IVersionedSubject,
  IWriterLease,
} from '@microdelta/history';
import type { IAsyncContextCapability, ISha256Capability, ITrackingObservation, ITrackingObserver } from '@microdelta/tracking';

import type { IResolutionFamily } from './family.js';

/**
 * The History operations Resolution uses. Candidate lookup, exact envelopes,
 * attempts, publication, acceptance and read-only recovery all belong to
 * History's one consistency authority; Resolution never touches its rows.
 * The reader must answer both selected and navigation requests exactly.
 * @alpha
 */
export type IResolutionHistory = Pick<
  IDurableHistory,
  | 'reader'
  | 'findCandidates'
  | 'readEnvelope'
  | 'allocateAttempt'
  | 'stageAttempt'
  | 'publishAttempt'
  | 'abandonAttempt'
  | 'recoverAttempt'
  | 'recordAcceptance'
>;

/**
 * Host facilities Resolution consumes: an async context for the currently
 * executing invocation and SHA-256 for its request-derived attempt keys and
 * intent digests. Tracking re-exports these Machine contracts.
 * @alpha
 */
export interface IResolutionHost extends IAsyncContextCapability, ISha256Capability {}

/**
 * Whether a step is a retained source, a memoized computation, or the
 * memoized implementation currently supplied to a callable step slot, invoked
 * through a nested call. @alpha
 */
export type IStepKind = 'source' | 'memo' | 'supplied';

/**
 * One request for new work, presented after reuse had its chance and before
 * any claim, attempt or body (REUSE-009). `reason` says why reuse failed.
 * @alpha
 */
export interface IAdmissionRequest {
  /** The step that needs work. */
  readonly step: IBindingDescriptor;
  /** Its kind. */
  readonly kind: IStepKind;
  /** Its scoped subject and compatibility group. */
  readonly subject: IVersionedSubject;
  /**
   * Why work is needed: no candidate in its compatibility group, candidates
   * that failed current validation, or current source policy requiring a check.
   */
  readonly reason: 'cold' | 'invalid' | 'source-policy';
}

/** An admission decision. Denial is an ordinary typed outcome. @alpha */
export type IAdmissionDecision =
  | { readonly kind: 'admitted' }
  | { readonly kind: 'denied'; readonly reason: string };

/**
 * The execution-admission port supplied by Run Supervision. Resolution asks
 * it only for work that current validation could not avoid; a valid hit never
 * reaches it. History's writer consistency is independent of this policy.
 * @alpha
 */
export interface IExecutionAdmission {
  /** Decide whether the described work may proceed. */
  admit(request: IAdmissionRequest): IAdmissionDecision | Promise<IAdmissionDecision>;
}

/**
 * Positions of Resolution's framework-owned lifecycle, in the order they can
 * occur for one step: verify candidates, evaluate finality, decide admission,
 * claim an attempt, execute, then publish, accept (ending the claim with
 * `release` when a check retained instead of publishing) or abandon. `abandon`
 * announces that History durably ended an admitted attempt without a result
 * (failure, interruption or a refused child); `release` announces the durable
 * ending after an explicit retention. Neither is announced when History could
 * not record the ending. Both follow a commit, so an observer failure there is
 * a diagnostic that never replaces the call's outcome. The sequence is
 * inspectable and cannot be reordered or replaced by an observer.
 * @alpha
 */
export type ILifecyclePhase =
  | 'verify'
  | 'finality'
  | 'admit'
  | 'refuse'
  | 'claim'
  | 'execute'
  | 'publish'
  | 'accept'
  | 'release'
  | 'abandon';

/** One lifecycle event, as recorded in an outcome's trace and offered to an observer. @alpha */
export interface ILifecycleEvent {
  /** The step the event belongs to. */
  readonly step: IBindingDescriptor;
  /** The lifecycle position. */
  readonly phase: ILifecyclePhase;
  /** The exact result concerned, when the phase names one. */
  readonly reference?: ICompletedResultReference;
}

/**
 * An optional observer of lifecycle events. It cannot authorize or veto work.
 * A throw before execution stops only the affected call; a throw after a
 * publication or acceptance committed becomes a diagnostic beside that
 * committed success, never a failure that invites re-execution.
 * @alpha
 */
export interface ILifecycleObserver {
  /** Observe one event. */
  observe(event: ILifecycleEvent): void;
}

/**
 * Construction options. The composition's scope is History's analysis;
 * `environment` completes the History scope. Declared input and helper slots
 * are the composition-wide bindings every callback receives.
 * @alpha
 */
export interface IResolutionOptions<TInputs extends object, THelpers extends object> {
  /** The family-bound Definition builders that minted the composition. */
  readonly declarations: IDeclarations<IResolutionFamily<TInputs, THelpers>>;
  /** The frozen current composition. */
  readonly composition: IComposition<IResolutionFamily<TInputs, THelpers>>;
  /** The input and callable slots bound into every callback's `inputs` and `helpers`. */
  readonly bindings: {
    readonly inputs: readonly string[];
    readonly helpers: readonly string[];
  };
  /** History's environment within the composition's analysis scope. */
  readonly environment: string;
  /** History's durable authority. */
  readonly history: IResolutionHistory;
  /** The Tracking observer that captures author evidence and owns result views. */
  readonly tracking: ITrackingObserver;
  /** Host capabilities. */
  readonly host: IResolutionHost;
  /** Run Supervision's admission port. */
  readonly admission: IExecutionAdmission;
  /** An optional lifecycle observer. */
  readonly observer?: ILifecycleObserver;
}

/**
 * A normal current request. The caller supplies a fresh opaque request key it
 * saved before starting work; Resolution derives each admitted attempt key
 * from it and the structural invocation. The writer lease authorizes storage
 * mutation only, never author execution.
 * @alpha
 */
export interface IResolveRequest {
  /** The step to resolve. */
  readonly step: IBindingDescriptor;
  /** The caller's saved request key; a nonempty opaque string. */
  readonly requestKey: string;
  /** History's current writer lease for this run. */
  readonly lease: IWriterLease;
}

/** A check-only request: no admission, claims, attempts, bodies or writes. @alpha */
export interface ICheckRequest {
  /** The step to check. */
  readonly step: IBindingDescriptor;
}

/** A recovery request: the saved request key and the declared invocation. @alpha */
export interface IRecoverRequest {
  /** The step whose admitted execution is recovered. */
  readonly step: IBindingDescriptor;
  /** The request key saved for that execution. */
  readonly requestKey: string;
}

/**
 * Why one candidate could not be reused. Changed content, lost or ambiguous
 * current correspondence, unsupported historical evidence and a changed child
 * output stay distinct (execution.md diagnostics, REUSE-007).
 *
 * - `changed`: one of the candidate's own consumed facts (implementation,
 *   input, helper or argument) differs now.
 * - `unavailable`, `incompatible`, `ambiguous`: an own consumed fact has no
 *   current value, a different container shape, or an ambiguous input binding.
 * - `correspondence`: a recorded call no longer reconnects to this step's
 *   current declared child relationship (M3 direct children, and nested edges
 *   Definition reports undeclared).
 * - `unsupported-evidence`: the provenance format or version, or a recorded
 *   witness, argument form or recipe, is one Resolution does not read.
 * - `changed-child-output`: a nested call's current child result differs in a
 *   fact the candidate consumed from that call.
 * - `missing-binding`, `ambiguous-binding`: a recorded nested call's callable
 *   slot now has no current implementation, or several.
 * - `unreconstructible-argument`: a recorded argument kept no value (for
 *   example a function), so the call cannot be made again without the body.
 * - `unjustified-argument`: a recorded derived argument was made after an
 *   observed untracked read, so recorded evidence cannot justify it.
 * - `child-refused`: reserved for a child whose required work was refused.
 * @alpha
 */
export interface ICandidateMiss {
  /** The candidate that failed. */
  readonly candidate: ICompletedResultReference;
  /** The failure class. */
  readonly reason:
    | 'changed'
    | 'unavailable'
    | 'incompatible'
    | 'ambiguous'
    | 'correspondence'
    | 'unsupported-evidence'
    | 'changed-child-output'
    | 'missing-binding'
    | 'ambiguous-binding'
    | 'unreconstructible-argument'
    | 'unjustified-argument'
    | 'child-refused';
  /** The observation whose current fact did not compare equal, when one did. */
  readonly observation?: ITrackingObservation;
  /** Human-readable detail. */
  readonly detail: string;
}

/**
 * How an existing result became current: the current finality hook accepted
 * it, the source's check explicitly retained it, or all its evidence validated.
 * @alpha
 */
export type IReuseBasis = 'finality' | 'check' | 'validated';

/** Fields every normal outcome carries. @alpha */
export interface IOutcomeEvidence {
  /** The resolved step. */
  readonly step: IBindingDescriptor;
  /** Candidates tried and why each failed, latest publication first. */
  readonly misses: readonly ICandidateMiss[];
  /**
   * The lifecycle events of the requested step itself, in order. Nested child
   * steps have their own lifecycle; their events reach the observer, not this
   * trace.
   */
  readonly trace: readonly ILifecycleEvent[];
  /**
   * Post-commit diagnostics of the whole request, including nested child
   * steps, each reported once and naming its step: for example an observer
   * failure after a child's acceptance or publication committed.
   */
  readonly diagnostics: readonly string[];
}

/**
 * The outcome of a normal request: an existing exact result reused with a new
 * acceptance record, a new publication, or an admission refusal.
 * @alpha
 */
export type IResolutionOutcome = IOutcomeEvidence & (
  | {
      readonly kind: 'reused';
      readonly basis: IReuseBasis;
      readonly reference: ICompletedResultReference;
      readonly acceptance: IAcceptanceRecord;
    }
  | {
      readonly kind: 'published';
      readonly reference: ICompletedResultReference;
      readonly attemptId: number;
    }
  | {
      readonly kind: 'refused';
      /** The step whose work was refused; a child when the parent needed its work. */
      readonly refused: IBindingDescriptor;
      readonly reason: string;
    }
);

/**
 * The outcome of a check-only request. `reusable` names the exact result a
 * normal request would reuse right now; `execution-required` means the step
 * itself would run; `uncertain` means source work at `boundary` must happen
 * before anything downstream can be decided.
 * @alpha
 */
export type ICheckOutcome =
  | {
      readonly kind: 'reusable';
      readonly step: IBindingDescriptor;
      readonly basis: IReuseBasis;
      readonly reference: ICompletedResultReference;
      readonly misses: readonly ICandidateMiss[];
    }
  | { readonly kind: 'execution-required'; readonly step: IBindingDescriptor; readonly misses: readonly ICandidateMiss[] }
  | {
      readonly kind: 'uncertain';
      readonly step: IBindingDescriptor;
      readonly boundary: IBindingDescriptor;
      readonly misses: readonly ICandidateMiss[];
    };

/**
 * What durably happened to one identified admitted execution. `recovered`
 * returns that execution's exact past success; it is not current acceptance.
 * The other states never execute anything automatically.
 * @alpha
 */
export type IRecoveryResult =
  | { readonly kind: 'recovered'; readonly reference: ICompletedResultReference; readonly attemptId: number }
  | { readonly kind: 'absent' }
  | { readonly kind: 'incomplete'; readonly attemptId: number }
  | { readonly kind: 'unsuccessful'; readonly attemptId: number };

/**
 * Reuse Resolution over one current composition and History scope.
 * @alpha
 */
export interface IResolution {
  /** Resolve one step under current policy, reusing or executing through admission. */
  resolve(request: IResolveRequest): Promise<IResolutionOutcome>;
  /** Report what a normal request would do, without admission, claims, bodies or writes. */
  check(request: ICheckRequest): Promise<ICheckOutcome>;
  /** Report the durable outcome of the execution a saved request key identifies, without executing. */
  recover(request: IRecoverRequest): IRecoveryResult;
}
