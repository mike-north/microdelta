/**
 * Structural binding descriptors: the durable, process-independent address of a
 * declared input, callable or step slot. Descriptors are the only correspondence
 * evidence that may be retained; display labels, subjects, function text or
 * identity, hashes and registration ordinals never substitute for them (CMP-6).
 */

/**
 * The kind of declared slot a descriptor addresses. Inputs are current
 * configuration values. Callables are composition-wide callable slots holding
 * either a supplied helper function or a supplied step implementation; the two
 * share one namespace, so a slot name denotes at most one of them. Steps are
 * source or memoized declarations at the composition level or within an
 * explicitly keyed member.
 * @alpha
 */
export type IBindingRole = 'input' | 'callable' | 'step';

/**
 * A structural address within one composition scope. Two descriptors denote
 * the same slot exactly when every field is equal; there is no partial match.
 * Input and callable slots are composition-wide and carry no member key. A
 * member's step slot carries its explicit member key; a composition-level step
 * slot has no member key field at all, so the two levels never alias.
 * @alpha
 */
export interface IBindingDescriptor {
  /** The composition (analysis) scope that owns the slot. */
  readonly scope: string;
  /** Which kind of declared slot this is. */
  readonly role: IBindingRole;
  /** The author-declared slot name within its role and member. */
  readonly slot: string;
  /** The explicit member key; present only for step slots within a member. */
  readonly memberKey?: string;
}
