/**
 * Placeholder Run Supervision engine: every operation fails. Replaced by the
 * implementation once the owner suites have been observed failing against it.
 */
import type { IRunContext, IRunOptions, IRun, IRunResult, ISupervision, ISupervisionOptions } from './contracts.js';
import { SupervisionError } from './errors.js';

/**
 * Create Run Supervision over an injected scope capability.
 * @param options - The scope capability.
 * @returns The Supervision contract.
 * @alpha
 */
export function createSupervision(options: ISupervisionOptions): ISupervision {
  void options;
  return Object.freeze({
    current(): IRunContext {
      throw new SupervisionError('invalid-request', 'Run Supervision is not implemented yet');
    },
    run<T>(runOptions: IRunOptions, body: (run: IRun) => T | Promise<T>): Promise<IRunResult<Awaited<T>>> {
      void runOptions;
      void body;
      return Promise.reject(new SupervisionError('invalid-request', 'Run Supervision is not implemented yet'));
    },
  });
}
