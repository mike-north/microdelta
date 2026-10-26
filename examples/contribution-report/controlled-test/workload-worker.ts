/** One independent-process workload phase owns its durable store and reports bounded measurements. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { openWorkspace } from 'microdelta';
import { composeReport, evaluateReport } from '../src/controlled/application.js';
import type { IReportServices } from '../src/controlled/application.js';
import { workloadCardinality, workloadInputsFor, workloadPeople } from './workload-fixture.js';
import { assertWorkloadMembership, createWorkloadHarness, maxRssBytesFromKibibytes } from './workload-harness.js';
import type { IWorkloadStats } from './workload-harness.js';

/** Worker phases reopen identical durable files in distinct processes. */
interface IWorkloadJob { readonly directory: string; readonly phase: 'cold' | 'restart'; readonly requestKey: string; readonly personCount: number }

/** Receipt keeps only report-scale facts; the complete PR-ID oracle stays inside the worker. */
interface IWorkloadReceipt {
  readonly phase: IWorkloadJob['phase'];
  readonly report: { readonly selectedPeople: number; readonly successfulPeople: number; readonly pullRequests: number; readonly score: number };
  readonly references: Readonly<Record<string, string>>;
  readonly currentSource: { readonly hooks: number; readonly bodies: number; readonly searchStarts: number; readonly completedSearches: number; readonly hooksBySource: { readonly roster: number; readonly discussion: number; readonly detail: number }; readonly bodiesBySource: { readonly roster: number; readonly discussion: number; readonly detail: number } };
  readonly usage: { readonly requestAttempts: number; readonly reports: number; readonly unknown: number };
  readonly fixture: ReturnType<typeof workloadCardinality>;
  readonly observed: IWorkloadStats;
  readonly memory: { readonly baselineRssBytes: number; readonly peakSampledRssBytes: number; readonly peakSampledHeapUsedBytes: number; readonly sampleIntervalMilliseconds: number; readonly rawMaxRss: number; readonly maxRssUnit: 'kibibytes'; readonly maxRssBytes: number };
};

const decoded: unknown = JSON.parse(process.argv[2] ?? 'null');
if (!isJob(decoded)) { throw new Error('invalid standalone workload job'); }
const job = decoded;
mkdirSync(job.directory, { recursive: true });
// Retry attribution accepts stable opaque connection identifiers, not local paths or other location-bearing values.
const harness = createWorkloadHarness('workload:issue-260', job.personCount);
const traceCounts = new Map<string, number>();
const services: IReportServices = { ...harness.services, trace(event) { const category = event.split(':', 1)[0] ?? 'unknown'; traceCounts.set(category, (traceCounts.get(category) ?? 0) + 1); } };
const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(job.directory, 'usage.sqlite'), logicalStore: 'controlled-workload-usage' });
const workspace = openWorkspace({ location: join(job.directory, 'history.sqlite'), logicalStore: 'controlled-workload-history', accounting });
const inputs = workloadInputsFor(job.personCount);
const application = composeReport(inputs, services);
const baseline = process.memoryUsage();
let peakSampledRssBytes = baseline.rss;
let peakSampledHeapUsedBytes = baseline.heapUsed;
const sampleIntervalMilliseconds = 100;
const sampler = setInterval(() => {
  const reading = process.memoryUsage();
  peakSampledRssBytes = Math.max(peakSampledRssBytes, reading.rss);
  peakSampledHeapUsedBytes = Math.max(peakSampledHeapUsedBytes, reading.heapUsed);
}, sampleIntervalMilliseconds);

try {
  const result = await evaluateReport(workspace, application, { environment: 'production', requestKey: job.requestKey, permits: 8, window: 8 });
  if (result.value.status !== 'complete') {
    const { fold, usage } = result.value;
    const memberStatuses = fold.members.reduce<Record<string, number>>((counts, member) => {
      counts[member.status] = (counts[member.status] ?? 0) + 1;
      return counts;
    }, {});
    throw new Error(`workload ${job.phase} report did not complete: ${JSON.stringify({ outcome: fold.outcome, discovery: fold.discovery, memberStatuses, members: fold.members.slice(0, 5), usage, traces: Object.fromEntries(traceCounts) })}`);
  }
  assertWorkloadMembership(harness.expectedPulls, harness.observedPulls, job.personCount);
  const report = result.value.report;
  const expectedPeople = workloadPeople(job.personCount);
  if (report.population !== 'authored-prs' || report.selected.length !== expectedPeople.length || report.people.length !== expectedPeople.length) {
    throw new Error('workload report population did not match its hidden harness oracle');
  }
  let reportedPulls = 0;
  let score = 0;
  for (let index = 0; index < expectedPeople.length; index += 1) {
    const expected = expectedPeople[index];
    const actual = report.people[index];
    if (expected === undefined || actual === undefined || actual.key !== expected.key || actual.count !== expected.pullRequests || actual.status !== 'contributions') {
      throw new Error(`workload report differed at person index ${String(index)}`);
    }
    reportedPulls += actual.count;
    score += actual.score;
  }
  const cardinality = workloadCardinality(job.personCount);
  const expectedCurrentAssessments = job.phase === 'cold' ? cardinality.pullRequests : 0;
  if (reportedPulls !== cardinality.pullRequests || harness.stats().observedAssessmentRequests !== expectedCurrentAssessments) {
    throw new Error(`workload report or assessments omitted PRs: ${String(reportedPulls)}/${String(harness.stats().observedAssessmentRequests)}`);
  }
  const references = Object.fromEntries(result.value.fold.members.flatMap(member => member.status === 'succeeded' ? [[member.key, member.outcome.reference.locator]] : []));
  const rawMaxRss = process.resourceUsage().maxRSS;
  // Node documents maxRSS in kibibytes (https://nodejs.org/api/process.html#processresourceusage); sampled memoryUsage values are already bytes.
  const maxRssUnit = 'kibibytes';
  const maxRssBytes = maxRssBytesFromKibibytes(rawMaxRss);
  const receipt: IWorkloadReceipt = {
    phase: job.phase,
    report: { selectedPeople: report.selected.length, successfulPeople: report.people.length, pullRequests: reportedPulls, score },
    references,
    currentSource: { hooks: (traceCounts.get('detail-hook') ?? 0) + (traceCounts.get('discussion-hook') ?? 0) + (traceCounts.get('roster-hook') ?? 0),
      bodies: (traceCounts.get('detail-body') ?? 0) + (traceCounts.get('discussion-body') ?? 0), searchStarts: traceCounts.get('search-start') ?? 0, completedSearches: traceCounts.get('search-complete') ?? 0,
      hooksBySource: { roster: traceCounts.get('roster-hook') ?? 0, discussion: traceCounts.get('discussion-hook') ?? 0, detail: traceCounts.get('detail-hook') ?? 0 },
      bodiesBySource: { roster: traceCounts.get('roster-body') ?? 0, discussion: traceCounts.get('discussion-body') ?? 0, detail: traceCounts.get('detail-body') ?? 0 } },
    usage: { requestAttempts: result.value.usage.requestAttempts, reports: result.value.usage.reports, unknown: result.value.usage.unknown.length },
    fixture: cardinality,
    observed: harness.stats(),
    memory: { baselineRssBytes: baseline.rss, peakSampledRssBytes, peakSampledHeapUsedBytes, sampleIntervalMilliseconds, rawMaxRss, maxRssUnit, maxRssBytes },
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  clearInterval(sampler);
  workspace.close();
  accounting.close();
}

/** JSON arguments are untrusted process input, narrowed before file paths or request identity are used. */
function isJob(value: unknown): value is IWorkloadJob {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { return false; }
  const directory = Reflect.get(value, 'directory');
  const phase = Reflect.get(value, 'phase');
  const requestKey = Reflect.get(value, 'requestKey');
  const personCount = Reflect.get(value, 'personCount');
  return typeof directory === 'string' && (phase === 'cold' || phase === 'restart') && typeof requestKey === 'string'
    && typeof personCount === 'number' && Number.isSafeInteger(personCount) && personCount > 0 && personCount <= 300;
}
