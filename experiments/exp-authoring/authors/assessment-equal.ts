/** A changed authored implementation with identical output challenges private callback evidence. */
import { memo } from '../src/protocol.js';
import type { IBinding } from '../src/protocol.js';
import type { IPullRequest, IScoring } from './assessment.js';

/** The extra zero changes actual emitted body text without changing the selected result. */
export function assessEqual(name: string, pr: IBinding<IPullRequest>, scoring: IBinding<IScoring>): IBinding<number> {
  return memo({ name, from: { pr, scoring }, run: ({ pr, scoring }) => Math.floor(pr.title.length / scoring.width) + 0 });
}
