/** Standalone TEST-6 phase: only History and compact receipts survive OS-process shutdown. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReactiveCostReceipts, runReactiveCost, validateReactiveCostJob } from './reactive-cost.js';

const decoded: unknown = JSON.parse(process.argv[2] ?? 'null');
const job = validateReactiveCostJob(decoded);
mkdirSync(job.directory, { recursive: true });
const receipts = await runReactiveCost(job);
const previous = job.phase === 'cold' ? [] : parseReactiveCostReceipts(readFileSync(join(job.directory, 'receipts.json'), 'utf8'));
writeFileSync(join(job.directory, 'receipts.json'), JSON.stringify([...previous, ...receipts]));
process.stdout.write(`${JSON.stringify(receipts.map(receipt => ({ phase: receipt.phase, bodies: receipt.bodies, measurement: receipt.measurement })))}\n`);
