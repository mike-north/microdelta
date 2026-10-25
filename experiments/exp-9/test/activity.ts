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
 * The selected record keeps a completed list of stable PR identifiers,
 * profile data, review identifiers and the fixture revision. It deliberately
 * does not include PR details: each detail is retrieved and retained through
 * its own supplied-step call after this search completes.
 */
import { currentRun } from 'microdelta';
import type { IPreviousResult, ISourceOutcome, ISourceOutcomes, ITrackedView } from 'microdelta';

import { authoredInWindow, environments, isEnvironment, readFixture, readFixtureFor, submittedInWindow } from './fixture.js';
import type { IConfig } from './fixture.js';

/** One complete pull request record returned by the separate detail adapter. */
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
  /** Stable identifiers of authored PRs in the window, ordered by number. */
  readonly pullRequestIds: readonly number[];
  /** Submitted reviews in window, ordered by review id. */
  readonly reviews: readonly { readonly id: string }[];
}

/** Records the fixture's selected ID lists for this diagnostic process only. */
export const selectedSearches: Record<string, readonly number[]> = {};

/** Select one contributor's profile, review identifiers and completed PR-ID search result. */
export function selectActivity(key: string, config: Pick<IConfig, 'repository' | 'window'>): IActivity {
  const fixture = readFixtureFor(config.repository);
  const profile = fixture.profiles.find((candidate) => candidate.key === key);
  if (profile === undefined) {
    throw new Error(`fixture error: no profile for ${key}`);
  }
  // Discovery remains a successful listing; this fixture knob fails only the
  // selected member's search, so an error cannot masquerade as empty results.
  if (fixture.searchFailures?.includes(key) === true) {
    throw new Error(`fixture search failure for ${key}`);
  }
  const pullRequestIds = authoredInWindow(fixture, key, config.window).map((pull) => pull.number);
  selectedSearches[key] = pullRequestIds;
  return {
    revision: fixture.revision,
    profile: { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl },
    pullRequestIds,
    reviews: submittedInWindow(fixture, key, config.window).map((review) => ({ id: review.id })),
  };
}

/** Retrieve one PR's detail after a completed ID search; missing IDs are adapter failures. */
export function retrievePullRequestDetail(number: number | undefined, repository: string): IPullRequest {
  if (number === undefined) {
    throw new Error('a pull request detail needs its searched ID');
  }
  const { environment } = currentRun();
  if (!isEnvironment(environment)) {
    throw new Error(`the fixture adapter serves the ${environments.join(', ')} environments, not ${environment}`);
  }
  const pull = readFixtureFor(repository).pullRequests.find((candidate) => candidate.number === number);
  if (pull === undefined) {
    throw new Error(`fixture error: no pull request ${String(number)}`);
  }
  return { number: pull.number, merged: pull.merged, labels: [...pull.labels] };
}

/**
 * The member activity check: fetch fresh fixture data for the member's
 * designated contributor identity. It confirms the run's selected environment
 * through scoped context lookup; no context parameter is threaded through the
 * helper.
 */
export function checkActivity(outcome: ISourceOutcomes, config: ITrackedView<IConfig>, key: string): ISourceOutcome<IActivity> {
  const { environment } = currentRun();
  if (!isEnvironment(environment)) {
    throw new Error(`the fixture adapter serves the ${environments.join(', ')} environments, not ${environment}`);
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
