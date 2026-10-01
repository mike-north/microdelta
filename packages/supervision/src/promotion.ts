/**
 * Recorded promotion between environments: Run Supervision's side of the
 * owner's 2026-09-30 environment decision (RUN-016, RUN-017). Environments
 * are namespaces of one store, and trial work satisfies production only
 * through an explicit, recorded promotion of exact results.
 *
 * Supervision owns *when* a promotion may be recorded: it is operator work of
 * a run, refused inside member or step work (CMP-9), recorded under the
 * store's writer lease obtained exactly as a normal request obtains it
 * (RUN-002), refused when stop intent is in force immediately before the
 * commit, and announced by an identifier-only event (RUN-013). History owns
 * *what* a promotion is: it validates the references, records them with the
 * lease's fence, and re-checks the lease at its commit. Supervision reaches
 * History only through the structural port declared here, which History's
 * durable store satisfies, so it never depends on History.
 */
import type { IRecoveryResult } from '@microdelta/resolution';

import type { IRunLease } from './contracts.js';

/**
 * An exact completed-result reference, as History issues and Resolution
 * reports it. A promotion names results only by such references; it never
 * carries their values.
 * @alpha
 */
export type IRunResultReference = Extract<IRecoveryResult, { readonly kind: 'recovered' }>['reference'];

/**
 * One environment of one analysis: the scope a promotion targets, and the
 * scope whose recorded promotions a run reads.
 * @alpha
 */
export interface IPromotionScope {
  /** The analysis; a promotion never crosses analyses. */
  readonly analysis: string;
  /** The environment within the analysis. */
  readonly environment: string;
}

/**
 * The versioned evidence an operator records with a promotion: why the
 * results were promoted, in the caller's own format. It is stored by History
 * and never offered in an event.
 * @alpha
 */
export interface IPromotionEvidence {
  /** The caller's evidence format identifier. */
  readonly format: string;
  /** The positive version of that format. */
  readonly formatVersion: number;
  /** The evidence content, in that format. */
  readonly content: unknown;
}

/**
 * One recorded promotion, as History returns it: exact results of other
 * environments admitted into the target environment, the evidence, and the
 * fence of the writer lease it was recorded under. Promoted results keep
 * their original provenance.
 * @alpha
 */
export interface IPromotionRecord {
  /** History's identity of the promotion, increasing in record order. */
  readonly promotionId: number;
  /** The environment the results were promoted into. */
  readonly target: IPromotionScope;
  /** The exact results promoted, each named once. */
  readonly references: readonly IRunResultReference[];
  /** Why the operator promoted them. */
  readonly evidence: IPromotionEvidence;
  /** The fence of the writer lease the promotion was recorded under. */
  readonly fence: number;
}

/**
 * An operator's request to promote exact results of the run's analysis.
 *
 * Note the asymmetry with {@link IRun.promotions}: a promotion targets
 * *another* environment, named by `into` (typically a trial run promotes its
 * results `into` production), while `promotions()` lists the promotions
 * recorded *into the run's own* environment (a production run lists what was
 * promoted into production).
 * @alpha
 */
export interface IPromotionRequest {
  /** The environment the results are promoted into; never the environment a named result was published in. */
  readonly into: string;
  /** The exact completed results promoted, each named once. */
  readonly references: readonly IRunResultReference[];
  /** Why the operator promotes them. */
  readonly evidence: IPromotionEvidence;
}

/**
 * Supervision's structural port to the store's promotion records. History's
 * durable store satisfies it as is; assembly supplies it in the run options.
 * `promoteResults` commits one promotion under a valid writer lease (History
 * re-checks the lease and refuses a stale one); `readPromotions` reads the
 * promotions recorded into one environment and needs no lease.
 * @alpha
 */
export interface IRunPromotionPort {
  /** Record one promotion under `lease`. */
  promoteResults(lease: IRunLease, request: { readonly target: IPromotionScope; readonly references: readonly IRunResultReference[]; readonly evidence: IPromotionEvidence }): IPromotionRecord;
  /** The promotions recorded into `query.target`, in record order. */
  readPromotions(query: { readonly target: IPromotionScope }): readonly IPromotionRecord[];
}

/**
 * The event a recorded promotion offers to run observers: the run, History's
 * promotion identity, the analysis and target environment, and the exact
 * references promoted. It has no field for the evidence or any value
 * (RUN-013).
 * @alpha
 */
export interface IPromotionEvent {
  readonly kind: 'promotion';
  /** The run that recorded the promotion. */
  readonly runId: string;
  /** History's identity of the promotion. */
  readonly promotionId: number;
  /** The analysis of the promoted results. */
  readonly analysis: string;
  /** The environment the results were promoted into. */
  readonly into: string;
  /** The exact results promoted. */
  readonly references: readonly IRunResultReference[];
}

/** Whether a value is a nonempty string. */
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Whether a value has the shape of an exact completed-result reference; History decides whether it names a result. */
function isReference(value: unknown): value is IRunResultReference {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'kind') === 'completed-result' && nonempty(Reflect.get(value, 'locator'));
}

/**
 * Read an operator's promotion request field by field, as untyped callers may
 * pass anything: a nonempty target environment, a list of reference-shaped
 * values, and evidence with a format and a positive version. Undefined when
 * it is malformed. History validates what the references name, and the
 * evidence content, at its commit.
 * @param request - The caller's request.
 * @returns The validated request, or undefined when malformed.
 */
export function readPromotionRequest(request: unknown): IPromotionRequest | undefined {
  if (typeof request !== 'object' || request === null) {
    return undefined;
  }
  const into: unknown = Reflect.get(request, 'into');
  const references: unknown = Reflect.get(request, 'references');
  const evidence: unknown = Reflect.get(request, 'evidence');
  if (!nonempty(into) || !Array.isArray(references) || typeof evidence !== 'object' || evidence === null) {
    return undefined;
  }
  const candidates: readonly unknown[] = references;
  if (!candidates.every(isReference)) {
    return undefined;
  }
  const format: unknown = Reflect.get(evidence, 'format');
  const formatVersion: unknown = Reflect.get(evidence, 'formatVersion');
  if (!nonempty(format) || typeof formatVersion !== 'number' || !Number.isSafeInteger(formatVersion) || formatVersion <= 0) {
    return undefined;
  }
  const content: unknown = Reflect.get(evidence, 'content');
  return { into, references: Object.freeze([...candidates]), evidence: Object.freeze({ format, formatVersion, content }) };
}
