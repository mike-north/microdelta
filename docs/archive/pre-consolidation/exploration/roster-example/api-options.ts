/** Compile-checked alternatives. Choose one per analysis; no runtime is implemented. @internal */
import { unified } from './api-options-surface.js';
import { analysisContext, memo, retrieval } from './surface.js';
import { isPRFinal, resolvePR, validateJudgment } from './policies.js';
import type { IAssessment, IPRData, IPRReference, IRequestOptions, IServices, ISourcePolicy } from './domain.js';
import type { IBindings, IMemoStep, IRef } from './surface.js';

/** Same request scope for both options; context is acquired only during execution. */
function requestOptions(): IRequestOptions {
  const context = analysisContext();
  context.signal.throwIfAborted();
  return { signal: context.signal, onUsage: observation => context.record(observation) };
}
/** The source policy is explicit current input, separate from stable PR identity. @internal */
export interface IRetrievalInput { readonly pr: IPRReference; readonly policy: ISourcePolicy }
/** Person-independent assessment inputs preserve shared per-PR work. @internal */
export interface IAssessmentInput { readonly evidence: IPRData; readonly prompt: string; readonly model: string }
/** Both candidate pipelines have this same call site. @internal */
export interface IPipelineInput extends IRetrievalInput { readonly prompt: string; readonly model: string }

/** Identical bodies ensure this comparison changes only constructor/option spelling. */
function steps(services: IServices): {
  readonly retrieve: IMemoStep<IRetrievalInput, IPRData>;
  readonly assess: IMemoStep<IAssessmentInput, IAssessment>;
} {
  return {
    retrieve: {
      identity: async input => await input.pr.url,
      isFinal: async (input, previous) => isPRFinal(
        { merged: await previous.value.merged }, await input.policy,
      ),
      run: async (input, previous) => resolvePR(
        await input.pr.url,
        previous === undefined ? undefined : { value: await previous.value, reuse: previous.reuse },
        services.pr, requestOptions(),
      ),
    },
    assess: {
      identity: async input => await input.evidence.url,
      run: async input => {
        const title = await input.evidence.title;
        const body = await input.evidence.body;
        const diff = await input.evidence.diff;
        const reviews = await input.evidence.reviews;
        const prompt = await input.prompt;
        const model = await input.model;
        const response = await services.judge({ title, body, diff, reviews, prompt, model }, requestOptions());
        return { url: await input.evidence.url, ...validateJudgment(response) };
      },
    },
  };
}

/** Reuse the exact consumer wiring so neither alternative hides composition burden. */
function pipeline(
  retrieve: (input: IBindings<IRetrievalInput>) => IRef<IPRData>,
  assess: (input: IBindings<IAssessmentInput>) => IRef<IAssessment>,
): (input: IBindings<IPipelineInput>) => IRef<IAssessment> {
  return input => assess({
    evidence: retrieve({ pr: input.pr, policy: input.policy }),
    prompt: input.prompt, model: input.model,
  });
}

/** Candidate A: two names express the different validation strategies. @internal */
export function createNamedVariant(services: IServices): (input: IBindings<IPipelineInput>) => IRef<IAssessment> {
  const step = steps(services);
  return pipeline(
    retrieval({ name: 'retrievePR', revision: 1, step: step.retrieve }),
    memo({ name: 'assessComplexity', revision: 1, step: step.assess }),
  );
}

/** Candidate B: one step mechanism, with an explicit source-validation option. @internal */
export function createUnifiedVariant(services: IServices): (input: IBindings<IPipelineInput>) => IRef<IAssessment> {
  const step = steps(services);
  return pipeline(
    unified.memo({ name: 'retrievePR', revision: 1, cache: { reuse: 'explicit' }, step: step.retrieve }),
    unified.memo({ name: 'assessComplexity', revision: 1, step: step.assess }),
  );
}
