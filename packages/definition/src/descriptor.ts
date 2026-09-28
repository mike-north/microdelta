/**
 * Structural binding descriptors: the durable, process-independent address of a
 * declared input, callable or step slot. Descriptors are the only correspondence
 * evidence that may be retained; display labels, subjects, function text or
 * identity, hashes and registration ordinals never substitute for them (CMP-6).
 */

/**
 * The kind of declared slot a descriptor addresses. Inputs are current
 * configuration values, callables are supplied helper functions, and steps are
 * source or memoized declarations within an explicitly keyed member.
 * @alpha
 */
export type IBindingRole = 'input' | 'callable' | 'step';

/**
 * A structural address within one composition scope. Two descriptors denote
 * the same slot exactly when every field is equal; there is no partial match.
 * M3 input and callable slots are composition-wide and carry no member key;
 * step slots always carry the explicit member key of their member.
 * @alpha
 */
export interface IBindingDescriptor {
  /** The composition (analysis) scope that owns the slot. */
  readonly scope: string;
  /** Which kind of declared slot this is. */
  readonly role: IBindingRole;
  /** The author-declared slot name within its role and member. */
  readonly slot: string;
  /** The explicit member key; present for step slots only. */
  readonly memberKey?: string;
}
