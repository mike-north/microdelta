/** Pure finite evidence rules; host observations supply facts, while these rules grant neither storage authority nor production adoption. @packageDocumentation */
import type { ICaseEvidence, ICaseObservations, ICandidateVerdict, ICorrelatedPair, IPairAssertion, IQualificationReport, IReadFailure, IReportValidation, ISourceEffect, ISourceImage } from './protocol.js';

/** Both ordinary healthy layouts are necessary for adoption, independently of any optional support cell. */
const mandatoryLayouts = ['closed-wal-no-sidecars', 'active-wal'] as const;
/** A physical closed fixture is prepared from these literal acknowledged commits. */
const closedCommits: readonly ICorrelatedPair[] = [{ revision: 1, currentRevision: 1, value: 'A' }, { revision: 2, currentRevision: 2, value: 'B' }];
/** Report problems describe missing evidence rather than asking a verdict label to certify itself. */
type IReportProblem = Extract<IReportValidation, { readonly kind: 'invalid' }>['problems'][number];

/** Compare actual correlated data with an independently selected committed answer. @internal */
export function assertCommittedPair(actual: ICorrelatedPair, expected: ICorrelatedPair): IPairAssertion {
  if (actual.revision !== actual.currentRevision) { return { kind: 'counterexample', reason: 'mixed-revisions' }; }
  return actual.revision === expected.revision && actual.currentRevision === expected.currentRevision && actual.value === expected.value
    ? { kind: 'satisfied' } : { kind: 'counterexample', reason: 'stale-or-wrong-value' };
}

/** Compare sampled source content and entries only; equal images make no transient-absence assertion. @internal */
export function sourceEffects(before: ISourceImage, after: ISourceImage): readonly ISourceEffect[] {
  const oldFiles = new Map(before.files.map(file => [file.name, file]));
  const newFiles = new Map(after.files.map(file => [file.name, file]));
  const effects: ISourceEffect[] = [];
  for (const name of [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort()) {
    const old = oldFiles.get(name); const current = newFiles.get(name);
    if (old === undefined) { effects.push({ kind: 'created', name }); }
    else if (current === undefined) { effects.push({ kind: 'removed', name }); }
    else if (old.bytes !== current.bytes || old.sha256 !== current.sha256) { effects.push({ kind: 'content-changed', name }); }
  }
  return effects;
}

/** Make the mechanism decision separately from successful execution of the evidence harness. @internal */
export function classifyCandidate(cases: readonly ICaseEvidence[]): ICandidateVerdict {
  for (const cell of cases) {
    if (cell.execution === 'unexecuted') { continue; }
    if (cell.attribution === 'reader-only' && cell.sourceEffects.length > 0 || cell.domainMutation === 'observed') { return 'REJECT'; }
    if (cell.fixtureHealth === 'verified-healthy' && (cell.committed === 'counterexample' || cell.coherence === 'counterexample'
      || mandatoryLayouts.some(id => id === cell.id) && (cell.execution === 'refused' || cell.execution === 'failed'))) { return 'REJECT'; }
  }
  return mandatoryLayouts.every(id => cases.some(cell => cell.id === id && cell.fixtureHealth === 'verified-healthy'
    && cell.execution === 'observed' && cell.committed === 'satisfied' && cell.coherence === 'satisfied'
    && cell.domainMutation === 'none' && cell.attribution === 'reader-only' && cell.sourceEffects.length === 0
    && cell.transientAbsence === 'qualified')) ? 'PASS' : 'INCONCLUSIVE';
}

/** Preserve native host meaning and original in-process cause; fixture SQL failure is not a History schema diagnosis. @internal */
export function readFailure(cause: unknown, stage: 'open' | 'query'): IReadFailure {
  let code: unknown;
  try { code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined; }
  catch { return { kind: 'failed', cause }; }
  if (code === 'ENOENT') { return { kind: 'absent', cause }; }
  if (code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB') { return { kind: 'corrupt', cause }; }
  if (code === 'SQLITE_READONLY_ROLLBACK' || code === 'SQLITE_READONLY_RECOVERY') { return { kind: 'recovery-required', cause }; }
  if (typeof code === 'string' && code.startsWith('SQLITE_BUSY')) { return { kind: 'busy', cause }; }
  return { kind: stage === 'query' && code === 'SQLITE_ERROR' ? 'query-failed' : 'failed', cause };
}

/** Healthy closure is supported by values, native exit, file header/layout and retained independent process records. */
function closedProvenance(cell: ICaseEvidence): boolean {
  const observations = cell.observations;
  if (cell.fixtureHealth !== 'verified-healthy' || observations === undefined) { return false; }
  const before = observations.sourceImages.find(stage => stage.stage === 'before-open')?.image.files;
  return observations.ownerAcknowledgments.length === closedCommits.length
    && closedCommits.every((pair, index) => {
      const actual = observations.ownerAcknowledgments[index];
      return actual !== undefined && assertCommittedPair(actual, pair).kind === 'satisfied';
    }) && observations.ownerExit.code === 0 && observations.ownerExit.signal === null
    && observations.header.readVersion === 2 && observations.header.writeVersion === 2
    && before?.length === 1 && before[0]?.name === 'store.sqlite' && before[0].bytes > 0
    && observations.childRecords.some(record => record.role === 'writer' && record.line.length > 0)
    && observations.childRecords.some(record => record.role === 'reader' && record.line.length > 0);
}

/** Rejection must point to recorded data, a native failure, an attributed image difference or an actual domain operation. */
function eligibleWitness(report: IQualificationReport): boolean {
  const witness = report.rejectionWitness;
  const cell = report.cases.find(entry => entry.id === witness?.caseId);
  if (witness === undefined || cell === undefined || cell.execution === 'unexecuted' || cell.observations === undefined) { return false; }
  const observed: ICaseObservations = cell.observations;
  switch (witness.kind) {
    case 'source-effect': {
      const before = observed.sourceImages.find(stage => stage.stage === 'before-open');
      return cell.attribution === 'reader-only' && before !== undefined && cell.sourceEffects.some(effect => observed.sourceImages
        .filter(stage => stage.stage !== 'before-open').some(stage => sourceEffects(before.image, stage.image)
          .some(actual => actual.kind === effect.kind && actual.name === effect.name)));
    }
    case 'read-failure':
      return cell.fixtureHealth === 'verified-healthy' && (cell.execution === 'refused' || cell.execution === 'failed')
        && observed.failure?.origin === 'candidate' && observed.failure.message.length > 0
        && observed.childRecords.some(record => record.role === 'reader' && record.line.length > 0);
    case 'committed-value':
      return cell.fixtureHealth === 'verified-healthy' && cell.committed === 'counterexample' && observed.reads.some(read => {
        const assertion = assertCommittedPair(read.actual, read.expected);
        return assertion.kind === 'counterexample' && assertion.reason === 'stale-or-wrong-value';
      });
    case 'coherence':
      return cell.fixtureHealth === 'verified-healthy' && cell.coherence === 'counterexample' && observed.reads.some(read => {
        const assertion = assertCommittedPair(read.actual, read.expected);
        return assertion.kind === 'counterexample' && assertion.reason === 'mixed-revisions';
      });
    case 'domain-mutation': return cell.domainMutation === 'observed' && observed.domainMutationOperations.length > 0;
  }
}

/** Refuse counterfeit ordinary completion while keeping measured preparation failure explicitly inconclusive. @internal */
export function validateQualificationReport(report: IQualificationReport): IReportValidation {
  const problems = new Set<IReportProblem>();
  if (report.verdict !== classifyCandidate(report.cases)) { problems.add('verdict-mismatch'); }
  if (report.harness === 'infrastructure-inconclusive') {
    if (report.preparation.failure.origin !== 'infrastructure' || report.preparation.failure.message.length === 0
      || report.preparation.records.length === 0 || report.rejectionWitness !== undefined) { problems.add('preparation-failure-unrecorded'); }
  } else {
    const closed = report.cases[0];
    if (closed?.id !== 'closed-wal-no-sidecars' || closed.execution === 'unexecuted') { problems.add('closed-layout-not-attempted'); }
    if (closed === undefined || !closedProvenance(closed)) { problems.add('closed-provenance-unverified'); }
  }
  if (report.verdict === 'REJECT' && !eligibleWitness(report)) { problems.add('reject-without-witness'); }
  return problems.size === 0 ? { kind: 'valid' } : { kind: 'invalid', problems: [...problems] };
}
