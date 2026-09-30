import { expectType } from 'tsd';

import { createNodeClock, createNodeMachine, createNodeSqlite, createNodeTimer } from '../dist/src/index.js';
import type { IClockCapability, IMachine, ISqliteCapability, ITimerCapability } from '@microdelta/machine';

expectType<IMachine>(createNodeMachine());
expectType<ISqliteCapability>(createNodeSqlite());
expectType<IClockCapability>(createNodeClock());
expectType<ITimerCapability>(createNodeTimer());
// The timer is also a clock, so one capability serves deadlines and readings.
expectType<number>(createNodeTimer().currentEpochMilliseconds());
expectType<() => void>(createNodeTimer().schedule(0, () => undefined, { keepAlive: false }));
