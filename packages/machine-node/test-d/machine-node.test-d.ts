import { expectType } from 'tsd';

import { createNodeClock, createNodeMachine, createNodeSqlite } from '../dist/src/index.js';
import type { IClockCapability, IMachine, ISqliteCapability } from '@microdelta/machine';

expectType<IMachine>(createNodeMachine());
expectType<ISqliteCapability>(createNodeSqlite());
expectType<IClockCapability>(createNodeClock());
