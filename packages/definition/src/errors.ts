/**
 * Definition & Binding failures. Each code names one violated composition or
 * invocation contract so owners and tests can distinguish, for example, an
 * undeclared edge from a closed scope without parsing messages.
 */

/**
 * The closed set of Definition failure reasons.
 *
 * - `invalid-subject`: a memoized or source subject is not a complete nonempty string (RES-001).
 * - `invalid-version`: a compatibility version is not a positive safe integer (REUSE-008).
 * - `invalid-callback`: an author callback is not a directly supplied function.
 * - `illegal-edge`: a child edge is outside the supported fixed M3 topology (CMP-1/7).
 * - `forged-declaration`: a registered declaration was not minted by Definition.
 * - `invalid-descriptor`: a scope, member key or slot is not a nonempty string.
 * - `invalid-input`: an input value cannot be copied into a frozen framework-owned snapshot.
 * - `conflicting-subject`: distinct definitions claim one scoped subject (RES-001).
 * - `unresolved-parent`: an invocation scope was requested for a slot that is not one bound step.
 * - `composition-phase`: framework result resolution was attempted while composing (CMP-9).
 * - `scope-closed`: a handle was used after its invocation scope ended.
 * - `scope-inactive`: a handle was used outside its own currently executing invocation.
 * - `unsupported-arguments`: an M3 handle received runtime arguments.
 * - `invalid-result`: the invocation port did not supply a `{ data }` carrier.
 * - `forged-composition`: an invocation was requested for a composition this family did not mint.
 * - `invalid-bindings`: facade bindings are not a plain record or collide with a context name Definition supplies.
 * - `invalid-previous`: a supplied previous-result carrier is not an immutable `{ data }` record.
 * @alpha
 */
export type IDefinitionErrorCode =
  | 'invalid-subject'
  | 'invalid-version'
  | 'invalid-callback'
  | 'illegal-edge'
  | 'forged-declaration'
  | 'invalid-descriptor'
  | 'invalid-input'
  | 'conflicting-subject'
  | 'unresolved-parent'
  | 'composition-phase'
  | 'scope-closed'
  | 'scope-inactive'
  | 'unsupported-arguments'
  | 'invalid-result'
  | 'forged-composition'
  | 'invalid-bindings'
  | 'invalid-previous';

/**
 * A rejected declaration, composition or invocation. Rejection always happens
 * before any affected author callback or port dispatch runs.
 * @alpha
 */
export class DefinitionError extends Error {
  /** The violated contract. */
  public readonly code: IDefinitionErrorCode;

  /**
   * @param code - The violated contract.
   * @param message - Human-readable diagnostic detail.
   */
  public constructor(code: IDefinitionErrorCode, message: string) {
    super(message);
    this.name = 'DefinitionError';
    this.code = code;
  }
}
