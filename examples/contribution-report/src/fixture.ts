/**
 * The example's stand-in for an upstream repository service: the checked-in
 * fixture `data/acme-widget.json`, validated on every read, plus the listing
 * status the upstream currently reports for its contributor list. Source
 * adapters (discovery and per-member activity) read it in place of a live
 * GitHub API; nothing else does. These are application fixture policies, not
 * framework rules.
 *
 * Fixture validation: a duplicate PR number or review id, or a record naming an
 * unknown contributor, is a fixture error rather than something to guess
 * around.
 */
import { readFileSync } from 'node:fs';

import type { ICollectionStatus } from 'microdelta';

/**
 * The declared reporting configuration: repository identity, the half-open
 * UTC reporting window and the gate threshold. Discovery and activity read
 * the repository and window; the gate reads `minimumAuthored`; the report
 * states all three.
 */
export interface IConfig {
  readonly repository: string;
  /** Half-open UTC window `[start, end)` as ISO dates. */
  readonly window: { readonly start: string; readonly end: string };
  /** A discovered contributor is required when their authored PR count in the window reaches this. */
  readonly minimumAuthored: number;
}

/** One profile in the fixture. `key` is stable contributor identity; `id` is the upstream profile id. */
export interface IFixtureProfile {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string;
}

/** One pull request in the fixture. */
export interface IFixturePullRequest {
  readonly number: number;
  readonly author: string;
  readonly createdAt: string;
  readonly merged: boolean;
  readonly labels: readonly string[];
}

/** One review in the fixture. Pending reviews were never submitted. */
export interface IFixtureReview {
  readonly id: string;
  readonly author: string;
  readonly submittedAt: string;
  readonly state: 'submitted' | 'pending';
}

/** The raw fixture file shape. */
export interface IFixture {
  readonly repository: string;
  /** Changes whenever the fixture's content changes, like an upstream ETag. */
  readonly revision: number;
  readonly profiles: readonly IFixtureProfile[];
  readonly pullRequests: readonly IFixturePullRequest[];
  readonly reviews: readonly IFixtureReview[];
}

/**
 * The environments the fixture adapters serve. A run selects one; each is a
 * namespace of the one store (RUN-017), so a `trial` run's results never
 * satisfy `production` except through a recorded promotion.
 */
export const environments = ['fixture', 'trial', 'production'] as const;

/** One environment the fixture adapters serve. */
export type IEnvironment = (typeof environments)[number];

/** The environment a command selects when it names none. */
export const fixtureEnvironment: IEnvironment = 'fixture';

/** Whether a string names an environment the fixture adapters serve. */
export function isEnvironment(value: string): value is IEnvironment {
  return environments.some((environment) => environment === value);
}

/**
 * The listing status the upstream currently reports for its contributor list.
 * `complete` by default; `open` stands in for an upstream that has not
 * finished listing, which is how the example exercises a strict report that
 * must wait. It is upstream state, like the fixture file, not an analysis
 * input: discovery's finality compares it with its previous result.
 */
let upstreamListing: ICollectionStatus = 'complete';

/** Select the listing status the upstream reports for the rest of this process. */
export function setUpstreamListing(status: ICollectionStatus): void {
  upstreamListing = status;
}

/** The listing status the upstream currently reports. */
export function currentUpstreamListing(): ICollectionStatus {
  return upstreamListing;
}

/** Read and validate the fixture file; duplicates and unknown authors are fixture errors. */
export function readFixture(): IFixture {
  // The record shape is trusted as the checked-in fixture's; only duplicate PR numbers and review ids and unknown authors are validated below.
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

/** Read the fixture for `repository`, which must be the repository it holds. */
export function readFixtureFor(repository: string): IFixture {
  const fixture = readFixture();
  if (fixture.repository !== repository) {
    throw new Error(`the fixture holds ${fixture.repository}, not ${repository}`);
  }
  return fixture;
}

/** Whether an ISO timestamp falls in the half-open window. */
export function inWindow(timestamp: string, window: IConfig['window']): boolean {
  const time = Date.parse(timestamp);
  return time >= Date.parse(`${window.start}T00:00:00Z`) && time < Date.parse(`${window.end}T00:00:00Z`);
}

/** A contributor's unique authored PRs created in the window, ordered by number. */
export function authoredInWindow(fixture: IFixture, key: string, window: IConfig['window']): IFixturePullRequest[] {
  return fixture.pullRequests
    .filter((pull) => pull.author === key && inWindow(pull.createdAt, window))
    .sort((left, right) => left.number - right.number);
}

/** A contributor's unique reviews submitted in the window (pending reviews excluded), ordered by id. */
export function submittedInWindow(fixture: IFixture, key: string, window: IConfig['window']): IFixtureReview[] {
  return fixture.reviews
    .filter((review) => review.author === key && review.state === 'submitted' && inWindow(review.submittedAt, window))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}
