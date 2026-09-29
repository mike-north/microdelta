/**
 * EXP-4's Node-only process driver. Invoked once as `A` (fresh history) and
 * once as `B` (reload), it rebuilds the composition from scratch in each
 * process; B reverses declaration order and member order and allocates fresh
 * data. The JSON file exists only to force the process boundary: it is not a
 * selected History schema and makes no atomicity or crash claim.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { decode, runPass } from '../src/protocol.js';
import type { IFoldOutcome, IInvocationRecord, IMemberOutcome, ISupervision } from '../src/protocol.js';
import { gateEvaluations, paid, summaryWithCallback, summaryWithPeek } from './bodies.js';
import { baseData, buildGraph, dave, erin, MemoryHistory, sourcesFor } from './fixture.js';
import type { IFixtureData, IGraphOptions } from './fixture.js';

/** What one process observed; tests compare these values across the boundary. */
interface IProcessReport {
  readonly stage: 'A' | 'B';
  readonly scenario: string;
  readonly factoryCalls: number;
  readonly topology: readonly string[];
  readonly memberOrder: readonly string[];
  readonly paid: readonly string[];
  readonly gates: number;
  readonly hookCalls: Record<string, number>;
  readonly collection: unknown;
  readonly outcomes: Record<string, string>;
  readonly fold: IFoldOutcome | undefined;
  readonly references: Record<string, string>;
  readonly newRecords: readonly string[];
  readonly lateMutation?: string;
}

/** Everything a stage needs; B's order reversal is applied separately. */
interface IStageSetup {
  readonly options: IGraphOptions;
  readonly data: IFixtureData;
  readonly supervision: ISupervision;
}

/** Scenario variants that change the composition itself in both processes. */
const bothProcesses: Readonly<Record<string, IGraphOptions>> = {
  'unreconstructible-argument': { summary: summaryWithCallback },
  'unjustified-argument': { summary: summaryWithPeek },
  'custom-key-renumbered': { customKey: true },
};

/** Process A's data and supervision per scenario family. */
function stageA(scenario: string): IStageSetup {
  const data = baseData();
  const options = bothProcesses[scenario] ?? {};
  if (scenario.startsWith('readiness-')) {
    data.status = 'open';
    data.contributors.push({ ...dave }, { ...erin });
    data.pulls['pr-6'] = { size: -1, title: 'broken' };
    return { options, data, supervision: { 'c-3': 'pending', 'c-5': 'cancelled' } };
  }
  if (scenario === 'failed-repair') {
    data.contributors.push({ ...dave });
    data.pulls['pr-6'] = { size: -1, title: 'broken' };
  }
  if (scenario === 'open-discovery') {
    data.status = 'open';
  }
  if (scenario === 'empty-population' || scenario === 'empty-open') {
    data.contributors = [];
  }
  return { options, data, supervision: {} };
}

/** Rename designated ids without touching any other member field. */
function renumber(data: IFixtureData): void {
  data.contributors = data.contributors.map(member => ({ ...member, id: member.id.replace('c-', 'c-1') }));
}

/** Process B's variant: the only differences from A apart from order reversal. */
function stageB(scenario: string): IStageSetup {
  const data = baseData();
  const shared = bothProcesses[scenario] ?? {};
  const variants: Record<string, () => IStageSetup> = {
    'child-input-equal': () => {
      data.pulls['pr-1'] = { size: 150, title: 'Refactor parser (reworded)' };
      return { options: shared, data, supervision: {} };
    },
    'child-output-changed': () => {
      data.pulls['pr-2'] = { size: 200, title: 'Fix typo' };
      return { options: shared, data, supervision: {} };
    },
    'assessor-swap-equal': () => ({ options: { assessor: 'B' }, data, supervision: {} }),
    'assessor-swap-changed': () => ({ options: { assessor: 'C' }, data, supervision: {} }),
    'missing-assessor': () => ({ options: { assessor: 'missing' }, data, supervision: {} }),
    'ambiguous-assessor': () => ({ options: { assessor: 'ambiguous' }, data, supervision: {} }),
    'inserted-member': () => {
      data.contributors.push({ ...dave });
      return { options: shared, data, supervision: {} };
    },
    'deleted-member': () => {
      data.contributors = data.contributors.filter(member => member.id !== 'c-3');
      return { options: shared, data, supervision: {} };
    },
    'unread-field': () => {
      data.contributors = data.contributors.map(member => ({ ...member, bio: `${member.bio} (edited)` }));
      data.config.unread = 'second';
      return { options: shared, data, supervision: {} };
    },
    'consumed-field': () => {
      data.contributors = data.contributors.map(member => member.id === 'c-1' ? { ...member, login: 'alice-renamed' } : member);
      return { options: shared, data, supervision: {} };
    },
    'duplicate-keys': () => {
      data.contributors = data.contributors.map(member => member.id === 'c-3' ? { ...member, id: 'c-1' } : member);
      return { options: shared, data, supervision: {} };
    },
    'custom-key-renumbered': () => {
      renumber(data);
      return { options: shared, data, supervision: {} };
    },
    'default-key-renumbered': () => {
      renumber(data);
      return { options: shared, data, supervision: {} };
    },
    'gate-flip-on': () => {
      data.contributors = data.contributors.map(member => member.id === 'c-2' ? { ...member, activity: 4 } : member);
      return { options: shared, data, supervision: {} };
    },
    'gate-flip-off': () => {
      data.config.minActivity = 4;
      return { options: shared, data, supervision: {} };
    },
    'gate-threshold-no-flip': () => {
      data.config.minActivity = 3;
      return { options: shared, data, supervision: {} };
    },
    'slot-renamed': () => ({ options: { summarySlot: 'profile' }, data, supervision: {} }),
    'collection-moved': () => ({ options: { collectionSlot: 'roster' }, data, supervision: {} }),
    'readiness-repaired': () => {
      data.contributors.push({ ...dave }, { ...erin });
      return { options: shared, data, supervision: {} };
    },
    'readiness-still-open': () => {
      data.status = 'open';
      data.contributors.push({ ...dave }, { ...erin });
      return { options: shared, data, supervision: { 'c-3': 'pending' } };
    },
    'failed-repair': () => {
      data.contributors.push({ ...dave });
      return { options: shared, data, supervision: {} };
    },
    'empty-population': () => {
      data.contributors = [];
      return { options: shared, data, supervision: {} };
    },
    'empty-open': () => {
      data.contributors = [];
      data.status = 'open';
      return { options: shared, data, supervision: {} };
    },
  };
  return variants[scenario]?.() ?? { options: shared, data, supervision: {} };
}

/** Reverse member traversal and PR-table insertion order; neither may matter (COL-3). */
function reverseOrders(data: IFixtureData): void {
  data.contributors.reverse();
  data.pulls = Object.fromEntries(Object.entries(data.pulls).reverse());
}

/** Label a record for reports: instance slot and key, or the assessed PR for a child. */
function label(record: IInvocationRecord): string {
  const { slot, memberKey, role } = record.descriptor;
  if (role !== 'callable') {
    return memberKey === undefined ? slot : `${slot}:${memberKey}`;
  }
  const argument = record.observations.find(observation => observation.kind === 'read'
    && observation.path.length === 2 && observation.path[0] === 'argument' && observation.path[1] === 0);
  const value = argument?.kind === 'read' ? decode(argument.fact) : undefined;
  return `${slot}(${typeof value === 'string' ? value : ''})`;
}

/** Compact, JSON-safe outcome text: status, plus the decision where one exists. */
function outcomeText(outcome: IMemberOutcome): string {
  if (outcome.status === 'succeeded') {
    return `succeeded:${outcome.decision}`;
  }
  return outcome.status === 'failed' ? `failed:${outcome.decision ?? 'gate'}` : outcome.status;
}

/** One pass in this process against the loaded (or new) fixture History. */
function run(stage: 'A' | 'B', scenario: string, history: MemoryHistory, pointers: Record<string, string>): IProcessReport {
  const setup = stage === 'A' ? stageA(scenario) : stageB(scenario);
  if (stage === 'B') {
    reverseOrders(setup.data);
  }
  const options: IGraphOptions = { ...setup.options, reversed: stage === 'B' };
  const built = buildGraph(options);
  let lateMutation: string | undefined;
  if (scenario === 'builder-mutation' && stage === 'B') {
    const [summary] = built.templateArray;
    if (summary !== undefined) {
      built.templateArray.push(summary);
    }
    try {
      built.lateTemplate()?.memo('late', () => null);
    } catch (error) {
      lateMutation = error instanceof Error ? error.message : String(error);
    }
  }
  const before = history.records.length;
  const { sources, hookCalls } = sourcesFor(setup.data, options.collectionSlot);
  const report = runPass(built.graph, sources, history, setup.supervision);
  const outcomes: Record<string, string> = {};
  for (const [key, steps] of Object.entries(report.members)) {
    for (const [slot, outcome] of Object.entries(steps)) {
      outcomes[`${slot}:${key}`] = outcomeText(outcome);
      if (outcome.status === 'succeeded') {
        pointers[`${slot}:${key}`] = outcome.reference;
      }
    }
  }
  const fold = report.folds.report;
  if (fold?.status === 'succeeded') {
    pointers.report = fold.reference;
  }
  return {
    stage,
    scenario,
    factoryCalls: built.factoryCalls(),
    topology: built.graph.topology,
    memberOrder: report.collection.status === 'rejected' ? [] : report.collection.keys,
    paid: [...paid].sort(),
    gates: gateEvaluations.length,
    hookCalls,
    collection: report.collection,
    outcomes,
    fold,
    references: { ...pointers },
    newRecords: history.records.slice(before).map(record => `${record.reference}=${label(record)}`),
    ...(lateMutation === undefined ? {} : { lateMutation }),
  };
}

/** Parse the fixture file written by process A. */
async function load(file: string): Promise<{ readonly history: MemoryHistory; readonly pointers: Record<string, string> }> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('pointers' in parsed) || typeof parsed.pointers !== 'object'
    || parsed.pointers === null) {
    throw new TypeError('Invalid EXP-4 fixture file');
  }
  const pointers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.pointers)) {
    if (typeof value !== 'string') {
      throw new TypeError('Invalid EXP-4 fixture pointer');
    }
    pointers[key] = value;
  }
  return { history: MemoryHistory.fromJson(parsed), pointers };
}

/** Two independent invocations of this file are the required process boundary. */
async function main(): Promise<void> {
  const [, , stage, file, scenario] = process.argv;
  if ((stage !== 'A' && stage !== 'B') || file === undefined || scenario === undefined) {
    throw new TypeError('Use process-entry.js A|B history.json scenario');
  }
  const { history, pointers } = stage === 'A'
    ? { history: new MemoryHistory(), pointers: {} }
    : await load(file);
  const report = run(stage, scenario, history, pointers);
  await writeFile(file, JSON.stringify({ records: history.records, next: history.next, pointers }));
  process.stdout.write(JSON.stringify(report));
}

await main();
