/** Ordinary imported declarations used by both independent fixture processes. */
import { tracked } from '../src/protocol.js';

/** The helper's captured config is tracked at the field it actually reads. */
export const importedConfig = tracked({ factor: 2, unread: 'before' });

/** The default helper's emitted source text is observed automatically when called. */
export const importedHelper = tracked((score: number): number => score * importedConfig.factor);

/** A code edit bound to the same structural helper slot must invalidate prior work. */
export const editedHelper = tracked((score: number): number => score * importedConfig.factor + 1);

/** Supplying a callable is a current structural declaration, not a saved closure. */
export const suppliedAssessor = tracked((score: number): number => score + 3);

/** Edits to this uncalled declaration must not become an invented observation. */
export const unusedHelper = tracked((score: number): number => score + 100);

/** A second uncalled implementation tests absence of speculative evidence. */
export const editedUnusedHelper = tracked((score: number): number => score + 101);
