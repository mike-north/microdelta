/** Compare validation strategies without mixing envelope metadata into steps. */
import { expectError, expectType } from 'tsd';
import { unified } from './api-options-surface.js';
import { createNamedVariant, createUnifiedVariant } from './api-options.js';
import type { IAssessment, IPRData, IPRReference, IServices, ISourcePolicy } from './domain.js';
import type { IMemoStep, IRef } from './surface.js';

declare const services: IServices;
declare const pr: IRef<IPRReference>;
declare const policy: IRef<ISourcePolicy>;
const named = createNamedVariant(services);
const unifiedVariant = createUnifiedVariant(services);

// Both shapes feed the same PR-assessment graph and return author payloads.
expectType<IRef<IAssessment>>(named({ pr, policy, prompt: 'Assess complexity', model: 'fixture-model' }));
expectType<IRef<IAssessment>>(unifiedVariant({ pr, policy, prompt: 'Assess complexity', model: 'fixture-model' }));
expectError(named({ pr, policy, prompt: 1, model: 'fixture-model' }));
expectError(unifiedVariant({ pr, policy, prompt: 1, model: 'fixture-model' }));

// Validation mode belongs to the envelope; prior-result and hook types do not change.
declare const step: IMemoStep<{ pr: IPRReference; policy: ISourcePolicy }, IPRData>;
expectType<IRef<IPRData>>(unified.memo({ name: 'pr', revision: 1, step, cache: { reuse: 'explicit' } })({ pr, policy }));
expectType<IRef<IPRData>>(unified.memo({ name: 'pr', revision: 1, step, cache: { reuse: 'automatic' } })({ pr, policy }));
expectType<IRef<IPRData>>(unified.memo({ name: 'pr', revision: 1, step })({ pr, policy }));
expectError(unified.memo({ name: 'pr', revision: 1, step, cache: { reuse: 'sometimes' } }));
expectError(unified.memo<{ id: string }, string>({
  name: 'missingIdentity', revision: 1, cache: { reuse: 'explicit' },
  step: { run: async input => await input.id },
}));
expectError(unified.memo<{ id: string }, string>({
  name: 'missingRevision', cache: { reuse: 'explicit' },
  step: { identity: async input => await input.id, run: async input => await input.id },
}));

// A current finality hook returns a boolean, never the reuse control outcome.
expectError(unified.memo<{ id: string }, string>({
  name: 'notABoolean', revision: 1, cache: { reuse: 'explicit' },
  step: {
    identity: async input => await input.id,
    isFinal: (_input, previous) => previous.reuse('wrong channel'),
    run: async input => await input.id,
  },
}));
