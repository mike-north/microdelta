/** The non-SQLite effects control separates deliberate lifecycle changes from a fresh-inode transient blindspot baseline. */
import { forbiddenEffects } from './images.js';
import type { ISourceImage } from './images.js';
/** A pathname observation is not a complete directory/source image. Only actual ENOENT proves this deliberate deletion. @internal */
export type IDeletionObservation = {
    readonly kind: 'missing';
    readonly code: 'ENOENT';
} | {
    readonly kind: 'present';
} | {
    readonly kind: 'failed';
    readonly code: string | null;
};
/** Sensitivity and the explicitly missed between-image changes are separate control outcomes. @internal */
export interface IEffectsControlAssessment {
    readonly mutationDetected: boolean;
    readonly deletionDetected: boolean;
    readonly blindspotObserved: boolean;
    readonly observed: boolean;
}
/** Exact images compare the transient phase only to its newly recreated baseline, never across the deliberate replacement. @internal */
export function assessEffectsControl(initial: ISourceImage | undefined, mutated: ISourceImage | undefined, deletion: IDeletionObservation | undefined, fresh: ISourceImage | undefined, restored: ISourceImage | undefined): IEffectsControlAssessment { const mutationDetected = !!initial && !!mutated && forbiddenEffects(initial, mutated).length > 0; const deletionDetected = !!mutated?.files.some(file => file.name === 'store.sqlite') && deletion?.kind === 'missing' && deletion.code === 'ENOENT'; const blindspotObserved = !!fresh && !!restored && forbiddenEffects(fresh, restored).length === 0; return { mutationDetected, deletionDetected, blindspotObserved, observed: mutationDetected && deletionDetected && blindspotObserved }; }
