/**
 * Independent child process for the external-operation process suites. It
 * assembles the real owners over the shared store files exactly as the
 * in-process harness does, runs one members request (or only inspects), and
 * writes one JSON line with its observations to file descriptor 1. A planned
 * fault kills the process with SIGKILL at one boundary of pr-1's request, with
 * no JavaScript cleanup:
 *
 * - `before-send`: the intent is durable and Accounting's usage intent is
 *   recorded, but the provider has received nothing;
 * - `after-send`: the provider applied the effect; no response, usage or
 *   outcome reached Supervision (a lost response through process death);
 * - `after-usage`: the usage report was acknowledged durably; the outcome was
 *   never committed.
 *
 * `hardStop` requests a hard stop as soon as the provider receives the
 * target's request. The target is pr-1 unless the script names another member.
 */
import { writeSync } from 'node:fs';

import { createStopController } from '@microdelta/supervision';
import type { IDeferralMode, IOperationAccounting, IRunEvent } from '@microdelta/supervision';

import { createWorld, installWorld } from './fixture.js';
import type { IOperationOptions } from './fixture.js';
import { fakeTimer, openSession } from './harness.js';
import type { IScriptEntry } from './provider.js';

/** A complete worker invocation. */
export interface IWorkerScript {
  readonly history: string;
  readonly accounting: string;
  readonly ledger: string;
  /** Supervision's clock reading for this process. */
  readonly now: number;
  readonly runId: string;
  readonly environment?: string;
  readonly deferral?: IDeferralMode;
  readonly scripts?: readonly { readonly name: string; readonly key: string; readonly entries: readonly IScriptEntry[] }[];
  readonly options?: Readonly<Record<string, IOperationOptions>>;
  readonly cancel?: 'cancelled' | 'running';
  readonly action: 'members' | 'inspect';
  readonly kill?: 'before-send' | 'after-send' | 'after-usage';
  readonly hardStop?: boolean;
  /** The member whose request the kill or hard stop targets; pr-1 when absent. */
  readonly target?: string;
}

/** What one worker reports. */
export interface IWorkerReport {
  readonly statuses?: Readonly<Record<string, string>>;
  readonly blocked?: Readonly<Record<string, unknown>>;
  readonly waitingUntil?: number | null;
  readonly diagnostics?: readonly string[];
  readonly events: readonly IRunEvent[];
  readonly operations: readonly unknown[];
  readonly usage: unknown;
}

/** Narrow the parsed argument to a worker script the parent serialized. */
function isScript(value: unknown): value is IWorkerScript {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'history') === 'string' && typeof Reflect.get(value, 'action') === 'string';
}

const parsed: unknown = JSON.parse(process.argv[2] ?? 'null');
if (!isScript(parsed)) {
  throw new Error('malformed worker script');
}
const script = parsed;
const timer = fakeTimer(script.now);
const world = installWorld(createWorld(() => timer.currentEpochMilliseconds(), undefined, script.ledger));
for (const entry of script.scripts ?? []) {
  world.provider.script(entry.name, entry.key, entry.entries);
}
Object.assign(world.options, script.options ?? {});
world.cancel = script.cancel;
const stop = createStopController();
const target = script.target ?? 'pr-1';

/** Die at once, as a crash would. */
function die(): never {
  process.kill(process.pid, 'SIGKILL');
  throw new Error('unreachable after SIGKILL');
}

const provider = world.provider;
world.provider = {
  ledger: () => provider.ledger(),
  script: (name, key, entries) => {
    provider.script(name, key, entries);
  },
  release: (name, key) => {
    provider.release(name, key);
  },
  get inFlight(): number {
    return provider.inFlight;
  },
  get peak(): number {
    return provider.peak;
  },
  async perform(name, key, send) {
    if (key === target && script.kill === 'before-send') {
      die();
    }
    if (key === target && script.hardStop === true) {
      queueMicrotask(() => {
        stop.request({ level: 'hard' });
      });
    }
    const answer = await provider.perform(name, key, send);
    if (key === target && script.kill === 'after-send') {
      die();
    }
    return answer;
  },
};

/** Kill just after pr-1's usage acknowledgment, when planned. */
function wrapAccounting(accounting: IOperationAccounting): IOperationAccounting {
  return {
    recordUsageIntent: (intent) => accounting.recordUsageIntent(intent),
    acknowledgeUsage: (report) => {
      const acknowledged = accounting.acknowledgeUsage(report);
      if (script.kill === 'after-usage' && report.report.includes(target)) {
        die();
      }
      return acknowledged;
    },
  };
}

// A short lease on the controlled clock: a later stage, started at least this much later, finds a killed holder's lease expired.
const session = openSession({ history: script.history, accounting: script.accounting }, timer, { wrapAccounting, leaseMilliseconds: 1_000 });
const environment = script.environment ?? 'env:production';
let report: IWorkerReport;
if (script.action === 'members') {
  const started = session.start({ runId: script.runId, environment, deferral: script.deferral ?? 'exit', stop, permits: 1, window: 1 }, (run) => run.resolveMembers({ template: 'pr', step: 'assess' }, { requestKey: `${script.runId}:members` }));
  const result = await started.done;
  const operations = (await session.start({ runId: `${script.runId}:inspect`, environment }, (run) => run.inspectOperations()).done).value;
  report = {
    statuses: Object.fromEntries(result.value.members.map((member) => [member.key, member.status])),
    blocked: Object.fromEntries(result.value.members.flatMap((member) => member.status === 'pending' && member.blocked !== undefined ? [[member.key, member.blocked]] : [])),
    waitingUntil: result.waitingUntil ?? null,
    diagnostics: result.diagnostics,
    events: started.events,
    operations,
    usage: session.usage(environment),
  };
} else {
  const operations = (await session.start({ runId: script.runId, environment }, (run) => run.inspectOperations()).done).value;
  report = { events: [], operations, usage: session.usage(environment) };
}
session.close();
writeSync(1, `${JSON.stringify(report)}\n`);
