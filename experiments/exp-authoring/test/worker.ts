/** Fresh-process proof host: current snapshots enter once and lifecycle events supply execution evidence. */
import { openWorkspace } from 'microdelta';
import type { IRunEvent } from 'microdelta';
import { openDurableHistory } from '@microdelta/history';
import { createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { execute } from '../src/execute.js';
import { reserved } from '../authors/reserved.js';
import { entryFor } from '../authors/entries.js';
import type { IInputs } from '../authors/entries.js';

/** Fixture variants alter ordinary declared input values, never a hidden callback environment. */
function inputsFor(scenario: string): IInputs {
  const title = scenario === 'changed' ? 'cccccccc' : scenario === 'equal' ? 'bbbbbb' : 'aaaa';
  return { pr: { title, labels: [scenario === 'unread' ? 'changed' : 'base'] }, alternate: { title: 'dddddddd', labels: [] }, scoring: { width: 4 }, unusedNumber: scenario === 'unread' ? 2 : 1 };
}
/** A single step's lifecycle evidence; reference remains empty only when no result was established. */
interface INodeReceipt { executions: number; publications: number; reference: string }

/** Execute the selected entry, close its workspace, then read its exact raw storage boundary separately. */
async function main(): Promise<void> {
  const [location, scenario, requestKey, mode] = process.argv.slice(2);
  if (location === undefined || scenario === undefined || requestKey === undefined || mode === undefined) {
    throw new Error('Expected location, scenario, request key and mode');
  }
  const events: IRunEvent[] = [];
  const workspace = openWorkspace({ location, logicalStore: 'authoring-proof' });
  const result = await (mode === 'reserved'
    ? execute(workspace, reserved, { analysis: 'authoring:proof', environment: 'test', requestKey, inputs: { ['__proto__']: { title: 'aaaa' } }, observers: [{ observe(event): void { events.push(event); } }] })
    : execute(workspace, entryFor(scenario, mode), { analysis: 'authoring:proof', environment: 'test', requestKey, inputs: mode === 'subjects' ? { ...inputsFor(scenario), unusedNumber: 11 } : inputsFor(scenario), observers: [{ observe(event): void { events.push(event); } }] })).finally(() => workspace.close());
  const nodes = new Map<string, INodeReceipt>();
  for (const event of events) {
    if (event.kind !== 'step') { continue; }
    const { step, phase, reference } = event.event;
    const node = nodes.get(step.slot) ?? { executions: 0, publications: 0, reference: '' };
    if (phase === 'execute') { node.executions += 1; }
    if (phase === 'publish') { node.publications += 1; }
    if ((phase === 'publish' || phase === 'accept') && reference !== undefined) { node.reference = reference.locator; }
    nodes.set(step.slot, node);
  }
  const history = openDurableHistory({ location, logicalStore: 'authoring-proof', sqlite: createNodeSqlite(), sha256: createNodeMachine(), clock: { currentEpochMilliseconds: () => Date.now() } });
  try {
    const rawStorage = history.reader.readSubtree(result.reference, []);
    process.stdout.write(`${JSON.stringify({ data: result.data, kind: result.kind, reference: result.reference.locator, nodes: Object.fromEntries(nodes), rawStorage })}\n`);
  } finally { history.close(); }
}
await main();
