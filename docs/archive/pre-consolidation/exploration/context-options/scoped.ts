/** Scoped context candidate. Compile-checked illustration, not executable runtime. @internal */
import { scoped } from './surface.js';
import type { Collection, Environment, Outcome, Ref } from './surface.js';
import type { Assessment, ChartPoint, Fact, Histogram, Input, PersonReport, PullRequest, Report, Rubric, Services, Team, TeamReport, Employee } from './domain.js';

const { analysis, analysisContext, fanOut, memo, refs, source, step } = scoped;

/** Construct an analysis with environment-specific clients supplied at the boundary. @internal */
export function createContributionAnalysis(environment: Environment<Services>) {
  const services = environment.services;
  // Discovery calls execute only when the run demands them, never while planning.
  const directory = memo(async function directory(organization: Ref<string>) {
    const context = analysisContext();
    return services.directory(await organization, { signal: context.signal, onUsage: observation => context.record(observation) });
  }, { revision: 1 });

  // Trial policy lives in one named application step. Selected people keep full histories.
  const population = step(async function population(teams: Ref<readonly Team[]>) {
    const context = analysisContext();
    const all = await teams;
    if (context.environment !== 'trial') { return all; }
    return all.map(team => ({
      ...team,
      employees: team.employees.filter(employee => employee.lastName.startsWith('A')),
    })).filter(team => team.employees.length > 0);
  });

  // Successful iterator completion establishes discovery closure for this person/period.
  const pullRequests = source(async function* pullRequests(employeeId: Ref<string>, period: Ref<string>) {
    const context = analysisContext();
    yield* services.pullRequests(await employeeId, await period, {
      signal: context.signal, onUsage: observation => context.record(observation),
    });
  }, { key: (pr: PullRequest) => pr.id, revision: 1 });

  // Only this request consumes provider resources; adapters report observed increments.
  const fetchFact = memo(async function fetchFact(pr: Ref<PullRequest>) {
    const context = analysisContext();
    return services.fact(await pr.id, { signal: context.signal, onUsage: observation => context.record(observation) });
  }, { revision: 1 });

  // An ordinary field selection avoids a dependency on the PR's text.
  const chartPoint = step(async function chartPoint(fact: Ref<Fact>): Promise<ChartPoint> {
    return refs.all({ language: fact.language, changedLines: fact.changedLines });
  });

  // Cheap and unmemoized: available compact rows can support provisional previews.
  const histogram = step(async function histogram(points: Collection<ChartPoint>): Promise<Histogram> {
    const counts: Record<string, number> = {};
    for await (const point of points) {
      const bucket = `${point.language}:${point.changedLines < 100 ? 'small' : 'large'}`;
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return counts;
  });

  // Explicit projection makes the judgment depend on evidence text, not chart-only fields.
  const evidenceText = step(async function evidenceText(fact: Ref<Fact>) { return await fact.text; });

  // Memoization gates this body on the person's complete verified fact collection.
  const assess = memo(async function assess(employee: Ref<Employee>, facts: Collection<string>, rubric: Ref<Rubric>): Promise<Assessment> {
    const context = analysisContext();
    const { employeeId, name, prompt } = await refs.all({
      employeeId: employee.id, name: employee.name, prompt: rubric.prompt,
    });
    const evidence: string[] = [];
    // Materializing one person's evidence uses memory proportional to that corpus.
    for await (const text of facts) { evidence.push(text); }
    context.signal.throwIfAborted();
    const judgment = await services.judge({ name, evidence, prompt }, {
      signal: context.signal, onUsage: observation => context.record(observation),
    });
    return { employeeId, name, ...judgment };
  }, { revision: 1 });

  // Combine final values; stage-level observation can still show histograms earlier.
  const personReport = step(async function personReport(
    assessment: Ref<Assessment>, histogram: Ref<Histogram>,
  ): Promise<PersonReport> { return { assessment: await assessment, histogram: await histogram }; });

  // Explicitly tolerant fold: independent people continue; failures remain visible.
  const teamReport = step(async function teamReport(
    team: Ref<Team>, people: Collection<Outcome<PersonReport>>,
  ): Promise<TeamReport> {
    const successful: PersonReport[] = [];
    const failures: { employeeKey: string; message: string }[] = [];
    for await (const outcome of people) {
      if (outcome.status === 'fulfilled') { successful.push(outcome.value); }
      else { failures.push({ employeeKey: outcome.key, message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error) }); }
    }
    return { teamId: await team.id, name: await team.name,
      selectedPeople: await team.employees.length, failures, people: successful };
  });

  // Environment labels make the scope of saved output explicit.
  const report = step(async function report(teams: Collection<TeamReport>): Promise<Report> {
    const context = analysisContext();
    const values: TeamReport[] = [];
    for await (const team of teams) { values.push(team); }
    return { environment: context.environment, teams: values };
  });

  // This synchronous composition is inspected with symbolic references for planning.
  // It must contain only wiring: no I/O, context lookup, data-dependent branches, or await.
  const definition = analysis('contributions', environment, (input: Ref<Input>) => {
    const teams = population(directory(input.organization));
    const reports = fanOut(teams, team => {
      const people = fanOut(team.employees, employee => {
        const facts = fanOut(pullRequests(employee.id, input.period), fetchFact, { concurrency: 8 });
        return personReport(
          assess(employee, fanOut(facts, evidenceText), input.rubric),
          histogram(fanOut(facts, chartPoint)),
        );
      }, { key: employee => employee.id, concurrency: 4 });
      return teamReport(team, people.settled());
    }, { key: team => team.id, concurrency: 2 });
    return report(reports);
  });
  return { definition, histogram };
}
