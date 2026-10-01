/**
 * Run Supervision failures. Each code names one violated run-lifetime or
 * supervision contract, so callers distinguish a lookup outside a live run
 * from a closed run or a composition-phase lookup without parsing messages.
 * Admission denial is a typed Resolution outcome, never an error here.
 */
import type { IWriterAttempt } from './contracts.js';

/**
 * The closed set of Supervision failure reasons.
 *
 * - `outside-run`: runtime context was looked up with no live run in the current asynchronous execution (DOM-2, RUN-001).
 * - `run-closed`: a closed run was asked to accept new work, or its context was looked up through an escaped callback (RUN-001).
 * - `composition-phase`: runtime context was looked up, or a run started, while a composition was being constructed (CMP-9).
 * - `observer-failure`: an observer threw before ordinary work began, so that call did not proceed (REUSE-009).
 * - `writer-busy`: a normal request waited for storage's single-writer lease until the operator's deadline passed
 *   while another process held it, or while storage stayed too busy to decide (RUN-002 owner decision). It is
 *   always a {@link WriterBusyError}, which names the holder.
 * - `invalid-request`: a run or request was malformed, for example an empty environment or ordinary-work label.
 * - `stopped`: stop intent refused or aborted a send, a permit wait or a wait for a time (RUN-014). The
 *   step attempt it belonged to can no longer publish; its body may let this propagate. It also ends a
 *   normal request's wait for the writer lease, before that request has done anything.
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
  | 'writer-busy'
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

/**
 * The last thing a waiting request observed before its deadline passed:
 * another unexpired holder, or storage contention with whatever writer was
 * recorded at that moment. These are the writer port's non-granting outcomes.
 * @alpha
 */
export type IWriterBusyObservation = Exclude<IWriterAttempt, { readonly kind: 'acquired' }>;

/**
 * The typed writer-busy outcome (RUN-002 owner decision): a normal request
 * waited for storage's single-writer lease until the operator's deadline
 * passed without obtaining it. It reports the request's final observation,
 * taken at or after the deadline, never an earlier or guessed one: the holder
 * that still held an unexpired lease, or storage contention (`SQLITE_BUSY`
 * exhaustion) together with the writer recorded then. Nothing was written on
 * the request's behalf, and the holder's lease is untouched.
 * @alpha
 */
export class WriterBusyError extends SupervisionError {
  /** The holder the final observation named; undefined only when contention prevented reading one. */
  public readonly holder: string | undefined;
  /** That holder's lease expiry in storage's clock domain, when known. */
  public readonly expiresAt: number | undefined;
  /** The operator deadline that passed (whole UTC epoch milliseconds). */
  public readonly deadline: number;
  /** Whether the final observation was storage contention rather than an observed unexpired holder. */
  public readonly contended: boolean;
  /**
   * Whether the recorded holder is this very run: its own renewal stayed busy
   * until the deadline, so it may still hold a valid lease it could not extend.
   */
  public readonly heldByThisRun: boolean;

  /**
   * @param observation - The request's final observation, at or after the deadline.
   * @param deadline - The operator deadline that passed.
   */
  public constructor(observation: IWriterBusyObservation, deadline: number) {
    super('writer-busy', writerBusyMessage(observation, deadline));
    this.name = 'WriterBusyError';
    this.holder = observation.holder;
    this.expiresAt = observation.expiresAt;
    this.deadline = deadline;
    this.contended = observation.kind === 'contended';
    this.heldByThisRun = observation.kind === 'contended' && observation.heldByThisRun;
  }
}

/** The diagnostic of a writer-busy outcome; it names identifiers and times only, never stored values. */
function writerBusyMessage(observation: IWriterBusyObservation, deadline: number): string {
  const passed = `the operator deadline ${String(deadline)} passed`;
  if (observation.kind === 'held') {
    return `Storage's writer lease is held by ${observation.holder} until ${String(observation.expiresAt)}; ${passed}`;
  }
  if (observation.heldByThisRun) {
    return `Storage stayed too busy to renew this run's writer lease (${observation.detail}); this run is the recorded holder ${String(observation.holder)} until ${String(observation.expiresAt)}, contended; ${passed}`;
  }
  const recorded = observation.holder === undefined
    ? 'no recorded holder could be read'
    : `the recorded holder is ${observation.holder} until ${String(observation.expiresAt)}`;
  return `Storage stayed too busy to grant the writer lease (${observation.detail}); ${recorded}; ${passed}`;
}
