/**
 * EXP-8's privacy-restricted inspection event schema and observer isolation.
 * Events are the only supervision/accounting evidence handed to observers and
 * presentation. By construction they carry identifiers, closed status and
 * reason vocabularies, fake-clock timings, usage figures and exact result
 * references, and nothing else: no request binding, argument, output or
 * provider body, and no free-form error text (which could embed any of those).
 * Observers are isolated: a throwing observer yields a structured diagnostic
 * and never alters execution or committed results (A-19, EXP-8).
 */
import type { IStopLevel } from './control.js';

/** Every event kind the candidate emits; the vocabulary is closed. @internal */
export type IEventKind =
  | 'lease-acquired'
  | 'lease-released'
  | 'recovered'
  | 'member-reused'
  | 'member-waiting'
  | 'member-blocked'
  | 'member-not-admitted'
  | 'step-admitted'
  | 'request-started'
  | 'request-settled'
  | 'usage-acknowledged'
  | 'retry-scheduled'
  | 'retry-started'
  | 'retry-exhausted'
  | 'stop-requested'
  | 'stop-escalated'
  | 'local-abort'
  | 'remote-cancel-requested'
  | 'remote-state'
  | 'step-settled'
  | 'published'
  | 'run-waiting'
  | 'run-settled';

/** Status words an event may state; each names a recorded fact, never a value. @internal */
export type IEventStatus =
  | 'succeeded'
  | 'not-applied'
  | 'unknown'
  | 'cancelled'
  | 'running'
  | 'deferred'
  | 'failed'
  | 'interrupted'
  | 'unknown-outcome'
  | 'completed'
  | 'acknowledged'
  | 'duplicate'
  | 'conflict'
  | 'waiting'
  | 'stopped'
  | 'settled'
  | 'writer-busy';

/**
 * Why something happened, as a closed code. Provider error messages and body
 * exceptions are deliberately reduced to one of these codes.
 * @internal
 */
export type IReasonCode =
  | 'rate-limited'
  | 'unavailable'
  | 'rejected'
  | 'lost-response'
  | 'stop-soft'
  | 'stop-hard'
  | 'deadline'
  | 'policy-exhausted'
  | 'no-policy'
  | 'not-repeat-safe'
  | 'body-failed'
  | 'partial-output-discarded'
  | 'recovered-after-crash';

/**
 * One inspection event. Identifier fields are store-allocated or author-chosen
 * member keys; `quantities` are usage figures by unit; `reference` is an exact
 * result reference; `at` and `notBefore` are fake-clock milliseconds.
 * @internal
 */
export interface IEvent {
  readonly sequence: number;
  readonly at: number;
  readonly kind: IEventKind;
  readonly runId: string;
  readonly member?: string;
  readonly stepAttemptId?: string;
  readonly operationId?: string;
  readonly requestAttemptId?: string;
  readonly status?: IEventStatus;
  readonly reason?: IReasonCode;
  readonly level?: IStopLevel;
  readonly quantities?: Readonly<Record<string, number>>;
  readonly reference?: string;
  readonly notBefore?: number;
  readonly fence?: number;
}

/** The fields a producer supplies; sequence, time and run are stamped by the log. @internal */
export type IEventFields = Omit<IEvent, 'sequence' | 'at' | 'runId'>;

/** Structured diagnostic codes. There is intentionally no message field. @internal */
export type IDiagnosticCode = 'observer-failed' | 'usage-conflict' | 'usage-not-durable' | 'acknowledgment-lost' | 'body-failed';

/** A diagnostic: a code plus identifiers, with the same privacy rule as events. @internal */
export interface IDiagnostic {
  readonly code: IDiagnosticCode;
  readonly at: number;
  readonly observer?: number;
  readonly sequence?: number;
  readonly member?: string;
  readonly operationId?: string;
  readonly requestAttemptId?: string;
}

/** An inspection consumer. It observes; it cannot veto, retry or alter execution (ACC-008, RUN-013). @internal */
export type IObserver = (event: IEvent) => void;

/**
 * The run's event log. Events are appended before observers see them, so the
 * log is complete even when every observer throws.
 * @internal
 */
export class EventLog {
  readonly events: IEvent[] = [];
  readonly diagnostics: IDiagnostic[] = [];

  constructor(
    private readonly now: () => number,
    private readonly observers: readonly IObserver[],
  ) {}

  /** The run identifier stamped on every event; set once the lease is acquired. */
  runId = 'run-unassigned';

  /** Append and deliver a frozen event; observer exceptions become diagnostics, never control flow. */
  emit(fields: IEventFields): IEvent {
    const quantities = fields.quantities === undefined ? {} : { quantities: Object.freeze({ ...fields.quantities }) };
    const event: IEvent = Object.freeze({ ...fields, ...quantities, sequence: this.events.length + 1, at: this.now(), runId: this.runId });
    this.events.push(event);
    this.observers.forEach((observer, index) => {
      try {
        observer(event);
      } catch {
        // The observer's error may embed any value; only its position and the event are recorded.
        this.diagnose({ code: 'observer-failed', observer: index, sequence: event.sequence });
      }
    });
    return event;
  }

  /** Record a diagnostic. */
  diagnose(diagnostic: Omit<IDiagnostic, 'at'>): void {
    this.diagnostics.push(Object.freeze({ ...diagnostic, at: this.now() }));
  }
}
