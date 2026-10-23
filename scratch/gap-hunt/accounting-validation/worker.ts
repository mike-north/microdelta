/** ACC-002: each process checks one source with real durable owners and synthetic sends. */
import { join } from 'node:path';

import { openDurableAccounting } from '@microdelta/accounting';
import { createNodeSqlite } from '@microdelta/machine-node';
import { authoring, currentExecution, openWorkspace } from 'microdelta';
import type { IPreviousResult, ISourceOutcome, ISourceOutcomes } from 'microdelta';

/** The payload's meaning is constant; explicit retention controls its exact identity. */
interface IPayload { readonly value: string }
/** Effects enter through one declared helper, with no undeclared callback captures. */
interface IHelpers {
  readonly check: (outcome: ISourceOutcomes, previous: IPreviousResult<IPayload> | undefined) => Promise<ISourceOutcome<IPayload>>;
}
const directory = process.argv[2];
const phase = process.argv[3];
if (directory === undefined || (phase !== 'cold' && phase !== 'retain-b' && phase !== 'retain-c' && phase !== 'fresh-negative')) {
  throw new Error('Expected directory and phase');
}
let sourceChecks = 0;
let sends = 0;
/** One actual execution operation per independent source check; no provider is contacted. */
async function check(outcome: ISourceOutcomes, previous: IPreviousResult<IPayload> | undefined): Promise<ISourceOutcome<IPayload>> {
  sourceChecks += 1;
  await currentExecution().operation<IPayload>({
    name: 'validate',
    binding: `synthetic-validation:${phase}`,
    perform: async () => {
      sends += 1;
      return { kind: 'succeeded', value: { value: 'stable' }, usage: { report: `observed:${phase}`, quantities: [{ unit: 'units', amount: phase === 'cold' ? 100 : 1 }] } };
    },
  });
  if (previous !== undefined && phase !== 'fresh-negative') {
    return outcome.retain(previous);
  }
  return outcome.fresh<IPayload>({ value: 'stable' });
}
const api = authoring<Record<string, never>, IHelpers>();
const source = api.source<IPayload>({
  subject: 'accounted-source',
  finality: () => false,
  run: ({ outcome, previous, helpers }) => helpers.check(outcome, previous),
});
const composition = api.compose({ scope: 'accounting-validation', helpers: [{ slot: 'check', helper: check }], steps: [{ slot: 'source', declaration: source }] });
const accounting = openDurableAccounting({ sqlite: createNodeSqlite(), location: join(directory, 'accounting.sqlite'), logicalStore: 'acc002' });
const workspace = openWorkspace({ location: join(directory, 'history.sqlite'), logicalStore: 'acc002', accounting });
try {
  const result = await workspace.run({ authoring: api, composition, environment: 'synthetic', runId: `acc002:${phase}` }, async run => {
    const resolved = await run.resolve({ scope: 'accounting-validation', role: 'step', slot: 'source' }, { requestKey: `check:${phase}` });
    return { resolved, ownUsage: run.usage({ run: `acc002:${phase}` }), originalUsage: run.usage({ run: 'acc002:cold' }), allUsage: run.usage(), operations: await run.inspectOperations() };
  });
  console.log(JSON.stringify({ phase, sourceChecks, sends, ...result.value }));
} finally {
  workspace.close();
  accounting.close();
}
