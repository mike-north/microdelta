/** Imported composition declares one retained scoring decision without owning runtime infrastructure. */
import { memo } from '../src/protocol.js';
import type { IBinding } from '../src/protocol.js';

/** The author reads title; labels are intentionally irrelevant to scoring. */
export interface IPullRequest { readonly title: string; readonly labels: readonly string[] }
/** Current scoring configuration is an explicit symbolic argument. */
export interface IScoring { readonly width: number }
/** Reuse this declaration factory with owned input bindings and explicit occurrence identity. */
export function assess(name: string, pr: IBinding<IPullRequest>, scoring: IBinding<IScoring>): IBinding<number> {
  return memo({ name, from: { pr, scoring }, run: ({ pr, scoring }) => Math.floor(pr.title.length / scoring.width) });
}
