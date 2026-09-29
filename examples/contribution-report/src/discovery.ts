/**
 * The contributor discovery source adapter: turns the fixture's activity in
 * the reporting window into a keyed collection of contributor records with a
 * completion status. It is an application policy, not a framework rule.
 *
 * Discovery rule (see the README): a contributor is discovered when they
 * authored a PR created in the window or submitted a non-pending review in the
 * window. Records are listed in the fixture's profile order; that order is
 * never identity. Each record's designated identity is its stable `key`
 * (`person:ada`); the custom-key variant keys by the upstream profile `id`
 * (`gh:1001`). The completion status is whatever the upstream currently
 * reports for its listing.
 */
import { currentRun } from 'microdelta';
import type { ICollectionResult, ICollectionStatus, IPreviousResult, ISourceOutcome, ISourceOutcomes, ITrackedView } from 'microdelta';

import { authoredInWindow, currentUpstreamListing, fixtureEnvironment, readFixture, readFixtureFor, submittedInWindow } from './fixture.js';
import type { IConfig } from './fixture.js';

/** One discovered contributor record. */
export interface IContributor {
  /** Designated identity: stable contributor key. Also selects the member's activity. */
  readonly key: string;
  /** Upstream profile id: the custom key. */
  readonly id: string;
  /** Display name; no member work reads it from the discovery record. */
  readonly name: string;
  /** Authored PRs created in the window; read by the gate. */
  readonly authored: number;
}

/** The discovery result: the keyed member list, its completion status and the fixture revision it came from. */
export interface IContributors extends ICollectionResult<IContributor> {
  /** Fixture revision the listing was selected from; read only by the finality policy. */
  readonly revision: number;
}

/** Discover the contributors active in the window, under the upstream's current listing status. */
export function selectContributors(config: Pick<IConfig, 'repository' | 'window'>, status: ICollectionStatus): IContributors {
  const fixture = readFixtureFor(config.repository);
  const members = fixture.profiles.flatMap((profile): IContributor[] => {
    const authored = authoredInWindow(fixture, profile.key, config.window).length;
    const reviewed = submittedInWindow(fixture, profile.key, config.window).length;
    return authored > 0 || reviewed > 0 ? [{ key: profile.key, id: profile.id, name: profile.name, authored }] : [];
  });
  return { revision: fixture.revision, status, members };
}

/**
 * The discovery check: fetch the current listing from the fixture upstream.
 * Like the activity adapter, it confirms the run's selected environment.
 */
export function discover(outcome: ISourceOutcomes, config: ITrackedView<IConfig>): ISourceOutcome<IContributors> {
  const { environment } = currentRun();
  if (environment !== fixtureEnvironment) {
    throw new Error(`the fixture adapter serves the ${fixtureEnvironment} environment, not ${environment}`);
  }
  const window = { start: config.window.start, end: config.window.end };
  return outcome.fresh(selectContributors({ repository: config.repository, window }, currentUpstreamListing()));
}

/**
 * The discovery finality policy: the previous listing is still final while
 * its fixture revision is current and the upstream still reports the same
 * listing status. Evaluated only for an eligible previous result.
 */
export function isDiscoveryFinal(previous: IPreviousResult<IContributors>): boolean {
  return previous.data.revision === readFixture().revision && previous.data.status === currentUpstreamListing();
}
