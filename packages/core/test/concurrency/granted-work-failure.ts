/**
 * C3's post-grant classifier keeps History data-operation outcomes separate
 * from writer acquisition. It accepts only History's typed refusals and
 * carries the operation and granted fence that authorize the attempted work.
 * @packageDocumentation
 */
import { HistoryBusyError } from '@microdelta/history';

/** A typed History refusal while using authority that was already granted. */
export interface IGrantedWorkFailure {
  readonly kind: 'storage-busy';
  readonly phase: 'allocate' | 'stage' | 'publish';
  readonly fence: number;
  readonly errorName: string;
}

/** Classify only exact History failures without discarding the granted authority. */
export function classifyGrantedWorkFailure(
  phase: IGrantedWorkFailure['phase'],
  fence: number,
  error: unknown,
): IGrantedWorkFailure {
  if (error instanceof HistoryBusyError) {
    return { kind: 'storage-busy', phase, fence, errorName: error.name };
  }
  throw new Error(`Unexpected post-grant History failure: ${error instanceof Error ? error.name : String(error)}`, { cause: error });
}
