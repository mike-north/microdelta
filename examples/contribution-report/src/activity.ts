/**
 * The per-member activity source adapter: selects one discovered
 * contributor's activity from the fixture under the example's attribution
 * rules. It is an application policy, not a framework rule.
 *
 * Attribution rules (see the README):
 * - a contributor's authored pull requests are the unique PRs they authored
 *   whose creation time falls in the half-open UTC window `[start, end)`;
 * - the merged subset is those PRs whose *current* merged status is true (the
 *   window restricts creation, not merge time);
 * - their reviews are the unique reviews they submitted in the window; pending
 *   reviews are excluded.
 *
 * The selected record keeps nested profile data, per-PR labels and the
 * fixture revision. The summary reads none of them except the profile name;
 * only the assessor reads a PR's labels, and only under rubric C.
 */
import { currentRun } from 'microdelta';
import type { IPreviousResult, ISourceOutcome, ISourceOutcomes, ITrackedView } from 'microdelta';

import { authoredInWindow, fixtureEnvironment, readFixture, readFixtureFor, submittedInWindow } from './fixture.js';
import type { IConfig } from './fixture.js';

/** One authored pull request as a member's activity holds it. */
export interface IPullRequest {
  readonly number: number;
  readonly merged: boolean;
  /** Read only by rubric C's assessment. */
  readonly labels: readonly string[];
}

/** One contributor's selected activity: the member source result a summary reads. */
export interface IActivity {
  /** Fixture revision the record was selected from; read only by the finality policy. */
  readonly revision: number;
  /** Mutable upstream profile; only `name` is read by the summary. */
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  /** Authored PRs in window, ordered by PR number. */
  readonly pullRequests: readonly IPullRequest[];
  /** Submitted reviews in window, ordered by review id. */
  readonly reviews: readonly { readonly id: string }[];
}

/** Select one contributor's activity from the fixture under the attribution rules. */
export function selectActivity(key: string, config: Pick<IConfig, 'repository' | 'window'>): IActivity {
  const fixture = readFixtureFor(config.repository);
  const profile = fixture.profiles.find((candidate) => candidate.key === key);
  if (profile === undefined) {
    throw new Error(`fixture error: no profile for ${key}`);
  }
  return {
    revision: fixture.revision,
    profile: { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl },
    pullRequests: authoredInWindow(fixture, key, config.window).map((pull) => ({ number: pull.number, merged: pull.merged, labels: [...pull.labels] })),
    reviews: submittedInWindow(fixture, key, config.window).map((review) => ({ id: review.id })),
  };
}

/**
 * The member activity check: fetch fresh fixture data for the member's
 * designated contributor identity. It confirms the run's selected environment
 * through scoped context lookup; no context parameter is threaded through the
 * helper.
 */
export function checkActivity(outcome: ISourceOutcomes, config: ITrackedView<IConfig>, key: string): ISourceOutcome<IActivity> {
  const { environment } = currentRun();
  if (environment !== fixtureEnvironment) {
    throw new Error(`the fixture adapter serves the ${fixtureEnvironment} environment, not ${environment}`);
  }
  return outcome.fresh(selectActivity(key, { repository: config.repository, window: { start: config.window.start, end: config.window.end } }));
}

/**
 * The member activity finality policy: the previous result is still final
 * while the fixture revision it was selected from is current (a conditional
 * check, like an unchanged ETag). Evaluated only for an eligible previous
 * result.
 */
export function isFinal(previous: IPreviousResult<IActivity>): boolean {
  return previous.data.revision === readFixture().revision;
}
