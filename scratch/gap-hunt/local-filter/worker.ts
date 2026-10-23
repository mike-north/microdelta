/** Independent processes share only exact History references and immutable payloads. */
import { readFileSync } from 'node:fs';
import { openDurableHistory } from '@microdelta/history';
import type { ICompletedResultReference, ICompletedResultReader } from '@microdelta/history';
import { createNodeMachine, createNodeSqlite } from '@microdelta/machine-node';
import { createTracking, createTrackingObserver } from '@microdelta/tracking';
import type { IObservationCapture } from '@microdelta/tracking';
import { createMaterialization } from '@microdelta/materialization';

/** Scalar fields permit a local filter without eagerly loading an unread payload. */
interface IRows { readonly adaName: string; readonly adaScore: number; readonly benName: string; readonly benScore: number; readonly unread: string }
const location = process.argv[2];
const mode = process.argv[3];
const receipt = process.argv[4];
if (location === undefined || mode === undefined) {throw new Error('location and mode required');}
const machine = createNodeMachine();
const history = openDurableHistory({ sqlite: createNodeSqlite(), clock: { currentEpochMilliseconds: () => 1000 }, sha256: machine, location, logicalStore: 'store:local-filter' });
try {
  if (mode === 'seed') {
    const acquired = history.acquireWriter({ holder: 'seed', leaseMilliseconds: 10000 });
    if (acquired.kind !== 'acquired') {throw new Error('seed writer refused');}
    const attempt = history.allocateAttempt(acquired.lease, { analysis: 'analysis:filter', environment: 'env:filter', subject: 'rows', version: 1, attemptKey: 'seed', intentDigest: 'filter-seed' });
    history.stageAttempt(acquired.lease, { attemptId: attempt.attemptId, payload: { adaName: 'Ada', adaScore: 9, benName: 'Ben', benScore: 2, unread: 'U'.repeat(20000) }, provenance: { format: 'filter-seed', formatVersion: 1, content: { origin: 'process-A' } }, dependencies: [] });
    const reference = history.publishAttempt(acquired.lease, attempt.attemptId);
    history.releaseWriter(acquired.lease);
    console.log(JSON.stringify({ reference, envelope: history.readEnvelope(reference), pid: process.pid }));
  } else {
    if (receipt === undefined) {throw new Error('seed receipt required');}
    const raw: unknown = JSON.parse(readFileSync(receipt, 'utf8'));
    if (typeof raw !== 'object' || raw === null) {throw new Error('seed receipt malformed');}
    const ref: unknown = Reflect.get(raw, 'reference');
    if (typeof ref !== 'object' || ref === null || Reflect.get(ref, 'kind') !== 'completed-result' || typeof Reflect.get(ref, 'locator') !== 'string') {throw new Error('reference malformed');}
    // Read and narrow each locator value rather than casting persisted JSON.
    const locator: unknown = Reflect.get(ref, 'locator');
    if (typeof locator !== 'string') {throw new Error('locator malformed');}
    const reference: ICompletedResultReference = { kind: 'completed-result', locator };
    const before = history.readEnvelope(reference);
    const selected: string[] = [];
    const reader: ICompletedResultReader = {
      readSelected(exact, request) { selected.push(request.address.map(part => part.kind === 'property' ? part.key : String(part.index)).join('.')); return history.reader.readSelected(exact, request); },
      resolveFingerprint(exact, request) { return history.reader.resolveFingerprint(exact, request); },
    };
    const observer = createTrackingObserver(machine);
    const materialization = createMaterialization({ tracking: observer, reader });
    const rows = materialization.materialize<IRows>(reference, { path: ['rows'] });
    const other = createTrackingObserver(machine);
    const independent = createMaterialization({ tracking: other, reader }).materialize<IRows>(reference, { path: ['independent'] });
    const independentBefore = other.capture(() => independent.adaName).value;
    const local = createTracking(machine);
    const filter = local.cell(5);
    let evaluations = 0;
    const filtered = local.derived(() => { evaluations++; const threshold = filter.get(); return [rows.adaScore >= threshold ? rows.adaName : '', rows.benScore >= threshold ? rows.benName : ''].filter(name => name !== ''); });
    /** This fixture composes the existing local derivation with selected History reads. */
    function captureFilter(): IObservationCapture<string[]> {
      // eslint-disable-next-line microdelta/tracked-captures -- TEST-6 deliberately composes a process-local cell derivation with immutable retained data; this lower-level observation fixture does not declare a durable tracked function.
      return observer.capture(() => filtered.get());
    }
    const initial = captureFilter();
    const cached = filtered.get();
    const initialEvaluations = evaluations;
    filter.set(1);
    const widened = captureFilter();
    filter.set(10);
    const empty = captureFilter();
    // Another reader keeps its own view and captured facts while local state changes.
    const independentCapture = other.capture(() => independent.adaName);
    console.log(JSON.stringify({ pid: process.pid, reference, initial: initial.value, cached, widened: widened.value, empty: empty.value, evaluations, initialEvaluations, selected, observationCounts: [initial.observations.length, widened.observations.length, empty.observations.length], independentBefore, independent: independentCapture.value, before, after: history.readEnvelope(reference), root: history.reader.readSubtree(reference, []) }));
  }
} finally { history.close(); }
