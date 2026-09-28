/**
 * The facade's host, selected once by assembly: the Node Machine supplies
 * snapshots, asynchronous context and SHA-256 to every owner the facade
 * composes. Owners receive it through their injected ports; none imports it.
 */
import { createNodeMachine } from '@microdelta/machine-node';

/** The one Node Machine every facade assembly shares. */
export const machine: ReturnType<typeof createNodeMachine> = createNodeMachine();
