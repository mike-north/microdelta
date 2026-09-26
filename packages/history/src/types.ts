/**
 * Compatibility shapes for the scaffold row Store. Their names and string paths
 * describe that storage port, not the target Value Semantics or identity model.
 */
/** Opaque, stable, hex-encoded content digest; equality is string equality. @public */
export type Fingerprint = string & { readonly __fp: unique symbol };

/** A legacy row-storage address, not the future structured semantic path. @public */
export type Path = string;

/**
 * Compatibility identity shape stored in scaffold rows. It does not establish
 * target subject identity, binding correspondence, or collection semantics.
 * @public
 */
export type Identity =
  | { kind: 'type'; type: string; key: string }
  | { kind: 'step'; name: string; inputs: readonly Identity[] }
  | { kind: 'member'; of: Identity; path: Path }
  | { kind: 'collection'; step: string; source: Identity };

/** Legacy row subject shape; future author-supplied subject identity is separate. @public */
export type Subject = Extract<Identity, { kind: 'step' }>;

/** Complete storage tuple. Backends must preserve boundaries between all three parts. @public */
export type ResultKey = {
  step: string;
  revision: number;
  subjectHash: string;
};

/** Legacy persisted read rows; target observation encoding remains undecided. @public */
export type RecordedRead =
  | { kind: 'field'; arg: number; path: Path; fingerprint: Fingerprint }
  | { kind: 'whole'; arg: number; fingerprint: Fingerprint }
  | { kind: 'memo'; key: ResultKey; generation: number };

/** Retained lifecycle states interpreted by repository and claim, not by storage. @public */
export type GenerationState = 'claimed' | 'current' | 'superseded' | 'abandoned';

/** The first observed difference in a persisted read or a nested verification. @public */
export type Divergence =
  | { read: RecordedRead; was: Fingerprint; now: Fingerprint | 'missing' }
  | { read: Extract<RecordedRead, { kind: 'memo' }>; nested: Divergence };

/** Observable call outcomes; an unmemoized named execution has no storage key. @public */
export type Outcome =
  | { kind: 'served'; key: ResultKey; generation: number }
  | { kind: 'executed'; key: ResultKey; generation: number }
  | { kind: 'checked'; key: ResultKey; wouldExecute: boolean; divergence?: Divergence }
  | { kind: 'refused'; key: ResultKey; reason: unknown }
  | { kind: 'failed'; key: ResultKey; error: unknown }
  | { kind: 'abandoned'; key: ResultKey; reason: 'error' | 'lease-expired' | 'refused' }
  | { kind: 'ran' };
