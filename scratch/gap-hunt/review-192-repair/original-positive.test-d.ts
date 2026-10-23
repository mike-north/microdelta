/** Generated alpha declarations accept scalar TResult despite the runtime's record/array-root guard. */
import { expectType } from 'tsd';
import { authoring, sourceOutcome } from '../../../packages/core/dist/api/microdelta.alpha.js';

type IAtom = string | number | boolean | null | undefined;
type IEmpty = Record<never, never>;
const builders = authoring<IEmpty, IEmpty>();
for (const atom of ['serialized dependency', 1, true, null, undefined]) {
  expectType<ReturnType<typeof builders.source<IAtom>>>(builders.source<IAtom>({ subject: 'scalar-source', run: () => sourceOutcome.fresh(atom) }));
  expectType<ReturnType<typeof builders.memo<IEmpty, IAtom>>>(builders.memo<IEmpty, IAtom>({ subject: 'scalar-memo', run: () => atom }));
}
