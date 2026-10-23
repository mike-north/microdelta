/** One resource-bounded 100k attempt; timeout/OOM remains an honest outcome. */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
const timeoutMilliseconds = 30 * 60 * 1000;
const log = createWriteStream('scratch/gap-hunt/scale/logs/collection-100000-bounded.log');
const started = Date.now();
log.write(`${JSON.stringify({ started: new Date(started).toISOString(), size: 100000, timeoutMilliseconds, heapLimitMB: 1536, leaseMilliseconds: 3600000 })}\n`);
const child = spawn(process.execPath, ['--max-old-space-size=1536', 'scratch/gap-hunt/scale/dist/collections.js', '100000'], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMilliseconds);
child.on('error', error => log.write(`${JSON.stringify({ spawnError: error.message })}\n`));
child.on('close', (code, signal) => {
  clearTimeout(timer);
  const summary = { code, signal, timedOut, milliseconds: Date.now() - started };
  log.end(`${JSON.stringify(summary)}\n`);
  console.log(JSON.stringify(summary));
  process.exitCode = code === 0 ? 0 : 1;
});
