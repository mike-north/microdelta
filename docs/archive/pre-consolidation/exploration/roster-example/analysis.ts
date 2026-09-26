/** Complete authoring sketch. surface.js intentionally has declarations only. @internal */
import { analysis, analysisContext, fanOut, memo, retrieval, source, step } from './surface.js';
import { collectAssessments, collectStrict, discoverPRs, isPRFinal, resolvePR, validateJudgment, validateRoster } from './policies.js';
import type { IAssessment, IEmployee, IInput, IPersonSummary, IPRData, IPRReference, IReport, IRequestOptions, IServices, ISourcePolicy, IWindow } from './domain.js';
import type { IAnalysis, ICollection, IEnvironment } from './surface.js';

/** Acquire scoped facilities only inside executing callbacks, never while wiring a plan. */
function requestOptions(): IRequestOptions {
  const context = analysisContext();
  context.signal.throwIfAborted();
  return { signal: context.signal, onUsage: observation => context.record(observation) };
}

/**
 * Compose org ID → CSV roster → people → paginated PRs → evidence → complexity
 * → one complete contribution summary per roster row. Provider clients are injected.
 * @internal
 */
export function createRosterAnalysis(environment: IEnvironment<IServices>): IAnalysis<IInput, IReport> {
  const services = environment.services;

  // Persist the returned CSV, but refresh the HR source each run in this example.
  // A future HR validator/reuse policy can be added without changing parsing.
  const roster = retrieval<{ organizationId: string }, string>({
    name: 'fetchRoster', revision: 1,
    step: {
      identity: async input => await input.organizationId,
      run: async input => services.rosterCsv(await input.organizationId, requestOptions()),
    },
  });

  const parseRoster = step<{ csv: string }, readonly IEmployee[]>({
    name: 'parseRoster',
    step: {
      run: async input => validateRoster(services.parseRosterCsv(await input.csv)),
    },
  });

  // Trial selection happens before GitHub or model work for excluded employees.
  const selectPeople = step<{ people: readonly IEmployee[]; trialIds: readonly string[] }, readonly IEmployee[]>({
    name: 'selectPeople',
    step: {
      run: async input => {
        const people = await input.people;
        if (analysisContext().environment !== 'trial') { return people; }
        const selected = new Set(await input.trialIds);
        if (selected.size === 0) { throw new Error('Trial requires explicit employee IDs'); }
        const available = new Set(people.map(person => person.employeeId));
        for (const id of selected) {
          if (!available.has(id)) { throw new Error(`Unknown trial employee: ${id}`); }
        }
        return people.filter(person => selected.has(person.employeeId));
    },
    },
  });

  const discover = source<{ username: string; window: IWindow }, IPRReference>({
    name: 'discoverPRs',
    step: {
      key: pr => pr.url,
      async *run(input) {
        const username = await input.username;
        const window = await input.window;
        const options = requestOptions();
        // This loop is ordinary author code. No page is memoized; each run starts over.
        yield* discoverPRs(window, cursor => services.page(username, window, cursor, options), options.signal);
    },
    },
  });

  const retrieve = retrieval<{ pr: IPRReference; policy: ISourcePolicy }, IPRData>({
    name: 'retrievePR', revision: 1,
    step: {
      identity: async input => await input.pr.url,
      isFinal: async (input, previous) => isPRFinal(
        { merged: await previous.value.merged }, await input.policy,
      ),
      run: async (input, previous) => resolvePR(
        await input.pr.url,
        // Only the refresh path materializes the full prior snapshot. The finality
        // hook above reads just merged state plus the current explicit policy.
        previous === undefined ? undefined : { value: await previous.value, reuse: previous.reuse },
        services.pr, requestOptions(),
      ),
    },
  });

  const assess = memo<{ evidence: IPRData; prompt: string; model: string }, IAssessment>({
    name: 'assessComplexity', revision: 1,
    step: {
      identity: async input => await input.evidence.url,
      run: async input => {
        // Read only evidence used by this analysis. Changes to validators or merged
        // state alone must not force another LLM call under field-sensitive verification.
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
  });

  // Materialize a complete per-person corpus before invoking a paid final summary.
  // This stores compact judgments, not every PR's full diff, in the fold result.
  const fold = step<{ assessments: ICollection<IAssessment> }, readonly IAssessment[]>({
    name: 'foldPerson',
    step: {
      run: input => collectAssessments(input.assessments),
    },
  });

  const summarize = memo<{
    employee: IEmployee; window: IWindow; assessments: readonly IAssessment[]; prompt: string; model: string;
  }, IPersonSummary>({
    name: 'summarizePerson', revision: 1,
    step: {
      identity: async input => await input.employee.employeeId,
      run: async input => {
        const employee = await input.employee;
        const window = await input.window;
        const assessments = await input.assessments;
        const base = { ...employee, window, pullRequestCount: assessments.length };
        // Closed-empty is a complete result and needs no model call. Failed discovery
        // never produces this empty array because the strict fold propagates its error.
        if (assessments.length === 0) {
          return { ...base, meanComplexity: null, summary: 'No pull requests in the selected creation-time window.' };
        }
        const prompt = await input.prompt;
        const model = await input.model;
        const summary = await services.summarize({ employee, window, assessments, prompt, model }, requestOptions());
        if (typeof summary !== 'string' || summary.trim().length === 0) { throw new Error('Invalid person summary'); }
        return { ...base, meanComplexity: assessments.reduce((sum, item) => sum + item.score, 0) / assessments.length, summary };
    },
    },
  });

  const report = step<{ people: ICollection<IPersonSummary> }, IReport>({
    name: 'report',
    step: {
      run: async input => ({ environment: analysisContext().environment, people: await collectStrict(input.people) }),
    },
  });

  // Only graph wiring occurs here. Each person's fold waits on its own inner
  // collection; it does not wait for discovery of every other roster row.
  return analysis('roster-contributions', environment, input => {
    const people = selectPeople({
      people: parseRoster({ csv: roster({ organizationId: input.organizationId }) }),
      trialIds: input.trialEmployeeIds,
    });
    const summaries = fanOut(people, person => {
      const prs = discover({ username: person.githubUsername, window: input.window });
      const assessments = fanOut(prs, pr => assess({
        evidence: retrieve({ pr, policy: input.sourcePolicy }),
        prompt: input.complexityPrompt, model: input.model,
      }), { concurrency: 8 });
      return summarize({
        employee: person, window: input.window, assessments: fold({ assessments }),
        prompt: input.summaryPrompt, model: input.model,
      });
    }, { key: person => person.employeeId, concurrency: 4 });
    return report({ people: summaries });
  });
}
