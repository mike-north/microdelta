/**
 * Command-line entry for the contribution-report example.
 *
 *   node examples/contribution-report/dist/main.js run --store DIR [options] [--open-discovery] [--reverse] [--json]
 *   node examples/contribution-report/dist/main.js recover --store DIR [--member KEY]... [--json]
 *   node examples/contribution-report/dist/main.js check --store DIR [options] [--open-discovery] [--reverse] [--json]
 *
 * Options select author-visible composition choices: `--rubric A|B|C` (the
 * supplied assessor), `--minimum-authored N` (the gate threshold input) and
 * `--key key|id` (designated identity or the custom key). `--open-discovery`
 * makes the fixture upstream report its contributor listing as still open.
 * `--reverse` registers helpers and steps in reverse order.
 *
 * `run` saves a fresh request key and its composition choices to
 * `DIR/requests.json` *before* starting work, then resolves the strict report
 * through the workspace's fold entry operation, which settles discovery and
 * every member first. `recover` reads the saved key and choices and asks the
 * recovery entry operation what the identified executions durably produced:
 * discovery's, the report's, and the summary of every member the recovered
 * discovery listing keys, the recovered report lists or `--member` names. It
 * runs no source hook, finality policy or step body; under `--key id` keying
 * the recovered listing runs the declared custom-key projection. `check` reports what a normal run would do for
 * discovery and each member summary without doing it. Observers count
 * executed bodies and finality evaluations by step.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openWorkspace } from 'microdelta';
import type { IDiscoveryReport, IFoldReport, IMemberOutcome, IRecoveryResult, IRunEvent, IStrictFoldOutcome, IWorkspace } from 'microdelta';

import { composeAnalysis, defaultVariation, templateSlot } from './analysis.js';
import type { IAnalysis, IKeyChoice, IReport, ISummary, IVariation } from './analysis.js';
import { rubrics } from './assessment.js';
import type { IRubric } from './assessment.js';
import { fixtureEnvironment, setUpstreamListing } from './fixture.js';
import { renderReport, renderUnfinished } from './report.js';

/** The logical store identity of the example's History file. */
const logicalStore = 'example:contribution-report';

/** The usage message every malformed command line reports. */
const usage = 'usage: main.js run|recover|check --store DIR [--rubric A|B|C] [--minimum-authored N] [--key key|id] [--open-discovery] [--reverse] [--member KEY]... [--json]';

/** The entry operation a command line selects. */
type ICommand = 'run' | 'recover' | 'check';

/** Parsed command line. */
interface IArguments {
  readonly command: ICommand;
  readonly store: string;
  readonly variation: IVariation;
  readonly openDiscovery: boolean;
  /** Member keys whose summaries `recover` is asked for explicitly. */
  readonly members: readonly string[];
  readonly json: boolean;
}

/** Whether a string names a command. */
function isCommand(value: string | undefined): value is ICommand {
  return value === 'run' || value === 'recover' || value === 'check';
}

/** Whether a string names a rubric. */
function isRubric(value: string): value is IRubric {
  return rubrics.some((rubric) => rubric === value);
}

/** Whether a string names a key choice. */
function isKeyChoice(value: string): value is IKeyChoice {
  return value === 'key' || value === 'id';
}

/**
 * Parse the command line or explain its usage. Every argument must be a known
 * flag with a valid value. `recover` takes its composition choices from the
 * saved request, so it accepts none (registration order included); `--member`
 * names members for recovery only.
 */
function parseArguments(argv: readonly string[]): IArguments {
  const [command, ...rest] = argv;
  if (!isCommand(command)) {
    throw new Error(usage);
  }
  let store: string | undefined;
  let rubric = defaultVariation.rubric;
  let minimumAuthored = defaultVariation.minimumAuthored;
  let key = defaultVariation.key;
  let reverse = false;
  let openDiscovery = false;
  let json = false;
  let composed = false;
  const members: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];
    switch (flag) {
      case '--store':
      case '--rubric':
      case '--minimum-authored':
      case '--key':
      case '--member': {
        if (value === undefined || value.startsWith('--')) {
          throw new Error(usage);
        }
        index += 1;
        if (flag === '--store') {
          store = value;
        } else if (flag === '--rubric' && isRubric(value)) {
          rubric = value;
          composed = true;
        } else if (flag === '--minimum-authored' && /^\d+$/u.test(value) && Number.isSafeInteger(Number(value))) {
          minimumAuthored = Number(value);
          composed = true;
        } else if (flag === '--key' && isKeyChoice(value)) {
          key = value;
          composed = true;
        } else if (flag === '--member' && value.length > 0) {
          members.push(value);
        } else {
          throw new Error(usage);
        }
        break;
      }
      case '--reverse':
        reverse = true;
        composed = true;
        break;
      case '--open-discovery':
        openDiscovery = true;
        composed = true;
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new Error(usage);
    }
  }
  if (store === undefined || (command === 'recover' ? composed : members.length > 0)) {
    throw new Error(usage);
  }
  return { command, store, variation: { rubric, minimumAuthored, key, reverse }, openDiscovery, members, json };
}

/** Counts of framework events a run observed, by step (`member/slot`, or the slot of a composition-level step or supplied slot). */
interface ICounts {
  /** Executed source checks and memo, supplied-step and fold bodies. */
  readonly executions: Record<string, number>;
  /** Finality evaluations. */
  readonly finality: Record<string, number>;
}

/** An observer that counts executions and finality evaluations. */
function counter(): { readonly counts: ICounts; readonly observe: (event: IRunEvent) => void } {
  const counts: ICounts = { executions: {}, finality: {} };
  const bump = (record: Record<string, number>, name: string): void => {
    record[name] = (record[name] ?? 0) + 1;
  };
  return {
    counts,
    observe(event: IRunEvent): void {
      if (event.kind !== 'step') {
        return;
      }
      const { step, phase } = event.event;
      const name = step.memberKey === undefined ? step.slot : `${step.memberKey}/${step.slot}`;
      if (phase === 'execute') {
        bump(counts.executions, name);
      } else if (phase === 'finality') {
        bump(counts.finality, name);
      }
    },
  };
}

/** A JSON-safe description of how discovery settled. */
function describeDiscovery(discovery: IDiscoveryReport): Record<string, unknown> {
  switch (discovery.kind) {
    case 'keyed':
      return { kind: discovery.kind, completion: discovery.completion, keys: discovery.keys };
    case 'rejected':
      return { kind: discovery.kind, reason: discovery.diagnostic.reason, key: discovery.diagnostic.key ?? null, message: discovery.diagnostic.message };
    case 'pending':
    case 'cancelled':
      return { kind: discovery.kind, reason: discovery.reason };
    default: {
      const exhaustive: never = discovery;
      return exhaustive;
    }
  }
}

/** A JSON-safe description of one member's typed outcome. */
function describeMember(member: IMemberOutcome): Record<string, unknown> {
  switch (member.status) {
    case 'succeeded':
      return { status: member.status, kind: member.outcome.kind, reference: member.outcome.reference.locator };
    case 'skipped':
      return { status: member.status };
    case 'pending':
    case 'cancelled':
      return { status: member.status, reason: member.reason };
    case 'failed':
      return { status: member.status, code: member.error.code, message: member.error.message };
    default: {
      const exhaustive: never = member;
      return exhaustive;
    }
  }
}

/** A JSON-safe description of the strict report's typed outcome. */
function describeFold(outcome: IStrictFoldOutcome): Record<string, unknown> {
  switch (outcome.status) {
    case 'succeeded': {
      const settled = outcome.outcome;
      const { required, skipped, closed } = settled.coverage;
      return {
        status: outcome.status,
        kind: settled.kind,
        reference: settled.reference.locator,
        misses: settled.misses.map((miss) => miss.reason),
        coverage: { required, skipped, closed },
      };
    }
    case 'waiting':
      return { status: outcome.status, pending: outcome.pending, openDiscovery: outcome.openDiscovery };
    case 'failed':
      return { status: outcome.status, failed: outcome.failed, cancelled: outcome.cancelled, pending: outcome.pending, openDiscovery: outcome.openDiscovery, diagnostic: outcome.diagnostic };
    case 'pending':
    case 'cancelled':
      return { status: outcome.status, reason: outcome.reason };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/** Open the example's workspace inside the store directory. */
function open(store: string): IWorkspace {
  mkdirSync(store, { recursive: true });
  return openWorkspace({ location: join(store, 'history.sqlite'), logicalStore });
}

/** The saved request file. */
function requestsFile(store: string): string {
  return join(store, 'requests.json');
}

/** A saved request: the key identifying its admitted executions and the composition choices it ran under. */
interface ISavedRequest {
  readonly requestKey: string;
  readonly variation: IVariation;
}

/** Run the strict report: save a fresh request key first, then resolve the fold and read its exact results. */
async function runReport(args: IArguments, analysis: IAnalysis): Promise<Record<string, unknown>> {
  const saved: ISavedRequest = { requestKey: `report:${randomUUID()}`, variation: args.variation };
  mkdirSync(args.store, { recursive: true });
  // The caller owns key persistence: saved before any work starts, so a lost acknowledgment can be recovered.
  writeFileSync(requestsFile(args.store), `${JSON.stringify(saved, null, 2)}\n`);
  const observed = counter();
  const workspace = open(args.store);
  try {
    const result = await workspace.run({ authoring: analysis.authoring, composition: analysis.composition, environment: fixtureEnvironment, observers: [observed] }, async (run) => {
      const folded: IFoldReport = await run.resolveFold(analysis.report, { requestKey: saved.requestKey });
      // Exact reads of what this request settled: each succeeded member's summary and the completed report.
      const summaries: Record<string, ISummary> = {};
      for (const member of folded.members) {
        if (member.status === 'succeeded') {
          summaries[member.key] = run.read<ISummary>(member.outcome.reference);
        }
      }
      const outcome = folded.outcome;
      if (outcome.status === 'succeeded') {
        const report = run.read<IReport>(outcome.outcome.reference);
        return { folded, summaries, report, text: renderReport(report, outcome.outcome.coverage) };
      }
      return { folded, summaries, report: null, text: renderUnfinished(outcome) };
    });
    const { folded, summaries, report, text } = result.value;
    return {
      command: 'run',
      options: { ...args.variation, openDiscovery: args.openDiscovery },
      text,
      discovery: describeDiscovery(folded.discovery),
      members: Object.fromEntries(folded.members.map((member) => [member.key, describeMember(member)])),
      summaries,
      fold: describeFold(folded.outcome),
      report,
      ...observed.counts,
      diagnostics: result.diagnostics,
    };
  } finally {
    workspace.close();
  }
}

/** Read the saved request, rejecting anything but a nonempty key and a complete, valid variation. */
function savedRequest(store: string): ISavedRequest {
  const saved: unknown = JSON.parse(readFileSync(requestsFile(store), 'utf8'));
  const field = (record: unknown, name: string): unknown => (typeof record === 'object' && record !== null ? Reflect.get(record, name) : undefined);
  const requestKey = field(saved, 'requestKey');
  const variation = field(saved, 'variation');
  const rubric = field(variation, 'rubric');
  const minimumAuthored = field(variation, 'minimumAuthored');
  const key = field(variation, 'key');
  const reverse = field(variation, 'reverse');
  if (typeof requestKey !== 'string' || requestKey.length === 0 || typeof rubric !== 'string' || !isRubric(rubric) ||
      typeof minimumAuthored !== 'number' || !Number.isSafeInteger(minimumAuthored) || minimumAuthored < 0 ||
      typeof key !== 'string' || !isKeyChoice(key) || typeof reverse !== 'boolean') {
    throw new Error(`${requestsFile(store)} does not hold a saved request`);
  }
  return { requestKey, variation: { rubric, minimumAuthored, key, reverse } };
}

/** A JSON-safe description of one recovery result. */
function describeRecovery(recovered: IRecoveryResult): Record<string, unknown> {
  return recovered.kind === 'recovered' ? { kind: recovered.kind, reference: recovered.reference.locator } : { kind: recovered.kind };
}

/**
 * Recover the executions the saved request key identifies, without running a
 * source hook, finality policy or step body. It recovers discovery's and the
 * report fold's executions, then the summary of every member named by any of:
 * the recovered discovery listing (keyed by the composition, which runs the
 * declared custom-key projection under `--key id`), the recovered report's
 * required members, or `--member`. An interrupted run whose report never
 * executed still recovers its members from its discovery; a run that reused
 * discovery and the report lists members only through `--member`.
 */
async function recover(store: string, named: readonly string[]): Promise<Record<string, unknown>> {
  const saved = savedRequest(store);
  const analysis = composeAnalysis(saved.variation);
  const observed = counter();
  const workspace = open(store);
  try {
    const result = await workspace.run({ authoring: analysis.authoring, composition: analysis.composition, environment: fixtureEnvironment, observers: [observed] }, async (run) => {
      const request = { requestKey: saved.requestKey };
      const discovery = await run.recover(analysis.discovery, request);
      const report = await run.recover(analysis.report, request);
      const keys = new Set(named);
      if (discovery.kind === 'recovered') {
        const keyed = analysis.composition.keyMembers(templateSlot, run.read<unknown>(discovery.reference));
        if (keyed.status === 'keyed') {
          for (const member of keyed.members) {
            keys.add(member.key);
          }
        }
      }
      if (report.kind === 'recovered') {
        for (const entry of run.read<IReport>(report.reference).required) {
          keys.add(entry.key);
        }
      }
      const members: Record<string, unknown> = {};
      // Canonical code-unit order, whichever source named a member.
      for (const key of [...keys].sort()) {
        members[key] = describeRecovery(await run.recover(analysis.summary(key), request));
      }
      return { discovery: describeRecovery(discovery), report: describeRecovery(report), members };
    });
    return { command: 'recover', options: saved.variation, recovered: result.value, ...observed.counts };
  } finally {
    workspace.close();
  }
}

/**
 * Report what a normal run would do for discovery and, once discovery is
 * reusable, for each keyed member's summary, without admission, bodies or
 * writes. A strict fold has no check-only request; `run` resolves it.
 */
async function check(args: IArguments, analysis: IAnalysis): Promise<Record<string, unknown>> {
  const observed = counter();
  const workspace = open(args.store);
  try {
    const result = await workspace.run({ authoring: analysis.authoring, composition: analysis.composition, environment: fixtureEnvironment, observers: [observed] }, async (run) => {
      const discovery = await run.check(analysis.discovery);
      if (discovery.kind !== 'reusable') {
        return { discovery: { kind: discovery.kind }, members: {} };
      }
      const keyed = analysis.composition.keyMembers(templateSlot, run.read<unknown>(discovery.reference));
      if (keyed.status === 'rejected') {
        return { discovery: { kind: 'rejected', reason: keyed.diagnostic.reason, message: keyed.diagnostic.message }, members: {} };
      }
      const members: Record<string, unknown> = {};
      for (const { key } of keyed.members) {
        const checked = await run.check(analysis.summary(key));
        members[key] = checked.kind === 'reusable' ? { kind: checked.kind, reference: checked.reference.locator } : { kind: checked.kind };
      }
      return { discovery: { kind: discovery.kind, reference: discovery.reference.locator, completion: keyed.completion }, members };
    });
    return { command: 'check', options: { ...args.variation, openDiscovery: args.openDiscovery }, checked: result.value, ...observed.counts };
  } finally {
    workspace.close();
  }
}

/** Run one command and print its result. */
async function main(argv: readonly string[]): Promise<void> {
  const args = parseArguments(argv);
  setUpstreamListing(args.openDiscovery ? 'open' : 'complete');
  const output = args.command === 'run'
    ? await runReport(args, composeAnalysis(args.variation))
    : args.command === 'recover'
      ? await recover(args.store, args.members)
      : await check(args, composeAnalysis(args.variation));
  process.stdout.write(args.json ? `${JSON.stringify(output, null, 2)}\n` : `${typeof output.text === 'string' ? output.text : JSON.stringify(output, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
