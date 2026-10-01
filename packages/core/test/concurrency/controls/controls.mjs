/**
 * The mutation controls of the M5 concurrency suites. Each control plants one
 * weakened guard into an emitted build (never TypeScript source): History's
 * lease authority, or Run Supervision's wait for the writer lease. A control
 * names the `experiments/exp-7` model fault it reproduces, so each known-bad
 * configuration with a code counterpart has a control that the Node suites
 * must reject; a control with no model counterpart instead states why the
 * model cannot express it. The first two are the controls the M5 issue
 * requires: the holder guard without its fence check, then without its expiry
 * check. A control is a list of edits to one target; every anchor must occur
 * exactly once in that target.
 *
 * `Publication.tla`'s `omit-publish-fence` fault has its code control in
 * `durable-history/controls/history-mutation-controls.mjs` ("publication
 * ignores the fence"); the holder-guard fence control here covers the same
 * guard for every operation.
 */
import { fileURLToPath } from 'node:url';

/** The repository root for a module inside `packages/core/test/concurrency/controls/`. */
export const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

/** History's emitted durable authority, relative to the repository root: the default target. */
export const target = 'packages/history/dist/src/durable/index.js';

/** Run Supervision's emitted wait for the writer lease, relative to the repository root. */
export const waitTarget = 'packages/supervision/dist/src/writer.js';

/**
 * Run Supervision's wait as its own owner tests load it: their test build
 * compiles the same source with the same compiler, so its JavaScript matches
 * `waitTarget` apart from the source-map comment.
 */
export const waitTestTarget = 'packages/supervision/.test-build/src/writer.js';

/** The facade's writer port as the facade's tests and workers load it, from the facade's test build. */
export const portTarget = 'packages/core/.test-build/src/writer.js';

/** Run Supervision's run engine as its own owner tests load it, from its test build. */
export const runTestTarget = 'packages/supervision/.test-build/src/supervision.js';

/** Every emitted file some control plants into. */
export const targets = Object.freeze([target, waitTarget, waitTestTarget, portTarget, runTestTarget]);

/** The file one control plants into. */
export function targetOf(control) {
  return control.target ?? target;
}

/**
 * The emitted file whose text proves a control's anchors in `npm test`. A
 * test-build target is checked through its package's build output when the
 * test build does not exist yet (the workspace runs packages' tests in
 * name order), since both compile the same source to the same JavaScript.
 */
export function anchorSourceOf(control) {
  const path = targetOf(control);
  return path.startsWith('packages/supervision/.test-build/') ? path.replace('/.test-build/', '/dist/') : path;
}

/**
 * The suites a control run executes, by group. `concurrency` (the default) is
 * the facade's cross-process and port suites; `supervision` is Run
 * Supervision's own writer-wait suite, for a defect only an owner test can
 * observe, such as a retained abort listener.
 */
export const groups = Object.freeze({
  concurrency: Object.freeze({ cwd: 'packages/core', directory: '.test-build/test/concurrency', suites: Object.freeze(['interleavings.test.js', 'contention.test.js', 'writer-port.test.js']) }),
  supervision: Object.freeze({ cwd: 'packages/supervision', directory: '.test-build/test', suites: Object.freeze(['writer-wait.test.js']) }),
});

/** The run group of one control. */
export function groupOf(control) {
  return control.group ?? 'concurrency';
}

/** The concurrency suite files every default control run must execute, and no others. */
export const suites = groups.concurrency.suites;

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
    edits: [{ anchor: 'return orContended(() => asHolder(lease, (now) => {', replacement: 'return orContended(() => asHolder({ ...lease, fence: readWriter().lastFence }, (now) => {' }],
  },
  {
    name: 'acquisition takes over one millisecond before the recorded expiry',
    model: 'WriterLease',
    fault: 'takeover-before-expiry',
    edits: [{ anchor: 'if (writer.holder !== null && writer.expiresAt > now) {', replacement: 'if (writer.holder !== null && writer.expiresAt > now + 1) {' }],
  },
  {
    name: 'renewal and release write the presented fence back into the writer row',
    model: null,
    unmodeled: 'While the holder guard holds, the presented fence equals the durable one, so the model cannot tell writing it back from leaving it; F1 observes the column assignment itself.',
    edits: [
      { anchor: 'statements.extendHolder.run(expiresAt);', replacement: 'statements.setHolder.run(lease.fence, lease.holder, expiresAt);' },
      { anchor: 'statements.clearHolder.run(now);', replacement: 'statements.setHolder.run(lease.fence, null, now);' },
    ],
  },
  {
    name: 'writer-busy reports no holder',
    model: 'WriterLease',
    fault: 'busy-without-holder',
    target: waitTarget,
    edits: [{ anchor: 'throw new WriterBusyError(attempt, deadline);', replacement: 'throw new WriterBusyError({ ...attempt, holder: undefined }, deadline);' }],
  },
  {
    name: 'waiting ignores the operator deadline',
    model: null,
    unmodeled: 'The deadline is process-local arithmetic; the model lets a waiter give up at any held observation and does not represent deadlines or liveness.',
    target: waitTarget,
    edits: [{ anchor: 'if (deadline !== undefined && now >= deadline) {', replacement: 'if (false) {' }],
  },
  {
    name: 'writer-busy reports an earlier try instead of the final one',
    model: 'WriterLease',
    fault: 'busy-on-stale-observation',
    target: waitTarget,
    edits: [
      { anchor: 'for (;;) {', replacement: 'let earliest; for (;;) {' },
      { anchor: 'const attempt = wait.writer.tryLease();', replacement: "const attempt = wait.writer.tryLease(); if (attempt.kind !== 'acquired') { earliest ??= attempt; }" },
      { anchor: 'throw new WriterBusyError(attempt, deadline);', replacement: 'throw new WriterBusyError(earliest ?? attempt, deadline);' },
    ],
  },
  {
    name: 'every failure of acquisition becomes contention',
    model: null,
    unmodeled: 'SQLite locks and host failures are outside the model; the port suite shows that damaged storage and clock failures must stay failures.',
    edits: [{
      anchor: 'const busy = orContended(() => connection.transaction(() => {',
      replacement: 'const busy = ((operation) => { try { return operation(); } catch (error) { return contention(error); } })(() => connection.transaction(() => {',
    }],
  },
  {
    name: 'the port treats a busy renewal as stale and swallows renewal failures',
    model: null,
    unmodeled: 'The port is a translation layer outside the model; the model has no storage contention for a renewal to report.',
    target: portTarget,
    edits: [
      {
        anchor: "if (renewal.kind === 'contended') {\n                        return contended(renewal, held);\n                    }",
        replacement: "if (renewal.kind === 'contended') {\n                        throw new StaleWriterError('treated as stale');\n                    }",
      },
      {
        anchor: 'if (!(error instanceof StaleWriterError)) {\n                        throw error;\n                    }\n                    held = undefined;',
        replacement: 'held = undefined;',
      },
    ],
  },
  {
    name: 'a wait does not remove its abort listener on waking',
    model: null,
    unmodeled: 'Listener retention is a resource property of one process; the model has no listeners. Only the owner suite can count them.',
    target: waitTestTarget,
    group: 'supervision',
    edits: [{ anchor: 'removeListener();\n            resolve();', replacement: 'resolve();' }],
  },
  {
    // Every normal request (resolve, members, strict and outcome fold) obtains its first pass's lease in one place.
    name: 'a normal request tries the writer once and fails busy instead of waiting',
    model: null,
    unmodeled: 'Which run operation waits is Supervision wiring outside the model; the owner suite runs the wait over every normal request.',
    target: runTestTarget,
    group: 'supervision',
    edits: [{
      anchor: 'if (number === 1 || writerPolicy.deadline !== undefined) {\n                return writerLease();\n            }',
      replacement: "if (number === 1 || writerPolicy.deadline !== undefined) {\n                const tried = writer.tryLease();\n                if (tried.kind !== 'acquired') {\n                    throw new SupervisionError('writer-busy', 'single try without waiting');\n                }\n                return tried.lease;\n            }",
    }],
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
