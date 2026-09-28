/**
 * Independent-process entry for the nested selected-read gate. Each command
 * opens the SQLite file fresh through Machine's Node adapter, assembles the
 * production Tracking and Materialization owners over the candidate reader,
 * writes one JSON document to stdout and exits, so every read crosses a real
 * process and reopen boundary.
 *
 *   worker.js <database> <logical-store> publish
 *   worker.js <database> <logical-store> read <input.json>
 *   worker.js <database> <logical-store> compare <input.json>
 */
import { readFileSync } from 'node:fs';

import { createMaterialization } from '@microdelta/materialization';
import { createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import type { ICompletedResultReference } from '@microdelta/history';
import { createTrackingObserver } from '@microdelta/tracking';
import type { ICurrentFactResolution, IObservationCapture, ITrackingObservation } from '@microdelta/tracking';

import { openCandidateNodeIndex } from '../src/node-index.js';
import { publishedResults } from './fixtures.js';
import type { IActivityRecord, IDomainView, IPublishedName } from './fixtures.js';
import { instrument } from './instrumented-sqlite.js';
import type { IReadEvidence } from './instrumented-sqlite.js';
import { exerciseDomain, renderEvidence, summarize } from './scenario.js';

/** Worker output of `read`: summary values, evidence and captured observations for later comparison. */
export interface IReadOutput {
  readonly summary: { readonly value: ReturnType<typeof summarize>; readonly evidence: IReadEvidence; readonly observations: readonly ITrackingObservation[] };
  readonly creation: IReadEvidence;
  readonly output: { readonly value: unknown; readonly evidence: IReadEvidence; readonly observations: readonly ITrackingObservation[] };
  readonly domain: { readonly value: readonly unknown[]; readonly evidence: readonly string[] };
  readonly oldReference: { readonly name: string; readonly evidence: IReadEvidence };
}

/** Worker output of `compare`: one comparison kind per capture and current result, plus read evidence. */
export interface ICompareOutput {
  readonly comparisons: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly evidence: IReadEvidence;
  readonly positiveControl: IReadEvidence;
}

const [databasePath, logicalStore, command, inputPath] = process.argv.slice(2);
if (databasePath === undefined || logicalStore === undefined || command === undefined) {
  throw new Error('worker requires a database path, logical store and command');
}

const machine = createNodeMachine();
const opened = instrument(createNodeSqlite().openSqlite(databasePath));
const index = openCandidateNodeIndex({ connection: opened.connection, sha256: machine, logicalStore });
const binding = { path: ['person:ada', 'summary', 'activity'] };
const referenceOf = (references: Readonly<Record<string, string>>, name: IPublishedName): ICompletedResultReference => {
  const locator = references[name];
  if (locator === undefined) {
    throw new Error(`Missing published reference ${name}`);
  }
  return { kind: 'completed-result', locator };
};

/** Read the JSON input document named on the command line. */
function readInput(): Readonly<Record<string, unknown>> {
  if (inputPath === undefined) {
    throw new Error(`${command} requires an input document`);
  }
  return JSON.parse(readFileSync(inputPath, 'utf8')) as Readonly<Record<string, unknown>>;
}

try {
  switch (command) {
    case 'publish': {
      const references: Record<string, string> = {};
      for (const [name, value] of Object.entries(publishedResults)) {
        references[name] = index.publish(name, value).locator;
      }
      process.stdout.write(JSON.stringify({ references }));
      break;
    }
    case 'read': {
      const references = readInput().references as Readonly<Record<string, string>>;
      const tracking = createTrackingObserver(machine);
      const materialization = createMaterialization({ tracking, reader: index.reader, navigationReader: index.reader });

      const creationStart = opened.mark();
      const view = materialization.materializeView<IActivityRecord>(referenceOf(references, 'base'), binding);
      const creation = opened.evidence(creationStart);

      const summaryStart = opened.mark();
      // eslint-disable-next-line microdelta/tracked-captures -- The gate measures the view's own reads; wrapping the helper would add unrelated implementation evidence.
      const summaryCapture = tracking.capture(() => summarize(view));
      const summaryEvidence = opened.evidence(summaryStart);

      const outputStart = opened.mark();
      const outputCapture = tracking.capture(() => materialization.materializeOutput({ author: view.profile }));
      const outputEvidence = opened.evidence(outputStart);

      const domainView = materialization.materializeView<IDomainView>(referenceOf(references, 'domain'), { path: ['domain'] });
      // eslint-disable-next-line microdelta/tracked-captures -- The shared operation table receives the observer so explicit key and presence operations are exercised.
      const domainCapture = tracking.capture(() => exerciseDomain(tracking, domainView));

      const oldStart = opened.mark();
      const oldName = materialization.materializeView<IActivityRecord>(referenceOf(references, 'base'), binding).profile.name;
      const oldEvidence = opened.evidence(oldStart);

      const result: IReadOutput = {
        summary: { value: summaryCapture.value, evidence: summaryEvidence, observations: summaryCapture.observations },
        creation,
        output: { value: outputCapture.value, evidence: outputEvidence, observations: outputCapture.observations },
        domain: { value: domainCapture.value, evidence: renderEvidence(domainCapture.observations) },
        oldReference: { name: oldName, evidence: oldEvidence },
      };
      process.stdout.write(JSON.stringify(result, (_key, value: unknown) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value));
      break;
    }
    case 'compare': {
      const input = readInput();
      const references = input.references as Readonly<Record<string, string>>;
      const captures = input.captures as Readonly<Record<string, readonly ITrackingObservation[]>>;
      const tracking = createTrackingObserver(machine);
      const materialization = createMaterialization({ tracking, reader: index.reader, navigationReader: index.reader });
      let current: ICompletedResultReference = referenceOf(references, 'base');
      const provider = materialization.currentProvider(() => current, { resolve: (): ICurrentFactResolution => ({ kind: 'unavailable' }) });
      const comparisons: Record<string, Record<string, string>> = {};
      const start = opened.mark();
      for (const [captureName, observations] of Object.entries(captures)) {
        const capture: IObservationCapture<unknown> = { value: undefined, observations };
        comparisons[captureName] = {};
        for (const name of Object.keys(publishedResults) as IPublishedName[]) {
          if (name === 'domain') {
            continue;
          }
          current = referenceOf(references, name);
          const outcome = tracking.compareCurrent(capture, provider);
          const row = comparisons[captureName];
          if (row !== undefined) {
            row[name] = outcome.kind;
          }
        }
      }
      const evidence = opened.evidence(start);
      // Positive control: the same instrumentation observes a leaf payload read when one happens.
      const controlStart = opened.mark();
      index.reader.readNode(referenceOf(references, 'base'), [{ kind: 'property', key: 'profile' }, { kind: 'property', key: 'name' }]);
      const positiveControl = opened.evidence(controlStart);
      const result: ICompareOutput = { comparisons, evidence, positiveControl };
      process.stdout.write(JSON.stringify(result));
      break;
    }
    default:
      throw new Error(`Unknown worker command ${command}`);
  }
} finally {
  opened.connection.close();
}
