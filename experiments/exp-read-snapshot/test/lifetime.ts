/** Experiment-owned synchronous release attempts preserve the first failure without abandoning later handles. */

/** A discriminant distinguishes even a thrown undefined from successful closure; thrown objects retain their identity. @internal */
export type IOwnedFinish = { readonly kind: 'closed' }
  | { readonly kind: 'failed'; readonly primary: unknown; readonly secondary: readonly unknown[] };

/** Attempt every release in declared ownership order and keep later failures separate from the first. @internal */
export function finishOwned(releases: readonly (() => void)[]): IOwnedFinish {
  const failures: unknown[] = [];
  for (const release of releases) {
    try { release(); } catch (error: unknown) { failures.push(error); }
  }
  return failures.length === 0 ? { kind: 'closed' } : { kind: 'failed', primary: failures[0], secondary: failures.slice(1) };
}
