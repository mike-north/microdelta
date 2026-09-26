/** Proposed public ergonomics: managed envelopes contain author-owned steps. */
import { expectError, expectType } from 'tsd';
import { analysisContext, memo, retrieval, source, step } from './surface.js';
import type { IPrevious, IRef, IReuse } from './surface.js';
import { createRosterAnalysis } from './analysis.js';
import type { IEnvironment, IAnalysis } from './surface.js';
import type { IInput, IReport, IServices } from './domain.js';

const label = memo<{ id: string }, string>({
  name: 'label', revision: 1,
  step: {
    identity: async input => await input.id,
    run: async input => await input.id,
  },
});
expectType<IRef<string>>(label({ id: 'one' }));
expectError(memo<{ id: string }, string>({ name: 'missingIdentity', revision: 1, step: { run: async input => await input.id } }));
expectError(memo<{ id: string }, string>({ name: 'missingRevision', step: { identity: async input => await input.id, run: async input => await input.id } }));
expectError(label({ id: 7 }));

// A reuse marker is consumed by the runtime, never exposed as ordinary output.
const retained = retrieval<{ id: string }, string>({
  name: 'retained', revision: 1,
  step: {
    identity: async input => await input.id,
    isFinal: async (input, previous) => (await previous.value) === (await input.id),
    run: async (input, previous) => previous === undefined ? await input.id : previous.reuse('validated'),
  },
});
expectType<IRef<string>>(retained({ id: 'one' }));
declare const previous: IPrevious<string>;
expectType<IReuse<string>>(previous.reuse('unchanged'));
expectError(previous.value = 'mutated');
// Awaiting prior data must not permit mutation of nested values or array members.
declare const mutablePrior: IPrevious<{ nested: { label: string }; items: string[] }>;
const snapshot = await mutablePrior.value;
expectError(snapshot.nested.label = 'mutated');
expectError(snapshot.items.push('mutated'));
expectError(memo<{ id: string }, number>({
  name: 'wrongReuse', revision: 1,
  step: { identity: async input => await input.id, run: () => previous.reuse('wrong value type') },
}));
memo<{ id: string }, string>({
  name: 'coldReuse', revision: 1,
  step: {
    identity: async input => await input.id,
    // @ts-expect-error A cold miss has no previous result on which to invoke reuse.
    run: (_input, prior) => prior.reuse('possibly absent'),
  },
});

// Non-memoized steps have no required memo identity callback.
step<{ value: string }, string>({ name: 'plain', step: { run: async input => await input.value } });
source<{ value: string }, string>({
  name: 'discovery',
  step: {
    key: value => value,
    async *run(input) { yield await input.value; },
  },
});
expectType<AbortSignal>(analysisContext().signal);
declare const environment: IEnvironment<IServices>;
expectType<IAnalysis<IInput, IReport>>(createRosterAnalysis(environment));
