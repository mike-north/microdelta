import { expectError, expectType } from 'tsd';
import type { ICompletedResultReader, ICompletedResultReference } from '@microdelta/history';
import type { ITrackingObserverHost } from '@microdelta/tracking';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ITracked } from '@microdelta/tracking';

import { createMaterialization } from '../dist/api/materialization.alpha.js';
import * as publicMaterialization from '@microdelta/materialization';

// The context is intentionally alpha-only until its contracts are accepted.
expectError(publicMaterialization.createMaterialization);

const machine: ITrackingObserverHost = {
  createAsyncContext: () => ({ getStore: () => undefined, run: (_value, callback) => callback() }),
  sha256: () => '0'.repeat(64),
};
declare const reader: ICompletedResultReader;
declare const reference: ICompletedResultReference;
const tracking = createTrackingObserver(machine);
const materialization = createMaterialization({ tracking, reader });
const view = materialization.materialize<{ readonly name: string }>(reference, { path: ['step'] });
expectType<ITracked<{ readonly name: string }>>(view);
expectType<string>(view.name);
expectType<string>(tracking.capture(() => view.name).value);
const tracked = tracking.tracked({ profile: { name: 'Ada' } }, { path: ['input'] });
const detached = materialization.materializeOutput(tracked.profile);
function needsTrackedProfile(_value: ITracked<{ readonly name: string }>): void {}
expectError(needsTrackedProfile(detached));
expectType<string>(detached.name);
expectError(() => {
  materialization.materializeOutput({ profile: tracked.profile }).profile.name = 'changed';
});
