/** Independent review of consumption variance: no runtime schema promise. */
import { expectError, expectNotAssignable, expectType } from 'tsd';
import type { IWorkspace } from 'microdelta';
import { analysis, graphOf, memo } from '../../../experiments/exp-authoring/src/protocol.js';
import type { IAnalysis, IGraph } from '../../../experiments/exp-authoring/src/protocol.js';
import { execute } from '../../../experiments/exp-authoring/src/execute.js';
import type { IResult } from '../../../experiments/exp-authoring/src/execute.js';
interface ITitle { readonly title: string }
declare const workspace: IWorkspace;
const title = analysis<ITitle>((input) => memo({ name: 'title', from: { title: input('title') }, run: ({ title }) => title.length }));
expectNotAssignable<IAnalysis<object>>(title);
expectNotAssignable<IAnalysis<{ readonly title: unknown }>>(title);
expectNotAssignable<IAnalysis<{ readonly title?: string }>>(title);
expectNotAssignable<IAnalysis<{ readonly title: string | number }>>(title);
expectError(execute(workspace, title, { analysis: 'a', environment: 'test', requestKey: 'k', inputs: {} }));
expectError(execute(workspace, title, { analysis: 'a', environment: 'test', requestKey: 'k', inputs: { title: 123 } }));
expectError(execute(workspace, title, { analysis: 'a', environment: 'test', requestKey: 'k', inputs: { title: { length: 99 } } }));
function run<TInputs extends object>(entry: IAnalysis<TInputs>, inputs: TInputs): Promise<IResult> {
  return execute(workspace, entry, { analysis: 'a', environment: 'test', requestKey: 'k', inputs });
}
function inspect<TInputs extends object>(entry: IAnalysis<TInputs>): IGraph { return graphOf(entry); }
expectError(run(title, { title: 123 }));
expectType<Promise<IResult>>(run(title, { title: 'ok' }));
expectType<IGraph>(inspect(title));
expectType<IGraph>(graphOf(title));
