/** Controlled caller for the installed foreground CLI; preparation owns resources, while the CLI alone owns run lifetime. */
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { defineCliWorkload, openWorkspace } from 'microdelta';
import type { IRunEvent } from 'microdelta';
import { composeReport, evaluateReportBody } from '../../examples/contribution-report/src/controlled/application.js';
import type { IReportHelpers, IReportInputs, IReportRunOutcome, IReportServices } from '../../examples/contribution-report/src/controlled/application.js';
import { baseInputs, fixture } from './fixture.js';
import type { IProcessReport } from './process-protocol.js';

/** The harness supplies this optional append-only import/work ledger to both start and finite observe processes. */
const ledger = process.env.CONTROLLED_REPORT_CLI_LEDGER;
/** Record facts only; counters neither drive graph outcomes nor stand in for retained History truth. */
function record(kind: string, details: Readonly<Record<string, unknown>> = {}): void {
  if (ledger !== undefined) { appendFileSync(ledger, `${JSON.stringify({ kind, ...details })}\n`); }
}
record('import');

/** A deterministic pre-admission pause holds the entire graph stable during a separate active observation. */
async function barrier(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdin.once('data', (chunk: Buffer) => {
      process.stdin.pause();
      if (chunk.toString() !== 'release\n') { reject(new Error('Expected controlled barrier release')); return; }
      record('control', { action: 'release' }); resolve();
    });
    process.stdin.once('end', () => reject(new Error('Controlled barrier closed without release')));
    process.stdin.once('error', reject);
    process.stdin.resume();
    process.stderr.write('controlled-report-barrier-ready\n');
  });
}

/** Opaque arguments select only small controlled scenarios and private fixture evidence destinations. */
export default defineCliWorkload<IReportInputs, IReportHelpers, IReportRunOutcome>(arguments_ => {
  const [state, proof, requestKey, mode] = arguments_;
  if (arguments_.length !== 4 || state === undefined || proof === undefined || requestKey === undefined
    || (mode !== 'normal' && mode !== 'fail-ada' && mode !== 'barrier')) { throw new Error('Expected state, proof, request key and controlled mode'); }
  record('factory');
  const fake = fixture({ github: async url => mode === 'fail-ada' && url.includes('author%3Aada') ? { status: 403, headers: {}, body: {} } : undefined });
  const services: IReportServices = { ...fake.services,
    trace: event => { record('source', { event }); fake.services.trace(event); },
    github: (url, accept, send) => { record('github', { url }); return fake.services.github(url, accept, send); },
    assess: (request, send) => { record('assessment', { id: request.id }); return fake.services.assess(request, send); },
  };
  const application = composeReport(baseInputs, services);
  const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(state, 'usage.sqlite'), logicalStore: 'controlled-usage' });
  const workspace = (() => {
    try { return openWorkspace({ location: join(state, 'history.sqlite'), logicalStore: 'controlled-history', accounting }); }
    catch (error: unknown) { try { accounting.close(); } catch { /* Preserve the workspace construction failure. */ } throw error; }
  })();
  /** These are actual committed lifecycle receipts, retained separately from the observation statement. */
  const receipts: IProcessReport['receipts'][number][] = [];
  function observe(event: IRunEvent): void {
    if (event.kind === 'step' && (event.event.phase === 'publish' || event.event.phase === 'accept') && event.event.reference !== undefined) {
      receipts.push({ runId: event.runId, step: event.event.step, phase: event.event.phase, reference: event.event.reference });
    }
    if (event.kind === 'stop') { record('control', { action: 'stop', level: event.level }); }
  }
  /** Disposal is idempotent, attempts both owned resources, and follows actual run closure in the CLI. */
  let disposed = false;
  return {
    workspace, options: { environment: 'production', authoring: application.authoring, composition: application.composition, permits: 2, window: 2, observers: [{ observe }] },
    async body(run, submission) {
      record('body');
      if (mode === 'barrier') { await barrier(); }
      const result = await evaluateReportBody(run, application, requestKey, submission);
      /** Bind the fixture's detailed evidence to the actual application and ordinary installed runtime entries. */
      const applicationUrl = import.meta.resolve('../../examples/contribution-report/src/controlled/application.js');
      const reportReference = result.fold.outcome.status === 'succeeded' ? result.fold.outcome.outcome.reference : undefined;
      const summary: IProcessReport = {
        status: result.status, foldStatus: result.fold.outcome.status,
        people: result.fold.members.map(person => ({ key: person.key, status: person.status, ...(person.status === 'succeeded' ? { reference: person.outcome.reference } : {}) })),
        trace: fake.trace, requests: fake.requests.length, assessments: fake.assessments.length,
        usage: { attempts: result.usage.requestAttempts, reports: result.usage.reports, unknown: result.usage.unknown.length, tokens: result.usage.observed.find(quantity => quantity.unit === 'tokens')?.amount ?? 0 },
        receipts, runtime: { application: applicationUrl, applicationSourceHash: createHash('sha256').update(readFileSync(fileURLToPath(applicationUrl))).digest('hex'),
          microdelta: import.meta.resolve('microdelta'), history: import.meta.resolve('@microdelta/history'), accounting: import.meta.resolve('@microdelta/accounting'), machineNode: import.meta.resolve('@microdelta/machine-node') },
        ...(reportReference === undefined ? {} : { reportReference }),
      };
      // This private harness evidence keeps the actual detailed outcome, without exporting report content as a product artifact.
      writeFileSync(join(proof, 'outcome.json'), JSON.stringify({ ...summary, fold: result.fold, detailedUsage: result.usage }));
      return result;
    },
    dispose() {
      if (disposed) { return; } disposed = true;
      try { workspace.close(); } finally { try { accounting.close(); } finally { record('dispose'); } }
    },
  };
});
