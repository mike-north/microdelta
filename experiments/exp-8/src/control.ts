/**
 * Host-neutral control primitives for EXP-8: an injected clock, a portable
 * abort signal, operator stop intent and a request-permit pool. They exist so
 * the supervision candidate can be driven deterministically by a fake clock
 * and a scripted operator; none of them reads real time or a host signal.
 */

/**
 * The injected clock. `sleepUntil` is the only way the candidate waits for
 * time to pass; `at` registers a deadline callback. A fake implementation
 * advances time explicitly, so no test depends on real sleeps.
 * @internal
 */
export interface IClock {
  now(): number;
  sleepUntil(time: number): Promise<void>;
  at(time: number, callback: () => void): void;
}

/** A portable cooperative abort signal handed to bodies and providers. @internal */
export interface IAbortSignal {
  readonly aborted: boolean;
  onAbort(listener: () => void): void;
}

/**
 * The stop level in force for a member. `soft` forbids new admissions and
 * retries while in-flight work drains; `hard` aborts bodies and forbids
 * publication. Levels only escalate.
 * @internal
 */
export type IStopLevel = 'none' | 'soft' | 'hard';

/**
 * An operator stop request. Without `member` it applies to the whole run.
 * `deadline` (fake-clock time) escalates an unfinished soft stop to hard; there
 * is no default deadline. `cause` distinguishes an operator's own hard stop from
 * a deadline escalation.
 * @internal
 */
export interface IStopRequest {
  readonly level: 'soft' | 'hard';
  readonly member?: string;
  readonly deadline?: number;
  readonly cause?: 'operator' | 'deadline';
}

/** Rank of each level, so that the strongest applicable request wins. */
const rank: Readonly<Record<IStopLevel, number>> = { none: 0, soft: 1, hard: 2 };

/** The strongest level among requests matching a scope predicate. */
function strongest(requests: readonly IStopRequest[], applies: (stop: IStopRequest) => boolean): IStopLevel {
  let level: IStopLevel = 'none';
  for (const stop of requests) {
    if (applies(stop) && rank[stop.level] > rank[level]) {
      level = stop.level;
    }
  }
  return level;
}

/** A member's abort state; listeners run once, when a hard stop first applies. */
interface ISignalState {
  aborted: boolean;
  readonly listeners: (() => void)[];
}

/**
 * Records operator stop intent and derives each member's level and abort
 * signal. It is the only place stop intent lives; the supervisor consults it at
 * every admission, retry and publication decision. A member-scoped stop never
 * affects another member (RUN-014: cancelling one does not cancel others).
 * @internal
 */
export class StopController {
  readonly requests: IStopRequest[] = [];
  private readonly listeners: ((stop: IStopRequest) => void)[] = [];
  private readonly signals = new Map<string, ISignalState>();

  /** Record intent; effective immediately for admission and retry decisions. */
  request(stop: IStopRequest): void {
    this.requests.push(stop);
    for (const listener of this.listeners) {
      listener(stop);
    }
    for (const [member, state] of this.signals) {
      if (!state.aborted && this.levelFor(member) === 'hard') {
        state.aborted = true;
        for (const abort of state.listeners.splice(0)) {
          abort();
        }
      }
    }
  }

  /** The strongest level applying to a member (run-wide or member-scoped). */
  levelFor(member: string): IStopLevel {
    return strongest(this.requests, stop => stop.member === undefined || stop.member === member);
  }

  /** The strongest run-wide level; member-scoped stops do not stop the run. */
  runLevel(): IStopLevel {
    return strongest(this.requests, stop => stop.member === undefined);
  }

  /** A signal that aborts once a hard stop applies to the member. */
  signalFor(member: string): IAbortSignal {
    let state = this.signals.get(member);
    if (state === undefined) {
      state = { aborted: this.levelFor(member) === 'hard', listeners: [] };
      this.signals.set(member, state);
    }
    const current = state;
    return {
      get aborted(): boolean {
        return current.aborted;
      },
      onAbort(listener: () => void): void {
        if (current.aborted) {
          listener();
        } else {
          current.listeners.push(listener);
        }
      },
    };
  }

  /** Notify the supervisor of each accepted request. */
  subscribe(listener: (stop: IStopRequest) => void): void {
    this.listeners.push(listener);
  }
}

/**
 * A FIFO pool of request permits (RUN-002). A permit guards one in-flight
 * provider request, never a member's whole subtree, a wait or a backoff.
 * @internal
 */
export class Permits {
  private inUse = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(readonly size: number) {}

  /** Permits currently held. */
  get held(): number {
    return this.inUse;
  }

  /** Wait for a permit; the returned function releases it exactly once and hands it to the next waiter. */
  acquire(): Promise<() => void> {
    return new Promise(resolve => {
      const grant = (): void => {
        this.inUse++;
        let released = false;
        resolve(() => {
          if (released) {
            return;
          }
          released = true;
          this.inUse--;
          this.waiters.shift()?.();
        });
      };
      if (this.inUse < this.size) {
        grant();
      } else {
        this.waiters.push(grant);
      }
    });
  }
}
