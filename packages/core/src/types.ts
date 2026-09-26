/** Opaque, stable, hex-encoded content digest; equality is string equality. @public */
export type Fingerprint = string & { readonly __fp: unique symbol };

/** A node address relative to a value root: `""`, `"body"`, or `"sections[3].title"`. @public */
export type Path = string;

/**
 * Durable, readable identity structure, independent of memoization and content.
 * Collection identities name the source once, rather than enumerating its members.
 * @public
 */
export type Identity =
  | { kind: 'type'; type: string; key: string }
  | { kind: 'step'; name: string; inputs: readonly Identity[] }
  | { kind: 'member'; of: Identity; path: Path }
  | { kind: 'collection'; step: string; source: Identity };

/** A step name plus its identified arguments; unidentified content is excluded. @public */
export type Subject = Extract<Identity, { kind: 'step' }>;

/** Complete storage tuple. Backends must preserve boundaries between all three parts. @public */
export type ResultKey = {
  step: string;
  revision: number;
  subjectHash: string;
};

/** Durable read addresses and fingerprints, never process-local tracking tags. @public */
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
