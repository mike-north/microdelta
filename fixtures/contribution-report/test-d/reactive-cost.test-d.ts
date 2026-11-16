/** TEST-6 consumer contracts compile against emitted fixture declarations and generated package alpha entries. */
import { expectError, expectType } from 'tsd';
import { parseReactiveCostReceipts, runReactiveCost, validateReactiveCostJob } from '../.test-build/fixtures/contribution-report/reactive-cost.js';
import type { IReactiveCostJob, IReactiveCostReceipt } from '../.test-build/fixtures/contribution-report/reactive-cost.js';

const job = validateReactiveCostJob({});
expectType<IReactiveCostJob>(job);
expectType<Promise<readonly IReactiveCostReceipt[]>>(runReactiveCost(job));
expectType<readonly IReactiveCostReceipt[]>(parseReactiveCostReceipts('[]'));
expectError(runReactiveCost({ ...job, phase: 'live-provider' }));
expectError(runReactiveCost({ ...job, memberIterations: 'expensive' }));
declare const receipt: IReactiveCostReceipt;
expectError(receipt.members.length = 0);
expectError(receipt.aggregate.value.total = 0);
expectType<'completed-result'>(receipt.aggregate.reference.kind);
