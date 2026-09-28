/**
 * Command-line entry for the contribution-report example.
 *
 *   node examples/contribution-report/dist/main.js run --store DIR [--reverse] [--json]
 *   node examples/contribution-report/dist/main.js recover --store DIR [--json]
 *   node examples/contribution-report/dist/main.js check --store DIR [--json]
 *
 * `run` saves a fresh request key per contributor summary to
 * `DIR/requests.json` *before* starting work, then resolves both summaries
 * through the workspace's normal entry operation and assembles the report as
 * ordinary work. `recover` reads the saved keys and asks the recovery entry
 * operation what those executions durably produced; it runs no author code.
 * `check` reports what a normal run would do without doing it. Observers
 * count executed bodies and checks, finality evaluations and ordinary work.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openWorkspace } from 'microdelta';
import type { IResolutionOutcome, IRunEvent, IWorkspace } from 'microdelta';

import { fixtureEnvironment } from './activity.js';
import { composeAnalysis, contributorKeys } from './analysis.js';
import type { IAnalysis, IContributorKey } from './analysis.js';
import { assembleReport, renderReport } from './report.js';

/** The logical store identity of the example's History file. */
const logicalStore = 'example:contribution-report';

/** Parsed command line. */
interface IArguments {
  readonly command: 'run' | 'recover' | 'check';
  readonly store: string;
  readonly reverse: boolean;
  readonly json: boolean;
}

/** Parse the command line or explain its usage. */
function parseArguments(argv: readonly string[]): IArguments {
  const [command, ...rest] = argv;
  const storeIndex = rest.indexOf('--store');
  const store = storeIndex >= 0 ? rest[storeIndex + 1] : undefined;
  if ((command !== 'run' && command !== 'recover' && command !== 'check') || store === undefined || store.startsWith('--')) {
    throw new Error('usage: main.js run|recover|check --store DIR [--reverse] [--json]');
  }
  return { command, store, reverse: rest.includes('--reverse'), json: rest.includes('--json') };
}

/** Counts of framework events a run observed. */
interface ICounts {
  /** Executed source checks and summary bodies, by `member/slot`. */
  readonly executions: Record<string, number>;
  /** Finality evaluations, by `member/slot`. */
  readonly finality: Record<string, number>;
  /** Completed ordinary work, by label. */
  readonly ordinary: Record<string, number>;
}

/** An observer that counts executions, finality evaluations and ordinary work. */
function counter(): { readonly counts: ICounts; readonly observe: (event: IRunEvent) => void } {
  const counts: ICounts = { executions: {}, finality: {}, ordinary: {} };
  const bump = (record: Record<string, number>, key: string): void => {
    record[key] = (record[key] ?? 0) + 1;
  };
  return {
    counts,
    observe(event: IRunEvent): void {
      if (event.kind === 'ordinary') {
        if (event.phase === 'end') {
          bump(counts.ordinary, event.label);
        }
        return;
      }
      const name = `${event.event.step.memberKey ?? ''}/${event.event.step.slot}`;
      if (event.event.phase === 'execute') {
        bump(counts.executions, name);
      } else if (event.event.phase === 'finality') {
        bump(counts.finality, name);
      }
    },
  };
}

/** A compact, JSON-safe description of one normal outcome. */
function describeOutcome(outcome: IResolutionOutcome): Record<string, unknown> {
  return outcome.kind === 'refused'
    ? { kind: outcome.kind, reason: outcome.reason }
    : { kind: outcome.kind, ...(outcome.kind === 'reused' ? { basis: outcome.basis } : {}), reference: outcome.reference.locator };
}

/** Open the example's workspace inside the store directory. */
function open(store: string): IWorkspace {
  mkdirSync(store, { recursive: true });
  return openWorkspace({ location: join(store, 'history.sqlite'), logicalStore });
}

/** The saved request keys file. */
function requestsFile(store: string): string {
  return join(store, 'requests.json');
}

/** Run the report: save fresh request keys first, then resolve and assemble. */
async function runReport(args: IArguments, analysis: IAnalysis, order: readonly IContributorKey[]): Promise<Record<string, unknown>> {
  const requestKeys = Object.fromEntries(contributorKeys.map((key) => [key, `report:${randomUUID()}:${key}`])) as Record<IContributorKey, string>;
  mkdirSync(args.store, { recursive: true });
  // The caller owns key persistence: saved before any work starts, so a lost acknowledgment can be recovered.
  writeFileSync(requestsFile(args.store), `${JSON.stringify(requestKeys, null, 2)}\n`);
  const observed = counter();
  const workspace = open(args.store);
  try {
    const result = await workspace.run({ authoring: analysis.authoring, composition: analysis.composition, environment: fixtureEnvironment, observers: [observed] }, async (run) => {
      const outcomes: Partial<Record<IContributorKey, IResolutionOutcome>> = {};
      for (const key of order) {
        outcomes[key] = await run.resolve(analysis.summaries[key], { requestKey: requestKeys[key] });
      }
      const resolved = { 'person:ada': outcomes['person:ada'], 'person:ben': outcomes['person:ben'] };
      if (resolved['person:ada'] === undefined || resolved['person:ben'] === undefined) {
        throw new Error('both summaries must resolve');
      }
      const complete = { 'person:ada': resolved['person:ada'], 'person:ben': resolved['person:ben'] };
      const report = await run.ordinary('report', () => assembleReport(run, complete));
      return { outcomes: complete, report };
    });
    return {
      command: 'run',
      order,
      text: renderReport(result.value.report),
      report: result.value.report,
      outcomes: Object.fromEntries(Object.entries(result.value.outcomes).map(([key, outcome]) => [key, describeOutcome(outcome)])),
      ...observed.counts,
      diagnostics: result.diagnostics,
    };
  } finally {
    workspace.close();
  }
}

/** Recover the executions the saved request keys identify, without running author code. */
async function recover(args: IArguments, analysis: IAnalysis): Promise<Record<string, unknown>> {
  const requestKeys = JSON.parse(readFileSync(requestsFile(args.store), 'utf8')) as Record<IContributorKey, string>;
  const observed = counter();
  const workspace = open(args.store);
  try {
    const result = await workspace.run({ authoring: analysis.authoring, composition: analysis.composition, environment: fixtureEnvironment, observers: [observed] }, async (run) => {
      const states: Record<string, unknown> = {};
      for (const key of contributorKeys) {
        const recovered = await run.recover(analysis.summaries[key], { requestKey: requestKeys[key] });
        states[key] = recovered.kind === 'recovered' ? { kind: recovered.kind, reference: recovered.reference.locator } : recovered;
      }
      return states;
    });
    return { command: 'recover', recovered: result.value, ...observed.counts };
  } finally {
    workspace.close();
  }
}

/** Report what a normal run would do, without admission, bodies or writes. */
async function check(args: IArguments, analysis: IAnalysis): Promise<Record<string, unknown>> {
  const observed = counter();
  const workspace = open(args.store);
  try {
    const result = await workspace.run({ authoring: analysis.authoring, composition: analysis.composition, environment: fixtureEnvironment, observers: [observed] }, async (run) => {
      const states: Record<string, unknown> = {};
      for (const key of contributorKeys) {
        const checked = await run.check(analysis.summaries[key]);
        states[key] = checked.kind === 'reusable' ? { kind: checked.kind, reference: checked.reference.locator } : { kind: checked.kind };
      }
      return states;
    });
    return { command: 'check', checked: result.value, ...observed.counts };
  } finally {
    workspace.close();
  }
}

/** Run one command and print its result. */
async function main(argv: readonly string[]): Promise<void> {
  const args = parseArguments(argv);
  const order: readonly IContributorKey[] = args.reverse ? [...contributorKeys].reverse() : contributorKeys;
  const analysis = composeAnalysis(order);
  const output = args.command === 'run' ? await runReport(args, analysis, order) : args.command === 'recover' ? await recover(args, analysis) : await check(args, analysis);
  process.stdout.write(args.json ? `${JSON.stringify(output, null, 2)}\n` : `${typeof output.text === 'string' ? output.text : JSON.stringify(output, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
