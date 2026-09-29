/**
 * One independent strict-fold process, started as `node worker.js <job>`. It
 * installs the world the caller wrote, composes the fold fixture afresh from
 * the job's variation, opens the facade's workspace over the shared SQLite
 * History file, resolves the `report` fold in one supervised run and writes
 * one JSON report line on fd 1. Nothing but durable History and the caller's
 * files survives between processes.
 */
import { readFileSync, writeSync } from 'node:fs';

import { resetWorld } from './fixture.js';
import type { IVariation, IWorld } from './fixture.js';
import { runFold } from './support.js';

/** Everything one worker process is told. */
export interface IFoldJob {
  readonly location: string;
  readonly world: string;
  readonly variation: IVariation;
}

/** Parse the job argument. */
function readJob(): IFoldJob {
  const argument = process.argv[2];
  if (argument === undefined) {
    throw new Error('the worker needs a job argument');
  }
  // The caller writes the job as JSON of exactly this shape.
  return JSON.parse(argument) as IFoldJob;
}

/** Run one job. */
async function main(): Promise<void> {
  const job = readJob();
  // The caller wrote the world file from an IWorld value.
  resetWorld(JSON.parse(readFileSync(job.world, 'utf8')) as IWorld);
  const report = await runFold(job.location, job.variation);
  writeSync(1, `${JSON.stringify(report)}\n`);
}

await main();
