/**
 * One process of the Issue 250 diagnostic consumer. It uses the generated
 * alpha facade and real durable workspace while keeping the deterministic
 * fixture and observation counters outside framework-owned state.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { openWorkspace } from 'microdelta';
import type { IDiscoveryReport, IRunEvent } from 'microdelta';

import { selectedSearches } from './activity.js';
import { composeAnalysis } from './analysis.js';
import type { ISummary } from './analysis.js';

/** The logical identity shared by all process runs in the probe. */
const logicalStore = 'experiment:issue-250-composition-boundary';

/** Read discovery identity without treating a failed listing as an empty one. */
function discoveredKeys(discovery: IDiscoveryReport): readonly string[] | null {
  switch (discovery.kind) {
    case 'keyed':
      return discovery.keys;
    case 'pending':
    case 'cancelled':
    case 'rejected':
      return null;
    default: {
      const exhaustive: never = discovery;
      return exhaustive;
    }
  }
}

/** Execute one complete strict report and emit only JSON-safe diagnostic facts. */
async function main(): Promise<void> {
  const location = process.argv[2];
  if (location === undefined) {
    throw new Error('usage: process-entry.js STORE_FILE');
  }
  mkdirSync(dirname(location), { recursive: true });
  const executions: Record<string, number> = {};
  const references: { readonly details: string[]; readonly members: Record<string, string> } = { details: [], members: {} };
  const observe = (event: IRunEvent): void => {
    if (event.kind !== 'step') {
      return;
    }
    const { step, phase, reference } = event.event;
    const name = step.memberKey === undefined ? step.slot : `${step.memberKey}/${step.slot}`;
    if (phase === 'execute') {
      const category = name.endsWith('/activity') ? 'search' : name.endsWith('/summary') ? 'summary' : name;
      executions[category] = (executions[category] ?? 0) + 1;
    }
    if ((phase === 'publish' || phase === 'accept') && reference !== undefined) {
      if (name === 'pullRequestDetail') {
        references.details.push(reference.locator);
      } else if (name.endsWith('/summary')) {
        references.members[step.memberKey ?? ''] = reference.locator;
      }
    }
  };

  const analysis = composeAnalysis();
  const workspace = openWorkspace({ location, logicalStore });
  try {
    const result = await workspace.run({
      authoring: analysis.authoring,
      composition: analysis.composition,
      environment: 'fixture',
      observers: [{ observe }],
    }, async (run) => {
      const folded = await run.resolveFold(analysis.report, { requestKey: `exp9:${randomUUID()}` });
      const summaries: Record<string, ISummary> = {};
      for (const member of folded.members) {
        if (member.status === 'succeeded') {
          summaries[member.key] = run.read<ISummary>(member.outcome.reference);
        }
      }
      const report = folded.outcome.status === 'succeeded' ? run.read(folded.outcome.outcome.reference) : null;
      const members = Object.fromEntries(folded.members.map((member) => [member.key, member.status === 'failed'
        ? { status: member.status, message: member.error.message }
        : { status: member.status }]));
      return {
        discovery: discoveredKeys(folded.discovery),
        members,
        summaries,
        fold: { status: folded.outcome.status },
        report,
      };
    });
    process.stdout.write(`${JSON.stringify({ ...result.value, searches: selectedSearches, executions, references })}\n`);
  } finally {
    workspace.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
