/**
 * The alpha coordinator contract accepts only registered surface identity and
 * cost evidence; callers cannot omit or manufacture gate memberships. Its
 * capability inputs keep epoch floors separate from elapsed debit time.
 *
 * @see ../../../docs/spec/operations.md (RUN-019)
 */
import { expectAssignable, expectError, expectType } from 'tsd';
import { createSharedRateCoordinator } from '../dist/src/index.js';
import type { IRunElapsedClock, IRunEpochClock, ISharedRateAdmission, ISharedRateSurface } from '../dist/src/index.js';

declare const elapsedClock: IRunElapsedClock;
declare const epochClock: IRunEpochClock;
declare const surface: ISharedRateSurface;

const owner = createSharedRateCoordinator({ elapsedClock, epochClock });
expectType<ISharedRateSurface>(owner.registerSurface({
  environment: 'prod',
  service: 'billing',
  accessContext: 'account-1',
  surface: 'search',
  gates: [{ id: 'api', limit: { units: 10, intervalMilliseconds: 60_000, costBasis: 'quantity' } }],
}));

expectType<ISharedRateAdmission>(owner.admit({ surface, run: 'run-1', quantityCost: 1, acceptedNotBefore: 100 }));
expectError(owner.admit({ surface, run: 'run-1', quantityCost: 1, gates: [] }));
expectError(owner.admit({ surface, run: 'run-1', quantityCost: 'one' }));
expectAssignable<ISharedRateAdmission>(owner.admit({ surface, run: 'run-2' }));
