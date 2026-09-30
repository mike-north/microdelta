/**
 * Independent child process for Resource Accounting's process-termination
 * tests. It opens the production SQLite adapter on a shared file through
 * Node's real SQLite capability and interprets a JSON script of steps, writing
 * one JSON line per completed step directly to file descriptor 1 so the trace
 * survives a SIGKILL. A deterministic fake paid provider keeps its ledger of
 * applied calls, each with the usage report it would deliver, in a separate
 * JSON-lines file, so "applied once" and "reported once" can be checked after
 * the process dies. `kill` and an armed commit-boundary fault terminate the
 * process without any JavaScript cleanup.
 * @packageDocumentation
 */
import { appendFileSync, existsSync, readFileSync, writeSync } from 'node:fs';

import type { IDurableAccounting, IUsageAcknowledgment, IUsageIntent, IUsageReport } from '@microdelta/accounting';

import { faultySqlite, openAccounting, openRaw } from './support.js';
import type { IFaultTiming } from './support.js';

/** One step; the worker applies steps in order. */
export type IWorkerStep =
  | { readonly op: 'intent'; readonly intent: IUsageIntent }
  | { readonly op: 'send'; readonly provider: string; readonly report: IUsageReport }
  | { readonly op: 'acknowledge'; readonly report: IUsageReport }
  | { readonly op: 'redeliver'; readonly provider: string }
  | { readonly op: 'arm'; readonly role: string; readonly timing: IFaultTiming }
  | { readonly op: 'summarize'; readonly environment: string }
  | { readonly op: 'hold-write-lock'; readonly milliseconds: number }
  | { readonly op: 'kill' };

/** A complete worker invocation. */
export interface IWorkerScript {
  readonly location: string;
  readonly steps: readonly IWorkerStep[];
}

/** Write one trace line synchronously, so it is durable before a later kill. */
function trace(entry: unknown): void {
  writeSync(1, `${JSON.stringify(entry)}\n`);
}

/** Describe an error by class name and message for the parent's assertions. */
function describeError(error: unknown): { readonly error: string; readonly message: string } {
  return error instanceof Error ? { error: error.name, message: error.message } : { error: 'unknown', message: String(error) };
}

/**
 * The provider's applied calls, each carrying the usage report it delivers.
 * The worker wrote every line itself, so each is a report it serialized.
 */
function providerReports(provider: string): readonly IUsageReport[] {
  if (!existsSync(provider)) {
    return [];
  }
  return readFileSync(provider, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): IUsageReport => {
      const parsed: unknown = JSON.parse(line);
      if (!isReport(parsed)) {
        throw new Error(`malformed provider ledger line ${line}`);
      }
      return parsed;
    });
}

/** Whether `value` is an object whose named fields are all strings. */
function hasStrings(value: unknown, fields: readonly string[]): value is object {
  return typeof value === 'object' && value !== null && fields.every((field) => typeof Reflect.get(value, field) === 'string');
}

/**
 * Narrow a parsed report to the shape the parent serialized. Field contents
 * are left to the adapter's own boundary validation, which is under test.
 */
function isReport(value: unknown): value is IUsageReport {
  return hasStrings(value, ['environment', 'operation', 'requestAttempt', 'report']) && Array.isArray(Reflect.get(value, 'quantities'));
}

/** Narrow a parsed intent to the shape the parent serialized. */
function isIntent(value: unknown): value is IUsageIntent {
  return hasStrings(value, ['environment', 'operation', 'requestAttempt']) && hasStrings(Reflect.get(value, 'attribution'), ['run']);
}

/** Narrow one parsed script step; an unrecognized step is a harness error. */
function parseStep(value: unknown): IWorkerStep {
  const op: unknown = typeof value === 'object' && value !== null ? Reflect.get(value, 'op') : undefined;
  const field = (name: string): unknown => (typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined);
  const provider = field('provider');
  const report = field('report');
  const intent = field('intent');
  const environment = field('environment');
  const role = field('role');
  const timing = field('timing');
  if (op === 'intent' && isIntent(intent)) {
    return { op, intent };
  }
  if (op === 'send' && typeof provider === 'string' && isReport(report)) {
    return { op, provider, report };
  }
  if (op === 'acknowledge' && isReport(report)) {
    return { op, report };
  }
  if (op === 'redeliver' && typeof provider === 'string') {
    return { op, provider };
  }
  if (op === 'arm' && typeof role === 'string' && (timing === 'statement' || timing === 'before-commit' || timing === 'after-commit')) {
    return { op, role, timing };
  }
  const milliseconds = field('milliseconds');
  if (op === 'hold-write-lock' && typeof milliseconds === 'number') {
    return { op, milliseconds };
  }
  if (op === 'summarize' && typeof environment === 'string') {
    return { op, environment };
  }
  if (op === 'kill') {
    return { op };
  }
  throw new Error(`unrecognized worker step ${JSON.stringify(value)}`);
}

/** Parse the parent's serialized script. */
function parseScript(text: string): IWorkerScript {
  const parsed: unknown = JSON.parse(text);
  const location: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'location') : undefined;
  const steps: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'steps') : undefined;
  if (typeof location !== 'string' || !Array.isArray(steps)) {
    throw new Error('worker script needs a location and steps');
  }
  return { location, steps: steps.map((step: unknown) => parseStep(step)) };
}

const encoded = process.argv[2];
if (encoded === undefined) {
  throw new Error('worker requires a JSON script argument');
}
const script = parseScript(encoded);
const sqlite = faultySqlite();
const accounting: IDurableAccounting = openAccounting({ location: script.location, sqlite: sqlite.capability });

/** Apply one step and return its traceable result. */
function apply(step: IWorkerStep): unknown {
  switch (step.op) {
    case 'intent':
      return accounting.recordUsageIntent(step.intent);
    case 'send':
      // The provider applies the call and holds its usage report for delivery.
      appendFileSync(step.provider, `${JSON.stringify(step.report)}\n`, 'utf8');
      return null;
    case 'acknowledge':
      return accounting.acknowledgeUsage(step.report);
    case 'redeliver':
      // A successor delivers every report the provider holds, as a late or repeated delivery.
      return providerReports(step.provider).map((report): IUsageAcknowledgment['kind'] => accounting.acknowledgeUsage(report).kind);
    case 'arm':
      sqlite.arm({ role: step.role, timing: step.timing, action: 'kill' });
      return step.role;
    case 'summarize':
      return accounting.summarizeUsage({ environment: step.environment });
    case 'hold-write-lock': {
      // Hold SQLite's write lock (an IMMEDIATE transaction on a separate
      // connection) for a fixed time, announcing it once held, as a
      // concurrent writer mid-transaction would.
      const connection = openRaw(script.location);
      connection.transaction(() => {
        trace({ op: 'hold-write-lock', held: true });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, step.milliseconds);
        return undefined;
      });
      connection.close();
      return 'released';
    }
    case 'kill':
      process.kill(process.pid, 'SIGKILL');
      return null;
    default: {
      const exhaustive: never = step;
      return exhaustive;
    }
  }
}

for (const [index, step] of script.steps.entries()) {
  try {
    trace({ index, op: step.op, ok: true, value: apply(step) });
  } catch (error: unknown) {
    trace({ index, op: step.op, ok: false, ...describeError(error) });
  }
}
accounting.close();
