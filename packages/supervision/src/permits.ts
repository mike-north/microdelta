/**
 * A run's bounded pools: its send permits and the lanes of its member window
 * (RUN-002, EXP-8 mechanism 1).
 *
 * A send permit guards exactly one real send while it is in flight: never a
 * member's subtree, a wait for children or another owner's result, or a wait
 * for a time. That is what lets a nested group complete with a single permit
 * (a parent waiting for its children holds none) and what bounds concurrent
 * paid requests to the operator's chosen size. A window lane is held by one
 * fan-out member while it works.
 *
 * Waiters are served first in, first out, except that a priority waiter is
 * served before every ordinary one (priority waiters among themselves are
 * also first in, first out). A member reclaiming the lane it lent for a timed
 * wait waits with priority: it already holds a claimed attempt and its
 * evidence in memory, so it must resume before members that have not started
 * rather than behind the whole remaining population. A wait ends early,
 * holding nothing, when its cancellation signal aborts; a waiter so cancelled
 * is removed from its queue, so no permit is ever granted to it and lost.
 */
import type { IAbortSignal } from './control.js';

/** One granted permit. Releasing hands it to the next waiter; releasing twice does nothing. */
export interface IPermit {
  release(): void;
}

/** A bounded pool whose waiters are served first in, first out, with priority waiters first. */
export interface IPermitPool {
  /**
   * Wait for a permit. Resolves the permit, or undefined when `cancel`
   * aborts first (at once when it already has); waiting holds nothing. A
   * `priority` waiter is served before every ordinary waiter.
   */
  acquire(cancel: IAbortSignal, options?: { readonly priority?: boolean }): Promise<IPermit | undefined>;
}

/**
 * Create a permit pool of `size` permits.
 * @param size - A positive safe integer, validated by the caller.
 * @returns The pool.
 */
export function createPermitPool(size: number): IPermitPool {
  /** Permits currently granted and not yet released. */
  let held = 0;
  /** Priority waiters in arrival order, served before any ordinary waiter; each grants itself when handed a permit. */
  const priority: (() => void)[] = [];
  /** Ordinary waiters in arrival order. */
  const ordinary: (() => void)[] = [];

  /** A granted permit, whose first release hands it to the next waiter or returns it to the pool. */
  const permit = (): IPermit => {
    let released = false;
    return Object.freeze({
      release(): void {
        if (released) {
          return;
        }
        released = true;
        const next = priority.shift() ?? ordinary.shift();
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
    acquire(cancel: IAbortSignal, options: { readonly priority?: boolean } = {}): Promise<IPermit | undefined> {
      if (cancel.aborted) {
        return Promise.resolve(undefined);
      }
      if (held < size) {
        held += 1;
        return Promise.resolve(permit());
      }
      const queue = options.priority === true ? priority : ordinary;
      return new Promise<IPermit | undefined>((resolve) => {
        let removeListener: () => void = () => undefined;
        const grant = (): void => {
          removeListener();
          resolve(permit());
        };
        queue.push(grant);
        removeListener = cancel.onAbort(() => {
          const index = queue.indexOf(grant);
          if (index >= 0) {
            queue.splice(index, 1);
            resolve(undefined);
          }
        });
      });
    },
  });
}
