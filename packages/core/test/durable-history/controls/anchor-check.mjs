/**
 * Anchor-only drift check shared by the facade's mutation-control runners.
 *
 * A control plants its fault by replacing an exact anchor in an emitted build,
 * so a refactor that renames or duplicates the anchored text silently disarms
 * it. Every runner already refuses to judge a control whose anchor does not
 * match exactly once, but only after minutes of baseline test runs. This
 * module lets each runner expose a cheap `--check-anchors` mode that reads the
 * current builds, verifies every plant matches exactly once and exits without
 * running any suite, so `npm test` can detect drift at the moment it happens.
 *
 * The module only counts anchors; it owns no control, build path or policy.
 */

/** The command-line switch that selects the anchor-only mode of a runner. */
export const checkAnchorsFlag = '--check-anchors';

/** Whether the runner was started in anchor-only mode. */
export function anchorCheckRequested(argv = process.argv) {
  return argv.includes(checkAnchorsFlag);
}

/** How many non-overlapping times `anchor` occurs in `text`. An empty anchor never matches. */
export function countAnchor(text, anchor) {
  return anchor === '' ? 0 : text.split(anchor).length - 1;
}

/**
 * The diagnostics for every plant whose anchor does not occur exactly once.
 * Each plant names its control, the file it edits, that file's current text
 * and the anchor.
 */
export function anchorProblems(plants) {
  return plants.flatMap(({ control, file, text, anchor }) => {
    const count = countAnchor(text, anchor);
    return count === 1 ? [] : [`ANCHOR ${String(count)}x in ${file}: ${control}`];
  });
}

/** Print the outcome of an anchor-only check and return the process exit code (0 only when no problem). */
export function reportAnchorCheck(problems, controlCount) {
  for (const problem of problems) {
    console.log(problem);
  }
  console.log(`${problems.length === 0 ? 'ANCHORS OK' : 'ANCHORS FAIL'}: ${String(controlCount)} controls`);
  return problems.length === 0 ? 0 : 1;
}
