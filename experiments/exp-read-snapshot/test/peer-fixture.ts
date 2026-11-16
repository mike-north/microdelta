/** Finite transport-fault fixture: acknowledges no database work and opens no source storage. */
import { basename, dirname } from 'node:path';
import { createInterface } from 'node:readline';

import { command } from './transport.js';
import type { IWorkerReply } from './transport.js';

/** Only the probe-owned directory name selects one fixed response/exit fault. */
const mode = basename(dirname(process.argv[3] ?? ''));
if (mode === 'stderr') { process.stderr.write('finite stderr fixture\n'); }
/** A parent deadline still owns termination if the fixed transport response is never requested. */
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
try {
  for await (const line of input) {
    const value: unknown = JSON.parse(line); const request = command(value);
    const response: IWorkerReply = mode === 'failed-ack'
      ? { id: request.id, kind: 'failed', failure: { origin: 'candidate', stage: 'exit', code: null, message: 'fixture refused exit' }, cleanup: [] }
      : { id: request.id, kind: 'exiting' };
    process.stdout.write(`${JSON.stringify(response)}\n`);
    process.exitCode = mode === 'failed-ack' || mode === 'bad-status' ? 1 : 0;
    break;
  }
} finally { input.close(); }
