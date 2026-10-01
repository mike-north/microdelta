/**
 * The facade's host, selected once by assembly: the Node Machine supplies
 * snapshots, asynchronous context and SHA-256 to every owner the facade
 * composes, and Node's secure random identifier source mints identities that
 * must never repeat across processes or hosts (run identifiers here, and
 * Supervision's operation identities through its random port). Owners
 * receive these through their injected ports; none imports them.
 */
import { createNodeMachine, createNodeRandom } from '@microdelta/machine-node';

/** The one Node Machine every facade assembly shares. */
export const machine: ReturnType<typeof createNodeMachine> = createNodeMachine();

/** Node's random identifier source: 128 secure random bits per identifier. */
export const random: ReturnType<typeof createNodeRandom> = createNodeRandom();
