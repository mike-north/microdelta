import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
for (const [width, depth] of [[1000, 1], [1, 10], [1, 50], [1, 100]]) {
  const result = spawnSync(process.execPath, [`scratch/gap-hunt/scale/dist/fold-${width}-${depth}.js`], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024 });
  const log = `${result.stdout}${result.stderr}\n${JSON.stringify({ width, depth, timeout: 60000, status: result.status, signal: result.signal, error: result.error?.message })}\n`;
  writeFileSync(`scratch/gap-hunt/scale/logs/fold-${width}-${depth}.log`, log);
  console.log(JSON.stringify({ width, depth, status: result.status, signal: result.signal }));
}
