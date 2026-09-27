/**
 * Node's implementation of the portable Machine host contracts.
 * @packageDocumentation
 */
import type { IMachine } from '@microdelta/machine';

import { _createNodeMachineImplementation } from './node/index.js';

/**
 * Create the Node adapter selected by application assembly. Each call returns
 * fresh async-context storage while sharing no caller-visible mutable state.
 * @alpha
 */
export function createNodeMachine(): IMachine {
  return _createNodeMachineImplementation();
}
