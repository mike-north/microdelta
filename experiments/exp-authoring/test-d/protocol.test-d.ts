/** The first slice exposes owned symbolic edges and numeric results, never authored storage carriers. */
import { expectError, expectType } from 'tsd';
import { analysis, memo } from '../src/protocol.js';
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
