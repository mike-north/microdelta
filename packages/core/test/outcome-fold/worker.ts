/**
 * One independent outcome-fold process, started as `node worker.js <job>`. It
 * installs the world the caller wrote, composes the fixture afresh from the
 * job's options, opens the facade's workspace over the shared SQLite History
 * file, resolves the `tally` outcome fold (and, when asked, the strict
 * `report` fold) in one supervised run and writes one JSON report line on
 * fd 1. Nothing but durable History and the caller's files survives between
 * processes.
 */
import { readFileSync, writeSync } from 'node:fs';

import { resetWorld } from './fixture.js';
import type { IWorld } from './fixture.js';
import { runTally } from './support.js';
import type { ITallyRunOptions } from './support.js';

/** Everything one worker process is told; only JSON-safe run options travel. */
export interface ITallyJob {
  readonly location: string;
  readonly world: string;
  readonly options: Pick<ITallyRunOptions, 'order' | 'minimumAuthored' | 'environment' | 'strict'>;
}

/** Parse the job argument. */
function readJob(): ITallyJob {
  const argument = process.argv[2];
  if (argument === undefined) {
    throw new Error('the worker needs a job argument');
  }
  // The caller writes the job as JSON of exactly this shape.
  return JSON.parse(argument) as ITallyJob;
}

/** Run one job. */
async function main(): Promise<void> {
  const job = readJob();
  // The caller wrote the world file from an IWorld value.
  resetWorld(JSON.parse(readFileSync(job.world, 'utf8')) as IWorld);
  const report = await runTally(job.location, job.options);
  writeSync(1, `${JSON.stringify(report)}\n`);
}

await main();
