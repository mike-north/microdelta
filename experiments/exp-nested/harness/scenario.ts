/**
 * Ordinary author code for the nested selected-read gate. The same helpers run
 * against lazy SQLite-backed views in a worker process and against in-memory
 * tracked wrappers in the test process, so their evidence can be compared.
 */
import type { ITracked, ITrackingObservation, ITrackingObserver } from '@microdelta/tracking';

import type { IActivityRecord, IDomainView } from './fixtures.js';

/** The M3 statistics a contributor summary derives from its activity source. */
export interface IActivityStatistics {
  readonly name: string;
  readonly authored: number;
  readonly merged: number;
  readonly reviews: number;
  readonly sentence: string;
}

/** Deterministic singular/plural wording, as the M3 formatter requires. */
function count(value: number, singular: string, plural: string): string {
  return `${String(value)} ${value === 1 ? singular : plural}`;
}

/**
 * Summarize activity with ordinary nested reads and indexed loops. Only the
 * name, each PR's merged flag and the two lengths are consumed; ids, dates,
 * labels, avatar and notes stay unread.
 */
export function summarize(activity: ITracked<IActivityRecord>): IActivityStatistics {
  const name = activity.profile.name;
  const pullRequests = activity.pullRequests;
  let merged = 0;
  for (let position = 0; position < pullRequests.length; position += 1) {
    if (pullRequests[position]?.merged === true) {
      merged += 1;
    }
  }
  const authored = pullRequests.length;
  const reviews = activity.reviews.length;
  const mergedClause = `${String(merged)} of which ${merged === 1 ? 'was' : 'were'} merged`;
  return {
    name,
    authored,
    merged,
    reviews,
    sentence: `${name} authored ${count(authored, 'pull request', 'pull requests')}, ${mergedClause}, and submitted ${count(reviews, 'review', 'reviews')}.`,
  };
}

/**
 * Exercise every supported operation over the domain edge record: key order,
 * holes versus present undefined, lengths, own versus inherited members through
 * two custom prototype levels, null-prototype records, Property "0" versus
 * Index 0, dotted keys, numeric edge values, null and a `then` data field.
 */
export function exerciseDomain(observer: ITrackingObserver, view: ITracked<IDomainView>): readonly unknown[] {
  return [
    observer.keys(view.ordered),
    view.sparse[1], 1 in view.sparse, view.sparse.length, view.sparse[3],
    view.present[1], 1 in view.present, observer.hasOwn(view.present, '1'),
    view.child.own, view.child.inherited, view.child.shadowed, view.child.depth, view.child.box.label,
    'inherited' in view.child, observer.hasOwn(view.child, 'inherited'), observer.hasOwn(view.child, 'own'),
    'missing' in view.child, Reflect.get(view.child, 'missing'), observer.keys(view.child),
    view.bare.only, 'toString' in view.bare, Reflect.get(view.bare, 'toString'),
    view.record['0'], view.record['a.b'], view.list[0], view.list.length,
    view.numbers.notANumber, Object.is(view.numbers.negativeZero, -0), view.numbers.infinity,
    view.nothing, view.then,
  ];
}

/** A stable, comparable rendering of evidence: kind, operation, address and digest. */
export function renderEvidence(observations: readonly ITrackingObservation[]): readonly string[] {
  return observations.map((observation) => JSON.stringify([
    observation.kind,
    observation.operation,
    observation.address.map((segment) => segment.kind === 'property' ? ['p', segment.key] : ['i', segment.index]),
    observation.fingerprint,
  ]));
}
