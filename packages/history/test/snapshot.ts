/**
 * The History test backend exercises copy isolation through a local V8-shaped
 * capability; production wiring is independently verified in assembly tests.
 */
import { deserialize, serialize } from 'node:v8';

import type { ISnapshotCapability } from '@microdelta/machine';

export const testSnapshotCapability: ISnapshotCapability = {
  snapshot<T>(value: T): T {
    // The test codec round-trips the generic fixture value rather than changing
    // its schema; Node Machine conformance covers the production adapter.
    return deserialize(serialize(value)) as T;
  },
};
