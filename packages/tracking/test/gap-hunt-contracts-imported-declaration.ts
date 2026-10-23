/** A module owns its tracked declarations; importing consumers must not rewrap them. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { createTrackingObserver } from '../src/index.js';

/** The declaration's shared capture owner supplies host mechanics, never author invalidation policy. */
export const declarationObserver = createTrackingObserver({
  createAsyncContext<T>() { return new AsyncLocalStorage<T>(); },
  sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); },
});
/** Changes to factor affect the helper while unread metadata must remain irrelevant. */
export const configuration = declarationObserver.local.cell(declarationObserver.tracked({ factor: 2, unread: 'first' }, { path: ['configuration'] }));
/** The actual imported declaration already bears the tracked brand and reads its module's tracked configuration. */
export function calculate(value: number): number {
  return value * configuration.get().factor;
}
/** Consumers invoke this already tracked declaration directly. */
export const importedHelper = declarationObserver.tracked(calculate, { path: ['helper'] });
