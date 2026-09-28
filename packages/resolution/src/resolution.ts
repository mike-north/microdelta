/**
 * Reuse Resolution engine (placeholder until the tests-first contract suites exist).
 */
import type { IResolution, IResolutionOptions } from './contracts.js';
import { ResolutionError } from './errors.js';

/**
 * Create Resolution over one composition and History scope.
 * @param options - Ports, composition and bindings.
 * @returns The Resolution contract.
 * @alpha
 */
export function createResolution<TInputs extends object, THelpers extends object>(options: IResolutionOptions<TInputs, THelpers>): IResolution {
  void options;
  throw new ResolutionError('invalid-request', 'Reuse Resolution is not implemented yet');
}
