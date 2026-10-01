/**
 * The example's command line: which commands exist, which flags each accepts,
 * and the validated arguments a command runs with. Every argument must be a
 * flag the command accepts, with a valid value; anything else is a usage
 * error. This is application presentation, not framework policy.
 *
 * Commands:
 * - `run` resolves the strict report and `status` the outcome (tolerant)
 *   status report; both take composition choices and the operator's run
 *   controls (environment, deferral mode, permits, window, writer lease
 *   duration and writer-wait deadline);
 * - `check` reports what a normal run would do, in a chosen environment;
 * - `recover` reports what the saved request durably produced, and takes its
 *   composition choices from the saved request;
 * - `operations` inspects an environment's external operations, usage and
 *   promotions; `settle` resolves or abandons one unknown operation;
 * - `promote` promotes what the source environment's current report rests on
 *   into another environment.
 */
import type { IDeferralMode } from 'microdelta';

import { defaultVariation } from './analysis.js';
import type { IKeyChoice, IVariation } from './analysis.js';
import { rubrics } from './assessment.js';
import type { IRubric } from './assessment.js';
import { fixtureEnvironment, isEnvironment } from './fixture.js';
import type { IEnvironment } from './fixture.js';

/** The usage message every malformed command line reports. */
export const usage = [
  'usage: main.js run|recover|check --store DIR [--rubric A|B|C|P] [--minimum-authored N] [--key key|id] [--open-discovery] [--reverse] [--member KEY]... [--json]',
  '       main.js run|status|check ... [--environment fixture|trial|production]',
  '       main.js run|status ... [--deferral sleep|exit] [--permits N] [--window N] [--lease-ms N] [--writer-deadline-ms N]',
  '       main.js operations --store DIR [--environment ENV] [--json]',
  '       main.js settle --store DIR --operation ID (--abandon | --resolve succeeded|failed) [--operator NAME] [--environment ENV] [--json]',
  '       main.js promote --store DIR --from ENV --to ENV [--rubric A|B|C|P] [--minimum-authored N] [--key key|id] [--reverse] [--json]',
].join('\n');

/** The entry operation a command line selects. */
export type ICommand = 'run' | 'status' | 'recover' | 'check' | 'operations' | 'settle' | 'promote';

/** Every command. */
const commands: readonly ICommand[] = ['run', 'status', 'recover', 'check', 'operations', 'settle', 'promote'];

/** The operator's controls of one supervised run; absent ones keep the framework's defaults. */
export interface IRunControls {
  /** Sleep and resume, or exit and report the time deferred work waits until. */
  readonly deferral?: IDeferralMode;
  /** How many sends may be in flight at once. */
  readonly permits?: number;
  /** How many members actively resolve at once. */
  readonly window?: number;
  /** The writer lease duration in milliseconds. */
  readonly leaseMilliseconds?: number;
  /** How long a normal request may wait for the writer lease before failing writer-busy; no deadline when absent. */
  readonly writerDeadlineMilliseconds?: number;
}

/** An operator's settlement of one unknown operation. */
export type ISettlementChoice =
  | { readonly action: 'abandon'; readonly operation: string; readonly operator: string }
  | { readonly action: 'resolve'; readonly outcome: 'succeeded' | 'failed'; readonly operation: string; readonly operator: string };

/** Parsed command line. */
export interface IArguments {
  readonly command: ICommand;
  readonly store: string;
  readonly variation: IVariation;
  readonly openDiscovery: boolean;
  /** Member keys whose summaries `recover` is asked for explicitly. */
  readonly members: readonly string[];
  /** The environment a run, check, inspection or settlement selects. */
  readonly environment: IEnvironment;
  readonly controls: IRunControls;
  /** The settlement `settle` records. */
  readonly settlement: ISettlementChoice | undefined;
  /** The source and target environments of `promote`. */
  readonly promotion: { readonly from: IEnvironment; readonly to: IEnvironment } | undefined;
  readonly json: boolean;
}

/** The commands that take composition choices. */
const composing: readonly ICommand[] = ['run', 'status', 'check', 'promote'];

/** Which commands accept each flag, and whether it takes a value. */
const flags: Readonly<Record<string, { readonly value: boolean; readonly commands: readonly ICommand[] }>> = {
  '--store': { value: true, commands },
  '--json': { value: false, commands },
  '--rubric': { value: true, commands: composing },
  '--minimum-authored': { value: true, commands: composing },
  '--key': { value: true, commands: composing },
  '--reverse': { value: false, commands: composing },
  '--open-discovery': { value: false, commands: ['run', 'status', 'check'] },
  '--member': { value: true, commands: ['recover'] },
  '--environment': { value: true, commands: ['run', 'status', 'check', 'operations', 'settle'] },
  '--deferral': { value: true, commands: ['run', 'status'] },
  '--permits': { value: true, commands: ['run', 'status'] },
  '--window': { value: true, commands: ['run', 'status'] },
  '--lease-ms': { value: true, commands: ['run', 'status'] },
  '--writer-deadline-ms': { value: true, commands: ['run', 'status'] },
  '--operation': { value: true, commands: ['settle'] },
  '--operator': { value: true, commands: ['settle'] },
  '--abandon': { value: false, commands: ['settle'] },
  '--resolve': { value: true, commands: ['settle'] },
  '--from': { value: true, commands: ['promote'] },
  '--to': { value: true, commands: ['promote'] },
};

/** Whether a string names a command. */
function isCommand(value: string | undefined): value is ICommand {
  return commands.some((command) => command === value);
}

/** Whether a string names a rubric. */
export function isRubric(value: string): value is IRubric {
  return rubrics.some((rubric) => rubric === value);
}

/** Whether a string names a key choice. */
export function isKeyChoice(value: string): value is IKeyChoice {
  return value === 'key' || value === 'id';
}

/** A nonnegative safe integer written in decimal digits, or undefined. */
function wholeNumber(value: string): number | undefined {
  return /^\d+$/u.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

/** A usage error. */
function misuse(): Error {
  return new Error(usage);
}

/** The value a flag requires, or a usage error. */
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw misuse();
  }
  return value;
}

/** A positive safe integer, or a usage error. */
function positive(value: string): number {
  const number = wholeNumber(value);
  if (number === undefined || number === 0) {
    throw misuse();
  }
  return number;
}

/** An environment the fixture serves, or a usage error. */
function environmentOf(value: string): IEnvironment {
  if (!isEnvironment(value)) {
    throw misuse();
  }
  return value;
}

/** Parse the command line or explain its usage. */
export function parseArguments(argv: readonly string[]): IArguments {
  const [command, ...rest] = argv;
  if (!isCommand(command)) {
    throw misuse();
  }
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const members: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index] ?? '';
    const spec = flags[flag];
    if (spec === undefined || !spec.commands.includes(command)) {
      throw misuse();
    }
    if (!spec.value) {
      switches.add(flag);
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--') || value.length === 0) {
      throw misuse();
    }
    index += 1;
    if (flag === '--member') {
      members.push(value);
    } else {
      values.set(flag, value);
    }
  }

  const rubric = values.get('--rubric') ?? defaultVariation.rubric;
  const minimumAuthored = values.has('--minimum-authored') ? wholeNumber(values.get('--minimum-authored') ?? '') : defaultVariation.minimumAuthored;
  const key = values.get('--key') ?? defaultVariation.key;
  if (!isRubric(rubric) || minimumAuthored === undefined || !isKeyChoice(key)) {
    throw misuse();
  }
  const deferral = values.get('--deferral');
  if (deferral !== undefined && deferral !== 'sleep' && deferral !== 'exit') {
    throw misuse();
  }
  const permits = values.get('--permits');
  const window = values.get('--window');
  const lease = values.get('--lease-ms');
  const deadline = values.get('--writer-deadline-ms');
  const controls: IRunControls = {
    ...(deferral === undefined ? {} : { deferral }),
    ...(permits === undefined ? {} : { permits: positive(permits) }),
    ...(window === undefined ? {} : { window: positive(window) }),
    ...(lease === undefined ? {} : { leaseMilliseconds: positive(lease) }),
    ...(deadline === undefined ? {} : { writerDeadlineMilliseconds: required(wholeNumber(deadline)) }),
  };

  let settlement: ISettlementChoice | undefined;
  if (command === 'settle') {
    const operation = required(values.get('--operation'));
    const operator = values.get('--operator') ?? 'operator.cli';
    const resolve = values.get('--resolve');
    if (switches.has('--abandon') === (resolve !== undefined)) {
      throw misuse();
    }
    if (resolve === undefined) {
      settlement = { action: 'abandon', operation, operator };
    } else if (resolve === 'succeeded' || resolve === 'failed') {
      settlement = { action: 'resolve', outcome: resolve, operation, operator };
    } else {
      throw misuse();
    }
  }

  let promotion: IArguments['promotion'];
  if (command === 'promote') {
    const from = environmentOf(required(values.get('--from')));
    const to = environmentOf(required(values.get('--to')));
    if (from === to) {
      throw misuse();
    }
    promotion = { from, to };
  }

  return {
    command,
    store: required(values.get('--store')),
    variation: { rubric, minimumAuthored, key, reverse: switches.has('--reverse') },
    openDiscovery: switches.has('--open-discovery'),
    members,
    environment: environmentOf(values.get('--environment') ?? fixtureEnvironment),
    controls,
    settlement,
    promotion,
    json: switches.has('--json'),
  };
}
