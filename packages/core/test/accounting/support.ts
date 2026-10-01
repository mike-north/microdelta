/**
 * Assembly-level support for Resource Accounting tests. It composes
 * Accounting's SQLite adapter with Node's real SQLite capability, exactly as
 * production assembly will, and adds only fault injection around that real
 * backend: a SIGKILL or throw at a chosen commit boundary of a chosen kind of
 * write. It never replaces storage with a test facade.
 *
 * Fault timings:
 * - `statement`: a statement of the write fails while the write's work runs.
 *   The transaction rolls back; the fact is certainly not durable.
 * - `before-commit`: the write's work completed, SQLite has not committed.
 *   The fact is not durable, but the adapter cannot tell this from a failed
 *   commit, so the caller sees unknown durability.
 * - `after-commit`: SQLite committed, the adapter has not returned. The fact is
 *   durable but no acknowledgment reached the caller: a lost acknowledgment.
 * @packageDocumentation
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDurableAccounting } from '@microdelta/accounting';
import type { IDurableAccounting, IDurableAccountingOptions, IUsageAttribution, IUsageIntent, IUsageReport } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';

/** The Machine SQLite capability as Accounting's adapter receives it. */
export type ISqliteCapability = IDurableAccountingOptions['sqlite'];
/** One real connection as Accounting receives it from the capability. */
export type ISqliteConnection = ReturnType<ISqliteCapability['openSqlite']>;
/** One prepared real statement. */
type ISqliteStatement = ReturnType<ISqliteConnection['prepare']>;

/** The logical store accounting tests open. */
export const logicalStore = 'store:contributors';

/** When an armed fault fires relative to SQLite's commit. */
export type IFaultTiming = 'statement' | 'before-commit' | 'after-commit';

/** A fault to inject into the next transaction that executes a statement with `role`. */
export interface IFaultPlan {
  /** The statement role tag (`intent`, `report`, `estimate`) that arms the fault. */
  readonly role: string;
  /** Whether the fault fires before or after SQLite commits. */
  readonly timing: IFaultTiming;
  /** Kill the process with SIGKILL, or throw to exercise the caller's view in-process. */
  readonly action: 'kill' | 'throw';
}

/** Error thrown by an armed in-process fault. */
export class InjectedFault extends Error {
  public constructor(role: string, timing: IFaultTiming) {
    super(`injected fault ${timing} of a ${role} transaction`);
    this.name = 'InjectedFault';
  }
}

/** A real SQLite capability with an optional commit-boundary fault. */
export interface IFaultySqlite {
  readonly capability: ISqliteCapability;
  /** Arm a fault that fires once; `undefined` disarms. */
  arm(plan: IFaultPlan | undefined): void;
}

/** Extract a statement's leading role tag. */
function roleOf(text: string): string {
  const match = /^\s*\/\*\s*([a-z-]+)\s*\*\//u.exec(text);
  return match?.[1] ?? 'untagged';
}

/** Fire an armed fault: SIGKILL ends the process with no JavaScript cleanup. */
function fire(plan: IFaultPlan): never {
  if (plan.action === 'kill') {
    process.kill(process.pid, 'SIGKILL');
  }
  throw new InjectedFault(plan.role, plan.timing);
}

/**
 * Wrap Node's real SQLite capability. Statement executions inside a
 * transaction record their role; when the armed role ran, the fault fires
 * after the callback's SQL and before SQLite commits, or after the real commit
 * returned and before the adapter sees the result.
 */
export function faultySqlite(): IFaultySqlite {
  const real = createNodeSqlite();
  let plan: IFaultPlan | undefined;
  let transactionRoles: Set<string> | undefined;

  const wrapStatement = (text: string, statement: ISqliteStatement): ISqliteStatement => {
    const role = roleOf(text);
    /** Note the role inside a transaction, failing first when a statement fault is armed for it. */
    const note = (): void => {
      if (transactionRoles === undefined) {
        return;
      }
      transactionRoles.add(role);
      const armed = plan;
      if (armed?.timing === 'statement' && armed.role === role) {
        plan = undefined;
        fire(armed);
      }
    };
    return {
      run(...values) {
        note();
        return statement.run(...values);
      },
      get(...values) {
        note();
        return statement.get(...values);
      },
      all(...values) {
        note();
        return statement.all(...values);
      },
    };
  };

  const capability: ISqliteCapability = {
    openSqlite(location: string): ISqliteConnection {
      const connection = real.openSqlite(location);
      return {
        exec: (text) => {
          connection.exec(text);
        },
        prepare: (text) => wrapStatement(text, connection.prepare(text)),
        transaction<T>(operation: () => T): T {
          const roles = new Set<string>();
          let result: { readonly value: T } | undefined;
          // The real connection still refuses asynchronous results at runtime;
          // this wrapper only observes the synchronous callback and its commit.
          connection.transaction(() => {
            transactionRoles = roles;
            try {
              result = { value: operation() };
            } finally {
              transactionRoles = undefined;
            }
            const armed = plan;
            if (armed?.timing === 'before-commit' && roles.has(armed.role)) {
              plan = undefined;
              fire(armed);
            }
            return undefined;
          });
          const armed = plan;
          if (armed?.timing === 'after-commit' && roles.has(armed.role)) {
            plan = undefined;
            fire(armed);
          }
          if (result === undefined) {
            throw new Error('transaction callback produced no result');
          }
          return result.value;
        },
        close: () => {
          connection.close();
        },
      };
    },
  };

  return {
    capability,
    arm(next: IFaultPlan | undefined): void {
      plan = next;
    },
  };
}

/** Temporary directories created by a suite, removed after each test. */
const directories: string[] = [];

/** Create a fresh SQLite file location inside a unique temporary directory. */
export function freshLocation(name = 'accounting.sqlite'): string {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-accounting-'));
  directories.push(directory);
  return join(directory, name);
}

/** Create a fresh temporary directory for auxiliary files such as a fake provider's ledger. */
export function freshDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-accounting-'));
  directories.push(directory);
  return directory;
}

/** Stores opened by a test, closed before their files are removed. */
const opened: IDurableAccounting[] = [];

/** Open the durable accounting store over the real backend and remember it for cleanup. */
export function openAccounting(options: { readonly location: string; readonly sqlite?: ISqliteCapability; readonly store?: string }): IDurableAccounting {
  const accounting = openDurableAccounting({
    sqlite: options.sqlite ?? createNodeSqlite(),
    location: options.location,
    logicalStore: options.store ?? logicalStore,
  });
  opened.push(accounting);
  return accounting;
}

/** Raw connections opened by a test. */
const rawConnections: ISqliteConnection[] = [];

/** Open a raw real connection for inspection or deliberate tampering. */
export function openRaw(location: string): ISqliteConnection {
  const connection = createNodeSqlite().openSqlite(location);
  rawConnections.push(connection);
  return connection;
}

/** Close everything a test opened and remove its temporary files. */
export function cleanup(): void {
  for (const accounting of opened.splice(0)) {
    try {
      accounting.close();
    } catch {
      // A test may already have closed it.
    }
  }
  for (const connection of rawConnections.splice(0)) {
    connection.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Attribution of Ada's assessment in the first run. */
export const adaAttribution: IUsageAttribution = { run: 'run-1', member: 'ada', stepAttempt: 'attempt-1' };

/** A usage intent for request attempt `requestAttempt` of operation `operation` in `environment`. */
export function intentFor(operation: string, requestAttempt: string, overrides: { readonly environment?: string; readonly attribution?: IUsageAttribution } = {}): IUsageIntent {
  return { environment: overrides.environment ?? 'production', operation, requestAttempt, attribution: overrides.attribution ?? adaAttribution };
}

/** A report of `tokens` input tokens for request attempt `requestAttempt` of `operation`. */
export function tokenReport(operation: string, requestAttempt: string, report: string, tokens: number, environment = 'production'): IUsageReport {
  return { environment, operation, requestAttempt, report, quantities: [{ unit: 'tokens.input', amount: tokens }] };
}
