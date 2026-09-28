/**
 * The example's source adapter: reads the checked-in fixture repository
 * activity (`data/acme-widget.json`) in place of a live GitHub API and selects
 * one contributor's activity under the example's attribution rules. It is an
 * application policy, not a framework rule.
 *
 * Attribution rules (see the README):
 * - a contributor's authored pull requests are the unique PRs they authored
 *   whose creation time falls in the half-open UTC window `[start, end)`;
 * - the merged subset is those PRs whose *current* merged status is true (the
 *   window restricts creation, not merge time);
 * - their reviews are the unique reviews they submitted in the window; pending
 *   reviews are excluded;
 * - a duplicate PR number or review id, or a record naming an unknown
 *   contributor, is a fixture error rather than something to guess around.
 *
 * The selected record keeps nested profile data and per-PR labels that the
 * summary never reads, plus the fixture revision, so unread changes are real
 * source changes the summary can ignore.
 */
import { readFileSync } from 'node:fs';

import { currentRun } from 'microdelta';
import type { IPreviousResult, ISourceOutcome, ISourceOutcomes, ITrackedView } from 'microdelta';

/** The declared reporting configuration. */
export interface IConfig {
  readonly repository: string;
  /** Half-open UTC window `[start, end)` as ISO dates. */
  readonly window: { readonly start: string; readonly end: string };
}

/** One contributor's selected activity: the source result a summary reads. */
export interface IActivity {
  /** Fixture revision the record was selected from; unread by the summary. */
  readonly revision: number;
  /** Mutable upstream profile; only `name` is read by the summary. */
  readonly profile: { readonly id: string; readonly name: string; readonly avatarUrl: string };
  /** Authored PRs in window, ordered by PR number; labels are unread. */
  readonly pullRequests: readonly { readonly number: number; readonly merged: boolean; readonly labels: readonly string[] }[];
  /** Submitted reviews in window, ordered by review id. */
  readonly reviews: readonly { readonly id: string }[];
}

/** The raw fixture file shape. */
interface IFixture {
  readonly repository: string;
  readonly revision: number;
  readonly profiles: readonly { readonly key: string; readonly id: string; readonly name: string; readonly avatarUrl: string }[];
  readonly pullRequests: readonly { readonly number: number; readonly author: string; readonly createdAt: string; readonly merged: boolean; readonly labels: readonly string[] }[];
  readonly reviews: readonly { readonly id: string; readonly author: string; readonly submittedAt: string; readonly state: 'submitted' | 'pending' }[];
}

/** The environment whose data this adapter serves. */
export const fixtureEnvironment = 'fixture';

/** Read and validate the fixture file; duplicates and unknown authors are fixture errors. */
function readFixture(): IFixture {
  const fixture = JSON.parse(readFileSync(new URL('../data/acme-widget.json', import.meta.url), 'utf8')) as IFixture;
  const keys = new Set(fixture.profiles.map((profile) => profile.key));
  const numbers = new Set<number>();
  for (const pull of fixture.pullRequests) {
    if (numbers.has(pull.number) || !keys.has(pull.author)) {
      throw new Error(`fixture error: pull request ${String(pull.number)} is duplicated or names an unknown author`);
    }
    numbers.add(pull.number);
  }
  const ids = new Set<string>();
  for (const review of fixture.reviews) {
    if (ids.has(review.id) || !keys.has(review.author)) {
      throw new Error(`fixture error: review ${review.id} is duplicated or names an unknown author`);
    }
    ids.add(review.id);
  }
  return fixture;
}

/** Whether an ISO timestamp falls in the half-open window. */
function inWindow(timestamp: string, window: IConfig['window']): boolean {
  const time = Date.parse(timestamp);
  return time >= Date.parse(`${window.start}T00:00:00Z`) && time < Date.parse(`${window.end}T00:00:00Z`);
}

/** Select one contributor's activity from the fixture under the attribution rules. */
export function selectActivity(key: string, config: IConfig): IActivity {
  const fixture = readFixture();
  if (fixture.repository !== config.repository) {
    throw new Error(`the fixture holds ${fixture.repository}, not ${config.repository}`);
  }
  const profile = fixture.profiles.find((candidate) => candidate.key === key);
  if (profile === undefined) {
    throw new Error(`fixture error: no profile for ${key}`);
  }
  return {
    revision: fixture.revision,
    profile: { id: profile.id, name: profile.name, avatarUrl: profile.avatarUrl },
    pullRequests: fixture.pullRequests
      .filter((pull) => pull.author === key && inWindow(pull.createdAt, config.window))
      .sort((left, right) => left.number - right.number)
      .map((pull) => ({ number: pull.number, merged: pull.merged, labels: [...pull.labels] })),
    reviews: fixture.reviews
      .filter((review) => review.author === key && review.state === 'submitted' && inWindow(review.submittedAt, config.window))
      .map((review) => ({ id: review.id }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  };
}

/**
 * The declared source check: fetch fresh fixture data for the contributor.
 * It confirms the run's selected environment through scoped context lookup;
 * no context parameter is threaded through the helper.
 */
export function checkActivity(outcome: ISourceOutcomes, config: ITrackedView<IConfig>, key: string): ISourceOutcome<IActivity> {
  const { environment } = currentRun();
  if (environment !== fixtureEnvironment) {
    throw new Error(`the fixture adapter serves the ${fixtureEnvironment} environment, not ${environment}`);
  }
  return outcome.fresh(selectActivity(key, { repository: config.repository, window: { start: config.window.start, end: config.window.end } }));
}

/**
 * The declared finality policy: the previous result is still final when the
 * fixture revision it was selected from is still current (a conditional
 * check, like an unchanged ETag). Evaluated only for an eligible previous result.
 */
export function isFinal(previous: IPreviousResult<IActivity>): boolean {
  return previous.data.revision === readFixture().revision;
}
