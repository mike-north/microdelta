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
 * - `operation-failed`: an external operation settled as failed: its provider refused it permanently, or its retry
 *   policy is exhausted (RUN-011). The step attempt may still handle it.
 * - `operation-deferred`: an external operation is deferred until a later time (RUN-011). Nothing was sent before that
 *   time; the step attempt can no longer publish or send, and its work stays pending.
 * - `operation-unknown`: an external operation's outcome is unknown and it may not be retried (RUN-012). Nothing was
 *   replayed; the step attempt can no longer publish or send, and its work stays pending until an operator settles it.
 * - `operation-unrecorded`: usage an operator supplied could not be made durable, so nothing was settled (ACC-007). An
 *   operation's own intent that cannot be made durable instead leaves its step pending on a short deferral.
 * - `operation-resolved`: an operator resolved the operation at this address as succeeded, so its effect happened and it
 *   is never sent again (RUN-012). It carries no value; the step attempt may handle it.
 * - `integrity`: a durable operation record Supervision wrote cannot be read back.
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
  | 'operation-failed'
  | 'operation-deferred'
  | 'operation-unknown'
  | 'operation-unrecorded'
  | 'operation-resolved'
  | 'integrity'
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
