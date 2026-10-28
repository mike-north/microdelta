/** Evidence vocabulary for the bounded host qualification; it grants no production storage or History authority. @packageDocumentation */

/** Every observed stage and process is bounded independently of SQLite's own busy timeout. @internal */
export const qualificationBounds = Object.freeze({
  maximumChildren: 2, stageMilliseconds: 5_000, childMilliseconds: 15_000,
  caseMilliseconds: 20_000, totalMilliseconds: 180_000, cleanupMilliseconds: 5_000,
  maximumRows: 72, maximumPayloadBytes: 4_096, maximumSourceFileBytes: 2_097_152,
  maximumSourceBytesPerCase: 8_388_608, maximumProtocolLineBytes: 8_192,
  maximumChildOutputBytes: 65_536, maximumCommandsPerCase: 16,
});

/** The two ordinary healthy layouts are adoption obligations, never optional support cells. @internal */
export type IMandatoryLayout = 'closed-wal-no-sidecars' | 'active-wal';
/** Additional layouts delimit support and failure evidence without redefining mandatory health. @internal */
export type ICaseId = IMandatoryLayout | 'active-readonly-sidecars' | 'retained-wal-missing-shm'
  | 'retained-wal-inaccessible-shm' | 'missing' | 'empty' | 'foreign-sqlite' | 'corrupt' | 'hot-journal';
/** An atomic fixture revision and current row must refer to the same committed value. @internal */
export interface ICorrelatedPair { readonly revision: number; readonly currentRevision: number; readonly value: string }
/** Compact source fingerprints preserve sampled content/entry differences, not transient-effect absence. @internal */
export interface ISourceFile { readonly name: string; readonly bytes: number; readonly sha256: string }
/** One source directory is observed only while legitimate modifiers are paused or closed. @internal */
export interface ISourceImage { readonly files: readonly ISourceFile[] }
/** An observed change is evidence only when its reader-only attribution is established. @internal */
export interface ISourceEffect { readonly kind: 'created' | 'removed' | 'content-changed'; readonly name: string }
/** A framed child record remains inspectable alongside normalized values, rather than acting as the sole physical proof. @internal */
export interface IChildRecord { readonly role: 'writer' | 'reader' | 'coordinator'; readonly line: string }
/** Source images are attributed to actual reader-lifetime stages while other modifiers are paused or closed. @internal */
export interface ISourceStage { readonly stage: 'before-open' | 'opened' | 'anchored' | 'queried' | 'pinned' | 'ended' | 'closed' | 'failed'; readonly image: ISourceImage }
/** Serialized failures preserve finite native facts and distinguish infrastructure from attempted candidate behavior. @internal */
export interface IObservedFailure { readonly origin: 'candidate' | 'infrastructure'; readonly stage: string; readonly code: string | null; readonly message: string }
/** Actual acknowledgments, closure, header, values and source images support a case's conclusions; labels alone are insufficient. @internal */
export interface ICaseObservations {
  readonly ownerAcknowledgments: readonly ICorrelatedPair[];
  readonly ownerExit: { readonly code: number | null; readonly signal: string | null };
  readonly header: { readonly readVersion: number; readonly writeVersion: number };
  readonly sourceImages: readonly ISourceStage[];
  readonly reads: readonly { readonly expected: ICorrelatedPair; readonly actual: ICorrelatedPair }[];
  readonly childRecords: readonly IChildRecord[];
  readonly runtime?: IRuntimePins;
  readonly failure?: IObservedFailure;
  readonly domainMutationOperations: readonly string[];
}
/** Each cell separates useful read truth from the stronger source-effects hypothesis. @internal */
export interface ICaseEvidence {
  readonly id: ICaseId;
  readonly fixtureHealth: 'verified-healthy' | 'invalid-or-unavailable' | 'unproved';
  readonly execution: 'observed' | 'refused' | 'failed' | 'unexecuted';
  readonly committed: 'satisfied' | 'counterexample' | 'unproved';
  readonly coherence: 'satisfied' | 'counterexample' | 'unproved';
  readonly domainMutation: 'none' | 'observed' | 'unproved';
  readonly attribution: 'reader-only' | 'unproved';
  readonly sourceEffects: readonly ISourceEffect[];
  readonly transientAbsence: 'qualified' | 'unproved';
  readonly observations?: ICaseObservations;
}
/** A mechanism decision is distinct from successful execution of the evidence harness. @internal */
export type ICandidateVerdict = 'PASS' | 'REJECT' | 'INCONCLUSIVE';
/** Assertions explain a concrete stale/torn value instead of treating query fulfillment as truth. @internal */
export type IPairAssertion = { readonly kind: 'satisfied' }
  | { readonly kind: 'counterexample'; readonly reason: 'stale-or-wrong-value' | 'mixed-revisions' };
/** Transport preserves host failure meaning without inventing History schema or store-identity diagnoses. @internal */
export interface IReadFailure { readonly kind: 'absent' | 'corrupt' | 'recovery-required' | 'busy' | 'query-failed' | 'failed'; readonly cause: unknown }
/** Actual runtime pins must come from the loaded binary; static headers are insufficient. @internal */
export interface IRuntimePins { readonly node: string; readonly driver: string; readonly sqlite: string; readonly compileOptions: readonly string[]; readonly platform: string; readonly arch: string; readonly sqliteSourceId?: string; readonly driverEntry?: string }
/** Only real tagged controls may establish sensitivity of the same candidate-value and source-effect assertions. @internal */
export interface IControlEvidence { readonly name: 'stale-snapshot' | 'mixed-revisions' | 'immediate' | 'content-and-sidecar' | 'transient-restoration'; readonly execution: 'observed' | 'unexecuted'; readonly oracleRejected: boolean; readonly limitation?: string; readonly evidencePath?: string }
/** The command may complete faithfully with a rejected candidate; no production adoption follows any verdict. @internal */
interface IQualificationRecord {
  readonly verdict: ICandidateVerdict;
  readonly cases: readonly ICaseEvidence[]; readonly controls: readonly IControlEvidence[];
  readonly limitations: readonly string[];
  readonly artifactDirectory?: string;
  readonly rejectionWitness?: { readonly caseId: ICaseId; readonly kind: 'source-effect' | 'read-failure' | 'committed-value' | 'coherence' | 'domain-mutation' };
}
/** Ordinary completion must contain an attempted healthy closed case; preparation failure has its own explicit inconclusive branch. @internal */
export type IQualificationReport = IQualificationRecord & (
  | { readonly harness: 'completed'; readonly runtime: IRuntimePins }
  | { readonly harness: 'infrastructure-inconclusive'; readonly verdict: 'INCONCLUSIVE'; readonly runtime: IRuntimePins | null;
      readonly preparation: { readonly attempted: true; readonly failure: IObservedFailure; readonly records: readonly IChildRecord[]; readonly sourceImages: readonly ISourceStage[] } }
);
/** Report validation prevents fabricated conclusions from hiding behind a successful harness command. @internal */
export type IReportValidation = { readonly kind: 'valid' } | { readonly kind: 'invalid'; readonly problems: readonly (
  'verdict-mismatch' | 'closed-layout-not-attempted' | 'closed-provenance-unverified' | 'reject-without-witness' | 'preparation-failure-unrecorded'
)[] };
