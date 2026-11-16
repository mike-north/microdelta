/** Node command-process mechanics; argument grammar and exit-status policy belong to the CLI consumer. @packageDocumentation */
import { writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ICommandProcessCapability } from '@microdelta/machine';

/** Complete UTF-8 text writes without a forced exit losing buffered command output. */
function writeText(descriptor: number, text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written < 1) { throw new Error('Command stream made no write progress'); }
    offset += written;
  }
}

/** Bind only the current process's argument/stream/status facilities, with no command semantics. @internal */
export function _createNodeCommandProcessImplementation(): ICommandProcessCapability {
  const args = Object.freeze(process.argv.slice(2));
  return Object.freeze({
    arguments: args,
    writeStdout(text: string): void { writeText(1, text); },
    writeStderr(text: string): void { writeText(2, text); },
    setExitCode(code: number): void {
      if (!Number.isInteger(code) || code < 0 || code > 255) { throw new RangeError('Command exit status must be a whole byte'); }
      process.exitCode = code;
    },
    resolvePath(path: string): string {
      return resolve(process.cwd(), path);
    },
    loadModule(path: string): Promise<unknown> {
      return import(pathToFileURL(path).href);
    },
    keepAlive(): () => void {
      // A ref'ed interval keeps Node alive while tracked promises and cleanup settle.
      const timer = setInterval(() => undefined, 2_147_000_000);
      let released = false;
      return (): void => { if (!released) { released = true; clearInterval(timer); } };
    },
    onSignal(signal: 'SIGINT' | 'SIGTERM', listener: () => void): () => void {
      process.on(signal, listener);
      let subscribed = true;
      return (): void => { if (subscribed) { subscribed = false; process.off(signal, listener); } };
    },
  });
}
