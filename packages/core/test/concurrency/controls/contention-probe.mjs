/**
 * On-demand measurement of how concurrent the M5 contention scenarios really
 * are. It drives the compiled concurrency worker exactly as the suites do and
 * prints numbers the suites only assert bounds on.
 *
 * For the C1 shape, four workers on a controlled clock acquire at a shared
 * host-clock barrier for ten rounds. It reports each round's start skew (the
 * spread of the workers' start times) and the longest time two acquisitions
 * were inside History together. For the C2 shape, four workers contend on the
 * host clock for 1.5 s. It reports grants, `held` observations, accepted and
 * refused mutations, the refusal classes and how long the loops overlapped.
 *
 * Not part of `npm test`: run `npm run build` and
 * `npm run test:unit --workspace microdelta` first, then
 * `node packages/core/test/concurrency/controls/contention-probe.mjs [runs]`.
 * Each run uses a fresh store in a temporary directory that it removes.
 */
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repositoryRoot } from './controls.mjs';

const worker = join(repositoryRoot, 'packages/core/.test-build/test/concurrency/worker.js');
const history = await import(pathToFileURL(join(repositoryRoot, 'packages/history/dist/src/index.js')).href);
const machine = await import(pathToFileURL(join(repositoryRoot, 'packages/machine-node/dist/src/index.js')).href);
const store = 'store:m5-concurrency';
const runs = Number(process.argv[2] ?? '3');

/** Create an initialized store, as the suites' `freshStore` does. */
function freshStore(directory) {
  const location = join(directory, 'history.sqlite');
  history.openDurableHistory({ sqlite: machine.createNodeSqlite(), clock: machine.createNodeClock(), sha256: machine.createNodeMachine(), location, logicalStore: store }).close();
  return location;
}

/** Start one worker and resolve once it has opened the store. */
function start(location, clock) {
  const child = fork(worker, [JSON.stringify({ location, store, clock })], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  return new Promise((resolve) => {
    child.once('message', () => {
      resolve(child);
    });
  });
}

/** Send one command and resolve with the worker's reply. */
function step(child, command) {
  return new Promise((resolve) => {
    child.once('message', resolve);
    child.send(command);
  });
}

/** Start skew and longest pairwise overlap of step intervals, in milliseconds. */
function measure(replies) {
  const starts = replies.map((reply) => reply.startedAt);
  let overlap = 0;
  replies.forEach((left, index) => {
    for (const right of replies.slice(index + 1)) {
      overlap = Math.max(overlap, Math.min(left.endedAt, right.endedAt) - Math.max(left.startedAt, right.startedAt));
    }
  });
  return { skew: Math.max(...starts) - Math.min(...starts), overlap: Math.max(0, overlap) };
}

/** Format milliseconds with microsecond precision. */
const ms = (value) => `${value.toFixed(3)} ms`;

/** The shared host monotonic clock, as the worker reads it. */
const hostNow = () => Number(process.hrtime.bigint()) / 1_000_000;

for (let run = 1; run <= runs; run += 1) {
  const directory = mkdtempSync(join(tmpdir(), 'contention-probe-'));
  try {
    const c1Location = freshStore(directory);
    const c1 = await Promise.all(['W0', 'W1', 'W2', 'W3'].map(() => start(c1Location, 'controlled')));
    const rounds = [];
    for (let round = 1; round <= 10; round += 1) {
      const notBefore = hostNow() + 40;
      const replies = await Promise.all(c1.map((child, index) => step(child, { op: 'acquire', at: round * 1_000, holder: `contender-W${String(index)}`, leaseMilliseconds: 400, notBefore })));
      rounds.push({ ...measure(replies), winners: replies.filter((reply) => reply.ok && reply.value.kind === 'acquired').length });
    }
    for (const child of c1) child.kill('SIGKILL');
    const skews = rounds.map((round) => round.skew).sort((left, right) => left - right);
    const overlapping = rounds.filter((round) => round.overlap > 0);
    console.log(`run ${String(run)} C1: skew min ${ms(skews[0])} median ${ms(skews[5])} max ${ms(skews[9])}; rounds with overlap ${String(overlapping.length)}/10; longest overlap ${ms(Math.max(...rounds.map((round) => round.overlap)))}; winners per round ${[...new Set(rounds.map((round) => round.winners))].join(',')}`);

    const c2Location = join(directory, 'free.sqlite');
    history.openDurableHistory({ sqlite: machine.createNodeSqlite(), clock: machine.createNodeClock(), sha256: machine.createNodeMachine(), location: c2Location, logicalStore: store }).close();
    const c2 = await Promise.all([0, 1, 2, 3].map(() => start(c2Location, 'host')));
    const notBefore = hostNow() + 40;
    const replies = await Promise.all(c2.map((child, index) => step(child, { op: 'contend', holder: `free-H${String(index)}`, durationMilliseconds: 1_500, leaseMilliseconds: 150, notBefore })));
    for (const child of c2) child.kill('SIGKILL');
    const events = replies.flatMap((reply) => reply.value);
    const count = (predicate) => events.filter(predicate).length;
    const refusals = [...new Set(events.filter((event) => !event.ok && event.op !== 'acquire').map((event) => event.error))];
    const loops = measure(replies);
    console.log(`run ${String(run)} C2: grants ${String(count((event) => event.op === 'acquire' && event.ok))}, held ${String(count((event) => event.op === 'acquire' && !event.ok))}, accepted mutations ${String(count((event) => event.op !== 'acquire' && event.ok))}, refused mutations ${String(count((event) => event.op !== 'acquire' && !event.ok))} (${refusals.join(',')}); loop skew ${ms(loops.skew)}, loops overlapped ${ms(loops.overlap)}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
