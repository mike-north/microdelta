/** Unified-constructor alternative only; not an additional public API. @internal */
import type { IBindings, IMemoStep, IMemoEnvelope, IRef } from './surface.js';

/**
 * Cache policy belongs to the library envelope. The author's step is nested
 * intact and may have its own unrelated fields named cache, name, or revision.
 * @internal
 */
export interface IUnifiedEnvelope<Step> extends IMemoEnvelope<Step> {
  readonly cache?: { readonly reuse: 'automatic' | 'explicit' };
}
/** A competing binding API for steps, not a runtime namespace. @internal */
export declare namespace unified {
  /** Explicit reuse asks the current hook/body for acceptance; automatic reuse verifies dependencies. @internal */
  function memo<Input, Output>(envelope: IUnifiedEnvelope<IMemoStep<Input, Output>>): (input: IBindings<Input>) => IRef<Output>;
}
