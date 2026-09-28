/**
 * Independently specified report entries for the base acme/widget Q1 world,
 * derived by hand from the M3 plan's fixture decisions and the contribution
 * example's attribution rules, never from program output:
 * - Ada: PRs 101 and 102 merged, 103 open (98 predates the window); five
 *   submitted reviews in the window (rv-ada-0 predates it, rv-ada-6 pending).
 * - Ben: PR 201 merged, 202 open (204 is created at the exclusive end); three
 *   submitted reviews in the window (rv-ben-4 follows it).
 *
 * @see ../../../../docs/plans/m3-contribution-analysis.md (Concrete fixture decisions)
 */

/** Ada's report entry. */
export const adaExpected = Object.freeze({ key: 'person:ada', name: 'Ada', authored: 3, merged: 2, reviews: 5, sentence: 'Ada authored 3 pull requests, 2 of which were merged, and submitted 5 reviews.' });

/** Ben's report entry (singular "was merged"). */
export const benExpected = Object.freeze({ key: 'person:ben', name: 'Ben', authored: 2, merged: 1, reviews: 3, sentence: 'Ben authored 2 pull requests, 1 of which was merged, and submitted 3 reviews.' });
