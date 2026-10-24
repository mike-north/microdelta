/**
 * C2's refusal classifier. Worker logs carry a narrow kind determined by
 * runtime class identity, with a separate diagnostic name for audit. An
 * unrelated failure aborts the worker instead of becoming test evidence.
 * @packageDocumentation
 */
import { HistoryBusyError, StaleWriterError } from '@microdelta/history';

/** The only failure categories a direct History contention call may report. */
export type IContentionFailure =
  | { readonly errorKind: 'storage-busy'; readonly errorName: string }
  | { readonly errorKind: 'stale-writer'; readonly errorName: string };

/** Classify History's direct refusal by class, not an arbitrary thrown name. */
export function classifyContentionFailure(error: unknown): IContentionFailure {
  if (error instanceof HistoryBusyError) {
    return { errorKind: 'storage-busy', errorName: error.name };
  }
  if (error instanceof StaleWriterError) {
    return { errorKind: 'stale-writer', errorName: error.name };
  }
  throw new Error(`Unexpected History contention failure: ${error instanceof Error ? error.name : String(error)}`, { cause: error });
}
