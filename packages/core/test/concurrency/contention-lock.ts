/**
 * C3's lock seam: one separate SQLite process confirms `BEGIN IMMEDIATE`
 * before the supervised worker resumes. This helper owns that child's full
 * lifecycle so every startup, callback, and release outcome is bounded and
 * cannot leave a worker retaining the shared write lock.
 * @packageDocumentation
 */
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Failure modes used only to prove that the lock helper cleans up its process. */
export type IContentionLockScenario =
  | 'no-ready'
  | 'unexpected-ready'
  | 'exit-before-ready'
  | 'ignore-release'
  | 'exit-nonzero-after-release'
  | 'signal-after-release';

/** Narrow test seams for exercising bounded helper failures without delaying normal C3 runs. */
export interface IContentionLockOptions {
  readonly scenario?: IContentionLockScenario;
  readonly timeoutMilliseconds?: number;
}

/** Process termination facts retained so cleanup can distinguish orderly release from failure. */
interface IChildExitStatus {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Children remain here until exit has been observed, for cleanup assertions. */
const activeChildren = new Set<ChildProcess>();

/** Number of C3 lock children not yet observed exiting. */
export function activeContentionLockCount(): number {
  return activeChildren.size;
}

const ordinaryWorker = fileURLToPath(new URL('./history-busy-lock.js', import.meta.url));
const scenarioWorker = fileURLToPath(new URL('./contention-lock-scenario.js', import.meta.url));

/** Rejects with a bounded diagnostic if the child has not exited by `timeoutMilliseconds`. */
async function waitForExit(exit: Promise<IChildExitStatus>, timeoutMilliseconds: number, reason: string): Promise<IChildExitStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exit,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(reason)), timeoutMilliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) { clearTimeout(timer); }
  }
}

/** Waits for the exact lock-ready marker and distinguishes timeout, wrong message, and early exit. */
function waitForLockReady(child: ChildProcess, timeoutMilliseconds: number, diagnostic: () => string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error === undefined) { resolve(); } else { reject(error); }
    };
    const onMessage = (message: unknown): void => {
      if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'locked') {
        finish();
      } else {
        finish(new Error(`lock holder sent an unexpected readiness message: ${String(message)}`));
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(`lock holder ended before readiness (${String(code)}/${String(signal)}): ${diagnostic()}`));
    };
    const timer = setTimeout(() => finish(new Error(`lock holder did not establish the SQLite write lock: ${diagnostic()}`)), timeoutMilliseconds);
    child.once('message', onMessage);
    child.once('exit', onExit);
  });
}

/** Release a ready lock holder and wait for its orderly exit within the same bound. */
function requestRelease(child: ChildProcess, timeoutMilliseconds: number, diagnostic: () => string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`lock holder did not release the SQLite write lock: ${diagnostic()}`));
    }, timeoutMilliseconds);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timer);
      if (code === 0 && signal === null) {
        resolve();
      } else {
        reject(new Error(`lock holder ended ${String(code)}/${String(signal)} after release: ${diagnostic()}`));
      }
    };
    child.once('exit', onExit);
    try {
      child.send({ kind: 'release' }, (error) => {
        if (error !== null) {
          clearTimeout(timer);
          child.off('exit', onExit);
          reject(new Error(`could not request lock release: ${error.message}`));
        }
      });
    } catch (error: unknown) {
      clearTimeout(timer);
      child.off('exit', onExit);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/**
 * Start the real lock-holder process, invoke `operation` only after lock
 * readiness, and release/reap the child on success and every failure path.
 * Scenario modes and shorter bounds are restricted to this harness's cleanup tests.
 */
export async function withIndependentWriteLock<T>(
  location: string,
  operation: () => Promise<T>,
  options: IContentionLockOptions = {},
): Promise<T> {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;
  const worker = options.scenario === undefined ? ordinaryWorker : scenarioWorker;
  const args = options.scenario === undefined ? [location] : [location, options.scenario];
  const child = fork(worker, args, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  activeChildren.add(child);
  let diagnosticText = '';
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { diagnosticText += chunk; });
  const diagnostic = (): string => diagnosticText || 'no worker diagnostics';
  const exit = new Promise<IChildExitStatus>((resolve) => {
    child.once('exit', (code, signal) => { resolve({ code, signal }); });
  });
  let exited = false;
  void exit.then(() => { exited = true; });
  let ready = false;
  let releaseFailed = false;
  let hasOriginalFailure = false;
  try {
    await waitForLockReady(child, timeoutMilliseconds, diagnostic);
    ready = true;
    const result = await operation();
    try {
      await requestRelease(child, timeoutMilliseconds, diagnostic);
    } catch (error: unknown) {
      releaseFailed = true;
      throw error;
    }
    return result;
  } catch (error: unknown) {
    hasOriginalFailure = true;
    throw error;
  } finally {
    let cleanupFailure: Error | undefined;
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (ready && !releaseFailed && child.connected) {
          try { child.send({ kind: 'release' }); } catch { /* A bounded SIGKILL below still reaps the child. */ }
        }
        await waitForExit(exit, timeoutMilliseconds, 'lock child did not exit after release');
      } catch (error: unknown) {
        child.kill('SIGKILL');
        try {
          await waitForExit(exit, 10_000, 'lock child could not be reaped after SIGKILL');
        } catch (reapError: unknown) {
          cleanupFailure = reapError instanceof Error ? reapError : new Error(String(reapError));
        }
        if (cleanupFailure === undefined && error instanceof Error) { cleanupFailure = error; }
      }
    }
    if (exited) { activeChildren.delete(child); }
    if (cleanupFailure !== undefined && !hasOriginalFailure) { throw cleanupFailure; }
  }
}
