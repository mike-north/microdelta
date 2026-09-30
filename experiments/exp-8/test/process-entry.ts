/**
 * EXP-8's Node-only process driver. Each invocation is one separate OS
 * process: it loads the store and the fake provider's ledger from files,
 * rebuilds the members from scratch, runs one pass on a fake clock that starts
 * at the stage's time, and writes a JSON report to stdout. Kill points send
 * SIGKILL to this process immediately before or after a named commit boundary,
 * or right after the provider applies an effect. The JSON files exist only to
 * force the process boundary: they are not a selected History schema and make
 * no atomicity, power-loss or concurrency claim beyond whole-file rename.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { StopController, Store, emptyState, isData, parseState, runPass, summarizeUsage } from '../src/protocol.js';
import type {
  ICommitBoundary,
  IDurablePort,
  IDurableState,
  IMemberDeclaration,
  IProviderRequest,
  IRemoteCancel,
  IWaitMode,
} from '../src/protocol.js';
import {
  FakeClock,
  FakeProvider,
  HOUR,
  T0,
  baseScript,
  cancelMember,
  emptyLedger,
  leaseTtlMs,
  okMember,
  quotaAt,
  quotaMember,
  secrets,
} from './fakes.js';
import type { ILedger, IScript } from './fakes.js';

/** Where a stage kills itself: at a commit boundary, or just after the provider applies an effect. */
type IKillPoint =
  | { readonly boundary: ICommitBoundary; readonly when: 'before' | 'after'; readonly subject: string }
  | { readonly afterApply: string };

/** One process's configuration within a scenario. */
interface IStage {
  readonly start: number;
  readonly waitMode: IWaitMode;
  readonly kill?: IKillPoint;
  readonly probeOnSleep?: boolean;
  readonly throwingObserver?: boolean;
  readonly presenterThrows?: boolean;
}

/** An operator acting on receipt of the n-th request of a name (n counts across processes). */
type IOperator = (request: IProviderRequest, index: number, stop: StopController, provider: FakeProvider) => void;

/** A scenario: the same members, script and operator in every stage. */
interface IScenario {
  readonly members: () => readonly IMemberDeclaration[];
  readonly script: IScript;
  readonly idempotencyKeys?: boolean;
  readonly cancelAnswer?: IRemoteCancel | 'unsupported';
  readonly operator?: IOperator;
  readonly stages: Readonly<Partial<Record<'A' | 'B' | 'C', IStage>>>;
}

/** Run an operator action after the provider has returned its pending promise. */
function later(action: () => void): void {
  void Promise.resolve().then(action);
}

const baseMembers = (): readonly IMemberDeclaration[] => [okMember(), quotaMember(), cancelMember()];
const onlyOk = (): readonly IMemberDeclaration[] => [okMember()];
const afterward: IStage = { start: T0 + HOUR, waitMode: 'exit' };
const fresh: IStage = { start: T0, waitMode: 'exit' };
const summarizeOnce: IScript = { summarize: [{ kind: 'ok' }] };

/** Hard-cancel only the in-flight member, on the first `generate` ever received. */
const cancelGenerate: IOperator = (request, index, stop) => {
  if (request.name === 'generate' && index === 0) {
    stop.request({ level: 'hard', member: 'm-cancel' });
  }
};

const scenarios: Readonly<Record<string, IScenario>> = {
  'quota-exit': {
    members: baseMembers,
    script: baseScript(),
    operator: cancelGenerate,
    stages: { A: fresh, B: afterward, C: { start: quotaAt + 60_000, waitMode: 'exit' } },
  },
  'quota-sleep': {
    members: () => [okMember(), quotaMember()],
    script: baseScript(),
    stages: { A: { start: T0, waitMode: 'sleep', probeOnSleep: true } },
  },
  'soft-then-hard': {
    members: baseMembers,
    script: baseScript(),
    cancelAnswer: 'unsupported',
    operator: (request, index, stop) => {
      if (request.name === 'generate' && index === 0) {
        stop.request({ level: 'soft' });
        later(() => {
          stop.request({ level: 'hard' });
        });
      }
    },
    stages: { A: fresh, B: afterward },
  },
  'soft-drain': {
    members: baseMembers,
    script: baseScript(),
    operator: (request, index, stop, provider) => {
      if (request.name === 'generate' && index === 0) {
        stop.request({ level: 'soft' });
        later(() => {
          provider.release('generate');
        });
      }
    },
    stages: { A: fresh, B: afterward },
  },
  'kill-after-intent': {
    members: onlyOk,
    script: summarizeOnce,
    stages: { A: { ...fresh, kill: { boundary: 'operation-intent', when: 'after', subject: 'm-ok' } }, B: afterward },
  },
  'kill-after-send': {
    members: onlyOk,
    script: summarizeOnce,
    stages: { A: { ...fresh, kill: { afterApply: 'summarize' } }, B: afterward },
  },
  'kill-after-usage': {
    members: onlyOk,
    script: summarizeOnce,
    stages: { A: { ...fresh, kill: { boundary: 'usage-acknowledged', when: 'after', subject: 'm-ok' } }, B: afterward },
  },
  'kill-before-publication': {
    members: onlyOk,
    script: summarizeOnce,
    stages: { A: { ...fresh, kill: { boundary: 'publication', when: 'before', subject: 'm-ok' } }, B: afterward },
  },
  'kill-after-publication': {
    members: onlyOk,
    script: summarizeOnce,
    stages: { A: { ...fresh, kill: { boundary: 'publication', when: 'after', subject: 'm-ok' } }, B: afterward },
  },
  'observer-presenter-throw': {
    members: onlyOk,
    script: summarizeOnce,
    stages: { A: { ...fresh, throwingObserver: true, presenterThrows: true }, B: afterward },
  },
  'duplicate-delivery': {
    members: onlyOk,
    script: { summarize: [{ kind: 'ok', late: 'duplicate', lateAt: T0 + 30 * 60_000 }] },
    stages: { A: fresh, B: afterward },
  },
  'lost-response-mutation': {
    members: () => [okMember({ retry: { maxAttempts: 3, backoffMs: 0 } })],
    script: { summarize: [{ kind: 'lost' }, { kind: 'ok' }] },
    stages: { A: fresh, B: afterward },
  },
  'safe-repeat-after-send': {
    members: () => [okMember({ safeToRepeat: true, retry: { maxAttempts: 2, backoffMs: 0 } })],
    script: { summarize: [{ kind: 'ok' }, { kind: 'ok' }] },
    stages: { A: { ...fresh, kill: { afterApply: 'summarize' } }, B: afterward },
  },
  'idempotent-after-send': {
    members: () => [okMember({ retry: { maxAttempts: 2, backoffMs: 0 } })],
    script: { summarize: [{ kind: 'ok' }, { kind: 'ok' }] },
    idempotencyKeys: true,
    stages: { A: { ...fresh, kill: { afterApply: 'summarize' } }, B: afterward },
  },
};

/** Terminate this process at once, as a crash would; nothing after this runs. */
function die(): never {
  process.kill(process.pid, 'SIGKILL');
  for (;;) {
    // SIGKILL is delivered before control could return here.
  }
}

/** A whole-file JSON port. Writes go to a temporary file then rename over the store. */
class FilePort implements IDurablePort {
  constructor(
    private readonly file: string,
    private readonly kill: IKillPoint | undefined,
  ) {}

  load(): IDurableState {
    if (!existsSync(this.file)) {
      return emptyState();
    }
    const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
    return parseState(parsed);
  }

  private killsAt(boundary: ICommitBoundary, when: 'before' | 'after', subject: string | null): boolean {
    const kill = this.kill;
    return kill !== undefined && 'boundary' in kill && kill.boundary === boundary && kill.when === when && kill.subject === subject;
  }

  commit(boundary: ICommitBoundary, state: IDurableState, subject: string | null): void {
    if (this.killsAt(boundary, 'before', subject)) {
      die();
    }
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, this.file);
    if (this.killsAt(boundary, 'after', subject)) {
      die();
    }
  }
}

/** Narrow an untrusted record. */
function fields(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid EXP-8 provider ledger');
  }
  return Object.fromEntries(Object.entries(value));
}

function items(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Invalid EXP-8 provider ledger list');
  }
  const list: readonly unknown[] = value;
  return list;
}

function str(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid EXP-8 provider ledger text');
  }
  return value;
}

function num(value: unknown): number {
  if (typeof value !== 'number') {
    throw new TypeError('Invalid EXP-8 provider ledger number');
  }
  return value;
}

function numbers(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(fields(value)).map(([key, entry]) => [key, num(entry)]));
}

/** Read the provider's ledger written by an earlier process, or start empty. */
function loadLedger(file: string): ILedger {
  if (!existsSync(file)) {
    return emptyLedger();
  }
  const root = fields(JSON.parse(readFileSync(file, 'utf8')));
  const ids = (entry: unknown): { operationId: string; requestAttemptId: string } => {
    const record = fields(entry);
    return { operationId: str(record.operationId), requestAttemptId: str(record.requestAttemptId) };
  };
  return {
    calls: numbers(root.calls),
    received: items(root.received).map(entry => {
      const record = fields(entry);
      const binding: unknown = record.binding;
      if (!isData(binding)) {
        throw new TypeError('Invalid EXP-8 received binding');
      }
      return { ...ids(entry), name: str(record.name), at: num(record.at), binding };
    }),
    applied: items(root.applied).map(entry => ({ ...ids(entry), name: str(fields(entry).name) })),
    cancels: items(root.cancels).map(str),
    late: items(root.late).map(entry => {
      const record = fields(entry);
      const report = fields(record.report);
      return { ...ids(entry), deliverAt: num(record.deliverAt), report: { reportId: str(report.reportId), quantities: numbers(report.quantities) } };
    }),
  };
}

/** Write a line synchronously: an asynchronous pipe write could be lost when the process then fails. */
function emit(value: unknown): void {
  writeSync(1, `${JSON.stringify(value)}\n`);
}

/** A separate process that tries to take and give back the writer lease while this one sleeps. */
function probe(directory: string, time: number): unknown {
  const entry = fileURLToPath(import.meta.url);
  const child = spawnSync(process.execPath, [entry, directory, 'probe', String(time)], { encoding: 'utf8' });
  const output: unknown = JSON.parse(child.stdout);
  return output;
}

/** The lease probe stage: acquire and release through the same store candidate. */
function runProbe(directory: string, time: number): void {
  const port = new FilePort(path.join(directory, 'store.json'), undefined);
  const holderBefore = port.load().lease.holder;
  const store = new Store(port, leaseTtlMs);
  const result = store.acquire(null, time);
  if (result.status === 'acquired') {
    store.release(time);
  }
  emit({ holderBefore, status: result.status, fence: result.status === 'acquired' ? result.fence : null });
}

/** One scenario stage in this process. */
async function runStage(directory: string, scenarioName: string, stageName: 'A' | 'B' | 'C'): Promise<void> {
  const scenario = scenarios[scenarioName];
  const stage = scenario?.stages[stageName];
  if (scenario === undefined || stage === undefined) {
    throw new TypeError(`Unknown EXP-8 scenario stage ${scenarioName} ${stageName}`);
  }
  const storeFile = path.join(directory, 'store.json');
  const ledgerFile = path.join(directory, 'provider.json');
  const clock = new FakeClock(stage.start);
  const stop = new StopController();
  const kill = stage.kill;
  const probes: unknown[] = [];
  if (stage.probeOnSleep === true) {
    clock.onSleep = () => {
      probes.push(probe(directory, clock.now()));
    };
  }
  const provider: FakeProvider = new FakeProvider(scenario.script, {
    clock,
    ledger: loadLedger(ledgerFile),
    ...(scenario.idempotencyKeys === undefined ? {} : { idempotencyKeys: scenario.idempotencyKeys }),
    ...(scenario.cancelAnswer === undefined ? {} : { cancelAnswer: scenario.cancelAnswer }),
    onChange: ledger => {
      writeFileSync(ledgerFile, JSON.stringify(ledger));
    },
    onReceive: (request, index) => {
      scenario.operator?.(request, index, stop, provider);
    },
    onApplied: (request, index) => {
      if (kill !== undefined && 'afterApply' in kill && kill.afterApply === request.name && index === 0) {
        die();
      }
    },
  });
  const port = new FilePort(storeFile, kill);
  const report = await runPass({
    store: new Store(port, leaseTtlMs),
    clock,
    provider,
    members: scenario.members(),
    stop,
    waitMode: stage.waitMode,
    ...(stage.throwingObserver === true ? { observers: [() => {
      throw new Error(secrets.error);
    }] } : {}),
  });
  emit({
    ...report,
    usage: summarizeUsage(port.load(), clock.now()),
    provider: {
      calls: provider.ledger.calls,
      applied: provider.ledger.applied,
      cancels: provider.ledger.cancels,
      received: provider.ledger.received.map(({ operationId, requestAttemptId, name, at }) => ({ operationId, requestAttemptId, name, at })),
    },
    sleeps: clock.sleeps,
    probes,
  });
  if (stage.presenterThrows === true) {
    throw new Error('presentation failed after the report was committed');
  }
}

/** Entry: `process-entry.js <dir> <scenario> A|B|C` or `process-entry.js <dir> probe <time>`. */
async function main(): Promise<void> {
  const [, , directory, scenario, stage] = process.argv;
  if (directory === undefined || scenario === undefined || stage === undefined) {
    throw new TypeError('Use process-entry.js <dir> <scenario> A|B|C, or <dir> probe <time>');
  }
  if (scenario === 'probe') {
    runProbe(directory, Number(stage));
    return;
  }
  if (stage !== 'A' && stage !== 'B' && stage !== 'C') {
    throw new TypeError(`Unknown stage ${stage}`);
  }
  await runStage(directory, scenario, stage);
}

await main();
