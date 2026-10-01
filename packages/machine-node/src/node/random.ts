/**
 * Node's random identifier source for Machine's portable capability. Each
 * identifier is 16 bytes from Node's cryptographically secure generator,
 * rendered as 32 lowercase hexadecimal characters. Node throws when it cannot
 * supply secure randomness, and that failure passes through unchanged.
 * @packageDocumentation
 */
import { randomBytes } from 'node:crypto';

import type { IRandomIdentifierCapability } from '@microdelta/machine';

/** The number of random bytes in one identifier: 128 bits. */
const identifierBytes = 16;

/** Bind the portable random identifier contract to Node's secure generator. @internal */
export function _createNodeRandomImplementation(): IRandomIdentifierCapability {
  return Object.freeze({
    randomIdentifier(): string {
      return randomBytes(identifierBytes).toString('hex');
    },
  });
}
