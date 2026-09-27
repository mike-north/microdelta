/**
 * Fresh processes run fixed protocol scenarios and expose only JSON state traces.
 * SIGKILL cases intentionally bypass JavaScript cleanup to exercise SQLite recovery.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { createPublicationRepository, type IAttempt } from '../src/index.js';
import { openNodeSqlite, type INodeSqliteDatabase } from './node-sqlite.js';
import type { ISqliteCapability } from '../src/sqlite.js';

/** @internal One writer owns fixture changes at each controlled event time. */
interface IWorkerWriter {
  readonly holderId: string;
  readonly fencingToken: number;
}

/** @internal A worker command selects one reproducible lifecycle boundary. */
const [databasePath, command, ...args] = process.argv.slice(2);

if (databasePath === undefined || command === undefined) {
  throw new Error('worker requires a database path and command');
}

/** @internal The driver owns durability settings and native file lifetime for this process. */
const database = openNodeSqlite(databasePath);
/** @internal Each scenario exercises the candidate through its narrow repository contract. */
const repository = createPublicationRepository(database);
repository.initialize();

switch (command) {
  case 'seed-old': {
    const writer = acquire(database, 'seed', 0);
    const attempt = allocate(writer, 'seed-old', 0);
    stage(writer, attempt, '{"value":"old"}', 0);
    repository.publishAttempt({ ...writer, attemptId: attempt.attemptId, nowMs: 0 });
    repository.releaseWriter({ ...writer, nowMs: 0 });
    break;
  }
  case 'acquire-then-kill': {
    acquire(database, 'interrupted', 10);
    terminateProcess();
    break;
  }
  case 'allocate-then-kill': {
    const writer = acquire(database, 'interrupted', 10);
    allocate(writer, 'interrupted-allocation', 10);
    terminateProcess();
    break;
  }
  case 'allocate-before-commit-then-kill': {
    const writer = acquire(database, 'interrupted', 10);
    createPublicationRepository(killBeforeTransactionCommit(database)).allocateAttempt({
      ...writer,
      attemptKey: 'interrupted-allocation',
      subjectKey: 'subject',
      nowMs: 10,
    });
    break;
  }
  case 'stage-then-kill': {
    const writer = acquire(database, 'interrupted', 10);
    const attempt = allocate(writer, 'interrupted-stage', 10);
    stage(writer, attempt, '{"value":"incomplete"}', 10);
    terminateProcess();
    break;
  }
  case 'stage-before-commit-then-kill': {
    const writer = acquire(database, 'interrupted', 10);
    const attempt = allocate(writer, 'interrupted-stage', 10);
    createPublicationRepository(killBeforeTransactionCommit(database)).stageAttempt({
      ...writer,
      attemptId: attempt.attemptId,
      payloadJson: '{"value":"incomplete"}',
      fingerprint: 'fixture-fingerprint',
      provenanceJson: '{"producer":"crash-worker"}',
      nowMs: 10,
    });
    break;
  }
  case 'stage-stable-key-then-kill': {
    const bodyCounterPath = args[0];
    if (bodyCounterPath === undefined) {
      throw new Error('staged recovery setup requires its body-call counter path');
    }
    const writer = acquire(database, 'interrupted', 10);
    const attempt = allocate(writer, 'stable-recovery-key', 10);
    // This marker records the original candidate computation; takeover must not repeat it.
    appendFileSync(bodyCounterPath, 'body\n', 'utf8');
    repository.stageAttempt({
      ...writer,
      attemptId: attempt.attemptId,
      payloadJson: '{"value":"retained-candidate"}',
      fingerprint: 'retained-fingerprint',
      provenanceJson: '{"producer":"staged-recovery"}',
      nowMs: 10,
    });
    terminateProcess();
    break;
  }
  case 'publish-staged-stable-key': {
    const bodyCounterPath = args[0];
    if (bodyCounterPath === undefined) {
      throw new Error('staged recovery requires its body-call counter path');
    }
    const prior = repository.findAttempt('stable-recovery-key');
    if (prior === null || prior.state !== 'staged') {
      throw new Error('expected staged stable-key attempt after reopen');
    }
    const priorWriter = repository.currentWriter();
    if (priorWriter === null) {
      throw new Error('expected the prior writer lease to remain until expiry');
    }
    const writer = acquire(database, 'staged-recovery', 20);
    const rebound = repository.allocateAttempt({
      ...writer,
      attemptKey: 'stable-recovery-key',
      subjectKey: 'subject',
      nowMs: 20,
    });
    let staleAuthorityRejected = false;
    try {
      repository.publishAttempt({
        ...priorWriter, attemptId: prior.attemptId, nowMs: 20,
      });
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.message !== 'stale writer fence') {
        throw error;
      }
      staleAuthorityRejected = true;
    }
    const reference = repository.publishAttempt({
      ...writer, attemptId: rebound.attemptId, nowMs: 20,
    });
    process.stdout.write(`${JSON.stringify({
      prior,
      rebound,
      staleAuthorityRejected,
      result: repository.readResult(reference),
      current: repository.readCurrent('subject'),
      bodyMarkerPresent: existsSync(bodyCounterPath),
    })}\n`);
    break;
  }
  case 'publish-before-commit-then-kill': {
    const writer = acquire(database, 'interrupted', 10);
    const attempt = allocate(writer, 'interrupted-publication', 10);
    stage(writer, attempt, '{"value":"unpublished"}', 10);
    const crashAtCommit = killBeforeTransactionCommit(database);
    createPublicationRepository(crashAtCommit).publishAttempt({
      ...writer,
      attemptId: attempt.attemptId,
      nowMs: 10,
    });
    break;
  }
  case 'execute-and-kill-after-commit': {
    const counterPath = args[0];
    if (counterPath === undefined) {
      throw new Error('execute command requires its body-call counter path');
    }
    const writer = acquire(database, 'lost-ack', 0);
    executeOnce(writer, counterPath, 0);
    terminateProcess();
    break;
  }
  case 'execute-once': {
    const counterPath = args[0];
    if (counterPath === undefined) {
      throw new Error('execute command requires its body-call counter path');
    }
    const prior = repository.findAttempt('stable-recovery-key');
    if (prior?.state === 'completed' && prior.resultReference !== null) {
      process.stdout.write(`${JSON.stringify({ reused: true, reference: prior.resultReference })}\n`);
      break;
    }
    const writer = acquire(database, 'retry', 10);
    const result = executeOnce(writer, counterPath, 10);
    process.stdout.write(`${JSON.stringify({ reused: false, reference: result })}\n`);
    break;
  }
  case 'inspect': {
    const current = repository.readCurrent('subject');
    const latestAttempt: IAttempt | null = repository.readAttempt('subject:2');
    process.stdout.write(`${JSON.stringify({ current, latestAttempt })}\n`);
    break;
  }
  default: {
    throw new Error(`unknown worker command: ${command}`);
  }
}

database.close();

/** @internal The worker uses explicit logical time to make lease expiry reproducible. */
function acquire(
  db: INodeSqliteDatabase,
  holderId: string,
  nowMs: number,
): IWorkerWriter {
  const result = createPublicationRepository(db).acquireWriter({ holderId, nowMs, leaseMs: 5 });
  if (result.kind !== 'acquired') {
    throw new Error(`writer already held by ${result.holderId}`);
  }
  return { holderId, fencingToken: result.fencingToken };
}

/** @internal The stable key remains the recovery locator if an acknowledgment is lost. */
function allocate(writer: IWorkerWriter, attemptKey: string, nowMs: number): IAttempt {
  return repository.allocateAttempt({
    ...writer,
    attemptKey,
    subjectKey: 'subject',
    nowMs,
  });
}

/** @internal Candidate bytes remain staged until the atomic snapshot/pointer commit. */
function stage(writer: IWorkerWriter, attempt: IAttempt, payloadJson: string, nowMs: number): void {
  repository.stageAttempt({
    ...writer,
    attemptId: attempt.attemptId,
    payloadJson,
    fingerprint: 'fixture-fingerprint',
    provenanceJson: '{"producer":"crash-worker"}',
    nowMs,
  });
}

/** @internal Test-only execution appends a body marker only when the attempt is not complete. */
function executeOnce(writer: IWorkerWriter, counterPath: string, nowMs: number) {
  const prior = repository.findAttempt('stable-recovery-key');
  if (prior?.state === 'completed' && prior.resultReference !== null) {
    return prior.resultReference;
  }
  const attempt = prior ?? allocate(writer, 'stable-recovery-key', nowMs);
  appendFileSync(counterPath, 'body\n', 'utf8');
  stage(writer, attempt, '{"value":"completed"}', nowMs);
  return repository.publishAttempt({ ...writer, attemptId: attempt.attemptId, nowMs });
}

/** @internal Interrupts the process without allowing close hooks to hide persistent state. */
function terminateProcess(): never {
  process.kill(process.pid, 'SIGKILL');
  throw new Error('SIGKILL returned unexpectedly');
}

/**
 * @internal
 * Kills after a repository operation's SQL callback but before SQLite commits,
 * so independent child cases can probe transaction rollback at different states.
 */
function killBeforeTransactionCommit(databaseToWrap: INodeSqliteDatabase): ISqliteCapability {
  return {
    exec: (sql) => databaseToWrap.exec(sql),
    queryOne: (sql, parameters) => databaseToWrap.queryOne(sql, parameters),
    queryAll: (sql, parameters) => databaseToWrap.queryAll(sql, parameters),
    prepare: (sql) => databaseToWrap.prepare(sql),
    transaction: <T>(operation: () => T): T => databaseToWrap.transaction(() => {
      operation();
      terminateProcess();
    }),
  };
}
