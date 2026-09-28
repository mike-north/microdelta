/**
 * Reuse Resolution failures. Each code names one violated contract so callers
 * and tests distinguish, for example, a failed current policy from historical
 * integrity damage without parsing messages. An admission refusal and a
 * check-only stop are typed outcomes, not errors (REUSE-009); an error here
 * always means the request produced no successful current result.
 */

/**
 * The closed set of Resolution failure reasons.
 *
 * - `unbound-step`: the requested step, or a declared input/helper slot it needs, has no unique current binding.
 * - `policy-failure`: the current finality hook threw or returned something other than a boolean (REUSE-002).
 * - `invalid-outcome`: a source returned something other than a Resolution-minted outcome envelope (RES-004).
 * - `invalid-retention`: a source explicitly retained a carrier that is not its own eligible previous result (RES-004).
 * - `execution-failure`: an admitted source check or memo body threw or rejected.
 * - `unsupported-result`: a result is not supported Value data with a record or array root.
 * - `integrity`: retained historical evidence is missing, malformed or outside this store scope (A-10).
 * - `wrong-intent`: a request key already identifies a different execution intent (recovery or allocation).
 * - `admission-failure`: the injected admission port threw instead of deciding.
 * - `observer-failure`: a lifecycle observer threw before execution, so the affected call did not proceed.
 * - `invalid-request`: a request is malformed, for example an empty request key.
 * @alpha
 */
export type IResolutionErrorCode =
  | 'unbound-step'
  | 'policy-failure'
  | 'invalid-outcome'
  | 'invalid-retention'
  | 'execution-failure'
  | 'unsupported-result'
  | 'integrity'
  | 'wrong-intent'
  | 'admission-failure'
  | 'observer-failure'
  | 'invalid-request';

/**
 * A failed resolution. The underlying author, History or host failure, when
 * there is one, is preserved as `cause` rather than translated into success,
 * a miss or a retry.
 * @alpha
 */
export class ResolutionError extends Error {
  /** The violated contract. */
  public readonly code: IResolutionErrorCode;

  /**
   * @param code - The violated contract.
   * @param message - Human-readable diagnostic detail.
   * @param cause - The underlying failure, when one exists.
   */
  public constructor(code: IResolutionErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ResolutionError';
    this.code = code;
  }
}
