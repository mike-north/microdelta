/** Bounded synchronization that distinguishes a missing send from its owning run ending early. */

/** The actual terminal outcome preserved when a run cannot reach its intended boundary. */
type IRunEnding<T> = { readonly kind: 'returned'; readonly value: T } | { readonly kind: 'threw'; readonly error: unknown };

/** Wait for the boundary without concealing an already completed or rejected run. */
export async function untilRunReaches<T>(running: Promise<T>, condition: () => boolean, description: string, maximumTurns = 2_000): Promise<void> {
  let ending: IRunEnding<T> | undefined;
  void running.then(
    (value) => { ending = { kind: 'returned', value }; },
    (error: unknown) => { ending = { kind: 'threw', error }; },
  );
  for (let turn = 0; turn < maximumTurns; turn += 1) {
    if (condition()) { return; }
    if (ending !== undefined) { throw new Error(`Run ended before ${description}`, { cause: ending }); }
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
  if (condition()) { return; }
  if (ending !== undefined) { throw new Error(`Run ended before ${description}`, { cause: ending }); }
  throw new Error(`timed out waiting until ${description}`);
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
