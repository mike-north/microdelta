/** Bounded synchronization that distinguishes a missing send from its owning run ending early. */
import { performance } from 'node:perf_hooks';

/** The actual terminal outcome preserved when a run cannot reach its intended boundary. */
type IRunEnding<T> = { readonly kind: 'returned'; readonly value: T } | { readonly kind: 'threw'; readonly error: unknown };

/**
 * Wait on a monotonic real-time deadline, independent of the controlled wall
 * clock. Timer-backed polling permits asynchronous setup to progress; the
 * owning run's settlement wakes the wait immediately and preserves its cause.
 */
export async function untilRunReaches<T>(running: Promise<T>, condition: () => boolean, description: string, milliseconds = 2_000): Promise<void> {
  let ending: IRunEnding<T> | undefined;
  const ended = running.then(
    (value) => { ending = { kind: 'returned', value }; },
    (error: unknown) => { ending = { kind: 'threw', error }; },
  );
  const deadline = performance.now() + milliseconds;
  for (;;) {
    if (condition()) { return; }
    if (ending !== undefined) { throw new Error(`Run ended before ${description}`, { cause: ending }); }
    const remaining = deadline - performance.now();
    if (remaining <= 0) { throw new Error(`timed out waiting until ${description}`); }
    let tick: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([ended, new Promise<void>((resolve) => {
        tick = setTimeout(resolve, Math.min(5, remaining));
      })]);
    } finally { clearTimeout(tick); }
  }
}

/** Bound completion and cleanup with a real timer, independent of the spied wall clock. */
export async function within<T>(running: Promise<T>, description: string, milliseconds = 2_000): Promise<T> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([running, new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => { reject(new Error(`timed out waiting for ${description}`)); }, milliseconds);
    })]);
  } finally { clearTimeout(deadline); }
}
