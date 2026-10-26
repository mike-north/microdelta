/** One independent-process workload phase owns its durable store and reports bounded measurements. */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { openWorkspace } from 'microdelta';
import type { IRunObserver } from 'microdelta';
import { composeReport, evaluateReport } from '../../examples/contribution-report/src/controlled/application.js';
import type { IReportServices } from '../../examples/contribution-report/src/controlled/application.js';
import { workloadCardinality, workloadInputsFor, workloadPeople } from './workload-fixture.js';
import { assertWorkloadMembership, createWorkloadHarness, maxRssBytesFromKibibytes } from './workload-harness.js';
import { createWorkloadMemorySampler } from './workload-measurement.js';
import type { IWorkloadStats } from './workload-harness.js';
import { qualificationWriterLeaseMilliseconds } from './workload-budget.js';
import { summarizeWorkloadFailure, WorkloadIncompleteError } from './workload-failure.js';
import type { IWorkloadMemoryReceipt } from './workload-failure.js';

/** Worker phases reopen identical durable files in distinct processes. */
export interface IWorkloadJob { readonly directory: string; readonly phase: 'cold' | 'restart'; readonly requestKey: string; readonly personCount: number }

/** Receipt keeps only report-scale facts; the complete PR-ID oracle stays inside the worker. */
export interface IWorkloadReceipt {
  readonly phase: IWorkloadJob['phase'];
  readonly report: { readonly selectedPeople: number; readonly successfulPeople: number; readonly pullRequests: number; readonly score: number };
  readonly references: Readonly<Record<string, string>>;
  readonly currentSource: { readonly hooks: number; readonly bodies: number; readonly searchStarts: number; readonly completedSearches: number; readonly hooksBySource: { readonly roster: number; readonly discussion: number; readonly detail: number }; readonly bodiesBySource: { readonly roster: number; readonly discussion: number; readonly detail: number } };
  readonly usage: { readonly requestAttempts: number; readonly reports: number; readonly unknown: number };
  readonly fixture: ReturnType<typeof workloadCardinality>;
  readonly observed: IWorkloadStats;
  readonly memory: IWorkloadMemoryReceipt;
};

/** Internal fixture seam executes exactly the standalone worker's phase; observers make lease-clock regressions bounded without another scheduler. */
export async function runWorkloadPhase(job: IWorkloadJob, observers: readonly IRunObserver[] = []): Promise<IWorkloadReceipt> {
  mkdirSync(job.directory, { recursive: true });
  // Retry attribution accepts stable opaque connection identifiers, not local paths or other location-bearing values.
  const sampler = createWorkloadMemorySampler({ intervalMilliseconds: 100 });
  const harness = createWorkloadHarness('workload:issue-260', job.personCount);
  const traceCounts = new Map<string, number>();
  const services: IReportServices = { ...harness.services,
    async github(url, accept, send) {
      sampler.sampleDispatchBoundary();
      try { return await harness.services.github(url, accept, send); }
      finally { sampler.sampleDispatchBoundary(); }
    },
    async assess(request, send) {
      sampler.sampleDispatchBoundary();
      try { return await harness.services.assess(request, send); }
      finally { sampler.sampleDispatchBoundary(); }
    },
    trace(event) { const category = event.split(':', 1)[0] ?? 'unknown'; traceCounts.set(category, (traceCounts.get(category) ?? 0) + 1); } };
  const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(job.directory, 'usage.sqlite'), logicalStore: 'controlled-workload-usage' });
  // One qualification fold can occupy the whole phase. Its isolated store accepts
  // correspondingly long dead-holder recovery; fencing is unchanged and no heartbeat renews the request.
  const workspace = openWorkspace({ location: join(job.directory, 'history.sqlite'), logicalStore: 'controlled-workload-history', accounting, leaseMilliseconds: qualificationWriterLeaseMilliseconds });
  const inputs = workloadInputsFor(job.personCount);
  const application = composeReport(inputs, services);
  /** Read actual process observations on either exit path; no completed-workload claim follows from a partial sample. */
  const measuredMemory = (): IWorkloadMemoryReceipt => {
    const rawMaxRss = process.resourceUsage().maxRSS;
    // Node documents maxRSS in kibibytes (https://nodejs.org/api/process.html#processresourceusage); memoryUsage values are bytes.
    return { ...sampler.snapshot(), samplingLimitation: 'Timer callbacks can be delayed by event-loop activity; dispatch-boundary samples are rate-limited, and maxRSS is the process high-water mark.',
      rawMaxRss, maxRssUnit: 'kibibytes', maxRssBytes: maxRssBytesFromKibibytes(rawMaxRss) };
  };
  try {
    const result = await evaluateReport(workspace, application, { environment: 'production', requestKey: job.requestKey, permits: 8, window: 8, observers });
    if (result.value.status !== 'complete') {
      throw new WorkloadIncompleteError({ ...summarizeWorkloadFailure({ ...result.value, diagnostics: result.diagnostics, stop: result.stop, waitingUntil: result.waitingUntil }),
        phase: job.phase, status: 'incomplete', measurementScope: 'partial-through-run-return', observed: harness.stats(), memory: measuredMemory() });
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
      memory: measuredMemory(),
    };
    return receipt;
  } finally {
    sampler.close();
    workspace.close();
    accounting.close();
  }
}

/** JSON arguments are untrusted process input, narrowed before file paths or request identity are used. */
function isJob(value: unknown): value is IWorkloadJob {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) { return false; }
  const directory: unknown = Reflect.get(value, 'directory');
  const phase: unknown = Reflect.get(value, 'phase');
  const requestKey: unknown = Reflect.get(value, 'requestKey');
  const personCount: unknown = Reflect.get(value, 'personCount');
  return typeof directory === 'string' && (phase === 'cold' || phase === 'restart') && typeof requestKey === 'string'
    && typeof personCount === 'number' && Number.isSafeInteger(personCount) && personCount > 0 && personCount <= 300;
}

/** The command entry only validates its job and prints the same phase receipt exercised by fixture tests. */
async function main(): Promise<void> {
  const decoded: unknown = JSON.parse(process.argv[2] ?? 'null');
  if (!isJob(decoded)) { throw new Error('invalid standalone workload job'); }
  try {
    const receipt = await runWorkloadPhase(decoded);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    if (!(error instanceof WorkloadIncompleteError)) { throw error; }
    process.stderr.write(`${JSON.stringify(error.receipt)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) { await main(); }
