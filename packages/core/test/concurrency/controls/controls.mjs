/**
 * The mutation controls of the M5 concurrency suites. Each control plants one
 * weakened writer guard into History's emitted build (never its TypeScript
 * source) and names the `experiments/exp-7/WriterLease.tla` fault it
 * reproduces, so every model known-bad configuration has a code counterpart
 * that the Node suites must reject. The first two are the controls the M5
 * issue requires: the holder guard without its fence check, then without its
 * expiry check.
 */
import { fileURLToPath } from 'node:url';

/** The repository root for a module inside `packages/core/test/concurrency/controls/`. */
export const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

/** The emitted file every control plants into, relative to the repository root. */
export const target = 'packages/history/dist/src/durable/index.js';

/** The concurrency suite files every control run must execute, and no others. */
export const suites = Object.freeze(['interleavings.test.js', 'contention.test.js']);

/** One planted defect: its anchor must occur exactly once in the emitted target. */
export const controls = Object.freeze([
  {
    name: 'the holder guard ignores the fence',
    fault: 'holder-ignores-fence',
    anchor: 'if (writer.holder !== lease.holder || writer.lastFence !== lease.fence) {',
    replacement: 'if (writer.holder !== lease.holder) {',
  },
  {
    name: 'the holder guard ignores lease expiry',
    fault: 'holder-ignores-expiry',
    anchor: 'else if (writer.expiresAt <= now) {',
    replacement: 'else if (false) {',
  },
  {
    name: 'a takeover reuses the previous fence',
    fault: 'takeover-without-fence',
    anchor: "const fence = safeSum(writer.lastFence, 1, 'writer fence');",
    replacement: 'const fence = writer.lastFence === 0 ? 1 : writer.lastFence;',
  },
  {
    name: 'acquisition takes over an unexpired holder',
    fault: 'acquire-ignores-expiry',
    anchor: 'if (writer.holder !== null && writer.expiresAt > now) {',
    replacement: 'if (false) {',
  },
  {
    name: 'a waiter’s observation advances the fence',
    fault: 'waiter-advances-fence',
    anchor: "acquisition = Object.freeze({ kind: 'held', holder: writer.holder, expiresAt: writer.expiresAt });",
    replacement: "statements.setHolder.run(writer.lastFence + 1, writer.holder, writer.expiresAt); acquisition = Object.freeze({ kind: 'held', holder: writer.holder, expiresAt: writer.expiresAt });",
  },
  {
    name: 'the clock high-water is ignored',
    fault: 'ignore-high-water',
    anchor: 'const now = Math.max(reading, writer.timeHighWater);',
    replacement: 'const now = reading;',
  },
  {
    name: 'renewal adopts the current fence instead of checking the presented one',
    fault: 'renew-ignores-fence',
    anchor: 'return asHolder(lease, (now) => {',
    replacement: 'return asHolder({ ...lease, fence: readWriter().lastFence }, (now) => {',
  },
]);
