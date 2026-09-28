/**
 * A consumer approved for Value, Tracking and Materialization hands Value's own
 * projection fact to Materialization. Materialization's generated surface names
 * the projection contract through Tracking (so consumers without a Value edge,
 * such as Resolution, can resolve it); Value-produced facts must stay assignable
 * in both directions.
 */
import type { IMaterialization } from '@microdelta/materialization';
import type { ITrackingBinding } from '@microdelta/tracking';
import type { IValueProjectionFact } from '@microdelta/value';

/** Project a Value fact through Materialization and keep Value's type for the result. */
export function projectValueFact(materialization: IMaterialization, binding: ITrackingBinding, fact: IValueProjectionFact): IValueProjectionFact {
  return materialization.project(binding, fact);
}
