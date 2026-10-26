/** CLI-005 owner declaration contract: exact handle, finite reader, and narrow app authority. */
import { expectError, expectType } from 'tsd';

import { openExecutionObservationReader } from '../dist/api/supervision.alpha.js';
import type {
  IApplicationStatementSubmission,
  IExecutionObservationHost,
  IExecutionObservationReadResult,
  IObservationAcknowledgment,
  IRunOptions,
  IRunResult,
  ISupervision,
} from '../dist/api/supervision.alpha.js';

declare const supervision: ISupervision;
declare const options: IRunOptions;
declare const host: IExecutionObservationHost;
declare const application: IApplicationStatementSubmission;

const synchronous = supervision.startObserved({ ...options, observationLocation: 'observation.sqlite' }, (_run, submit) => {
  submit.submit({ kind: 'incomplete', reasons: ['coverage'] });
  expectError(submit.phase);
  return 7;
});
expectType<Promise<IRunResult<number>>>(synchronous.result);
expectType<Promise<IObservationAcknowledgment>>(synchronous.acknowledgment);
expectType<string>(synchronous.locator.executionId);

const asynchronous = supervision.startObserved({ ...options, observationLocation: 'observation.sqlite' }, async () => 'value');
expectType<Promise<IRunResult<string>>>(asynchronous.result);
expectError(supervision.startObserved(options, () => 'missing location'));
expectError(application.submit({ kind: 'confirmed' }));

const reader = openExecutionObservationReader(host.reader, synchronous.locator);
expectType<IExecutionObservationReadResult>(reader.read());
expectType<void>(reader.close());
expectError(reader.write);
expectError(reader.stop);
