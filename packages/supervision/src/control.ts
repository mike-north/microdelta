/**
 * Operator stop intent and the portable signal that conveys it (RUN-014,
 * RUN-015, EXP-8 mechanism 1).
 *
 * A stop controller is where an operator's intent lives: a soft stop admits
 * no new work and lets admitted steps drain, with no default deadline; an
 * operator deadline or a hard stop escalates it. Levels only escalate. A hard
 * stop aborts the controller's signal, which Supervision hands to bodies,
 * permit waits and waits for a time. The controller knows nothing about runs,
 * steps or History: a run consults it at every admission, send, wait and
 * publication decision. Deadlines are wall-clock times measured by an injected
 * timer, so no host timer is read here.
 */
import { SupervisionError } from './errors.js';

/**
 * The stop level in force. `none`: nothing is stopped. `soft`: no new work is
 * admitted and nothing is retried, while admitted steps drain. `hard`:
 * in-flight sends, permit waits and waits for a time are aborted and nothing
 * new is committed.
 * @alpha
 */
export type IStopLevel = 'none' | 'soft' | 'hard';

/**
 * Why a stop level holds: the operator asked for it, or an operator deadline
 * on a soft stop passed and escalated it to hard.
 * @alpha
 */
export type IStopCause = 'operator' | 'deadline';

/**
 * One operator stop request. There is no default deadline: a soft stop
 * without one drains for as long as admitted steps take.
 * @alpha
 */
export interface IStopRequest {
  /** The requested level. A request never lowers the level in force. */
  readonly level: 'soft' | 'hard';
  /**
   * For a soft stop, the wall-clock time (whole UTC epoch milliseconds) at
   * which it escalates to hard if it is still soft. A later request can only
   * bring an armed deadline earlier.
   */
  readonly deadline?: number;
}

/**
 * The stop intent in force: its level, why it holds, and the deadline armed
 * on a soft stop.
 * @alpha
 */
export interface IStopState {
  /** The level in force. */
  readonly level: IStopLevel;
  /** Why the level holds; undefined while nothing is stopped. */
  readonly cause: IStopCause | undefined;
  /** The armed escalation time of a soft stop; undefined otherwise. */
  readonly deadline: number | undefined;
}

/**
 * A portable, cooperative abort signal. It carries a hard stop to bodies and
 * adapters, which decide how to abandon their own work; arbitrary JavaScript
 * and remote services are not forcibly cancelled by it (RUN-014).
 * @alpha
 */
export interface IAbortSignal {
  /** Whether the signal has aborted. It never un-aborts. */
  readonly aborted: boolean;
  /**
   * Call `listener` once when the signal aborts, or at once when it already
   * has. Returns a function that removes a listener that has not run yet.
   */
  onAbort(listener: () => void): () => void;
}

/**
 * The timer capability Supervision needs, structurally identical to the
 * Machine's: the wall clock and one-shot callbacks at a wall-clock time.
 * Assembly supplies it; Supervision never imports a host.
 * @alpha
 */
export interface IRunTimer {
  /** The current wall-clock time in whole UTC epoch milliseconds. */
  currentEpochMilliseconds(): number;
  /**
   * Call `callback` once when the clock reads at or after `epochMilliseconds`;
   * returns a cancel function. `keepAlive: false` means the pending timer does
   * not by itself keep the host alive.
   */
  schedule(epochMilliseconds: number, callback: () => void, options?: { readonly keepAlive?: boolean }): () => void;
}

/**
 * Operator stop intent for one or more runs. Requests take effect at once for
 * every admission, retry and publication decision of the runs it is given to.
 * @alpha
 */
export interface IStopController {
  /** The stop intent in force now. */
  readonly state: IStopState;
  /** Aborts when the level first becomes hard. */
  readonly signal: IAbortSignal;
  /**
   * Record a stop request. Levels only escalate; a soft request's deadline
   * can only move an armed deadline earlier. A deadline already reached
   * escalates at once. Throws `SupervisionError('invalid-request')` for a
   * malformed request, or a deadline without a timer.
   */
  request(stop: IStopRequest): void;
  /**
   * Observe every change of the stop intent, in order. Returns a function
   * that ends the subscription. A listener that throws does not prevent the
   * change or other listeners.
   */
  subscribe(listener: (state: IStopState) => void): () => void;
}

/** Options of a stop controller. @alpha */
export interface IStopControllerOptions {
  /** The timer that arms deadlines; a deadline cannot be requested without one. */
  readonly timer?: IRunTimer;
}

/**
 * A signal Supervision owns and aborts. It aborts at most once and then runs
 * its listeners in registration order; a listener added afterwards runs at
 * once. A throwing listener never prevents the others: its failure goes to
 * `onListenerFailure` when given, and is otherwise dropped, because the code
 * that aborts (an operator request, a deadline timer) must not fail on a
 * listener's behalf. Only `signal` is ever handed out, so no receiver can
 * abort it.
 */
export interface IAbortSource {
  /** The read-only signal receivers see. */
  readonly signal: IAbortSignal;
  /** Abort once, running every pending listener in order. */
  abort(): void;
  /**
   * How many listeners the source still retains. A listener is retained only
   * until it runs or is removed, so every settled race or wait returns this
   * to its baseline; a retained listener would keep whatever it captures
   * (for example a step's output) reachable until the run closes.
   */
  readonly listenerCount: number;
}

/**
 * Create an abort source.
 * @param onListenerFailure - Where a throwing listener's failure is reported, if anywhere.
 * @returns The source.
 */
export function createAbortSource(onListenerFailure?: (error: unknown) => void): IAbortSource {
  let done = false;
  /**
   * Pending listeners in registration order (a Set keeps insertion order).
   * An entry leaves the set as soon as it runs or is removed, so nothing it
   * captures stays reachable through the source afterwards.
   */
  const listeners = new Set<{ readonly listener: () => void }>();
  const call = (listener: () => void): void => {
    try {
      listener();
    } catch (error: unknown) {
      onListenerFailure?.(error);
    }
  };
  const signal: IAbortSignal = Object.freeze({
    get aborted(): boolean {
      return done;
    },
    onAbort(listener: () => void): () => void {
      if (typeof listener !== 'function') {
        throw new SupervisionError('invalid-request', 'An abort listener must be a function');
      }
      if (done) {
        call(listener);
        return (): void => undefined;
      }
      const entry = { listener };
      listeners.add(entry);
      return (): void => {
        listeners.delete(entry);
      };
    },
  });
  return Object.freeze({
    signal,
    get listenerCount(): number {
      return listeners.size;
    },
    abort(): void {
      if (done) {
        return;
      }
      done = true;
      for (const entry of [...listeners]) {
        // A listener removed by an earlier one while aborting does not run.
        if (listeners.delete(entry)) {
          call(entry.listener);
        }
      }
    },
  });
}

/** Whether a value is a safe integer of epoch milliseconds a deadline can name. */
function isEpochTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Nothing stopped. */
const notStopped: IStopState = Object.freeze({ level: 'none', cause: undefined, deadline: undefined });

/**
 * Create a stop controller with nothing stopped.
 *
 * Its deadline timer is scheduled without keep-alive, so an armed deadline
 * never prolongs the host's life on its own, yet fires on time while work
 * keeps it running. An operator hard stop, or the deadline itself, disarms it.
 * @param options - The timer that arms operator deadlines.
 * @returns The controller.
 * @alpha
 */
export function createStopController(options: IStopControllerOptions = {}): IStopController {
  const timer = options.timer;
  let state: IStopState = notStopped;
  const signal = createAbortSource();
  const subscribers: { readonly listener: (state: IStopState) => void; removed: boolean }[] = [];
  /** Cancels the armed deadline timer, if one is armed. */
  let disarm: (() => void) | undefined;

  /** Adopt a new state and tell every subscriber; a hard level also disarms any deadline and aborts the signal. */
  function change(next: IStopState): void {
    state = Object.freeze(next);
    if (next.level === 'hard') {
      disarm?.();
      disarm = undefined;
      signal.abort();
    }
    for (const entry of [...subscribers]) {
      if (!entry.removed) {
        try {
          entry.listener(state);
        } catch {
          // A subscriber's failure must not undo or block the operator's stop.
        }
      }
    }
  }

  /** Escalate an unfinished soft stop to hard because its deadline passed. */
  function escalate(): void {
    if (state.level === 'soft') {
      change({ level: 'hard', cause: 'deadline', deadline: undefined });
    }
  }

  /** Arm (or re-arm) the soft stop's deadline, escalating at once when it has already passed. */
  function arm(deadline: number, clock: IRunTimer): void {
    disarm?.();
    disarm = undefined;
    if (deadline <= clock.currentEpochMilliseconds()) {
      escalate();
      return;
    }
    disarm = clock.schedule(deadline, () => {
      disarm = undefined;
      escalate();
    }, { keepAlive: false });
  }

  return Object.freeze({
    get state(): IStopState {
      return state;
    },
    signal: signal.signal,
    request(stop: IStopRequest): void {
      const level: unknown = typeof stop === 'object' && stop !== null ? Reflect.get(stop, 'level') : undefined;
      const deadline: unknown = typeof stop === 'object' && stop !== null ? Reflect.get(stop, 'deadline') : undefined;
      if (level !== 'soft' && level !== 'hard') {
        throw new SupervisionError('invalid-request', 'A stop request needs level "soft" or "hard"');
      }
      if (deadline !== undefined && (level !== 'soft' || !isEpochTime(deadline))) {
        throw new SupervisionError('invalid-request', 'A stop deadline is a whole epoch millisecond time on a soft stop');
      }
      if (deadline !== undefined && timer === undefined) {
        throw new SupervisionError('invalid-request', 'A stop deadline needs a timer to arm it');
      }
      if (state.level === 'hard') {
        return;
      }
      if (level === 'hard') {
        change({ level: 'hard', cause: 'operator', deadline: undefined });
        return;
      }
      const armed = state.deadline;
      const next = deadline === undefined ? armed : armed === undefined ? deadline : Math.min(armed, deadline);
      if (state.level === 'soft' && next === armed) {
        return;
      }
      change({ level: 'soft', cause: 'operator', deadline: next });
      if (next !== undefined && next !== armed && timer !== undefined) {
        arm(next, timer);
      }
    },
    subscribe(listener: (state: IStopState) => void): () => void {
      if (typeof listener !== 'function') {
        throw new SupervisionError('invalid-request', 'A stop subscriber must be a function');
      }
      const entry = { listener, removed: false };
      subscribers.push(entry);
      return (): void => {
        entry.removed = true;
        const index = subscribers.indexOf(entry);
        if (index >= 0) {
          subscribers.splice(index, 1);
        }
      };
    },
  });
}
