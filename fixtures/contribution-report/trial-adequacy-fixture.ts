/**
 * An author-owned RUN-018 trial, separate from the contribution-report product
 * graph. Explicit selection supplies both a staff-only leadership input and a
 * deterministic plotting input. Successful execution records data and coverage;
 * it has no authority to claim semantic adequacy or enlarge the selected set.
 */
import { authoring, currentExecution } from 'microdelta';
import type { IFoldEntry, IFoldReport, IResolutionOutcome, IResultView, IRunEvent, IRunResult, ITrackedView, IWorkspace } from 'microdelta';

/** Fixture role classification is explicit author data, not a library HR schema. @internal */
export interface ITrialPerson { readonly key: string; readonly staff: boolean; readonly datum: number }
/** Only these selected stable keys may contribute work or plotting samples. @internal */
export interface ITrialInputs { readonly roster: readonly ITrialPerson[]; readonly selected: readonly string[] }
/** Independent fixture receipts distinguish body execution from supervised model sends. @internal */
export interface ITrialLedger { readonly bodies: string[]; readonly models: string[] }
/** A complete authored selection may legitimately contain no members. @internal */
export interface ITrialPopulation { readonly status: 'complete'; readonly members: readonly ITrialPerson[] }
/** Plot preparation preserves its actual singleton/empty data, without statistical claims. @internal */
export interface ITrialPlot { readonly selected: readonly string[]; readonly input: readonly number[]; readonly output: readonly number[] }
/** A leadership instance records only the explicitly selected staff identity it analyzed. */
interface ILeadership { readonly key: string }
/** The empty leadership fold is successful without manufacturing any analyzed person. */
interface ILeadershipResult { readonly analyzed: readonly string[] }
/** Each actual called helper supplies tracked intent; the ledger is observation-only fixture state. */
interface ITrialHelpers {
  readonly select: (roster: ITrackedView<readonly ITrialPerson[]>, selected: ITrackedView<readonly string[]>) => ITrialPopulation;
  readonly staff: (population: ITrialPopulation) => ITrialPopulation;
  readonly leadership: (person: ITrackedView<ITrialPerson>) => Promise<ILeadership>;
  readonly fold: (members: readonly IFoldEntry<IResultView<ILeadership>>[]) => ILeadershipResult;
  readonly plot: (population: IResultView<ITrialPopulation>) => ITrialPlot;
}
/** The current typed outcomes and exact data are evidence of execution, not representativeness. @internal */
export interface ITrialValue {
  readonly leadership: IFoldReport;
  readonly leadershipInput: ITrialPopulation;
  readonly leadershipResult: ILeadershipResult;
  readonly plot: ITrialPlot;
  readonly plotOutcome: Extract<IResolutionOutcome, { readonly kind: 'published' | 'reused' }>;
}

/** Run once in trial scope; both consumer graphs are fixed before selected data instantiates work. @internal */
export function runTrial(workspace: IWorkspace, inputs: ITrialInputs, ledger: ITrialLedger, observe: (event: IRunEvent) => void): Promise<IRunResult<ITrialValue>> {
  const helpers: ITrialHelpers = {
    select(roster, selected) {
      ledger.bodies.push('selection');
      const members: ITrialPerson[] = [];
      const seen = new Set<string>();
      for (let index = 0; index < selected.length; index += 1) {
        const key = selected[index];
        if (key === undefined || seen.has(key)) { throw new Error('Invalid explicit trial selection'); }
        seen.add(key);
        let found: ITrialPerson | undefined;
        for (let position = 0; position < roster.length; position += 1) {
          const person = roster[position];
          if (person?.key === key) {
            if (found !== undefined) { throw new Error('Ambiguous explicit trial identity'); }
            found = { key: person.key, staff: person.staff, datum: person.datum };
          }
        }
        if (found === undefined) { throw new Error('Missing explicitly selected trial identity'); }
        members.push(found);
      }
      return { status: 'complete', members };
    },
    staff(population) {
      ledger.bodies.push('leadership-input');
      const members: ITrialPerson[] = [];
      for (const person of population.members) { if (person.staff) { members.push(person); } }
      return { status: 'complete', members };
    },
    async leadership(person) {
      const key = person.key;
      ledger.bodies.push(`leadership:${key}`);
      return currentExecution().operation<ILeadership>({
        name: 'trial-leadership-model', binding: key,
        perform: async send => {
          ledger.models.push(key);
          return { kind: 'succeeded', value: { key }, usage: { report: send.requestAttempt, quantities: [{ unit: 'tokens', amount: 1 }] } };
        },
      });
    },
    fold(members) {
      ledger.bodies.push('leadership-fold');
      return { analyzed: members.flatMap(member => member.status === 'succeeded' ? [member.data.key] : []) };
    },
    plot(population) {
      ledger.bodies.push('plot');
      const selected: string[] = [];
      const points: number[] = [];
      for (let index = 0; index < population.members.length; index += 1) {
        const person = population.members[index];
        if (person === undefined) { throw new Error('Incomplete plotting population'); }
        selected.push(person.key);
        points.push(person.datum);
      }
      return { selected, input: points, output: [...points] };
    },
  };
  const api = authoring<ITrialInputs, ITrialHelpers>();
  const selection = api.source<ITrialPopulation>({ subject: 'trial-selection', collection: { identity: 'key' }, run: ({ inputs, helpers, outcome }) => outcome.fresh<ITrialPopulation>(helpers.select(inputs.roster, inputs.selected)) });
  const leadershipInput = api.source<ITrialPopulation>({ subject: 'leadership-input', collection: { identity: 'key' }, run: ({ inputs, helpers, outcome }) => outcome.fresh<ITrialPopulation>(helpers.staff(helpers.select(inputs.roster, inputs.selected))) });
  const staff = api.template({ slot: 'staff', collection: leadershipInput, steps: member => ({
    analysis: member.memo({ subject: member.subject('leadership'), run: ({ member: person, helpers }): Promise<ILeadership> => helpers.leadership(person) }),
  }) });
  const leadership = api.fold({ subject: 'leadership-result', over: { template: staff, step: 'analysis' }, run: ({ members, helpers }) => helpers.fold(members) });
  const plot = api.memo({ subject: 'plot-data', children: { selection }, run: async ({ calls, helpers }) => helpers.plot((await calls.selection()).data) });
  const composition = api.compose({ scope: 'author-trial-adequacy', inputs: [{ slot: 'roster', value: inputs.roster }, { slot: 'selected', value: inputs.selected }],
    helpers: [{ slot: 'select', helper: helpers.select }, { slot: 'staff', helper: helpers.staff }, { slot: 'leadership', helper: helpers.leadership }, { slot: 'fold', helper: helpers.fold }, { slot: 'plot', helper: helpers.plot }],
    steps: [{ slot: 'selection', declaration: selection }, { slot: 'leadershipInput', declaration: leadershipInput }, { slot: 'leadership', declaration: leadership }, { slot: 'plot', declaration: plot }], templates: [staff] });
  return workspace.run({ authoring: api, composition, environment: 'trial', observers: [{ observe }] }, async run => {
    const leadership = await run.resolveFold({ scope: composition.scope, role: 'step', slot: 'leadership' }, { requestKey: 'trial-leadership' });
    const plotOutcome = await run.resolve({ scope: composition.scope, role: 'step', slot: 'plot' }, { requestKey: 'trial-plot' });
    if (leadership.outcome.status !== 'succeeded' || leadership.discovery.kind !== 'keyed' || (plotOutcome.kind !== 'published' && plotOutcome.kind !== 'reused')) { throw new Error('Expected successful authored trial execution'); }
    return { leadership, leadershipInput: run.read<ITrialPopulation>(leadership.discovery.reference), leadershipResult: run.read<ILeadershipResult>(leadership.outcome.outcome.reference), plot: run.read<ITrialPlot>(plotOutcome.reference), plotOutcome };
  });
}
