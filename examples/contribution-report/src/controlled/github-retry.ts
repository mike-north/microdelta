/** Concrete GitHub source retry budget; Supervision alone persists decisions, waits, allowances and send authority. */
import type { ISourceRetryPolicy } from 'microdelta';

/** Explicit application-selected delay budgets; numeric fixture values are not provider defaults. @internal */
export interface IGithubRetryBudgets { readonly backoffMilliseconds: number; readonly maximumDelayMilliseconds: number; readonly maximumTotalWaitMilliseconds: number }
/** Register one exact adapter/service/access policy without creating a retry dispatcher or persistence path. @internal */
export function githubRetryPolicy(connection: string, budgets: IGithubRetryBudgets, now: () => number): ISourceRetryPolicy {
  const backoff = budgets.backoffMilliseconds;
  const maximumDelay = budgets.maximumDelayMilliseconds;
  const maximumTotalWait = budgets.maximumTotalWaitMilliseconds;
  if (![backoff, maximumDelay, maximumTotalWait].every(value => Number.isSafeInteger(value) && value >= 0)) { throw new Error('invalid GitHub retry budgets'); }
  return { id: 'controlled-github-budget', scope: { source: 'controlled-github-rest', service: 'controlled', connection }, decide: async input => {
    if (input.signal.aborted || input.outcome.kind === 'unknown' || input.outcome.kind === 'failed' && !input.outcome.transient || input.history.omittedPriorAttempts > 0) { return { kind: 'stop' }; }
    const at = now();
    const delay = Math.max(backoff, (input.knownNotBefore ?? at) - at);
    let acceptedWait = 0;
    for (const previous of input.history.prior) { if (previous.decision?.kind === 'retry-after') { acceptedWait += previous.decision.delayMilliseconds; } }
    // Bounded recorded history is the authority; unavailable older decisions cannot justify a fabricated remaining budget.
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(delay) || !Number.isSafeInteger(acceptedWait + delay) || delay > maximumDelay || acceptedWait + delay > maximumTotalWait) { return { kind: 'stop' }; }
    return { kind: 'retry-after', delayMilliseconds: delay };
  } };
}
