/** The worker reaches the leaf through this imported module, retaining its explicit declared helper identity. */
export { dependency } from './gap-hunt-source-artifact-leaf.js';

/** A declared intermediary invokes the current tracked leaf supplied by the facade's helper view. */
export function intermediary(leaf: (value: number) => number, value: number): number {
  return leaf(value);
}
