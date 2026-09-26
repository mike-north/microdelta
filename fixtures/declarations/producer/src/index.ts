/** Distinct contract tiers used only by boundary consumers. @packageDocumentation */
/** A user-facing fixture result. @public */
export function publicValue(): string { return 'public'; }
/** A separately selected preview fixture result. @beta */
export function betaValue(): string { return 'beta'; }
/** An approved sibling-only fixture result. @alpha */
export function alphaValue(): string { return 'alpha'; }
/** An own-package fixture result. @internal */
export function _internalValue(): string { return 'internal'; }
/** Private fixture state has no entry-point export or declaration view. */
function hiddenValue(): string { return 'hidden'; }
void hiddenValue;
/** An internal value shape for negative leak probes. @internal */
export interface _IInternalValue { readonly secret: string }
