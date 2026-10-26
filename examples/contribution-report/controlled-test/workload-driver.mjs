/** Run the full controlled workload in two independent processes and retain only its compact receipts. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const worker = join(root, 'examples/contribution-report/.test-build/controlled-test/workload-worker.js');
const directory = mkdtempSync(join(tmpdir(), 'issue260-controlled-workload-'));
const timeout = 12 * 60 * 60 * 1_000;
const smoke = process.argv.includes('--smoke');
const personCount = smoke ? 2 : 300;
const requiredPulls = smoke ? 500 : 150_000;

/** A worker is one fresh OS process; no service closure or coordinator state crosses the restart boundary. */
function run(phase) {
  process.stdout.write(`Starting ${phase} ${String(requiredPulls)}-PR ${smoke ? 'smoke' : 'acceptance'} in fresh process; durable directory ${directory}\n`);
  const started = process.hrtime.bigint();
  const child = spawnSync(process.execPath, [worker, JSON.stringify({ directory, phase, requestKey: `workload:${phase}`, personCount })], {
    cwd: root, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024,
  });
  const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1_000_000;
  if (child.error !== undefined) { throw new Error(`${phase} workload process failed: ${child.error.message}`); }
  if (child.status !== 0) { throw new Error(`${phase} workload process exited ${String(child.status)}: ${child.stderr}`); }
  const lines = child.stdout.trim().split('\n');
  const last = lines.at(-1);
  if (last === undefined) { throw new Error(`${phase} workload process did not write a receipt`); }
  const receipt = JSON.parse(last);
  process.stdout.write(`${JSON.stringify({ phase, elapsedMilliseconds, report: receipt.report, fixture: receipt.fixture, currentSource: receipt.currentSource, usage: receipt.usage, observed: receipt.observed, memory: receipt.memory })}\n`);
  return { receipt, elapsedMilliseconds };
}

/** The harness checks exact report counts and identities out of band before emitting each compact receipt. */
const cold = run('cold');
const restart = run('restart');
if (cold.receipt.report.pullRequests !== requiredPulls || restart.receipt.report.pullRequests !== requiredPulls) {
  throw new Error(`workload did not assess the expected ${String(requiredPulls)} unique PR population`);
}
if (JSON.stringify(cold.receipt.references) !== JSON.stringify(restart.receipt.references)) {
  throw new Error('fresh-process report references changed under unchanged workload inputs');
}
for (const phase of [cold, restart]) {
  if (phase.receipt.report.selectedPeople !== personCount || phase.receipt.report.successfulPeople !== personCount
    || phase.receipt.currentSource.searchStarts !== personCount || phase.receipt.currentSource.completedSearches !== personCount) {
    throw new Error(`${phase.receipt.phase} workload omitted a selected person or complete source search`);
  }
}
const pullCount = cold.receipt.fixture.pullRequests;
if (cold.receipt.currentSource.hooks !== 0 || cold.receipt.currentSource.bodiesBySource.roster !== 1
  || cold.receipt.currentSource.bodiesBySource.discussion !== pullCount || cold.receipt.currentSource.bodiesBySource.detail !== pullCount) {
  throw new Error('cold workload source bodies differed from one roster plus one discussion and detail source per PR');
}
if (restart.receipt.currentSource.hooksBySource.roster !== 1 || restart.receipt.currentSource.hooksBySource.discussion !== pullCount
  || restart.receipt.currentSource.hooksBySource.detail !== pullCount || restart.receipt.currentSource.bodiesBySource.roster !== 0
  || restart.receipt.currentSource.bodiesBySource.discussion !== pullCount || restart.receipt.currentSource.bodiesBySource.detail !== 0) {
  throw new Error('restart did not refresh discussion evidence and retain accepted detail and roster results');
}
if (cold.receipt.observed.observedAssessmentRequests !== pullCount || restart.receipt.observed.observedAssessmentRequests !== 0) {
  throw new Error('cold assessments or settled restart reuse differed from the declared policy');
}
const sendsFor = (receipt, route) => receipt.observed.routes[route]?.sends ?? 0;
const searchSends = sendsFor(cold.receipt, 'search-page');
if (searchSends === 0 || sendsFor(restart.receipt, 'search-page') !== searchSends) {
  throw new Error('restart did not repeat the complete current-source search under the same fixture inputs');
}
for (const [route, count] of [['review-list', pullCount], ['conversation-comments', pullCount], ['inline-comments', pullCount],
  ['pull-detail', pullCount], ['pull-diff', pullCount], ['assessment', pullCount]]) {
  if (sendsFor(cold.receipt, route) !== count) { throw new Error(`cold workload route ${route} did not serve its independent fixture count`); }
}
for (const [route, count] of [['review-list', pullCount], ['conversation-comments', pullCount], ['inline-comments', pullCount],
  ['pull-detail', 0], ['pull-diff', 0], ['assessment', 0]]) {
  if (sendsFor(restart.receipt, route) !== count) { throw new Error(`restart route ${route} violated refresh/reuse policy`); }
}
for (const [phase, previousAttempts] of [[cold, 0], [restart, cold.receipt.usage.requestAttempts]]) {
  const sends = Object.values(phase.receipt.observed.routes).reduce((total, route) => total + route.sends, 0);
  const currentAttempts = phase.receipt.usage.requestAttempts - previousAttempts;
  if (sends !== currentAttempts) {
    throw new Error(`actual transport sends ${String(sends)} differed from current supervised attempts ${String(currentAttempts)}`);
  }
}
const evidence = { directory, platform: process.platform, arch: process.arch, node: process.version,
  cold: { ...cold.receipt, elapsedMilliseconds: cold.elapsedMilliseconds },
  restart: { ...restart.receipt, elapsedMilliseconds: restart.elapsedMilliseconds } };
const evidencePath = join(directory, 'receipt.json');
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${smoke ? 'Completed non-acceptance smoke' : 'Accepted controlled 150k-PR cold and fresh-process restart workload'}. Receipt: ${evidencePath}\n`);
