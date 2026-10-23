/**
 * Feed the existing component lifecycle worker through a file, avoiding host
 * process-launch limits on a large JSON argv. Only a synthetic fixture uses it.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (file === undefined) {
  throw new Error('gap hunt worker requires a script file');
}
process.argv[2] = readFileSync(file, 'utf8');
await import('./durable-history/worker.js');
