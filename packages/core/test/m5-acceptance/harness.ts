/**
 * Parent-side support for the M5 independent-process acceptance suite. A
 * scenario owns one temporary directory holding the shared SQLite History
 * file, Resource Accounting's file, the world file and the provider
 * directory. Each step spawns a fresh worker process (`worker.ts`) that
 * imports the *built* `microdelta` facade and rebuilds declarations, helpers
 * and inputs from scratch; nothing survives between steps except those files.
 *
 * The parent inspects durable state through the stores themselves: History's
 * rows read with a raw read-only query (the writer row, attempts, results,
 * journal revisions, acceptances and promotions, each with the fence it was
 * written under), and Accounting's summary through its own durable adapter.
 * It never reads a worker's cache, and it never writes either store.
 *
 * Steps run synchronously (`run`) or in the background (`start`), so a test
 * can interleave processes deterministically: it waits for a worker's output
 * line, a provider receipt or a lease expiry, then opens a provider gate,
 * starts another worker, or kills one.
 *
 * @see ../../../../docs/plans/m5-operations.md (Planned evidence names)
 * @see ../../../../docs/spec/acceptance.md (TEST-2)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';

import type { IWorld } from './analysis.js';
import { gateFile, readLedger } from './provider.js';
import type { ILedgerEntry } from './provider.js';
import type { ICommand, IJob, IResultJson } from './worker.js';

/** The logical store every M5 acceptance scenario uses. */
export const logicalStore = 'store:m5-acceptance';

/** The production environment. */
export const production = 'env:production';

/** A trial environment of the same analysis. */
export const trial = 'env:trial';

/** The worker entry point, as emitted beside this module. */
const worker = fileURLToPath(new URL('./worker.js', import.meta.url));

/** One hour in milliseconds. */
export const hour = 60 * 60 * 1_000;

/** One run event as a worker printed it: the event's own fields, never a value. */
export type IEventJson = Readonly<Record<string, unknown>>;

/** One parsed worker process. */
export interface IProcessRun {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Every JSON line, in order. */
  readonly lines: readonly Readonly<Record<string, unknown>>[];
  /** The final result line; a process without one throws when this is read. */
  readonly result: IResultJson;
  /** The final error line, if the process failed with one. */
  readonly error: Readonly<Record<string, unknown>> | undefined;
  /** Every run event, in order. */
  readonly events: readonly IEventJson[];
  /** The operation events, as `phase[:status][:reason]@member` strings. */
  readonly operations: readonly string[];
  /** The member keys whose assessment body started, in order. */
  readonly assessed: readonly string[];
}

/** A worker running in the background. */
export interface IStartedProcess {
  /** The JSON lines printed so far. */
  readonly lines: readonly Readonly<Record<string, unknown>>[];
  /** Whether the process has exited. */
  readonly exitedYet: boolean;
  /** Wait until a printed line satisfies `predicate`. */
  waitForLine(predicate: (line: Readonly<Record<string, unknown>>) => boolean, description: string, timeout?: number): Promise<void>;
  /** Kill the process with `signal`. */
  kill(signal: NodeJS.Signals): void;
  /** The finished process. */
  readonly exited: Promise<IProcessRun>;
}

/** One row of the History writer, as stored. */
export interface IWriterRow {
  readonly lastFence: number;
  readonly holder: string | null;
  readonly expiresAt: number;
}

/**
 * A snapshot of durable History for comparing state before and after an
 * action: every row of every History table, plus the fenced rows in a compact
 * form for reading which fences wrote what. The writer row's clock high-water
 * is left out: the writer-lease model lets any writer transaction, including a
 * refused one or a waiter's observation, raise it, and it grants no authority.
 */
export interface IFencedRows {
  readonly writer: IWriterRow;
  /** Every row of every History table, as sorted JSON lines, by table (the writer row without its high-water). */
  readonly tables: Readonly<Record<string, readonly string[]>>;
  /** `<attempt id> <subject> <environment> <state> <allocated fence> <ended fence>` */
  readonly attempts: readonly string[];
  /** `<result id> <subject> <environment> <published fence>` */
  readonly results: readonly string[];
  /** `<sequence> <collection> <key> r<revision> <fence>` */
  readonly journal: readonly string[];
  /** `<acceptance id> <result id> <environment> <fence>` */
  readonly acceptances: readonly string[];
  /** `<promotion id> <environment> <fence>` */
  readonly promotions: readonly string[];
}

/** One durable attempt row. */
export interface IAttemptRow {
  readonly subject: string;
  readonly environment: string;
  readonly state: string;
  readonly allocatedFence: number;
  readonly endedFence: number | null;
}

/** Accounting's summary of one environment, as its durable adapter reports it. */
export type IUsageSummaryJson = ReturnType<ReturnType<typeof openDurableAccounting>['summarizeUsage']>;

/** A job as a test states it: the command and its options; the scenario supplies its files. */
export type IJobOptions = Omit<IJob, 'location' | 'accounting' | 'logicalStore' | 'world' | 'provider' | 'environment' | 'command'> & {
  readonly environment?: string;
};

/** One scenario: two stores, a world file and a provider directory in a fresh directory. */
export interface IScenario {
  readonly directory: string;
  readonly location: string;
  readonly accounting: string;
  readonly provider: string;
  /** Write the world every later process reads. */
  writeWorld(world: IWorld): void;
  /**
   * Run one independent worker process to completion. It is killed after
   * `timeoutMilliseconds` (90 s when absent), so a case that expects a prompt
   * exit can bound how long a defect that hangs may cost.
   */
  run(command: ICommand, options?: IJobOptions, timeoutMilliseconds?: number): IProcessRun;
  /** Start one independent worker process in the background. */
  start(command: ICommand, options?: IJobOptions): IStartedProcess;
  /** Open a provider gate, releasing every request held at it. */
  open(gate: string): void;
  /** The provider's ledger, in order. */
  ledger(): readonly ILedgerEntry[];
  /** The member keys of one kind of ledger line, in order. */
  keys(kind: ILedgerEntry['kind']): readonly string[];
  /** The History writer row now. */
  writer(): IWriterRow;
  /** Every History row now. */
  rows(): IFencedRows;
  /** Every attempt row of the subjects whose name starts with `prefix`, in allocation order. */
  attempts(prefix?: string): readonly IAttemptRow[];
  /** The fences that published results of `subject` in `environment`, in publication order, in the scenario's (or another) History file. */
  publications(subject: string, environment?: string, file?: string): readonly number[];
  /** Accounting's summary of one environment, read through its durable adapter over the scenario's (or another) Accounting file. */
  usage(environment?: string, file?: string): IUsageSummaryJson;
  /** Wait until the stored writer lease has expired by real time, with a margin. */
  outlastLease(margin?: number): Promise<void>;
  /** Kill every background worker still running, so a failed case never leaves a process holding the test runner open, then remove the directory. */
  remove(): void;
}

/** Parse every JSON line of a worker's output. */
function parse(stdout: string): Readonly<Record<string, unknown>>[] {
  return stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => {
    // Lines are written by the worker as JSON objects.
    return JSON.parse(line) as Readonly<Record<string, unknown>>;
  });
}

/** Whether a parsed line is the worker's result line, which it writes from an IResultJson value. */
function isResultLine(line: Readonly<Record<string, unknown>>): line is Readonly<Record<string, unknown>> & IResultJson {
  return line['t'] === 'result' && typeof line['runId'] === 'string' && typeof line['members'] === 'object';
}

/** The compact form of one operation event. */
function operationLine(event: IEventJson): string {
  const status = event['status'];
  const reason = event['reason'];
  const member = event['member'];
  return `${String(event['phase'])}${typeof status === 'string' ? `:${status}` : ''}${typeof reason === 'string' ? `:${reason}` : ''}@${typeof member === 'string' ? member : '-'}`;
}

/** Build the parsed view of one finished worker. */
function processRun(status: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string): IProcessRun {
  const lines = parse(stdout);
  const resultLine = lines.find(isResultLine);
  const error = lines.find((line) => line['t'] === 'error');
  const events = lines.filter((line) => line['t'] === 'event');
  return {
    status,
    signal,
    stdout,
    stderr,
    lines,
    get result(): IResultJson {
      if (resultLine === undefined) {
        throw new Error(`the process (${String(status)}/${String(signal)}) produced no result: ${JSON.stringify(error)} ${stderr}`);
      }
      return resultLine;
    },
    error,
    events,
    operations: events.filter((event) => event['kind'] === 'operation').map(operationLine),
    assessed: lines.filter((line) => line['t'] === 'trace' && line['helper'] === 'assess').map((line) => String(line['key'])),
  };
}

/** Read rows with a short-lived raw connection; the parent never writes. */
function query(location: string, statement: string): readonly Readonly<Record<string, unknown>>[] {
  const connection = createNodeSqlite().openSqlite(location);
  try {
    return connection.prepare(statement).all();
  } finally {
    connection.close();
  }
}

/** A nullable integer cell. */
function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Wait `milliseconds` of real time. */
export function elapse(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Poll until `condition` holds, failing with `description` after `timeout` milliseconds. */
export async function until(condition: () => boolean, description: string, timeout = 20_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting until ${description}`);
    }
    await elapse(10);
  }
}

/** Create a scenario directory. */
export function scenario(): IScenario {
  const directory = mkdtempSync(join(tmpdir(), 'microdelta-m5-acceptance-'));
  const location = join(directory, 'history.sqlite');
  const accounting = join(directory, 'accounting.sqlite');
  const provider = join(directory, 'provider');
  const worldFile = join(directory, 'world.json');
  mkdirSync(join(provider, 'gates'), { recursive: true });
  /** Background workers that have not exited yet. */
  const running = new Set<ReturnType<typeof spawn>>();
  const jobOf = (command: ICommand, options: IJobOptions): IJob => ({
    location,
    accounting,
    logicalStore,
    world: worldFile,
    provider,
    environment: production,
    command,
    ...options,
  });
  const writer = (): IWriterRow => {
    const [row] = query(location, 'SELECT last_fence, holder, expires_at FROM history_writer WHERE singleton = 1');
    if (row === undefined) {
      throw new Error('the store has no writer row');
    }
    return { lastFence: Number(row['last_fence']), holder: typeof row['holder'] === 'string' ? row['holder'] : null, expiresAt: Number(row['expires_at']) };
  };
  const attempts = (prefix = ''): readonly IAttemptRow[] => query(location, 'SELECT subject, environment, state, allocated_fence, ended_fence FROM history_attempts ORDER BY attempt_id')
    .filter((row) => String(row['subject']).startsWith(prefix))
    .map((row) => ({ subject: String(row['subject']), environment: String(row['environment']), state: String(row['state']), allocatedFence: Number(row['allocated_fence']), endedFence: nullableNumber(row['ended_fence']) }));
  return {
    directory,
    location,
    accounting,
    provider,
    writeWorld(world) {
      writeFileSync(worldFile, `${JSON.stringify(world, null, 2)}\n`);
    },
    run(command, options = {}, timeoutMilliseconds = 90_000) {
      const spawned = spawnSync(process.execPath, [worker, JSON.stringify(jobOf(command, options))], { encoding: 'utf8', timeout: timeoutMilliseconds });
      return processRun(spawned.status, spawned.signal, spawned.stdout, spawned.stderr);
    },
    start(command, options = {}) {
      const child = spawn(process.execPath, [worker, JSON.stringify(jobOf(command, options))], { stdio: ['ignore', 'pipe', 'pipe'] });
      running.add(child);
      let stdout = '';
      let stderr = '';
      let exitedYet = false;
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const exited = new Promise<IProcessRun>((resolve) => {
        child.on('close', (status, signal) => {
          running.delete(child);
          exitedYet = true;
          resolve(processRun(status, signal, stdout, stderr));
        });
      });
      return {
        get lines() {
          return parse(stdout);
        },
        get exitedYet() {
          return exitedYet;
        },
        async waitForLine(predicate, description, timeout = 20_000) {
          await until(() => parse(stdout).some(predicate) || exitedYet, description, timeout);
          if (!parse(stdout).some(predicate)) {
            throw new Error(`the process exited before ${description}: ${stdout} ${stderr}`);
          }
        },
        kill(signal) {
          child.kill(signal);
        },
        exited,
      };
    },
    open(gate) {
      writeFileSync(gateFile(provider, gate), '');
    },
    ledger: () => readLedger(provider),
    keys: (kind) => readLedger(provider).filter((entry) => entry.kind === kind).map((entry) => entry.key),
    writer,
    rows() {
      return {
        writer: writer(),
        // Every table the store holds, read from SQLite's own catalog, so a table added to History's schema is compared too.
        tables: Object.fromEntries(query(location, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((entry) => String(entry['name'])).map((table) => [table, query(location, `SELECT * FROM ${table}`)
          .map((row) => JSON.stringify(table === 'history_writer' ? { ...row, time_high_water: undefined } : row))
          .sort()])),
        attempts: attempts().map((row) => `${row.subject} ${row.environment} ${row.state} ${String(row.allocatedFence)} ${String(row.endedFence)}`),
        results: query(location, 'SELECT result_id, subject, environment, published_fence FROM history_results ORDER BY result_id').map((row) => `${String(row['result_id'])} ${String(row['subject'])} ${String(row['environment'])} ${String(row['published_fence'])}`),
        journal: query(location, 'SELECT sequence, collection, journal_key, revision, fence FROM history_journal ORDER BY sequence').map((row) => `${String(row['sequence'])} ${String(row['collection'])} ${String(row['journal_key'])} r${String(row['revision'])} ${String(row['fence'])}`),
        acceptances: query(location, 'SELECT acceptance_id, result_id, environment, fence FROM history_acceptances ORDER BY acceptance_id').map((row) => `${String(row['acceptance_id'])} ${String(row['result_id'])} ${String(row['environment'])} ${String(row['fence'])}`),
        promotions: query(location, 'SELECT promotion_id, environment, fence FROM history_promotions ORDER BY promotion_id').map((row) => `${String(row['promotion_id'])} ${String(row['environment'])} ${String(row['fence'])}`),
      };
    },
    attempts,
    publications(subject, environment = production, file = location) {
      return query(file, 'SELECT subject, environment, published_fence FROM history_results ORDER BY publication')
        .filter((row) => row['subject'] === subject && row['environment'] === environment)
        .map((row) => Number(row['published_fence']));
    },
    usage(environment = production, file = accounting) {
      const adapter = openDurableAccounting({ sqlite: createNodeSqlite(), location: file, logicalStore });
      try {
        return adapter.summarizeUsage({ environment });
      } finally {
        adapter.close();
      }
    },
    async outlastLease(margin = 50) {
      const { expiresAt } = writer();
      await until(() => Date.now() >= expiresAt + margin, `the writer lease expiring at ${String(expiresAt)} has expired`);
    },
    remove(): void {
      for (const child of running) {
        child.kill('SIGKILL');
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
