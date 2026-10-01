/**
 * Support for the stop, permit and lifecycle suites of the assembled
 * workspace path: a stub provider standing in for a paid service, named
 * promise gates a test opens, a bounded wait for an observable condition, a
 * temporary store, and a raw read of History's attempt rows. Nothing here
 * replaces an owner: every run goes through the facade over real SQLite.
 *
 * @see ../../../../docs/plans/m5-operations.md (planned evidence `soft-then-hard-stop`, `publication-commit-race`, `drain-outlives-lease`, `lifecycle-isolation`)
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeSnapshot } from '@microdelta/value';

import type { IAbortSignal } from '../../src/index.js';
import { openRaw } from '../durable-history/support.js';

/** A promise with its resolution exposed. */
export interface IDeferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

/** Create a deferred promise. */
export function deferred<T = void>(): IDeferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

/** Named gates: a promise per label that stays pending until the test opens it. */
export interface IGates {
  /** The gate's promise, created on first use. */
  wait(label: string): Promise<void>;
  /** Open a gate, whether or not anything waits on it yet. */
  open(label: string): void;
}

/** Create a set of named gates. */
export function gates(): IGates {
  const byLabel = new Map<string, IDeferred<void>>();
  const gateOf = (label: string): IDeferred<void> => {
    let gate = byLabel.get(label);
    if (gate === undefined) {
      gate = deferred();
      byLabel.set(label, gate);
    }
    return gate;
  };
  return {
    wait: (label) => gateOf(label).promise,
    open: (label) => {
      gateOf(label).resolve();
    },
  };
}

/**
 * A stub provider standing in for a paid service. Each request waits for its
 * gate; with `cooperative` it also rejects as soon as its abort signal fires,
 * as a well-behaved adapter does. It counts requests in flight and records
 * received, completed and aborted requests by label.
 */
export interface IStubProvider {
  readonly inFlight: number;
  readonly peak: number;
  readonly received: string[];
  readonly completed: string[];
  readonly aborted: string[];
  /** Perform one labelled request answering `value` once its gate opens. */
  request(label: string, value: number): (signal: IAbortSignal) => Promise<number>;
  /** Open the gate of a request, before or after it arrives. */
  release(label: string): void;
}

/** Create a stub provider. */
export function stubProvider(options: { readonly cooperative?: boolean } = {}): IStubProvider {
  const requestGates = gates();
  const counts = { inFlight: 0, peak: 0 };
  const received: string[] = [];
  const completed: string[] = [];
  const aborted: string[] = [];
  return {
    get inFlight(): number {
      return counts.inFlight;
    },
    get peak(): number {
      return counts.peak;
    },
    received,
    completed,
    aborted,
    request(label: string, value: number) {
      return async (signal: IAbortSignal): Promise<number> => {
        received.push(label);
        counts.inFlight += 1;
        counts.peak = Math.max(counts.peak, counts.inFlight);
        try {
          await new Promise<void>((resolve, reject) => {
            // A well-behaved adapter stops listening once its request settles.
            const stopListening = signal.onAbort(() => {
              aborted.push(label);
              if (options.cooperative === true) {
                reject(new Error(`request ${label} abandoned`));
              }
            });
            void requestGates.wait(label).then(() => {
              stopListening();
              resolve();
            });
          });
          completed.push(label);
          return value;
        } finally {
          counts.inFlight -= 1;
        }
      };
    },
    release: (label) => {
      requestGates.open(label);
    },
  };
}

/**
 * Wait, one event-loop turn at a time, until `condition` holds. Fails with
 * `description` after a bounded number of turns rather than hanging, so a
 * missing behavior is reported as a failed expectation.
 */
export async function until(condition: () => boolean, description: string, turns = 2_000): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
  throw new Error(`timed out waiting until ${description}`);
}

/** Let queued continuations and immediates run for `turns` event-loop turns. */
export async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** Real elapsed time, for the few cases that must outlive a real lease or deadline. */
export function elapse(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** A temporary store directory and its file location. */
export interface ITempStore {
  readonly location: string;
  remove(): void;
}

/** Create a temporary directory holding one store file location. */
export function tempStore(): ITempStore {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-stop-'));
  return { location: join(directory, 'history.sqlite'), remove: () => rmSync(directory, { recursive: true, force: true }) };
}

/** One attempt row as History durably recorded it. */
export interface IAttemptRow {
  readonly subject: string;
  readonly state: string;
  /** The recorded ending (Resolution's attempt-ending record), when the attempt ended without a result. */
  readonly ending: string | undefined;
}

/** Every attempt in the store at `location`, in allocation order. */
export function attemptsAt(location: string): readonly IAttemptRow[] {
  return openRaw(location).prepare('SELECT subject, state, outcome FROM history_attempts ORDER BY attempt_id').all().map((row) => {
    const outcome = row['outcome'];
    // The outcome column holds Resolution's attempt-ending record in Value's snapshot encoding.
    const decoded: unknown = typeof outcome === 'string' ? decodeSnapshot(outcome) : undefined;
    const ending: unknown = typeof decoded === 'object' && decoded !== null ? Reflect.get(decoded, 'ending') : undefined;
    return { subject: String(row['subject']), state: String(row['state']), ending: typeof ending === 'string' ? ending : undefined };
  });
}

/** The subjects that have at least one completed result in the store at `location`. */
export function publishedSubjects(location: string): readonly string[] {
  return openRaw(location).prepare('SELECT DISTINCT subject FROM history_results ORDER BY subject').all().map((row) => String(row['subject']));
}
