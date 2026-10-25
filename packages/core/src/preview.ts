/**
 * Read-only observation composition: owner-supplied evaluation evidence determines
 * display freshness while Materialization retains exact selected value loading.
 * No evaluation, acceptance, writer or reader-lifetime authority lives here.
 */
import type { IBindingDescriptor as IStepDescriptor } from '@microdelta/definition';
import type { ICompletedResultReference } from '@microdelta/history';
import type { IMaterialization, IMaterializedView } from '@microdelta/materialization';
import type { IResolutionOutcome } from '@microdelta/resolution';
import type { IRunContext } from '@microdelta/supervision';

/** One selected evaluation, distinct from durable reuse identity. @alpha */
export interface IPreviewScope {
  /** Existing run identity, analysis and environment; all must correspond. */
  readonly context: IRunContext;
  /** Distinguishes successive evaluations of the same step within a run. */
  readonly requestKey: string;
  /** Structural Definition identity of the evaluated step. */
  readonly step: IStepDescriptor;
}

/** Native request outcome or failure, saved with its actual evaluation scope. @alpha */
export type IPreviewEvaluation =
  | { readonly kind: 'returned'; readonly scope: IPreviewScope; readonly outcome: IResolutionOutcome }
  | { readonly kind: 'threw'; readonly scope: IPreviewScope; readonly error: unknown };

/** A current failed refresh remains distinct even when it threw undefined. @alpha */
export type IPreviewRefresh =
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly error: unknown };

/** Explicit exact data and evaluation selection; omitted evidence verifies nothing. @alpha */
export interface IPreviewRequest {
  /** Evaluation whose display status the caller wants to inspect. */
  readonly scope: IPreviewScope;
  /** Optional retained immutable result; absence never initiates work. */
  readonly reference?: ICompletedResultReference;
  /** Trusted owner evidence; mismatched scopes have no effect. */
  readonly evaluation?: IPreviewEvaluation;
}

/** Availability is framework metadata independent of author value truthiness. @alpha */
export type IPreview<T extends object> =
  | { readonly availability: 'unavailable'; readonly scope: IPreviewScope; readonly refresh: IPreviewRefresh }
  | { readonly availability: 'available'; readonly scope: IPreviewScope; readonly refresh: IPreviewRefresh;
      readonly freshness: 'current' | 'stale'; readonly reference: ICompletedResultReference;
      readonly value: IMaterializedView<T> };

/** Stateless observation over an existing Materialization reader lifetime. @alpha */
export interface IPreviewProjection {
  /** Inspect supplied evidence and expose the exact selected lazy value, without work. */
  project<T extends object>(request: IPreviewRequest): IPreview<T>;
}

/**
 * Compose display evidence with exact selected reads. The injected capability
 * grants no dispatch, source policy, acceptance mutation or writer access.
 * @alpha
 */
export function createPreviewProjection(materialization: Pick<IMaterialization, 'materializeView'>): IPreviewProjection {
  return Object.freeze({
    project<T extends object>(request: IPreviewRequest): IPreview<T> {
      const scope: IPreviewScope = Object.freeze({
        context: Object.freeze({ ...request.scope.context }),
        requestKey: request.scope.requestKey,
        step: Object.freeze({ ...request.scope.step }),
      });
      const evaluation = request.evaluation !== undefined && sameScope(scope, request.evaluation.scope)
        ? request.evaluation : undefined;
      const refresh: IPreviewRefresh = evaluation?.kind === 'threw'
        ? Object.freeze({ kind: 'failed', error: evaluation.error })
        : Object.freeze({ kind: 'none' });
      if (request.reference === undefined) {
        return Object.freeze({ availability: 'unavailable', scope, refresh });
      }
      const reference = Object.freeze({ ...request.reference });
      return Object.freeze({
        availability: 'available', scope, refresh, reference,
        freshness: isVerified(scope, reference, evaluation) ? 'current' : 'stale',
        value: materialization.materializeView<T>(reference, { path: [] }),
      });
    },
  });
}

/** Definition identity includes fanout ownership as well as slot/member names. */
function sameStep(left: IStepDescriptor, right: IStepDescriptor): boolean {
  return left.scope === right.scope && left.role === right.role && left.slot === right.slot
    && left.memberKey === right.memberKey && left.template === right.template && left.collection === right.collection;
}

/** A saved report from another evaluation cannot verify this selected request. */
function sameScope(left: IPreviewScope, right: IPreviewScope): boolean {
  return left.context.runId === right.context.runId && left.context.analysis === right.context.analysis
    && left.context.environment === right.context.environment && left.requestKey === right.requestKey
    && sameStep(left.step, right.step);
}

/** Exact references, never a mutable current head, bind evidence to displayed data. */
function sameReference(left: ICompletedResultReference, right: ICompletedResultReference): boolean {
  return left.kind === right.kind && left.locator === right.locator;
}

/** Only native successful evidence can mark this exact result current for preview. */
function isVerified(scope: IPreviewScope, reference: ICompletedResultReference, evaluation: IPreviewEvaluation | undefined): boolean {
  if (evaluation?.kind !== 'returned' || !sameStep(scope.step, evaluation.outcome.step)) { return false; }
  const outcome = evaluation.outcome;
  switch (outcome.kind) {
    case 'published': return sameReference(reference, outcome.reference);
    case 'reused': return sameReference(reference, outcome.reference)
      && sameReference(reference, outcome.acceptance.reference)
      && scope.context.environment === outcome.acceptance.environment;
    case 'refused':
    case 'skipped': return false;
  }
}
