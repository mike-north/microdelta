import { readFileSync } from 'node:fs';
const file = process.argv[2];
if (file === undefined) throw new Error('Expected synthetic script file');
process.argv[2] = readFileSync(file, 'utf8');
await import('../../../packages/core/.test-build/test/durable-history/worker.js');
