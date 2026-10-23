/** The first slice exposes owned symbolic edges and numeric results, never authored storage carriers. */
import { expectError, expectType, expectNotAssignable } from 'tsd';
import { analysis, memo } from '../src/protocol.js';
import { execute } from '../src/execute.js';
import { graphOf } from '../src/protocol.js';
import type { IWorkspace } from 'microdelta';
import type { IAnalysis, IBinding } from '../src/protocol.js';

/** Input names/types are ordinary author declarations; the prototype does not special-case them. */
interface IInputs { readonly document: { readonly title: string; readonly unread: string }; readonly multiplier: number }

const entry = analysis<IInputs>((input) => {
  const length = memo({ name: 'length', from: { document: input('document') }, run: ({ document }) => document.title.length });
  expectType<IBinding<number>>(length);
  return memo({ name: 'score', from: { length, multiplier: input('multiplier') }, run: ({ length, multiplier }) => length * multiplier });
});
expectType<IAnalysis<IInputs>>(entry);
expectError(analysis<IInputs>((input) => memo({ name: 'bad', from: { data: input('missing') }, run: () => 1 })));
expectError(analysis<IInputs>(() => memo({ name: 'bad', from: { data: 1 }, run: () => 1 })));
expectError(analysis<IInputs>((input) => memo({ name: 'bad', from: { document: input('document') }, run: ({ document }) => document.missing })));
expectError(analysis<IInputs>(() => memo({ name: 'bad', from: {}, run: () => ({ value: 1 }) })));
expectError(analysis<IInputs>(() => memo({ name: 'bad', from: {}, run: async () => 1 })));

/** Execution consumes this contract: widening it must not erase required input types. */
const requiresTitle = analysis<{ readonly title: string }>((input) => memo({ name: 'title', from: { title: input('title') }, run: ({ title }) => title.length }));
expectNotAssignable<IAnalysis<{ readonly title: unknown }>>(requiresTitle);

/** Generic callers preserve their input contract and graph inspection remains type-independent. */
declare const workspace: IWorkspace;
expectError(execute(workspace, requiresTitle, { analysis: 'title', environment: 'test', requestKey: 'bad', inputs: { title: { length: 999 } } }));
expectType<Promise<import('../src/execute.js').IResult>>(execute(workspace, requiresTitle, { analysis: 'title', environment: 'test', requestKey: 'good', inputs: { title: 'valid' } }));
expectType<import('../src/protocol.js').IGraph>(graphOf(requiresTitle));
/** An existing generic execution helper must infer the same consumption contract. */
function runGeneric<TInputs extends object>(entry: IAnalysis<TInputs>, inputs: TInputs): ReturnType<typeof execute> {
  return execute(workspace, entry, { analysis: 'generic', environment: 'test', requestKey: 'good', inputs });
}
expectType<Promise<import('../src/execute.js').IResult>>(runGeneric(requiresTitle, { title: 'valid' }));
