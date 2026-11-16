/** Specific missing/empty input preservation composes the generic finite coordination policy without imposing it on foreign-valid WAL. */
import { classifyEffects } from './effects-policy.js';
import type { IEffectsClassification, IEstablishedLayout, IEffectStageContext } from './effects-policy.js';
import type { ISourceImage } from './images.js';
/** The original complete baseline is separate from later stage images; missing proof grants no new counterexample. @internal */
export interface ICaseBaseline {
    readonly proved: boolean;
    readonly image: ISourceImage | undefined;
}
/** Only a proved original Q11/Q12 input and actual reader-only window establish this stronger entry-preservation violation. @internal */
export function caseEffects(id: string, layout: IEstablishedLayout, context: IEffectStageContext, baseline: ICaseBaseline, before: ISourceImage, after: ISourceImage): IEffectsClassification {
    const generic = classifyEffects(id, layout, context, before, after);
    const original = baseline.image;
    const selected = baseline.proved && context.readerOnly && original !== undefined && (id === 'Q11' && original.files.length === 0 || id === 'Q12' && original.files.length === 1 && original.files[0]?.name === 'store.sqlite' && original.files[0].bytes.length === 0);
    if (!selected) {
        return generic;
    }
    const additions = generic.unknown.filter(effect => effect.before === null && (effect.file === 'store.sqlite-wal' || effect.file === 'store.sqlite-shm'));
    return { allowed: generic.allowed, forbidden: [...generic.forbidden, ...additions.map(effect => ({ ...effect, reason: `${id} proved original input forbids new sidecar entry` }))], unknown: generic.unknown.filter(effect => !additions.includes(effect)) };
}
