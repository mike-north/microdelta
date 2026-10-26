/**
 * Contracts of Run Supervision's external operations: the declared handle
 * author code and adapters use for one logical external call, the outcomes
 * and retry policy it follows, the ports through which it persists, the
 * operator's settlement of an unknown operation, and the privacy-restricted
 * events it reports (RUN-011, RUN-012, RUN-013, RUN-014, ACC-003, ACC-005,
 * ACC-007; EXP-8 mechanisms 3 to 7 and its supervisor resolutions).
 *
 * An **external operation** is one logical external call, such as one paid
 * provider request. Supervision mints its stable identity before the first
 * send and keeps it for every retry, so a lost response is **unknown** rather
 * than silently replayed. Each network try is a **request attempt** with its
 * own identity. Before each send Supervision commits the operation's intent
 * through History's operation journal and records Accounting's usage intent
 * (intent before send); usage is acknowledged before the outcome is committed
 * (usage before outcome). Its outcome is `succeeded`, `failed`, `deferred`
 * (not before a time) or `unknown`; an operator may later resolve or abandon
 * an unknown one.
 *
 * Supervision owns the ports below structurally, as it owns its timer: it
 * imports neither History nor Accounting. Assembly supplies History's journal
 * port and Accounting's durable adapter, which satisfy them. Supervision never
 * touches History rows; it stores only its own opaque records under its own
 * collections.
 */
import type { IAdmissionRequest } from '@microdelta/resolution';

import type { IAbortSignal } from './control.js';
import type { IRunContext } from './contracts.js';

/**
 * A scoped subject and compatibility group, as Resolution presents admitted
 * work: the stable owner of an attempt's external operations across runs.
 * @alpha
 */
export type IOperationSubject = IAdmissionRequest['subject'];

/**
 * One observed quantity of a usage report: a nonnegative safe-integer amount
 * of an identifier unit such as `tokens.input`. Units are never converted
 * into one another (ACC-001).
 * @alpha
 */
export interface IOperationQuantity {
  /** The unit identifier; it never carries a value. */
  readonly unit: string;
  /** A nonnegative safe-integer amount. */
  readonly amount: number;
}

/**
 * A usage report an adapter received for one request attempt. Its identity
 * must be stable across redelivery: derive it from the provider's response
 * (a usage record or response identifier), never mint it per delivery.
 * Supervision acknowledges it with Accounting under the provider namespace
 * (`provider:<report>`), so it never collides with an operator's report.
 * @alpha
 */
export interface IOperationUsage {
  /** The provider-derived report identity, unique within the operation. */
  readonly report: string;
  /** Observed additive deltas, at most one per unit. */
  readonly quantities: readonly IOperationQuantity[];
}

/** A reusable, non-secret identity for the adapter and access context that interprets failures. @alpha */
export interface IRetrySourceScope {
  /** Adapter family, independent of a step or result identifier. */
  readonly source: string;
  /** Logical remote service, not an inferred hostname. */
  readonly service: string;
  /** Configured access context identity; never a credential or token. */
  readonly connection: string;
}

/** Small adapter-extracted provider facts that may inform a source policy. @alpha */
export interface IRetryFacts {
  /** Provider's HTTP status, when one exists. */
  readonly httpStatus?: number;
  /** Bounded provider code, without response payload or headers. */
  readonly providerCode?: string;
  /** Bounded, adapter-defined contextual conditions. */
  readonly conditions?: readonly string[];
}

/** One complete source decision; policy has no allowance or dispatch authority. @alpha */
export type IRetryDecision =
  | { readonly kind: 'retry-now' }
  | { readonly kind: 'retry-after'; readonly delayMilliseconds: number }
  | { readonly kind: 'stop' };

/** Normalized provider outcome supplied to a source retry policy. @alpha */
export type IRetryOutcome =
  | { readonly kind: 'failed'; readonly transient: boolean }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unknown' };

/** One bounded prior sent-attempt summary for the same logical operation and run. @alpha */
export interface IRetryAttemptSummary {
  /** Identity of this actual network attempt. */
  readonly requestAttempt: string;
  /** Normalized outcome recorded for this attempt. */
  readonly status: 'failed' | 'rate-limited' | 'unknown';
  /** Actual usage acknowledgment, where known; absence remains unknown. */
  readonly usage: IAttemptUsage;
  /** A previously accepted decision, when one exists. */
  readonly decision?: IRetryDecision;
}

/** Bounded current-run history; `sentAttempts` is authoritative despite truncation. @alpha */
export interface IRetryHistory {
  /** Actual sent attempts for this operation in the current private run instance. */
  readonly sentAttempts: number;
  /** Latest eight eligible prior attempts, oldest first. */
  readonly prior: readonly IRetryAttemptSummary[];
  /** Earlier eligible prior attempts omitted from `prior`. */
  readonly omittedPriorAttempts: number;
  /** Most recent accepted retry delay, not elapsed time or provider not-before. */
  readonly previousDelayMilliseconds?: number;
}

/** Readonly evidence for one retry choice; it grants no supervised execution capability. @alpha */
export interface IRetryDecisionInput {
  /** Current run attribution and analysis/environment scope. */
  readonly context: IRunContext;
  /** Exact source registration selected for this operation. */
  readonly source: IRetrySourceScope;
  /** Stable logical operation identity. */
  readonly operation: string;
  /** The sent request attempt whose response is being classified. */
  readonly requestAttempt: string;
  /** Adapter-normalized outcome, separate from provider facts. */
  readonly outcome: IRetryOutcome;
  /** Detached, bounded facts extracted by the adapter. */
  readonly facts: IRetryFacts;
  /** Strongest known independent provider/durable not-before floor. */
  readonly knownNotBefore?: number;
  /** Bounded actual history for this operation and run. */
  readonly history: IRetryHistory;
  /** Aborted when this classification wait is cancelled by run control. */
  readonly signal: IAbortSignal;
}

/** Exact scoped callback reused by a source adapter across matching operations. @alpha */
export interface ISourceRetryPolicy {
  /** Unique, non-secret registration identifier. */
  readonly id: string;
  /** Exact source/service/connection tuple selected by the adapter. */
  readonly scope: IRetrySourceScope;
  /** Make one complete retry decision for the supplied bounded observation. */
  decide(input: IRetryDecisionInput): IRetryDecision | Promise<IRetryDecision>;
}

/**
 * How an adapter classifies one request attempt's response. Only the adapter
 * knows its provider's meaning; Supervision applies the retry policy to it.
 *
 * - `succeeded`: the provider applied the request and answered `value`.
 * - `failed`: the provider refused it and applied nothing. `transient`
 *   failures (for example `unavailable`) retry only under the author's policy;
 *   others are permanent.
 * - `rate-limited`: a rate or quota limit refused it and applied nothing. With
 *   a `retryAt` time it is deferred durably until then and retried by default;
 *   without one it is a transient failure.
 * - `unknown`: whether the provider applied it is not known, for example a
 *   lost response. A rejected `perform` means the same. A finite acquisition
 *   allowance can permit another request without an effect-safety hint.
 *
 * `error` is the adapter's own detail for the author's body; Supervision
 * never records it, reports it or puts it in a diagnostic (RUN-013).
 * @alpha
 */
export type IOperationResponse<T> =
  | { readonly kind: 'succeeded'; readonly value: T; readonly usage?: IOperationUsage }
  | { readonly kind: 'failed'; readonly transient: boolean; readonly error?: unknown; readonly usage?: IOperationUsage; readonly retryFacts?: IRetryFacts; readonly notBefore?: number }
  | { readonly kind: 'rate-limited'; readonly retryAt?: number; readonly usage?: IOperationUsage; readonly retryFacts?: IRetryFacts; readonly notBefore?: number }
  | { readonly kind: 'unknown'; readonly usage?: IOperationUsage; readonly retryFacts?: IRetryFacts; readonly notBefore?: number };

/**
 * What one request attempt's `perform` receives: the abort signal a hard stop
 * aborts, the stable operation identity, the request attempt's identity and,
 * when the provider supports idempotency keys, the key to send (the operation
 * identity, identical on every retry of the operation).
 * @alpha
 */
export interface IOperationSend {
  /** Aborts when a hard stop takes effect; the adapter should abandon its request. */
  readonly signal: IAbortSignal;
  /** The stable operation identity, shared by every retry. */
  readonly operation: string;
  /** This request attempt's identity. */
  readonly requestAttempt: string;
  /** The provider idempotency key to send, when the request declared provider idempotency. */
  readonly idempotencyKey: string | undefined;
}

/**
 * An author's finite override for one direct acquisition operation. Without
 * one, three total sent attempts and bounded increasing backoff apply to
 * classified retryable responses. Historical rate-only settings can restrict
 * that total, but never grant extra unknown/transient sends (RUN-011).
 * @alpha
 */
export interface IOperationRetryPolicy {
  /**
   * The most actually sent request attempts in one analysis-run invocation,
   * including initial, unknown, transient and rate-refused sends. A positive
   * safe integer; three total when absent. A new run has fresh allowance.
   */
  readonly maxAttempts?: number;
  /** Fixed wait override for classified retries, holding no network permit; absent uses increasing 2s/4s bounded backoff. */
  readonly backoffMilliseconds?: number;
  /**
   * Legacy restrictive subcap on rate-refusal retries. It is never an
   * independent allowance above `maxAttempts`; five when absent. Retained for
   * existing alpha callers and v1 records pending a separate API decision.
   */
  readonly rateLimitRetries?: number;
}

/**
 * One declared external operation, called through the live run's execution
 * controls from inside an admitted step attempt's body.
 *
 * The operation is addressed by the step attempt's subject, `name` and
 * `binding`: a call at an address whose earlier operation is still unsettled
 * (deferred, unknown) reuses that operation's identity; a settled address or
 * a changed binding is a new operation (RUN-012). Authors isolate each paid
 * call in its own child step, because the reuse unit is the step and a
 * resumed step re-runs its body (EXP-8 resolution 3).
 * @alpha
 */
export interface IOperationRequest<T> {
  /**
   * The operation's name within its step, an identifier
   * (`^[a-z][a-z0-9_.:-]{0,63}$`). It appears in events, so it must never
   * embed a value.
   */
  readonly name: string;
  /**
   * The canonical request binding: an opaque digest or identifier of the
   * request's parameters that the author computes. Equal bindings are the same
   * intended request; a changed binding is a new operation. It is stored in
   * Supervision's journal records only, never in events or diagnostics; it
   * should be a digest, not the parameters themselves.
   */
  readonly binding: string;
  /**
   * Historical effect-safety declaration retained for source compatibility
   * and journal audit. It is not required for acquisition retry authority.
   */
  readonly safeToRepeat?: boolean;
  /**
   * The provider deduplicates by idempotency key: each send carries the
   * operation identity as its key. This can reduce duplicate effects, but is
   * neither retry authority nor proof of a charge total.
   */
  readonly providerIdempotency?: boolean;
  /** The author's retry policy. */
  readonly retry?: IOperationRetryPolicy;
  /** Exact adapter/service/access identity used to select a reusable source retry policy. */
  readonly retrySource?: IRetrySourceScope;
  /** Send one request attempt and classify its response. A rejection is an unknown outcome. */
  perform(send: IOperationSend): Promise<IOperationResponse<T>>;
  /**
   * Ask the provider to cancel remote work after a hard stop aborted a send:
   * `cancelled` when confirmed, `running` when it continues. Absent, failing
   * or unanswered, the remote state is `unknown`. It must be bounded.
   */
  cancel?(): Promise<'cancelled' | 'running'>;
}

/**
 * An operation's durable status. `pending` while a request attempt is in
 * flight; `deferred` until its "not before" time; `unknown` while its
 * outcome is not known; `succeeded`, `failed` and `cancelled` (a provider
 * confirmed cancellation after a hard stop) are settled; `resolved` and
 * `abandoned` record an operator's settlement of an unknown operation (a
 * resolution as succeeded keeps its address consumed). `retry-exhausted`
 * records a known recoverable refusal that spent this invocation's allowance;
 * its address remains held for a later run.
 * `pending`, `deferred`, `unknown` and `retry-exhausted` are unsettled: they
 * keep their required work pending.
 * @alpha
 */
export type IOperationStatus = 'pending' | 'succeeded' | 'failed' | 'deferred' | 'unknown' | 'cancelled' | 'resolved' | 'abandoned' | 'retry-exhausted';

/**
 * One request attempt's durable status. `not-sent` means stop intent or a
 * failed intent write prevented the send after the intent was committed.
 * @alpha
 */
export type IRequestAttemptStatus = 'pending' | 'succeeded' | 'failed' | 'rate-limited' | 'unknown' | 'cancelled' | 'not-sent';

/**
 * What is known about a request attempt's remote work after a hard stop
 * aborted it locally: provider-confirmed `cancelled`, still `running`, or
 * `unknown`. Durable in the journal, so a later run and the operator see it.
 * @alpha
 */
export type IOperationRemoteState = 'cancelled' | 'running' | 'unknown';

/**
 * Whether a request attempt's usage report reached Accounting: acknowledged
 * durably, not recorded (its usage stays unknown), or no report was received.
 * @alpha
 */
export type IAttemptUsage = 'acknowledged' | 'unrecorded' | 'none';

/**
 * One request attempt as an operator inspects it: identifiers, statuses and
 * time only, never values.
 * @alpha
 */
export interface IRequestAttemptView {
  /** The request attempt's identity. */
  readonly requestAttempt: string;
  /** The run that sent it. */
  readonly run: string;
  /** History's identity of the step attempt it belonged to. */
  readonly stepAttempt: string;
  /** Its durable status. */
  readonly status: IRequestAttemptStatus;
  /** The remote state recorded after a hard stop aborted it, if one did. */
  readonly remote: IOperationRemoteState | undefined;
  /** Whether its usage report reached Accounting; undefined while in flight. */
  readonly usage: IAttemptUsage | undefined;
}

/**
 * An operator's recorded settlement of an unknown operation.
 * @alpha
 */
export interface IOperationSettlementRecord {
  /** Whether the operator resolved or abandoned it. */
  readonly action: 'resolve' | 'abandon';
  /** The outcome a resolution asserts; undefined for an abandonment. */
  readonly outcome: 'succeeded' | 'failed' | undefined;
  /** The operator's identifier. */
  readonly operator: string;
  /** When it was recorded, in epoch milliseconds of Supervision's timer. */
  readonly at: number;
  /** The operator-namespaced report identity of usage the operator supplied, if any. */
  readonly report: string | undefined;
}

/**
 * One external operation as an operator inspects it: identities, statuses,
 * times, its settlement and any resolution that settlement superseded, never
 * its binding or any value.
 * @alpha
 */
export interface IOperationView {
  /** The stable operation identity. */
  readonly operation: string;
  /** The subject whose step attempts own the operation. */
  readonly subject: IOperationSubject;
  /** The designated member key of the work, if it belongs to a member. */
  readonly member: string | undefined;
  /** The operation's name within its step. */
  readonly name: string;
  /** Its durable status. */
  readonly status: IOperationStatus;
  /** For a deferred operation, the earliest time it may be retried. */
  readonly notBefore: number | undefined;
  /** Every request attempt, in order. */
  readonly attempts: readonly IRequestAttemptView[];
  /** The operator's settlement, once recorded. */
  readonly settlement: IOperationSettlementRecord | undefined;
  /**
   * The operator's earlier resolution as succeeded that a later abandonment
   * superseded, kept for the audit trail: who asserted the effect happened,
   * when, and the usage report it acknowledged. Undefined unless the
   * operation was abandoned after such a resolution.
   */
  readonly resolution: IOperationSettlementRecord | undefined;
}

/**
 * An operator's settlement of one unknown operation (EXP-8 resolution 5).
 *
 * - `resolve` asserts its outcome. Usage the operator learned is acknowledged
 *   through Accounting under the operator namespace (`operator:<report>`),
 *   attributed to the operation's last request attempt.
 *   - As `succeeded`, the effect happened: the address stays consumed, and a
 *     later call at it mints and sends nothing and fails with
 *     `operation-resolved`, carrying no value. A resolution that supplies a
 *     result is M6 work.
 *   - As `failed`, nothing happened: the address is free, and a later call
 *     makes a new operation.
 * - `abandon` gives it up; its usage stays unknown, because unknown is never
 *   zero (ACC-005). The address is free: abandoning is the operator's
 *   explicit authorization of a possible second effect. An operation already
 *   resolved as `succeeded` may also be abandoned, which frees its consumed
 *   address; a second resolution, or abandoning one resolved as `failed`
 *   (whose address is already free), is refused.
 *
 * Either one settles the operation, so its step's work is no longer blocked.
 * @alpha
 */
export type IOperationSettlement =
  | {
      readonly action: 'resolve';
      readonly operation: string;
      /** The operator's identifier. */
      readonly operator: string;
      /** The outcome the operator asserts. */
      readonly outcome: 'succeeded' | 'failed';
      /** Usage the operator learned, if any. */
      readonly usage?: IOperationUsage;
    }
  | {
      readonly action: 'abandon';
      readonly operation: string;
      /** The operator's identifier. */
      readonly operator: string;
    };

/**
 * Why a step's work is blocked by an unsettled external operation: deferred
 * until `notBefore`, a known recoverable refusal exhausted this run's
 * allowance, or an unknown outcome whose current run's finite policy is
 * exhausted. A source-classification block preserves a known provider
 * response while its one live callback waits, or reports that no live owner
 * can finish the pending decision. `unrecorded` means a lost writer lease
 * could not settle the outcome (EXP-8 ruling R). `not-repeat-safe` remains in the alpha union for
 * old consumers but is not emitted for acquisition by the current engine.
 * @alpha
 */
export type IOperationBlock =
  | { readonly kind: 'deferred'; readonly operation: string; readonly notBefore: number }
  | { readonly kind: 'policy-exhausted'; readonly operation: string }
  | { readonly kind: 'classification'; readonly operation: string; readonly reason: 'waiting' | 'interrupted' }
  | { readonly kind: 'unknown-outcome'; readonly operation: string; readonly reason: 'not-repeat-safe' | 'policy-exhausted' | 'unrecorded' };

/**
 * How a run treats work deferred until a later time once only deferred work
 * remains: `sleep` releases the writer lease, waits until the earliest time
 * (any stop ends the wait) and resumes; `exit` returns at once, reporting the
 * time it is waiting until. Later runs honor the time in both modes.
 * @alpha
 */
export type IDeferralMode = 'sleep' | 'exit';

/**
 * One journal record value: an owner-defined format tag, its version and
 * Value-encodable content. Structurally History's versioned record.
 * @alpha
 */
export interface IJournalRecordValue {
  /** Supervision's record format identity. */
  readonly format: string;
  /** Its positive safe-integer version. */
  readonly formatVersion: number;
  /** The record content, which History stores without interpreting it. */
  readonly content: unknown;
}

/**
 * One current journal revision as Supervision reads it.
 * @alpha
 */
export interface IJournalEntry {
  /** The record's key within its collection. */
  readonly key: string;
  /** The revision number, the expected revision of the next compare-and-set write. */
  readonly revision: number;
  /** The writer fence under which this revision was committed. */
  readonly fence: number;
  /** The record. */
  readonly record: IJournalRecordValue;
}

/**
 * The address of one journal record.
 * @alpha
 */
export interface IJournalLocation {
  /** The analysis. */
  readonly analysis: string;
  /** The environment namespace. */
  readonly environment: string;
  /** Supervision's collection. */
  readonly collection: string;
  /** The record key. */
  readonly key: string;
}

/**
 * One compare-and-set write of a journal commit.
 * @alpha
 */
export interface IJournalWriteRequest {
  /** Supervision's collection. */
  readonly collection: string;
  /** The record key. */
  readonly key: string;
  /** The revision last read, or 0 for a new key. */
  readonly expectedRevision: number;
  /** The new record. */
  readonly record: IJournalRecordValue;
}

/**
 * Supervision's view of History's operation journal (RUN-011/012). Assembly
 * opens it over the run's store with {@link operationJournalDeclaration}.
 * Commits are atomic and fenced by the writer lease; reads need no lease.
 * Supervision decides what its records mean; History only stores them.
 * @alpha
 */
export interface IOperationJournalPort {
  /** Commit every write atomically under the writer lease, or refuse the whole commit. */
  commit(
    lease: { readonly holder: string; readonly fence: number; readonly expiresAt: number },
    request: { readonly analysis: string; readonly environment: string; readonly writes: readonly IJournalWriteRequest[] },
  ): readonly IJournalEntry[];
  /** The current revision at one address, if any. */
  read(address: IJournalLocation): IJournalEntry | undefined;
  /** The current revision of every key of one collection, in order of first write. */
  list(query: { readonly analysis: string; readonly environment: string; readonly collection: string }): readonly IJournalEntry[];
}

/**
 * Whom a usage intent belongs to, as Accounting records it: the run, the
 * member (or `null`) and the step attempt (or `null`).
 * @alpha
 */
export interface IOperationAttribution {
  /** The run identifier. */
  readonly run: string;
  /** The designated member key, or `null`. */
  readonly member: string | null;
  /** The step attempt identifier, or `null`. */
  readonly stepAttempt: string | null;
}

/**
 * Supervision's view of Resource Accounting's durable adapter (ACC-003,
 * ACC-005, ACC-007). Every write commits before it returns and needs no
 * writer lease; any thrown error means no acknowledgment was issued. An error
 * whose `durability` is `'unknown'` means the write ran but its commit was not
 * confirmed, so it may have landed; any other thrown error recorded nothing.
 * An adapter, or any wrapper around one, must preserve that mark on every
 * error where the write may have landed: dropping it makes Supervision treat
 * a landed intent as never recorded, so its usage would read unknown forever.
 * @alpha
 */
export interface IOperationAccounting {
  /** Durably record that a request attempt is about to be sent. */
  recordUsageIntent(intent: {
    readonly environment: string;
    readonly operation: string;
    readonly requestAttempt: string;
    readonly attribution: IOperationAttribution;
  }): 'recorded' | 'duplicate';
  /** Durably acknowledge one usage report keyed by (operation, report). */
  acknowledgeUsage(report: {
    readonly environment: string;
    readonly operation: string;
    readonly requestAttempt: string;
    readonly report: string;
    readonly quantities: readonly IOperationQuantity[];
  }): { readonly kind: 'acknowledged' | 'duplicate' | 'conflict' };
}

/**
 * The ports a run's external operations need, supplied by assembly:
 * History's journal port over the run's store, Accounting's durable adapter,
 * and the host's random identifier source that makes operation identities
 * (and so provider idempotency keys) globally unique. The type requires all
 * three; a run also refuses untyped configuration that lacks one.
 * @alpha
 */
export interface IRunOperationPorts {
  /** History's operation journal, opened with {@link operationJournalDeclaration}. */
  readonly journal: IOperationJournalPort;
  /** Resource Accounting's durable adapter. */
  readonly accounting: IOperationAccounting;
  /** The host's random identifier source, structurally the Machine's random identifier capability. */
  readonly random: IRunRandom;
}

/**
 * Positions of one external operation, as run observers see them:
 *
 * - `request-started`: the intent is durable and the provider callback has
 *   been invoked for this request attempt; a stop observed after the intent
 *   but before that invocation instead leaves a not-sent attempt;
 * - `request-settled`: the attempt settled with a status (and remote state
 *   after a hard stop);
 * - `usage-acknowledged` / `usage-unrecorded`: its usage report reached
 *   Accounting durably, or did not (its usage stays unknown);
 * - `retry-scheduled`: a retry waits (a backoff, or a deferral with `notBefore`);
 * - `retry-started`: a retry or resumed deferral begins under the same identity;
 * - `retry-exhausted`: the policy allows no further attempt;
 * - `blocked`: an unsettled operation refused a call or an admission;
 * - `recovered`: an attempt left in flight by a run that died or lost its
 *   lease is recorded unknown;
 * - `resolved` / `abandoned`: an operator settled an unknown operation.
 * @alpha
 */
export type IOperationPhase =
  | 'request-started'
  | 'request-settled'
  | 'usage-acknowledged'
  | 'usage-unrecorded'
  | 'retry-scheduled'
  | 'retry-started'
  | 'retry-exhausted'
  | 'blocked'
  | 'recovered'
  | 'resolved'
  | 'abandoned';

/**
 * The closed reason codes operation events carry (never free text):
 * `rate-limited`, `transient` and `permanent` classify a refusal;
 * `lost-response` an unknown outcome; `policy-exhausted` why the current
 * run cannot retry it (`not-repeat-safe` remains for alpha compatibility);
 * `not-before` a
 * deferral; `classification-waiting` or `classification-interrupted` a known
 * response awaiting a live decision or left without authorized ownership;
 * `stopped` stop intent; `lease-lost` a commit the writer lease no
 * longer authorizes; `recovered-after-crash` an attempt a dead run left in
 * flight; `unrecorded` a usage write that issued no acknowledgment;
 * `conflict` a redelivered report that disagreed with the recorded one;
 * `operator` an operator's action.
 * @alpha
 */
export type IOperationReason =
  | 'rate-limited'
  | 'transient'
  | 'permanent'
  | 'lost-response'
  | 'not-repeat-safe'
  | 'policy-exhausted'
  | 'not-before'
  | 'classification-waiting'
  | 'classification-interrupted'
  | 'stopped'
  | 'lease-lost'
  | 'recovered-after-crash'
  | 'unrecorded'
  | 'conflict'
  | 'operator';

/**
 * One event of an external operation. It carries identifiers, closed status
 * and reason codes, times, usage quantities with identifier units, and the
 * remote state only: never the binding, arguments, a response value, a
 * provider body or an error message (RUN-013). Usage units that are not
 * identifiers are dropped from the event (the durable report keeps them).
 * @alpha
 */
export interface IOperationEvent {
  /** Discriminates operation events. */
  readonly kind: 'operation';
  /** The run the event belongs to. */
  readonly runId: string;
  /** The position. */
  readonly phase: IOperationPhase;
  /** When it happened, in epoch milliseconds of Supervision's timer. */
  readonly at: number;
  /** The stable operation identity. */
  readonly operation: string;
  /** The operation's identifier name. */
  readonly name: string;
  /** The designated member key of the work, if any (a declared identifier, EXP-8 resolution 7). */
  readonly member: string | undefined;
  /** History's identity of the step attempt, if any. */
  readonly stepAttempt: string | undefined;
  /** The request attempt, if the event concerns one. */
  readonly requestAttempt: string | undefined;
  /** The operation's or request attempt's status after this position, if any. */
  readonly status: IOperationStatus | IRequestAttemptStatus | undefined;
  /** A closed reason code, if any. */
  readonly reason: IOperationReason | undefined;
  /** The "not before" time of a deferral or backoff, if any. */
  readonly notBefore: number | undefined;
  /** Usage quantities with identifier units, if the event reports usage. */
  readonly usage: readonly IOperationQuantity[] | undefined;
  /** The remote state recorded after a hard stop, if any. */
  readonly remote: IOperationRemoteState | undefined;
}

/**
 * One event of a run's waiting for deferred work: `sleeping` (the run
 * released its writer lease, if it held one, and waits until `until`),
 * `exiting` (exit mode returns waiting until `until`), `resumed` (the wait
 * ended and the work is presented again) or `stopped` (stop intent ended the
 * wait). After `resumed` the pass takes the writer lease as any normal request
 * does, waiting under the run's `writerWait` policy.
 * @alpha
 */
export interface IWaitEvent {
  /** Discriminates wait events. */
  readonly kind: 'wait';
  /** The run the event belongs to. */
  readonly runId: string;
  /** The position. */
  readonly phase: 'sleeping' | 'exiting' | 'resumed' | 'stopped';
  /** The earliest "not before" time of the deferred work. */
  readonly until: number;
  /** Whether the run released its writer lease for the wait. */
  readonly released: boolean;
}

/**
 * The host randomness Supervision needs, structurally identical to the
 * Machine's random identifier capability: fresh identifiers of 128 secure
 * random bits as lowercase hexadecimal. Operation identities, which are also
 * provider idempotency keys, draw on it so they never repeat across stores,
 * processes or hosts sharing a provider account. Assembly supplies it.
 * @alpha
 */
export interface IRunRandom {
  /** A fresh identifier of 32 lowercase hexadecimal characters. */
  randomIdentifier(): string;
}

/** The collection of Supervision's operation records. @alpha */
export const operationsCollection = 'microdelta.supervision.operations';

/**
 * The collection of Supervision's per-subject index of unsettled operations:
 * which operations at which addresses still block a subject's work. @alpha
 */
export const blocksCollection = 'microdelta.supervision.blocks';

/** The operation record format identity. @alpha */
export const operationFormat = 'microdelta.supervision.operation';

/** The block index record format identity. @alpha */
export const blocksFormat = 'microdelta.supervision.blocks';

/**
 * The journal formats and versions Supervision reads and writes; assembly
 * opens History's journal port with exactly this declaration.
 * @alpha
 */
export const operationJournalDeclaration: { readonly formats: readonly { readonly format: string; readonly versions: readonly number[] }[] } = Object.freeze({
  formats: Object.freeze([
    Object.freeze({ format: operationFormat, versions: Object.freeze([1, 2, 3, 4]) }),
    Object.freeze({ format: blocksFormat, versions: Object.freeze([1]) }),
  ]),
});
