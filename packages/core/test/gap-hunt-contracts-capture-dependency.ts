/** Ordinary imported helper deliberately carries a transitive untracked configuration influence. */
export const configuration = { factor: 2 };
/** This ordinary export has no tracking brand; a caller must not mistake its import for tracked evidence. */
export function importedHelper(value: number): number { return value * configuration.factor; }
