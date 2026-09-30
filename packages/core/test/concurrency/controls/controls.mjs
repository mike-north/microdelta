/**
 * The mutation controls of the M5 concurrency suites. Each control plants one
 * weakened guard into History's emitted build (never its TypeScript source)
 * and names the `experiments/exp-7` model fault it reproduces, so each
 * known-bad configuration with a code counterpart has a control that the Node
 * suites must reject. The first two are the controls the M5 issue requires:
 * the holder guard without its fence check, then without its expiry check.
 * A control is a list of edits; every anchor must occur exactly once.
 *
 * `Publication.tla`'s `omit-publish-fence` fault has its code control in
 * `durable-history/controls/history-mutation-controls.mjs` ("publication
 * ignores the fence"); the holder-guard fence control here covers the same
 * guard for every operation.
 */
import { fileURLToPath } from 'node:url';

/** The repository root for a module inside `packages/core/test/concurrency/controls/`. */
export const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

/** The emitted file every control plants into, relative to the repository root. */
export const target = 'packages/history/dist/src/durable/index.js';

/** The concurrency suite files every control run must execute, and no others. */
export const suites = Object.freeze(['interleavings.test.js', 'contention.test.js']);

/** One planted defect: which model fault it reproduces and the edits that plant it. */
export const controls = Object.freeze([
  {
    name: 'the holder guard ignores the fence',
    model: 'WriterLease',
    fault: 'holder-ignores-fence',
    edits: [{ anchor: 'if (writer.holder !== lease.holder || writer.lastFence !== lease.fence) {', replacement: 'if (writer.holder !== lease.holder) {' }],
  },
  {
    name: 'the holder guard ignores lease expiry',
    model: 'WriterLease',
    fault: 'holder-ignores-expiry',
    edits: [{ anchor: 'else if (writer.expiresAt <= now) {', replacement: 'else if (false) {' }],
  },
  {
    name: 'the holder guard treats the expiry instant as still live',
    model: 'WriterLease',
    fault: 'holder-expiry-inclusive',
    edits: [{ anchor: 'else if (writer.expiresAt <= now) {', replacement: 'else if (writer.expiresAt < now) {' }],
  },
  {
    name: 'a takeover reuses the previous fence',
    model: 'WriterLease',
    fault: 'takeover-without-fence',
    edits: [{ anchor: "const fence = safeSum(writer.lastFence, 1, 'writer fence');", replacement: 'const fence = writer.lastFence === 0 ? 1 : writer.lastFence;' }],
  },
  {
    name: 'acquisition takes over an unexpired holder',
    model: 'WriterLease',
    fault: 'acquire-ignores-expiry',
    edits: [{ anchor: 'if (writer.holder !== null && writer.expiresAt > now) {', replacement: 'if (false) {' }],
  },
  {
    name: 'a waiter’s observation advances the fence',
    model: 'WriterLease',
    fault: 'waiter-advances-fence',
    edits: [{
      anchor: "acquisition = Object.freeze({ kind: 'held', holder: writer.holder, expiresAt: writer.expiresAt });",
      replacement: "statements.setHolder.run(writer.lastFence + 1, writer.holder, writer.expiresAt); acquisition = Object.freeze({ kind: 'held', holder: writer.holder, expiresAt: writer.expiresAt });",
    }],
  },
  {
    name: 'the clock high-water is ignored',
    model: 'WriterLease',
    fault: 'ignore-high-water',
    edits: [{ anchor: 'const now = Math.max(reading, writer.timeHighWater);', replacement: 'const now = reading;' }],
  },
  {
    name: 'renewal adopts the current fence instead of checking the presented one',
    model: 'WriterLease',
    fault: 'renew-ignores-fence',
    edits: [{ anchor: 'return asHolder(lease, (now) => {', replacement: 'return asHolder({ ...lease, fence: readWriter().lastFence }, (now) => {' }],
  },
  {
    // Both layers are weakened: the lifecycle check and the SQL state predicate.
    name: 'abandonment ends a completed attempt',
    model: 'Publication',
    fault: 'abandon-completed',
    edits: [
      { anchor: "if (attempt.state !== 'allocated' && attempt.state !== 'staged') {", replacement: "if (attempt.state !== 'allocated' && attempt.state !== 'staged' && attempt.state !== 'completed') {" },
      { anchor: "WHERE attempt_id = ? AND state IN ('allocated', 'staged')`", replacement: "WHERE attempt_id = ? AND state IN ('allocated', 'staged', 'completed')`" },
    ],
  },
  {
    name: 'recording an acceptance rewinds the current pointer',
    model: 'Publication',
    fault: 'accept-moves-current',
    edits: [{
      anchor: 'statements.setAcceptanceSequence.run(acceptanceId);',
      replacement: "statements.setAcceptanceSequence.run(acceptanceId); connection.prepare('UPDATE history_current SET result_id = ? WHERE analysis = ? AND environment = ? AND subject = (SELECT subject FROM history_results WHERE result_id = ?)').run(resultId, scope.analysis, scope.environment, resultId);",
    }],
  },
]);

/** Apply a control's edits to the original emitted text, or fail if an anchor is not unique. */
export function plant(original, control) {
  return control.edits.reduce((text, edit) => {
    const count = original.split(edit.anchor).length - 1;
    if (count !== 1) {
      throw new Error(`${control.name}: anchor occurs ${String(count)} times`);
    }
    return text.replace(edit.anchor, edit.replacement);
  }, original);
}
