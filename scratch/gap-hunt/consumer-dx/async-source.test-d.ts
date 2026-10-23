/** Negative controls remain rejected independently of asynchronous source support. */
import { expectError } from 'tsd';
import { authoring } from 'microdelta';
interface IValue { readonly value: number }
const api = authoring<Record<string, never>, Record<string, never>>();
expectError(api.source<IValue>({ subject: 'wrong-envelope', run: () => ({ kind: 'fresh', value: { value: 1 } }) }));
expectError(api.source<IValue>({ subject: 'wrong-root-type', run: ({ outcome }) => outcome.fresh<IValue>(1) }));
// A promise must not erase the declared result shape. Scalar-root policy itself belongs to #156.
expectError(api.source<IValue>({ subject: 'wrong-promised-root', run: async ({ outcome }) => { await Promise.resolve(); return outcome.fresh<number>(1); } }));
