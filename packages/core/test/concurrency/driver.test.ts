/**
 * How the concurrency driver decides that a worker died. A child process's
 * `exit` event can be emitted before the parent has read the last messages the
 * child wrote to its IPC channel. Linux Node 20 did this in the full suite when
 * four workers closed at once: a worker answered `close`, disconnected and
 * exited 0, and the driver, deciding at `exit`, misreported the answered
 * `close` as an unexpected death. `close` is emitted only after the child's
 * IPC channel and stdio have closed, so the driver decides there. These cases
 * drive the driver's event handling with a scripted child, emitting events in
 * exactly the orders that matter, so they do not depend on platform timing.
 *
 * @see https://nodejs.org/api/child_process.html#event-close
 * @see https://nodejs.org/api/child_process.html#event-exit
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, test } from '@jest/globals';

import { attachWorker } from './driver.js';
import type { IWorkerHandle, IWorkerProcess } from './driver.js';
import { lifecyclePrefix } from './protocol.js';
import type { IHarnessCommand } from './protocol.js';

/** A child process whose events the test emits by hand. */
class ScriptedChild extends EventEmitter implements IWorkerProcess {
  public connected = true;
  public readonly stderr = new PassThrough();
  public readonly sent: IHarnessCommand[] = [];

  public send(message: IHarnessCommand): boolean {
    this.sent.push(message);
    return true;
  }

  /** Emit a message from the child, as its IPC channel would. */
  public answer(message: unknown): void {
    this.emit('message', message);
  }

  /** Write one lifecycle marker to the child's stderr. */
  public async mark(point: string): Promise<void> {
    await new Promise<void>((resolve) => {
      this.stderr.write(`${lifecyclePrefix}${point}\n`, () => {
        resolve();
      });
    });
    // Let the driver's data listener run.
    await new Promise((resolve) => setImmediate(resolve));
  }

  /** The child's process has ended. */
  public exited(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.connected = false;
    this.emit('exit', code, signal);
  }

  /** The child's stdio and IPC channel have closed. */
  public closed(code: number | null): void {
    this.emit('close', code, null);
  }
}

/** Attach the driver to a scripted child and complete its start-up. */
async function started(child: ScriptedChild): Promise<IWorkerHandle> {
  const handle = attachWorker('scripted', child);
  child.answer({ ready: true });
  return handle;
}

/** A successful reply as a worker sends it. */
const okReply = { ok: true, value: null, startedAt: 1, endedAt: 2 } as const;

describe('the driver decides a worker died only once its channel has closed', () => {
  test('an answer read after the exit event still resolves the pending step (the Linux Node 20 close race)', async () => {
    const child = new ScriptedChild();
    const handle = await started(child);
    const closing = handle.close();
    child.exited(0);
    child.answer(okReply);
    child.closed(0);
    await expect(closing).resolves.toBeUndefined();
    expect(child.sent).toEqual([{ op: 'close' }]);
  });

  test('a worker that exits without answering fails the pending step, naming the operation, how long ago it was sent and how far the worker got', async () => {
    const child = new ScriptedChild();
    const handle = await started(child);
    const step = handle.step({ op: 'inspect' });
    await child.mark('received inspect');
    child.exited(0);
    child.closed(0);
    await expect(step).rejects.toThrow(/exited \(code 0, signal null\) while awaiting inspect \(sent [\d.]+ ms earlier\); lifecycle: received inspect; stderr: none/u);
  });

  test('a worker killed before it reports ready fails start-up, naming ready and its stderr', async () => {
    const child = new ScriptedChild();
    const starting = attachWorker('scripted', child);
    child.stderr.write('boom\n');
    await new Promise((resolve) => setImmediate(resolve));
    child.exited(null, 'SIGKILL');
    child.closed(null);
    await expect(starting).rejects.toThrow(/exited \(code null, signal SIGKILL\) while awaiting ready \(sent [\d.]+ ms earlier\); lifecycle: none; stderr: boom/u);
  });

  test('lifecycle markers do not make a clean close abnormal, but other stderr output does', async () => {
    const clean = new ScriptedChild();
    const cleanHandle = await started(clean);
    await clean.mark('replied');
    const cleanClose = cleanHandle.close();
    clean.answer(okReply);
    clean.exited(0);
    clean.closed(0);
    await expect(cleanClose).resolves.toBeUndefined();

    const noisy = new ScriptedChild();
    const noisyHandle = await started(noisy);
    noisy.stderr.write('warning: something\n');
    await new Promise((resolve) => setImmediate(resolve));
    const noisyClose = noisyHandle.close();
    noisy.answer(okReply);
    noisy.exited(0);
    noisy.closed(0);
    await expect(noisyClose).rejects.toThrow(/ended abnormally.*warning: something/u);
  });
});
