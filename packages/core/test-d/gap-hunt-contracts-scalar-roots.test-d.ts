/** Generated alpha declarations accept scalar TResult despite the runtime's record/array-root guard. */
import { expectType } from 'tsd';
import { authoring, sourceOutcome } from '../dist/api/microdelta.alpha.js';

type IAtom = string | number | boolean | null | undefined;
type IEmpty = Record<never, never>;
const builders = authoring<IEmpty, IEmpty>();
for (const atom of ['serialized dependency', 1, true, null, undefined]) {
  // eslint-disable-next-line microdelta/tracked-captures -- Type-only historical mismatch probe deliberately returns a fixed untracked atom; no runtime capture executes.
  expectType<ReturnType<typeof builders.source<IAtom>>>(builders.source<IAtom>({ subject: 'scalar-source', run: () => sourceOutcome.fresh(atom) }));
  // eslint-disable-next-line microdelta/tracked-captures -- Type-only historical mismatch probe tests generic scalar acceptance independently of runtime tracking.
  expectType<ReturnType<typeof builders.memo<IEmpty, IAtom>>>(builders.memo<IEmpty, IAtom>({ subject: 'scalar-memo', run: () => atom }));
}
