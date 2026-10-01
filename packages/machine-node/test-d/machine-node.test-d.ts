import { expectError, expectType } from 'tsd';

import { canonicalNodeLocation, createNodeClock, createNodeMachine, createNodeRandom, createNodeSqlite, createNodeTimer } from '../dist/src/index.js';
import type { IClockCapability, IMachine, IRandomIdentifierCapability, ISqliteCapability, ITimerCapability } from '@microdelta/machine';

expectType<IMachine>(createNodeMachine());
expectType<ISqliteCapability>(createNodeSqlite());
expectType<IClockCapability>(createNodeClock());
expectType<ITimerCapability>(createNodeTimer());
// The timer is also a clock, so one capability serves deadlines and readings.
expectType<number>(createNodeTimer().currentEpochMilliseconds());
expectType<() => void>(createNodeTimer().schedule(0, () => undefined, { keepAlive: false }));

// A canonical location is a plain string derived from a location string.
expectType<string>(canonicalNodeLocation('/tmp/history.sqlite'));
expectError(canonicalNodeLocation());

// The random identifier source returns a string and takes no argument.
expectType<IRandomIdentifierCapability>(createNodeRandom());
expectType<string>(createNodeRandom().randomIdentifier());
