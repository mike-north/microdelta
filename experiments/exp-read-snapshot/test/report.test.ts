/** Counterfeit and incomplete reports must fail the same qualification assertions as actual returned evidence. */
import { expect, test } from '@jest/globals';

import { validateQualificationReport } from '../src/evidence.js';
import type { ICaseEvidence, ICaseObservations, IQualificationReport, ISourceImage } from '../src/protocol.js';

/** These explicit model bytes test validation sensitivity; they are never represented as observed native behavior. */
const before: ISourceImage = { files: [{ name: 'store.sqlite', bytes: 8192, sha256: 'a'.repeat(64) }] };
/** A sampled sidecar creation is a positive counterexample, without making a transient-absence claim. */
const after: ISourceImage = { files: [...before.files, { name: 'store.sqlite-shm', bytes: 32768, sha256: 'b'.repeat(64) }] };
/** Closed-fixture proof includes actual-value records and physical images, not just the words healthy/closed. */
const observations: ICaseObservations = {
  ownerAcknowledgments: [{ revision: 1, currentRevision: 1, value: 'A' }, { revision: 2, currentRevision: 2, value: 'B' }],
  ownerExit: { code: 0, signal: null }, header: { readVersion: 2, writeVersion: 2 },
  sourceImages: [{ stage: 'before-open', image: before }, { stage: 'opened', image: before }, { stage: 'anchored', image: after },
    { stage: 'queried', image: after }, { stage: 'ended', image: after }, { stage: 'closed', image: after }],
  reads: [{ expected: { revision: 2, currentRevision: 2, value: 'B' }, actual: { revision: 2, currentRevision: 2, value: 'B' } }],
  childRecords: [{ role: 'writer', line: '{"kind":"committed","revision":1,"value":"A"}' },
    { role: 'writer', line: '{"kind":"committed","revision":2,"value":"B"}' },
    { role: 'writer', line: '{"kind":"closed"}' }, { role: 'reader', line: '{"kind":"anchored","revision":2,"currentRevision":2,"value":"B"}' }],
  domainMutationOperations: [],
};
/** All candidate cells are explicit even when decisive evidence stops later execution. */
function unexecuted(id: ICaseEvidence['id']): ICaseEvidence {
  return { id, fixtureHealth: 'unproved', execution: 'unexecuted', committed: 'unproved', coherence: 'unproved',
    domainMutation: 'unproved', attribution: 'unproved', sourceEffects: [], transientAbsence: 'unproved' };
}
/** This ordinary completed model has a concrete source-effect witness and a legitimately unexecuted later cell. */
function rejectedModel(): Extract<IQualificationReport, { readonly harness: 'completed' }> {
  return { harness: 'completed', verdict: 'REJECT',
    cases: [{ ...unexecuted('closed-wal-no-sidecars'), fixtureHealth: 'verified-healthy', execution: 'observed', committed: 'satisfied', coherence: 'satisfied',
      domainMutation: 'none', attribution: 'reader-only', sourceEffects: [{ kind: 'created', name: 'store.sqlite-shm' }], observations }, unexecuted('active-wal')],
    rejectionWitness: { caseId: 'closed-wal-no-sidecars', kind: 'source-effect' }, controls: [],
    runtime: { node: 'v24.14.0', driver: '12.9.0', sqlite: '3.53.0', compileOptions: ['MODEL_ONLY'], platform: 'model', arch: 'model' },
    limitations: ['Model only; transient absence unproved and active case unexecuted'],
  };
}

test('an ordinary completed rejection needs a real attempted healthy closed case and a source-image witness', () => {
  expect(validateQualificationReport(rejectedModel())).toEqual({ kind: 'valid' });
});
test('all-unexecuted completed evidence cannot pass by selecting inconclusive and adding generic limitations', () => {
  const report = rejectedModel();
  const { rejectionWitness, ...withoutWitness } = report; void rejectionWitness;
  expect(validateQualificationReport({ ...withoutWitness, verdict: 'INCONCLUSIVE', cases: [unexecuted('closed-wal-no-sidecars'), unexecuted('active-wal')] })).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['closed-layout-not-attempted']) });
});
test('all-unexecuted evidence cannot fabricate a rejected candidate or borrow an unexecuted witness', () => {
  expect(validateQualificationReport({ ...rejectedModel(), cases: [unexecuted('closed-wal-no-sidecars'), unexecuted('active-wal')] })).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['verdict-mismatch', 'closed-layout-not-attempted', 'reject-without-witness']) });
});
test('a verdict must match case evidence even when a different label would make the harness look successful', () => {
  expect(validateQualificationReport({ ...rejectedModel(), verdict: 'INCONCLUSIVE' })).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['verdict-mismatch']) });
});
test('claiming healthy closure without acknowledgments/header/source provenance is invalid ordinary completion', () => {
  const report = rejectedModel();
  expect(validateQualificationReport({ ...report, cases: report.cases.map(cell => {
    if (cell.id !== 'closed-wal-no-sidecars') { return cell; }
    const { observations: removed, ...withoutObservations } = cell; void removed;
    return withoutObservations;
  }) })).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['closed-provenance-unverified', 'reject-without-witness']) });
});
test('a source-effect label without a matching sampled byte/entry difference is not an eligible reject witness', () => {
  const report = rejectedModel();
  expect(validateQualificationReport({ ...report, cases: report.cases.map(cell => cell.id === 'closed-wal-no-sidecars' ? {
    ...cell, observations: { ...observations, sourceImages: observations.sourceImages.map(stage => ({ ...stage, image: before })) },
  } : cell) })).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['reject-without-witness']) });
});
test('a healthy refusal cannot reject when fixture health is actually unproved', () => {
  const report = rejectedModel();
  expect(validateQualificationReport({ ...report, cases: report.cases.map(cell => cell.id === 'closed-wal-no-sidecars' ? {
    ...cell, fixtureHealth: 'unproved', execution: 'refused', committed: 'unproved', coherence: 'unproved', sourceEffects: [],
    observations: { ...observations, reads: [], sourceImages: [{ stage: 'before-open', image: before }, { stage: 'failed', image: before }],
      childRecords: [...observations.childRecords.filter(record => record.role === 'writer'), { role: 'reader', line: '{"kind":"failed","stage":"open","code":"SQLITE_CANTOPEN"}' }],
      failure: { origin: 'candidate', stage: 'open', code: 'SQLITE_CANTOPEN', message: 'Native candidate open failed' } },
  } : cell), rejectionWitness: { caseId: 'closed-wal-no-sidecars', kind: 'read-failure' } })).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['verdict-mismatch', 'reject-without-witness']) });
});
test('a verified healthy attempted refusal can reject with its actual candidate failure retained', () => {
  const report = rejectedModel();
  expect(validateQualificationReport({ ...report, cases: report.cases.map(cell => cell.id === 'closed-wal-no-sidecars' ? {
    ...cell, execution: 'refused', committed: 'unproved', coherence: 'unproved', sourceEffects: [], observations: { ...observations, reads: [],
      sourceImages: [{ stage: 'before-open', image: before }, { stage: 'failed', image: before }],
      childRecords: [...observations.childRecords.filter(record => record.role === 'writer'), { role: 'reader', line: '{"kind":"failed","stage":"open","code":"SQLITE_CANTOPEN"}' }],
      failure: { origin: 'candidate', stage: 'open', code: 'SQLITE_CANTOPEN', message: 'Native candidate open failed' } },
  } : cell), rejectionWitness: { caseId: 'closed-wal-no-sidecars', kind: 'read-failure' } })).toEqual({ kind: 'valid' });
});
test('an explicit actual preparation failure may remain inconclusive without invented fixture health', () => {
  const report: IQualificationReport = { harness: 'infrastructure-inconclusive', verdict: 'INCONCLUSIVE', runtime: null, cases: [unexecuted('closed-wal-no-sidecars'), unexecuted('active-wal')], controls: [],
    limitations: ['Owner process could not start'], preparation: { attempted: true,
      failure: { origin: 'infrastructure', stage: 'writer-start', code: 'ENOENT', message: 'Owned writer executable is unavailable' },
      records: [{ role: 'coordinator', line: '{"kind":"writer-start-failed","code":"ENOENT"}' }], sourceImages: [{ stage: 'before-open', image: { files: [] } }] } };
  expect(validateQualificationReport(report)).toEqual({ kind: 'valid' });
  expect(validateQualificationReport({ ...report, preparation: { ...report.preparation, records: [] } })).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['preparation-failure-unrecorded']) });
});
test('a later infrastructure failure cannot erase an already recorded candidate source-effect counterexample', () => {
  const measured = rejectedModel();
  const report: IQualificationReport = { harness: 'infrastructure-inconclusive', verdict: 'INCONCLUSIVE', runtime: measured.runtime,
    cases: measured.cases, controls: [], limitations: ['Later transport failed'], preparation: { attempted: true,
      failure: { origin: 'infrastructure', stage: 'reader-exit', code: null, message: 'Later transport failed' },
      records: [{ role: 'coordinator', line: '{"kind":"reader-exit-failed"}' }], sourceImages: observations.sourceImages } };
  expect(validateQualificationReport(report)).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['verdict-mismatch']) });
});
test('an unresolved owned child cannot be represented as ordinary completed evidence', () => {
  const report = { ...rejectedModel(), cleanup: [{ index: 0, pid: 123, role: 'reader' as const, kind: 'unresolved' as const,
    failures: [{ origin: 'infrastructure' as const, stage: 'cleanup', code: null, message: 'Owned child exit deadline exceeded' }] }] };
  expect(validateQualificationReport(report)).toMatchObject({ kind: 'invalid', problems: expect.arrayContaining(['owned-cleanup-incomplete']) });
});
