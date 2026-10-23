/** A changed authored implementation whose output must invalidate the parent. */
import { memo } from '../src/protocol.js';
import type { IBinding } from '../src/protocol.js';
import type { IPullRequest, IScoring } from './assessment.js';

/** The extra one changes actual emitted body text and the consumed child result. */
export function assessChanged(name: string, pr: IBinding<IPullRequest>, scoring: IBinding<IScoring>): IBinding<number> {
  return memo({ name, from: { pr, scoring }, run: ({ pr, scoring }) => Math.floor(pr.title.length / scoring.width) + 1 });
}
