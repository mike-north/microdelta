/**
 * Independent child process for durable History recovery tests. It opens the
 * real SQLite-backed authority on a shared file and interprets a JSON script
 * of lifecycle steps, writing one JSON line per completed step directly to
 * file descriptor 1 so the trace survives a SIGKILL. `kill` and an armed
 * pre-commit fault terminate the process without any JavaScript cleanup,
 * which is the process-termination boundary under test.
 * @packageDocumentation
 */
import { appendFileSync, writeFileSync, writeSync } from 'node:fs';

import type { IAttemptRequest, IDurableHistory, IWriterLease } from '@microdelta/history';

import { controlledClock, observedSqlite, openHistory } from './support.js';

/** One lifecycle step; the worker applies steps in order. */
export type IWorkerStep =
  | { readonly op: 'time'; readonly at: number }
  | { readonly op: 'acquire'; readonly holder: string; readonly lease: number }
  | { readonly op: 'use-lease'; readonly lease: IWriterLease }
  | { readonly op: 'renew'; readonly lease: number }
  | { readonly op: 'release' }
  | { readonly op: 'allocate'; readonly request: IAttemptRequest }
  | { readonly op: 'use-attempt'; readonly attemptId: number }
  | { readonly op: 'body'; readonly counter: string }
  | { readonly op: 'stage'; readonly payload: unknown; readonly label: string; readonly dependencies?: readonly string[] }
  | { readonly op: 'publish' }
  | { readonly op: 'abandon'; readonly outcome: 'failed' | 'interrupted' }
  | { readonly op: 'accept'; readonly locator: string }
  | { readonly op: 'recover'; readonly request: IAttemptRequest }
  | { readonly op: 'acknowledge'; readonly file: string }
  | { readonly op: 'arm'; readonly role: string }
  | { readonly op: 'kill' };

/** A complete worker invocation. */
export interface IWorkerScript {
  readonly location: string;
  readonly store: string;
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

const encoded = process.argv[2];
if (encoded === undefined) {
  throw new Error('worker requires a JSON script argument');
}
const script = JSON.parse(encoded) as IWorkerScript;
const clock = controlledClock(0);
const sqlite = observedSqlite();
const history: IDurableHistory = openHistory({ location: script.location, clock, sqlite: sqlite.capability, store: script.store });

let lease: IWriterLease | undefined;
let attemptId: number | undefined;
let lastReference: string | undefined;

/** The lease a step needs; a missing lease is a script error. */
function requireLease(): IWriterLease {
  if (lease === undefined) {
    throw new Error('script step needs a lease');
  }
  return lease;
}

/** The attempt a step needs; a missing attempt is a script error. */
function requireAttempt(): number {
  if (attemptId === undefined) {
    throw new Error('script step needs an attempt');
  }
  return attemptId;
}

/** Apply one step and return its traceable result. */
function apply(step: IWorkerStep): unknown {
  switch (step.op) {
    case 'time':
      clock.set(step.at);
      return step.at;
    case 'acquire': {
      const acquisition = history.acquireWriter({ holder: step.holder, leaseMilliseconds: step.lease });
      if (acquisition.kind === 'acquired') {
        lease = acquisition.lease;
      }
      return acquisition;
    }
    case 'use-lease':
      lease = step.lease;
      return lease;
    case 'renew':
      lease = history.renewWriter(requireLease(), step.lease);
      return lease;
    case 'release':
      history.releaseWriter(requireLease());
      return null;
    case 'allocate': {
      const attempt = history.allocateAttempt(requireLease(), step.request);
      attemptId = attempt.attemptId;
      return attempt;
    }
    case 'use-attempt':
      attemptId = step.attemptId;
      return attemptId;
    case 'body':
      // Marks one execution of the (fixture) author body in a file outside the database.
      appendFileSync(step.counter, 'body\n', 'utf8');
      return null;
    case 'stage':
      return history.stageAttempt(requireLease(), {
        attemptId: requireAttempt(),
        payload: step.payload,
        provenance: { format: 'test.resolution.provenance', formatVersion: 1, content: { label: step.label } },
        dependencies: (step.dependencies ?? []).map((locator) => ({ kind: 'completed-result', locator })),
      });
    case 'publish': {
      const reference = history.publishAttempt(requireLease(), requireAttempt());
      lastReference = reference.locator;
      return reference;
    }
    case 'abandon':
      return history.abandonAttempt(requireLease(), {
        attemptId: requireAttempt(),
        outcome: step.outcome,
        evidence: { format: 'test.outcome', formatVersion: 1, content: { reason: step.outcome } },
      });
    case 'accept':
      return history.recordAcceptance(requireLease(), {
        reference: { kind: 'completed-result', locator: step.locator },
        evidence: { format: 'test.acceptance', formatVersion: 1, content: { accepted: true } },
        dependencies: [],
      });
    case 'recover':
      return history.recoverAttempt(step.request);
    case 'acknowledge':
      // The caller's acknowledgment of a committed publication, outside the database.
      writeFileSync(step.file, lastReference ?? '', 'utf8');
      return null;
    case 'arm':
      sqlite.arm({ role: step.role, action: 'kill' });
      return step.role;
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
history.close();
