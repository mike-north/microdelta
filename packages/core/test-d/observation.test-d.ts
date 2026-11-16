/** CLI-005 facade declaration contract over the generated alpha tier. */
import { expectError, expectType } from 'tsd';

import { openExecutionObservationReader } from '../dist/api/microdelta.alpha.js';
import type {
  IExecutionObservationReadResult,
  IExecutionObservationFaultCount,
  IObservationAcknowledgment,
  IRunResult,
  IWorkspace,
  IWorkspaceRunOptions,
} from '../dist/api/microdelta.alpha.js';

// @ts-expect-error: Exact execution observation is alpha, not the default release tier.
export type { IExecutionObservation as IDefaultObservationMustRemainHidden } from 'microdelta';

declare const workspace: IWorkspace;
declare const options: IWorkspaceRunOptions<object, object>;

const synchronous = workspace.startObserved({ ...options, observationLocation: 'observation.sqlite' }, (run, application) => {
  expectType<string>(run.context.runId);
  application.submit({ kind: 'not-classified' });
  expectError(application.close);
  return 7;
});
expectType<Promise<IRunResult<number>>>(synchronous.result);
expectType<Promise<IObservationAcknowledgment>>(synchronous.acknowledgment);
declare const faultCount: IExecutionObservationFaultCount;
expectType<number>(faultCount.count);
expectType<boolean>(faultCount.lowerBound);

const asynchronous = workspace.startObserved({ ...options, observationLocation: 'observation.sqlite' }, async () => 'value');
expectType<Promise<IRunResult<string>>>(asynchronous.result);
expectError(workspace.startObserved(options, () => 'missing location'));

const reader = openExecutionObservationReader(synchronous.locator);
expectType<IExecutionObservationReadResult>(reader.read());
expectType<void>(reader.close());
expectError(reader.write);
expectError(reader.cancel);
