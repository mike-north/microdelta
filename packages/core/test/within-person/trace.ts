/** In-memory acknowledgments record causal facts from real owner operations. */
export interface ITraceEvent {
  readonly sequence: number;
  readonly kind: string;
  readonly facts: Readonly<Record<string, unknown>>;
  readonly runId: string | null;
  readonly runInstance: string | null;
}
/** The fixture records observations only; the library owns all result publication. */
export interface ITrace {
  readonly events: readonly ITraceEvent[];
  record(kind: string, facts: Readonly<Record<string, unknown>>, run?: { readonly runId: string; readonly instance: string }): ITraceEvent;
}
/** Preserve each ordered acknowledgment in one bounded ordinary run. */
export function createTrace(): ITrace {
  const events: ITraceEvent[] = [];
  return {
    events,
    record(kind, facts, run): ITraceEvent {
      if (events.length >= 20_000) { throw new Error('Ordinary trace limit exceeded'); }
      const event = { sequence: events.length, kind, facts, runId: run?.runId ?? null, runInstance: run?.instance ?? null };
      events.push(event);
      return event;
    },
  };
}
