import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
for (const [size, timeout] of [[1000, 60000], [10000, 60000], [100000, 10000]]) {
  const result = spawnSync(process.execPath, ['scratch/gap-hunt/scale/dist/collections.js', String(size)], { encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  const log = `${result.stdout}${result.stderr}\n${JSON.stringify({ size, timeout, status: result.status, signal: result.signal, error: result.error?.message })}\n`;
  writeFileSync(`scratch/gap-hunt/scale/logs/collection-${size}.log`, log);
  console.log(log);
}
