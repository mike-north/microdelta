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
 * source, memoized or strict fold declarations at the composition level,
 * within an explicitly keyed member, or within a keyed fanout template.
 * @alpha
 */
export type IBindingRole = 'input' | 'callable' | 'step';

/**
 * A structural address within one composition scope. Two descriptors denote
 * the same slot exactly when every field is equal; there is no partial match.
 * Input and callable slots are composition-wide and carry no member key. A
 * member's step slot carries its explicit member key; a composition-level step
 * slot has no member key field at all, so the two levels never alias. A
 * fanout template step carries its template slot and the collection binding
 * that scopes its member keys (CMP-4, COL-1); its instance adds the member
 * key. Descriptors without the template fields keep their M3 meaning exactly.
 * @alpha
 */
export interface IBindingDescriptor {
  /** The composition (analysis) scope that owns the slot. */
  readonly scope: string;
  /** Which kind of declared slot this is. */
  readonly role: IBindingRole;
  /** The author-declared slot name within its role and member. */
  readonly slot: string;
  /** The member key: explicit for a member's step slot, discovered for a template instance. */
  readonly memberKey?: string;
  /** The fanout template slot; present, with `collection`, for template steps only. */
  readonly template?: string;
  /** The composition-level step slot of the keyed collection a template fans out over. */
  readonly collection?: string;
}
