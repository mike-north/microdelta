import { expectType, expectError } from 'tsd';
import { authoring, openWorkspace } from 'microdelta';
import type { IAuthoring, IWorkspace } from 'microdelta';
expectType<IAuthoring<Record<string, never>, Record<string, never>>>(authoring<Record<string, never>, Record<string, never>>());
expectType<IWorkspace>(openWorkspace({ location: 'synthetic.sqlite', logicalStore: 'synthetic' }));
expectError(openWorkspace({ location: 'synthetic.sqlite' }));

// DOM-2's delivered implicit scope uses two facade-local generated aliases.
import { currentExecution, currentRun } from 'microdelta';
import type { IRunContext, IRunExecution } from 'microdelta';
expectType<IRunContext>(currentRun());
expectType<string>(currentRun().environment);
expectType<string>(currentRun().analysis);
expectType<IRunExecution>(currentExecution());
expectType<boolean>(currentExecution().signal.aborted);
expectType<IRunExecution['operation']>(currentExecution().operation);
expectType<IRunExecution['send']>(currentExecution().send);
expectType<IRunExecution['sleepUntil']>(currentExecution().sleepUntil);
