/**
 * The acceptance harness's instrumented host module. In an acceptance worker
 * process, a module-customization hook (`host-hooks.ts`) resolves only the
 * facade's own import of `@microdelta/machine-node` to this module, so the
 * assembled workspace runs over:
 *
 * - the real Node Machine and clock, re-exported unchanged;
 * - the real Node SQLite capability, wrapped to *observe* every production
 *   statement (its role tag and any author-payload cells it returned) and to
 *   *interrupt* the process with SIGKILL immediately before or after the
 *   commit of the N-th transaction that executed a chosen role.
 *
 * The wrapper never alters a statement, row, transaction or result: History,
 * Resolution, Supervision and the facade run their own production code. It is
 * a process-termination and read-observation seam, not a second store.
 *
 * The fault plan comes from `MICRODELTA_ACCEPTANCE_FAULT`, e.g.
 * `{"role":"publish","occurrence":2,"when":"after"}`.
 */
import { writeSync } from 'node:fs';

import type { ISqliteCapability } from '@microdelta/history';
import { createNodeClock, createNodeMachine, createNodeSqlite as createRealNodeSqlite } from '@microdelta/machine-node';

export { createNodeClock, createNodeMachine };

/** One live connection as History receives it. */
type IConnection = ReturnType<ISqliteCapability['openSqlite']>;
/** One prepared statement. */
type IStatement = ReturnType<IConnection['prepare']>;
/** One returned row. */
type IRow = NonNullable<ReturnType<IStatement['get']>>;

/** Columns whose non-null cells carry author payload (canonical root, indexed scalar leaf, staged content). */
const payloadColumns: Readonly<Record<string, 'root' | 'scalar' | 'staged'>> = Object.freeze({ payload: 'root', scalar: 'scalar', staged_payload: 'staged' });

/** When a planned fault fires relative to its transaction's commit. */
export interface IFaultPlan {
  /** The statement role whose transaction is interrupted. */
  readonly role: string;
  /** Which transaction containing that role (1-based) is interrupted. */
  readonly occurrence: number;
  /** Kill just before the commit, or just after it returned. */
  readonly when: 'before' | 'after';
}

/** Aggregated read evidence for a window of production statements. */
export interface IReadEvidence {
  /** Role tags executed in the window, with counts. */
  readonly roles: Readonly<Record<string, number>>;
  /** Non-null canonical root payload cells returned. */
  readonly rootPayloadCells: number;
  /** Non-null indexed scalar leaf cells returned. */
  readonly scalarCells: number;
  /** Non-null staged candidate cells returned. */
  readonly stagedCells: number;
}

/** Extract a statement's leading role tag, as History writes it. */
function roleOf(text: string): string {
  const match = /^\s*\/\*\s*([a-z-]+)\s*\*\//u.exec(text);
  return match?.[1] ?? 'untagged';
}

/** Parse the fault plan from the environment; absent means no fault. */
function faultPlan(): IFaultPlan | undefined {
  const text = process.env['MICRODELTA_ACCEPTANCE_FAULT'];
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(text);
  const role: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'role') : undefined;
  const occurrence: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'occurrence') : undefined;
  const when: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'when') : undefined;
  if (typeof role !== 'string' || typeof occurrence !== 'number' || (when !== 'before' && when !== 'after')) {
    throw new Error(`malformed MICRODELTA_ACCEPTANCE_FAULT: ${text}`);
  }
  return { role, occurrence, when };
}

/** Every observed statement: its role and returned rows' payload cells. */
const events: { readonly role: string; readonly root: number; readonly scalar: number; readonly staged: number }[] = [];

/** The planned fault and how many transactions with its role have run. */
const plan = faultPlan();
let seen = 0;

/**
 * Terminate without any JavaScript cleanup, after a synchronous trace line
 * naming the fault reached: its role, occurrence and boundary as structured
 * fields (which the parent matches against the plan) and a readable note.
 * Nothing is written after it, so it is the process's last output line.
 */
function kill(fault: IFaultPlan): never {
  writeSync(1, `${JSON.stringify({ t: 'fault', role: fault.role, occurrence: fault.occurrence, when: fault.when, note: `${fault.when} commit of ${fault.role} #${String(fault.occurrence)}` })}\n`);
  process.kill(process.pid, 'SIGKILL');
  throw new Error('unreachable after SIGKILL');
}

/** Observe one statement's execution. */
function note(role: string, rows: readonly IRow[], roles: Set<string> | undefined): void {
  let root = 0;
  let scalar = 0;
  let staged = 0;
  for (const row of rows) {
    for (const [column, cell] of Object.entries(row)) {
      const kind = payloadColumns[column];
      if (kind === undefined || cell === null) {
        continue;
      }
      if (kind === 'root') {
        root += 1;
      } else if (kind === 'scalar') {
        scalar += 1;
      } else {
        staged += 1;
      }
    }
  }
  events.push({ role, root, scalar, staged });
  roles?.add(role);
}

/**
 * The real Node SQLite capability, observed and interruptible. Statements and
 * transactions are forwarded unchanged.
 * @returns The wrapped capability.
 */
export function createNodeSqlite(): ISqliteCapability {
  const real = createRealNodeSqlite();
  return {
    openSqlite(location: string): IConnection {
      const connection = real.openSqlite(location);
      let transactionRoles: Set<string> | undefined;
      return {
        exec: (text) => {
          connection.exec(text);
        },
        prepare: (text) => {
          const statement = connection.prepare(text);
          const role = roleOf(text);
          return {
            run(...values) {
              const result = statement.run(...values);
              note(role, [], transactionRoles);
              return result;
            },
            get(...values) {
              const row = statement.get(...values);
              note(role, row === undefined ? [] : [row], transactionRoles);
              return row;
            },
            all(...values) {
              const rows = statement.all(...values);
              note(role, rows, transactionRoles);
              return rows;
            },
          };
        },
        transaction<T>(operation: () => T): T {
          const roles = new Set<string>();
          let armed = false;
          // The real connection still refuses asynchronous results; the wrapper only observes the callback.
          const result = connection.transaction<unknown>(() => {
            transactionRoles = roles;
            try {
              const value = operation();
              if (plan !== undefined && roles.has(plan.role)) {
                seen += 1;
                armed = seen === plan.occurrence;
                if (armed && plan.when === 'before') {
                  kill(plan);
                }
              }
              return value;
            } finally {
              transactionRoles = undefined;
            }
          }) as T;
          if (armed && plan?.when === 'after') {
            kill(plan);
          }
          return result;
        },
        close: () => {
          connection.close();
        },
      };
    },
  };
}

/** A mark into the observed statement log. */
export function markReads(): number {
  return events.length;
}

/** Summarize observed statements since `start`. */
export function readEvidence(start: number): IReadEvidence {
  const roles: Record<string, number> = {};
  let rootPayloadCells = 0;
  let scalarCells = 0;
  let stagedCells = 0;
  for (const event of events.slice(start)) {
    roles[event.role] = (roles[event.role] ?? 0) + 1;
    rootPayloadCells += event.root;
    scalarCells += event.scalar;
    stagedCells += event.staged;
  }
  return { roles, rootPayloadCells, scalarCells, stagedCells };
}
