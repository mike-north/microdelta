/** Node supplies the portable coordinated read authority without exposing a driver. */
import { expectType } from 'tsd';
import type { ISqliteCoordinatedReadCapability } from '@microdelta/machine';
import { createNodeSqliteCoordinatedReader } from '../dist/src/index.js';
expectType<ISqliteCoordinatedReadCapability>(createNodeSqliteCoordinatedReader());
