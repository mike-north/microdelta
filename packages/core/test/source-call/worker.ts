/** One independent facade process; no callback, observer or acceptance state survives its exit. */
import { openWorkspace } from 'microdelta';
import { composeFixture, installWorld, logicalStore } from './fixture.js';
import { isJob } from './protocol.js';
import type { IReportData, IWorkerReport } from './protocol.js';

const decoded: unknown = JSON.parse(process.argv[2] ?? 'null');
if (!isJob(decoded)) { throw new Error('Invalid source-call worker job'); }
const job = decoded;
installWorld(job.world);
const fixture = composeFixture(job.variation);
const workspace = openWorkspace({ location: job.location, logicalStore });
try {
  const result = await workspace.run({ authoring: fixture.authoring, composition: fixture.composition, environment: 'production' }, async run => {
    const settled = await run.resolveFold(fixture.report, { requestKey: job.requestKey });
    const report: IWorkerReport = {
      status: settled.outcome.status,
      members: settled.members.map(member => ({ key: member.key, status: member.status, ...(member.status === 'succeeded' ? { reference: member.outcome.reference } : {}) })),
      trace: job.world.trace,
      ...(settled.outcome.status === 'succeeded' ? { data: run.read<IReportData>(settled.outcome.outcome.reference) } : {}),
    };
    return report;
  });
  process.stdout.write(`${JSON.stringify(result.value)}\n`);
} finally { workspace.close(); }
