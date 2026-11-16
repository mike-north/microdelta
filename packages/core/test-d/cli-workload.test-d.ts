import { expectError, expectType } from 'tsd';
import { defineCliWorkload } from '../src/index.js';
import type {
  IApplicationStatementSubmission,
  ICliWorkload,
  IWorkspace,
  IWorkspaceRun,
  IWorkspaceRunOptions,
} from '../src/index.js';

interface IInputs { readonly source: string; }
interface IHelpers { readonly token: string; }

declare const workspace: IWorkspace;
declare const options: Omit<IWorkspaceRunOptions<IInputs, IHelpers>, 'stop'>;

const workload = defineCliWorkload<IInputs, IHelpers, number>((args) => {
  expectType<readonly string[]>(args);
  return {
    workspace,
    options,
    body(run: IWorkspaceRun, application: IApplicationStatementSubmission) {
      expectType<IWorkspaceRun>(run);
      expectType<IApplicationStatementSubmission>(application);
      return Promise.resolve(args.length);
    },
    dispose() {},
  };
});
expectType<ReturnType<typeof defineCliWorkload<IInputs, IHelpers, number>>>(workload);

expectError(defineCliWorkload<IInputs, IHelpers, number>(() => ({
  workspace,
  options: { ...options, stop: undefined },
  body: () => 'wrong result',
  dispose() {},
})));

expectError(defineCliWorkload<IInputs, IHelpers, number>(() => ({
  workspace,
  options,
  body: () => 'wrong result',
  dispose() {},
})));

// The CLI alone owns stop intent, even when every other preparation field is valid.
expectError(defineCliWorkload<IInputs, IHelpers, number>(() => ({
  workspace, options: { ...options, stop: undefined }, body: () => 1, dispose() {},
})));

// Inference retains the author's input/helper contracts and asynchronous result value.
const inferred = defineCliWorkload(args => ({ workspace, options, body: () => Promise.resolve(args.length), dispose() {} }));
expectType<ICliWorkload<IInputs, IHelpers, number>>(inferred);

// Handover always includes a disposer, even when its implementation has no resources.
expectError(defineCliWorkload<IInputs, IHelpers, number>(() => ({ workspace, options, body: () => 1 })));
