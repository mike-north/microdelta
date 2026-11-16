/** Independent production-facade report process; only durable History/Accounting and controlled JSON survive exit. */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { openWorkspace } from 'microdelta';
import type { IRunEvent } from 'microdelta';
import { composeReport, evaluateReport } from '../../examples/contribution-report/src/controlled/application.js';
import type { IReportServices } from '../../examples/contribution-report/src/controlled/application.js';
import { fixture } from './fixture.js';
import { isProcessJob } from './process-protocol.js';
import type { IProcessReport } from './process-protocol.js';

const decoded: unknown = JSON.parse(process.argv[2] ?? 'null');
if (!isProcessJob(decoded)) { throw new Error('Invalid controlled report process job'); }
const job = decoded;
const fake = fixture({ ...job.options, environment: job.environment ?? 'production', github: async url => {
  if (!url.includes('author%3Agrace')) { return undefined; }
  if (job.mode === 'fail-grace') { return { status: 200, headers: {}, body: { total_count: 0, incomplete_results: true, items: [] } }; }
  if (job.mode === 'crash-after-ada') { return new Promise(() => undefined); }
  return undefined;
} });
const services: IReportServices = { ...fake.services,
  github: async (url, accept, send) => { appendFileSync(join(job.directory, 'wire-ledger.jsonl'), `${JSON.stringify({ kind: 'github', url, ...(accept === undefined ? {} : { accept }), operation: send.operation, attempt: send.requestAttempt })}\n`); return fake.services.github(url, accept, send); },
  assess: async (request, send) => { appendFileSync(join(job.directory, 'wire-ledger.jsonl'), `${JSON.stringify({ kind: 'assessment', ...request, operation: send.operation, attempt: send.requestAttempt })}\n`); return fake.services.assess(request, send); },
};
const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(job.directory, 'usage.sqlite'), logicalStore: 'controlled-usage' });
const workspace = openWorkspace({ location: join(job.directory, 'history.sqlite'), logicalStore: 'controlled-history', accounting, ...(job.mode === 'crash-after-ada' ? { leaseMilliseconds: 1_000 } : {}) });
const application = composeReport(job.inputs, services);
const receipts: IProcessReport['receipts'][number][] = [];
/** Killing after publication exercises committed exact History, not a body-start or in-memory checkpoint. */
function observe(event: IRunEvent): void {
  if (event.kind === 'step' && (event.event.phase === 'publish' || event.event.phase === 'accept') && event.event.reference !== undefined) {
    receipts.push({ runId: event.runId, step: event.event.step, phase: event.event.phase, reference: event.event.reference });
  }
  if (job.mode === 'crash-after-ada' && event.kind === 'step' && event.event.phase === 'publish' && event.event.step.slot === 'summary' && event.event.step.memberKey === 'ada') {
    writeFileSync(join(job.directory, 'crash-receipt.json'), JSON.stringify({ reference: event.event.reference, trace: fake.trace, requests: fake.requests.length, assessments: fake.assessments.length }));
    process.kill(process.pid, 'SIGKILL');
  }
}
try {
  const result = await evaluateReport(workspace, application, { environment: job.environment ?? 'production', requestKey: job.requestKey, permits: 2, window: 2, observers: [{ observe }] });
  /** Resolve the same static application edge the worker imported, so copied graphs cannot be confused by labels. */
  const applicationUrl = import.meta.resolve('../../examples/contribution-report/src/controlled/application.js');
  /** The bytes behind that path are the tracking evidence whose intentional helper variation is under test. */
  const applicationSourceHash = createHash('sha256').update(readFileSync(fileURLToPath(applicationUrl))).digest('hex');
  /** A successful strict fold owns the exact report reference returned through its typed outcome. */
  const reportReference = result.value.fold.outcome.status === 'succeeded' ? result.value.fold.outcome.outcome.reference : undefined;
  const value: IProcessReport = { status: result.value.status, foldStatus: result.value.fold.outcome.status, people: result.value.fold.members.map(person => ({ key: person.key, status: person.status, ...(person.status === 'succeeded' ? { reference: person.outcome.reference } : {}) })),
    trace: fake.trace, requests: fake.requests.length, assessments: fake.assessments.length,
    usage: { attempts: result.value.usage.requestAttempts, reports: result.value.usage.reports, unknown: result.value.usage.unknown.length, tokens: result.value.usage.observed.find(quantity => quantity.unit === 'tokens')?.amount ?? 0 },
    receipts, runtime: { application: applicationUrl, applicationSourceHash, microdelta: import.meta.resolve('microdelta'), history: import.meta.resolve('@microdelta/history'), accounting: import.meta.resolve('@microdelta/accounting'), machineNode: import.meta.resolve('@microdelta/machine-node') },
    ...(reportReference === undefined ? {} : { reportReference }),
    ...(result.value.status === 'complete' ? { report: result.value.report } : {}) };
  process.stdout.write(`${JSON.stringify(value)}\n`);
} finally { workspace.close(); accounting.close(); }
