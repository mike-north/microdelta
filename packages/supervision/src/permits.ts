/**
 * A run's bounded pool of send permits (RUN-002, EXP-8 mechanism 1).
 *
 * A permit guards exactly one real send while it is in flight: never a
 * member's subtree, a wait for children or another owner's result, or a wait
 * for a time. That is what lets a nested group complete with a single permit
 * (a parent waiting for its children holds none) and what bounds concurrent
 * paid requests to the operator's chosen size. Waiters are served first in,
 * first out. A wait ends early, holding nothing, when its cancellation signal
 * aborts; a waiter so cancelled is removed from the queue, so no permit is
 * ever granted to it and lost.
 */
import type { IAbortSignal } from './control.js';

/** One granted permit. Releasing hands it to the next waiter; releasing twice does nothing. */
export interface IPermit {
  release(): void;
}

/** A bounded, first-in first-out pool of send permits. */
export interface IPermitPool {
  /**
   * Wait for a permit. Resolves the permit, or undefined when `cancel`
   * aborts first (at once when it already has); waiting holds nothing.
   */
  acquire(cancel: IAbortSignal): Promise<IPermit | undefined>;
}

/**
 * Create a permit pool of `size` permits.
 * @param size - A positive safe integer, validated by the caller.
 * @returns The pool.
 */
export function createPermitPool(size: number): IPermitPool {
  /** Permits currently granted and not yet released. */
  let held = 0;
  /** Waiters in arrival order; each grants itself when handed a permit. */
  const waiters: (() => void)[] = [];

  /** A granted permit, whose first release hands it to the next waiter or returns it to the pool. */
  const permit = (): IPermit => {
    let released = false;
    return Object.freeze({
      release(): void {
        if (released) {
          return;
        }
        released = true;
        const next = waiters.shift();
        if (next === undefined) {
          held -= 1;
        } else {
          // The permit passes directly to the next waiter; the held count is unchanged.
          next();
        }
      },
    });
  };

  return Object.freeze({
    acquire(cancel: IAbortSignal): Promise<IPermit | undefined> {
      if (cancel.aborted) {
        return Promise.resolve(undefined);
      }
      if (held < size) {
        held += 1;
        return Promise.resolve(permit());
      }
      return new Promise<IPermit | undefined>((resolve) => {
        let removeListener: () => void = () => undefined;
        const grant = (): void => {
          removeListener();
          resolve(permit());
        };
        waiters.push(grant);
        removeListener = cancel.onAbort(() => {
          const index = waiters.indexOf(grant);
          if (index >= 0) {
            waiters.splice(index, 1);
            resolve(undefined);
          }
        });
      });
    },
  });
}
