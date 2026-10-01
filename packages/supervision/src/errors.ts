/**
 * Run Supervision failures. Each code names one violated run-lifetime or
 * supervision contract, so callers distinguish a lookup outside a live run
 * from a closed run or a composition-phase lookup without parsing messages.
 * Admission denial is a typed Resolution outcome, never an error here.
 */

/**
 * The closed set of Supervision failure reasons.
 *
 * - `outside-run`: runtime context was looked up with no live run in the current asynchronous execution (DOM-2, RUN-001).
 * - `run-closed`: a closed run was asked to accept new work, or its context was looked up through an escaped callback (RUN-001).
 * - `composition-phase`: runtime context was looked up, or a run started, while a composition was being constructed (CMP-9).
 * - `observer-failure`: an observer threw before ordinary work began, so that call did not proceed (REUSE-009).
 * - `writer-unavailable`: the run's writer port could not provide storage's single-writer lease for a storage-mutating request.
 * - `invalid-request`: a run or request was malformed, for example an empty environment or ordinary-work label.
 * - `stopped`: stop intent refused or aborted a send, a permit wait or a wait for a time (RUN-014). The
 *   step attempt it belonged to can no longer publish; its body may let this propagate.
 * - `undeclared-call`: a run operation was called from inside a member's work or a step attempt
 *   (author code that kept the run). What it resolves or reads would enter no evidence of the
 *   calling body, so it is refused before any admission or lane (CMP-9, RUN-002).
 * @alpha
 */
export type ISupervisionErrorCode =
  | 'outside-run'
  | 'run-closed'
  | 'composition-phase'
  | 'observer-failure'
  | 'writer-unavailable'
  | 'invalid-request'
  | 'stopped'
  | 'undeclared-call';

/**
 * A failed supervision request. An underlying failure, when there is one, is
 * preserved as `cause` rather than translated into success or a retry.
 * @alpha
 */
export class SupervisionError extends Error {
  /** The violated contract. */
  public readonly code: ISupervisionErrorCode;

  /**
   * @param code - The violated contract.
   * @param message - Human-readable diagnostic detail.
   * @param cause - The underlying failure, when one exists.
   */
  public constructor(code: ISupervisionErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SupervisionError';
    this.code = code;
  }
}
