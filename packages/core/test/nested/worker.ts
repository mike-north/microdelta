/**
 * One independent nested-validation process, started as
 * `node worker.js <job-json>`. It installs the world the caller wrote, composes
 * the nested fixture afresh from the job's variation, opens Reuse Resolution
 * over the shared SQLite History file and resolves (or checks) each member's
 * summary in the variation's member order. It writes one JSON result line on
 * fd 1: each member's outcome or failure and the author helpers' invocation
 * counts. Nothing but durable History and the caller's files survives between
 * processes.
 */
import { readFileSync, writeSync } from 'node:fs';

import { ResolutionError } from '@microdelta/resolution';
import type { ICandidateMiss } from '@microdelta/resolution';

import { memberKeys, resetWorld, world } from './fixture.js';
import type { IMemberKey, IVariation, IWorld } from './fixture.js';
import { openNestedSession } from './support.js';

/** Everything one worker process is told. */
export interface INestedJob {
  readonly location: string;
  readonly world: string;
  readonly variation: IVariation;
  readonly command: 'resolve' | 'check';
}

/** A JSON-safe description of one member's result. */
export type IMemberReport =
  | { readonly kind: 'reused' | 'published' | 'reusable'; readonly reference: string; readonly misses: readonly { readonly reason: string; readonly detail: string }[] }
  | { readonly kind: 'refused' | 'execution-required' | 'uncertain'; readonly misses: readonly { readonly reason: string; readonly detail: string }[] }
  | { readonly kind: 'failed'; readonly code: string; readonly message: string };

/** The one result line a worker writes. */
export interface INestedResult {
  readonly outcomes: Readonly<Record<IMemberKey, IMemberReport>>;
  readonly counts: Pick<IWorld, 'checks' | 'initials' | 'summaries' | 'assessments'>;
}

/** Describe candidate misses. */
function describeMisses(misses: readonly ICandidateMiss[]): readonly { readonly reason: string; readonly detail: string }[] {
  return misses.map((item) => ({ reason: item.reason, detail: item.detail }));
}

/** Parse the job argument. */
function readJob(): INestedJob {
  const argument = process.argv[2];
  if (argument === undefined) {
    throw new Error('the worker needs a job argument');
  }
  // The caller writes the job as JSON of exactly this shape.
  return JSON.parse(argument) as INestedJob;
}

/** Resolve or check one member's summary, reporting a failure as data. */
async function run(job: INestedJob, key: IMemberKey, session: ReturnType<typeof openNestedSession>): Promise<IMemberReport> {
  const step = session.nested.steps[key].summary;
  try {
    if (job.command === 'check') {
      const checked = await session.check(step);
      return checked.kind === 'reusable'
        ? { kind: 'reusable', reference: checked.reference.locator, misses: describeMisses(checked.misses) }
        : { kind: checked.kind, misses: describeMisses(checked.misses) };
    }
    const outcome = await session.resolve(step);
    return outcome.kind === 'refused'
      ? { kind: 'refused', misses: describeMisses(outcome.misses) }
      : { kind: outcome.kind, reference: outcome.reference.locator, misses: describeMisses(outcome.misses) };
  } catch (error: unknown) {
    if (error instanceof ResolutionError) {
      return { kind: 'failed', code: error.code, message: error.message };
    }
    throw error;
  }
}

/** Run one job. */
async function main(): Promise<void> {
  const job = readJob();
  // The caller wrote the world file from an IWorld value.
  resetWorld(JSON.parse(readFileSync(job.world, 'utf8')) as IWorld);
  const session = openNestedSession(job.location, job.variation);
  const outcomes: Partial<Record<IMemberKey, IMemberReport>> = {};
  try {
    const order = job.variation.order === 'reversed' ? [...memberKeys].reverse() : memberKeys;
    for (const key of order) {
      outcomes[key] = await run(job, key, session);
    }
  } finally {
    session.close();
  }
  const ada = outcomes['person:ada'];
  const ben = outcomes['person:ben'];
  if (ada === undefined || ben === undefined) {
    throw new Error('both members must be reported');
  }
  const result: INestedResult = {
    outcomes: { 'person:ada': ada, 'person:ben': ben },
    counts: { checks: world.checks, initials: world.initials, summaries: world.summaries, assessments: world.assessments },
  };
  writeSync(1, `${JSON.stringify(result)}\n`);
}

await main();
