/** Fixed, synthetic authored-PR population for the standalone report scale acceptance run. */
import type { IReportInputs } from '../../examples/contribution-report/src/controlled/application.js';

/** A selected author owns one deterministic, varied-size segment of the fixture population. */
export interface IWorkloadPerson {
  readonly key: string;
  readonly name: string;
  readonly login: string;
  readonly firstNumber: number;
  readonly pullRequests: number;
}

/** Expected independently observed scale dimensions; request attempts are counted at dispatch time. */
export interface IWorkloadCardinality {
  readonly people: number;
  readonly pullRequests: number;
  readonly reviews: number;
  readonly comments: number;
  readonly inlineComments: number;
}

/** Harness-side PR metadata is separate from provider response objects returned to the application. */
export interface IWorkloadPull {
  readonly number: number;
  readonly createdAt: number;
  readonly title: string;
  readonly body: string;
  readonly diff: string;
  readonly reviewBody: string;
  readonly commentBodies: readonly [string, string];
  readonly inlineBody: string;
}

/** A skewed fixed cohort totals 150,000 authored PRs while including sparse, ordinary and prolific authors. */
const GROUPS = [
  { people: 150, pullsPerPerson: 250 },
  { people: 100, pullsPerPerson: 500 },
  { people: 40, pullsPerPerson: 1_000 },
  { people: 10, pullsPerPerson: 2_250 },
] as const;

/** Latest updates and quiet finality need 14,400 + 3,600 seconds before the shared cutoff. */
const REQUIRED_TEMPORAL_TAIL_SECONDS = 18_001;

/** Frozen report period supplies stable second-precision creation timestamps for controlled search. */
export const workloadInputs: IReportInputs = workloadInputsFor();

/** Parameterize only the in-process smoke cohort; full acceptance always uses all 300 people. */
export function workloadInputsFor(personCount = 300): IReportInputs {
  const people = workloadPeople(personCount);
  return {
  csv: makeRoster(people),
  selected: people.map(person => person.key),
  scope: {
    repositories: ['acme/widget'],
    start: 1_767_225_600,
    end: 1_775_001_600,
    cutoff: 1_775_001_600,
    observation: 'workload-observation-a',
  },
  prompt: { text: 'Assess controlled contribution evidence', model: 'controlled-model', weight: 1, helperVersion: 'workload-rubric-a' },
  settling: { quietSeconds: 3_600, quietVersion: 'quiet-a', closedDay: '2026-01-02', dailyVersion: 'daily-a' },
  contentBasis: { kind: 'controlled-as-of', scenario: 'workload-150k-v1', cutoff: 1_775_001_600 },
  };
}

/** Independently states entity counts; comments count conversation entries, while inline notes remain separate. */
export function workloadCardinality(personCount = 300): IWorkloadCardinality {
  const people = workloadPeople(personCount);
  const pullRequests = people.reduce((sum, person) => sum + person.pullRequests, 0);
  return { people: people.length, pullRequests, reviews: pullRequests, comments: pullRequests * 2, inlineComments: pullRequests };
}

/** Return one roster identity from the fixed cohort without materializing PR payloads. */
export function workloadPerson(index: number, personCount = 300): IWorkloadPerson {
  if (!Number.isSafeInteger(index) || index < 0 || index >= personCount) {
    throw new RangeError('workload person index is outside the fixed cohort');
  }
  let firstNumber = 1;
  let cursor = 0;
  for (const group of GROUPS) {
    for (let member = 0; member < group.people; member += 1) {
      const person = { key: personKey(cursor), name: `Engineer ${String(cursor + 1).padStart(3, '0')}`, login: `engineer-${String(cursor + 1).padStart(3, '0')}`, firstNumber, pullRequests: group.pullsPerPerson };
      if (cursor === index) { return person; }
      if (cursor + 1 >= personCount) { throw new RangeError('workload person index is outside the fixed cohort'); }
      firstNumber += group.pullsPerPerson;
      cursor += 1;
    }
  }
  throw new RangeError('workload person index is outside the fixed cohort');
}

/** Materialize one varied payload only when the fixed provider harness serves its request. */
export function workloadPull(person: IWorkloadPerson, ordinal: number): IWorkloadPull {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= person.pullRequests) {
    throw new RangeError('workload PR ordinal is outside its author segment');
  }
  const number = person.firstNumber + ordinal;
  const start = workloadInputs.scope.start;
  const span = workloadInputs.scope.end - start - REQUIRED_TEMPORAL_TAIL_SECONDS;
  const createdAt = start + 1 + Math.floor((ordinal * span) / person.pullRequests);
  const variable = number % 8;
  return {
    number,
    createdAt,
    title: `Contribution ${String(number)} by ${person.login}`,
    body: `${`Description ${String(number)} `.repeat(1 + variable * 4)}Implementation context ${person.login}`,
    diff: `${`+ changed line ${String(number)}\n`.repeat(1 + (number % 5) * 3)}+ end`,
    reviewBody: `${`Review ${String(number)} `.repeat(1 + (number % 3) * 5)}approved after inspection`,
    commentBodies: [
      `${`Discussion ${String(number)} `.repeat(1 + (number % 4) * 4)}question and resolution`,
      `${`Follow-up ${String(number)} `.repeat(1 + (number % 2) * 7)}confirmed`,
    ],
    inlineBody: `${`Inline ${String(number)} `.repeat(1 + (number % 6) * 3)}specific code note`,
  };
}

/** Return the full fixed roster; it contains identities only, never hydrated PR or discussion payloads. */
export function workloadPeople(personCount = 300): readonly IWorkloadPerson[] {
  if (!Number.isSafeInteger(personCount) || personCount < 1 || personCount > 300) { throw new RangeError('workload cohort size must be between one and 300 people'); }
  const result: IWorkloadPerson[] = [];
  let firstNumber = 1;
  let index = 0;
  for (const group of GROUPS) {
    for (let member = 0; member < group.people; member += 1) {
      result.push({ key: personKey(index), name: `Engineer ${String(index + 1).padStart(3, '0')}`, login: `engineer-${String(index + 1).padStart(3, '0')}`, firstNumber, pullRequests: group.pullsPerPerson });
      firstNumber += group.pullsPerPerson;
      index += 1;
      if (index === personCount) { return result; }
    }
  }
  return result;
}

/** Stable keys let the independent manifest compare observed report membership without leaking it into the app. */
function personKey(index: number): string { return `employee-${String(index + 1).padStart(3, '0')}`; }

/** Roster serialization follows the report application's own quoted CSV input contract. */
function makeRoster(people: readonly IWorkloadPerson[]): string {
  const rows = ['employee_id,github_login,name,active'];
  for (const person of people) { rows.push(`${person.key},${person.login},"${person.name}",true`); }
  return `${rows.join('\n')}\n`;
}
